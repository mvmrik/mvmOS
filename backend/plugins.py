import httpx
import json
import os
import shutil
import time
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn, APPS_DIR
from . import app_backends

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

# cache per URL: { url: (data, timestamp) }
_cache: dict = {}
_CACHE_TTL = 120


async def _fetch_json(url: str) -> dict:
    cached = _cache.get(url)
    if cached and time.time() - cached[1] < _CACHE_TTL:
        return cached[0]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    _cache[url] = (data, time.time())
    return data


def _cache_bust(url: str):
    _cache.pop(url, None)


def _installed_map() -> dict:
    """Returns {plugin_id: row} for all installed plugins."""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM plugins").fetchall()
    return {r["id"]: dict(r) for r in rows}


def _app_dir(plugin_id: str) -> str:
    return os.path.join(APPS_DIR, plugin_id)


def _annotate(apps: list, installed: dict) -> list:
    result = []
    for app in apps:
        inst = installed.get(app["id"])
        result.append({
            **app,
            "installed": inst is not None,
            "update_available": inst is not None and inst["version"] != app.get("version", ""),
        })
    return result


# ── Stores ────────────────────────────────────────────────────────────────────

@router.get("/stores")
async def list_stores(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM stores ORDER BY official DESC, added_at").fetchall()
    return JSONResponse([dict(r) for r in rows])


class StoreRequest(BaseModel):
    name: str
    manifest_url: str


@router.post("/stores")
async def add_store(body: StoreRequest, session=Depends(get_current_session)):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(body.manifest_url)
            r.raise_for_status()
            data = r.json()
        # support both v2 (categories) and v1 (apps list)
        if "categories" in data:
            cats = data["categories"]
            if not isinstance(cats, list) or not cats:
                return JSONResponse({"error": "Invalid manifest: 'categories' must be a non-empty list"}, status_code=400)
            for cat in cats:
                for field in ("id", "name", "manifest_url"):
                    if not cat.get(field):
                        return JSONResponse({"error": f"Category '{cat.get('id','?')}' is missing '{field}'"}, status_code=400)
        elif "apps" in data:
            apps = data["apps"]
            if not isinstance(apps, list):
                return JSONResponse({"error": "Invalid manifest: 'apps' must be a list"}, status_code=400)
            for i, app in enumerate(apps):
                for field in ("id", "name", "version"):
                    if not app.get(field):
                        return JSONResponse({"error": f"App #{i+1} is missing required field '{field}'"}, status_code=400)
                if not app.get("base_url") and not app.get("js_url"):
                    return JSONResponse({"error": f"App '{app['id']}' is missing 'base_url' or 'js_url'"}, status_code=400)
        else:
            return JSONResponse({"error": "Invalid manifest: must have 'categories' or 'apps' key"}, status_code=400)
    except JSONResponse:
        raise
    except Exception as e:
        return JSONResponse({"error": f"Cannot reach manifest: {e}"}, status_code=400)
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO stores (name, manifest_url, official) VALUES (?, ?, 0)",
                (body.name, body.manifest_url),
            )
        except Exception:
            return JSONResponse({"error": "Store already exists"}, status_code=409)
    return JSONResponse({"ok": True})


@router.delete("/stores/{store_id}")
async def remove_store(store_id: int, session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT official FROM stores WHERE id=?", (store_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "Not found"}, status_code=404)
        if row["official"]:
            return JSONResponse({"error": "Cannot remove the official store"}, status_code=403)
        conn.execute("DELETE FROM stores WHERE id=?", (store_id,))
    return JSONResponse({"ok": True})


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories")
async def get_categories(store_id: int = 0, session=Depends(get_current_session)):
    with get_conn() as conn:
        if store_id:
            row = conn.execute("SELECT manifest_url FROM stores WHERE id=?", (store_id,)).fetchone()
        else:
            row = conn.execute("SELECT manifest_url FROM stores WHERE official=1").fetchone()
    if not row:
        return JSONResponse({"error": "Store not found"}, status_code=404)
    try:
        data = await _fetch_json(row["manifest_url"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    if "categories" in data:
        return JSONResponse({"version": 2, "categories": data["categories"]})
    # v1 fallback — build synthetic category list from apps
    apps = data.get("apps", [])
    cats = {}
    for app in apps:
        cat = app.get("category", "Utilities")
        cats[cat] = cats.get(cat, 0) + 1
    return JSONResponse({"version": 1, "categories": [
        {"id": cat.lower(), "name": cat, "icon": "📦", "count": count}
        for cat, count in cats.items()
    ], "_apps": apps})


@router.get("/category-apps")
async def get_category_apps(store_id: int = 0, category_url: str = "", category_id: str = "",
                             session=Depends(get_current_session)):
    # If direct category manifest URL provided, fetch it
    if category_url:
        try:
            data = await _fetch_json(category_url)
            apps = data.get("apps", [])
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=502)
    else:
        # v1 fallback — filter from root manifest
        with get_conn() as conn:
            if store_id:
                row = conn.execute("SELECT manifest_url FROM stores WHERE id=?", (store_id,)).fetchone()
            else:
                row = conn.execute("SELECT manifest_url FROM stores WHERE official=1").fetchone()
        if not row:
            return JSONResponse({"error": "Store not found"}, status_code=404)
        try:
            data = await _fetch_json(row["manifest_url"])
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        all_apps = data.get("apps", [])
        apps = [a for a in all_apps if a.get("category", "").lower() == category_id.lower()]

    installed = _installed_map()
    return JSONResponse(_annotate(apps, installed))


# ── Manifest per store (legacy, kept for update checks) ───────────────────────

@router.get("/manifest")
async def get_manifest(store_id: int = 0, session=Depends(get_current_session)):
    with get_conn() as conn:
        if store_id:
            row = conn.execute("SELECT manifest_url FROM stores WHERE id=?", (store_id,)).fetchone()
        else:
            row = conn.execute("SELECT manifest_url FROM stores WHERE official=1").fetchone()
    if not row:
        return JSONResponse({"error": "Store not found"}, status_code=404)
    try:
        data = await _fetch_json(row["manifest_url"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    # v2: collect all apps from all categories
    if "categories" in data:
        all_apps = []
        async with httpx.AsyncClient(timeout=10) as client:
            for cat in data["categories"]:
                cat_url = cat.get("manifest_url")
                if not cat_url:
                    continue
                try:
                    cat_data = await _fetch_json(cat_url)
                    all_apps.extend(cat_data.get("apps", []))
                except Exception:
                    pass
        installed = _installed_map()
        return JSONResponse(_annotate(all_apps, installed))

    apps = data.get("apps", [])
    installed = _installed_map()
    return JSONResponse(_annotate(apps, installed))


# ── Installed plugins ─────────────────────────────────────────────────────────

@router.get("")
async def list_plugins(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT p.*, s.name as store_name, s.official "
            "FROM plugins p LEFT JOIN stores s ON p.store_id = s.id "
            "ORDER BY p.open_count DESC, p.last_opened_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        item = dict(r)
        mf_path = os.path.join(_app_dir(r["id"]), "manifest.json")
        try:
            with open(mf_path) as f:
                mf = json.load(f)
            item["settings"] = mf.get("settings", [])
        except Exception:
            item["settings"] = []
        result.append(item)
    return JSONResponse(result)


# ── Install ───────────────────────────────────────────────────────────────────

class InstallRequest(BaseModel):
    id: str
    name: str
    icon: str = "📦"
    category: str = "Utilities"
    version: str = "1.0.0"
    description: str = ""
    # either a direct js_url (legacy single-file) or a base_url to fetch manifest.json from
    js_url: str = ""
    base_url: str = ""
    store_id: int = 0
    install_backend: bool = False


@router.post("/install")
async def install_plugin(body: InstallRequest, session=Depends(get_current_session)):
    app_dir = _app_dir(body.id)
    os.makedirs(app_dir, exist_ok=True)

    async with httpx.AsyncClient(timeout=15) as client:
        if body.base_url:
            # fetch per-app manifest.json first
            try:
                mf_url = body.base_url.rstrip("/") + "/manifest.json"
                mf_r = await client.get(mf_url)
                mf_r.raise_for_status()
                mf = mf_r.json()
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch app manifest: {e}"}, status_code=502)

            entry = mf.get("entry", "main.js")

            # check for backend.py BEFORE writing any files
            backend_url = body.base_url.rstrip("/") + "/backend.py"
            try:
                be_r = await client.get(backend_url)
                has_be = be_r.status_code == 200
                be_code = be_r.text if has_be else None
            except Exception:
                has_be = False
                be_code = None

            # if backend exists and not yet confirmed → ask first, write nothing
            if has_be and not body.install_backend:
                return JSONResponse({"needs_backend_confirm": True, "entry": entry})

            # confirmed (or no backend) — now write all files
            with open(os.path.join(app_dir, "manifest.json"), "w") as f:
                json.dump(mf, f)

            try:
                js_r = await client.get(body.base_url.rstrip("/") + "/" + entry)
                js_r.raise_for_status()
                with open(os.path.join(app_dir, entry), "w") as f:
                    f.write(js_r.text)
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch entry JS: {e}"}, status_code=502)

            css_file = mf.get("css")
            if css_file:
                try:
                    css_r = await client.get(body.base_url.rstrip("/") + "/" + css_file)
                    if css_r.status_code == 200:
                        with open(os.path.join(app_dir, css_file), "w") as f:
                            f.write(css_r.text)
                except Exception:
                    pass

            if body.install_backend and has_be and be_code:
                app_backends.install(body.id, be_code)

            entry_path = entry
        else:
            # legacy single js_url
            try:
                js_r = await client.get(body.js_url)
                js_r.raise_for_status()
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch plugin: {e}"}, status_code=502)
            with open(os.path.join(app_dir, "main.js"), "w") as f:
                f.write(js_r.text)
            mf = {"id": body.id, "name": body.name, "icon": body.icon,
                  "category": body.category, "version": body.version,
                  "description": body.description, "entry": "main.js"}
            with open(os.path.join(app_dir, "manifest.json"), "w") as f:
                json.dump(mf, f)
            entry_path = "main.js"

    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO plugins
               (id, name, icon, category, version, description, store_id, installed_at, open_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), COALESCE(
                   (SELECT open_count FROM plugins WHERE id=?), 0))""",
            (body.id, body.name, body.icon, body.category,
             body.version, body.description, body.store_id or None, body.id),
        )
    return JSONResponse({"ok": True, "entry": entry_path})


# ── Uninstall ─────────────────────────────────────────────────────────────────

@router.delete("/{plugin_id}")
async def uninstall_plugin(plugin_id: str, session=Depends(get_current_session)):
    app_dir = _app_dir(plugin_id)
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    app_backends.uninstall(plugin_id)
    with get_conn() as conn:
        conn.execute("DELETE FROM plugins WHERE id=?", (plugin_id,))
    return JSONResponse({"ok": True})


# ── App database ─────────────────────────────────────────────────────────────

class DbRequest(BaseModel):
    sql: str
    params: list = []

@router.post("/{plugin_id}/db")
async def app_db(plugin_id: str, body: DbRequest, session=Depends(get_current_session)):
    app_dir = _app_dir(plugin_id)
    if not os.path.isdir(app_dir):
        return JSONResponse({"error": "App not installed"}, status_code=404)
    db_path = os.path.join(app_dir, "data.db")
    try:
        import sqlite3 as _sqlite3
        conn = _sqlite3.connect(db_path)
        conn.row_factory = _sqlite3.Row
        cur = conn.execute(body.sql, body.params)
        conn.commit()
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        conn.close()
        return JSONResponse({"rows": rows, "rowcount": cur.rowcount})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


# ── Track opens ───────────────────────────────────────────────────────────────

@router.post("/{plugin_id}/open")
async def track_open(plugin_id: str, session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute(
            "UPDATE plugins SET open_count=open_count+1, last_opened_at=strftime('%s','now') WHERE id=?",
            (plugin_id,),
        )
    return JSONResponse({"ok": True})
