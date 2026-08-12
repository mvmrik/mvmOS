import httpx
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import time
import zipfile
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn, APPS_DIR, SYSTEM_APPS
from . import app_backends
from . import premium

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

# cache per URL: { url: (data, timestamp) }
_cache: dict = {}
_CACHE_TTL = 120


def _core_version() -> str:
    try:
        vf = os.path.join(os.path.dirname(__file__), "..", "version.txt")
        return open(vf).read().strip()
    except Exception:
        return "0.0.0"

def _version_tuple(v: str):
    import re
    nums = re.findall(r'\d+', v)
    return tuple(int(x) for x in nums[:3]) if nums else (0, 0, 0)

def _satisfies_min_version(min_ver: str) -> bool:
    return _version_tuple(_core_version()) >= _version_tuple(min_ver)


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


def _apply_schema(db_path: str, schema: dict):
    """Apply db.json schema to SQLite DB — create tables and add missing columns."""
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        for table in schema.get("tables", []):
            name = table["name"]
            cols = table["columns"]
            exists = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
            ).fetchone()
            if not exists:
                col_defs = []
                for col in cols:
                    defn = f"{col['name']} {col['type']}"
                    if col.get("primary"):
                        defn += " PRIMARY KEY"
                    if col.get("default") is not None:
                        defn += f" DEFAULT {col['default']!r}"
                    col_defs.append(defn)
                conn.execute(f"CREATE TABLE {name} ({', '.join(col_defs)})")
            else:
                existing_cols = {row[1] for row in conn.execute(f"PRAGMA table_info({name})")}
                for col in cols:
                    if col["name"] not in existing_cols:
                        defn = f"{col['name']} {col['type']}"
                        if col.get("default") is not None:
                            defn += f" DEFAULT {col['default']!r}"
                        conn.execute(f"ALTER TABLE {name} ADD COLUMN {defn}")
        conn.commit()
    finally:
        conn.close()


async def _sync_premium(plugin_id: str) -> None:
    """Install/update hook for the premium build.

    Always wipes any existing premium/ first, then re-fetches from mvmos.org
    only if this installation is licensed right now — so an app can never be
    left with a premium build made for a different version of itself, and a
    lapsed licence loses it on the next update.

    Never raises: an unreachable mvmos.org must not fail an install that has
    already written its files and its DB row.
    """
    try:
        await sys.modules["backend.premium"].sync_premium(plugin_id)
    except Exception as e:
        print(f"[plugins] premium sync failed for {plugin_id}: {e}")


def _install_from_zip(zip_bytes: bytes, plugin_id: str, install_backend: bool) -> dict:
    """
    Extract a zip and distribute files:
      manifest.json, db.json, premium/, api.py/desktop.py/other root .py → apps/<id>/
      everything else (main.js, css, html, public/*)                    → apps/<id>/public/
      backend/ folder (only for apps approved for one)                  → backend/apps/<id>/
    Returns the parsed manifest dict.
    """
    app_dir = _app_dir(plugin_id)
    backend_app_dir = os.path.join(os.path.dirname(__file__), "apps", plugin_id)
    os.makedirs(app_dir, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()

        # detect optional top-level prefix (e.g. "qbit-dashboard/")
        prefix = ""
        if names and "/" in names[0]:
            candidate = names[0].split("/")[0] + "/"
            if all(n.startswith(candidate) for n in names):
                prefix = candidate

        def _strip(name: str) -> str:
            return name[len(prefix):]

        mf_data = None
        has_backend = False
        be_code = None
        pub_code = None

        for zname in names:
            rel = _strip(zname)
            if not rel or rel.endswith("/"):
                continue

            data = zf.read(zname)
            parts = rel.split("/")

            if rel == "manifest.json":
                mf_data = json.loads(data)
                dest = os.path.join(app_dir, "manifest.json")
                open(dest, "wb").write(data)

            elif parts[0] == "backend":
                has_backend = True
                if rel == "backend/backend.py":
                    be_code = data.decode()
                elif rel == "backend/public.py":
                    pub_code = data.decode()
                if not install_backend:
                    continue
                # install backend files
                sub = "/".join(parts[1:])
                dest = os.path.join(backend_app_dir, sub)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, "wb").write(data)

            elif rel in ("db.json", "extension.json") or parts[0] == "premium" or (
                    len(parts) == 1 and rel.endswith(".py")):
                # Schema, the app's own server code (api.py, desktop.py, and
                # plugin files like telegram.py / mp_game.py / scheduler.py)
                # and its premium/ build all belong beside public/, never
                # inside it — none of this may ever be reachable by URL.
                dest = os.path.join(app_dir, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, "wb").write(data)

            else:
                # Everything the browser loads — main.js, css, the public page.
                # A zip may list these flat or under public/; both land in
                # public/, the app's only served folder.
                sub = "/".join(parts[1:]) if parts[0] == "public" else rel
                dest = os.path.join(app_dir, "public", sub)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, "wb").write(data)

        if mf_data is None:
            raise ValueError("manifest.json not found in zip")

        # apply db.json schema if present
        db_json_path = os.path.join(app_dir, "db.json")
        if os.path.exists(db_json_path):
            try:
                schema = json.loads(open(db_json_path).read())
                db_path = os.path.join(app_dir, "data.db")
                _apply_schema(db_path, schema)
            except Exception:
                pass

        if has_backend and not install_backend:
            return {"manifest": mf_data, "needs_backend_confirm": True, "be_code": be_code}

        if install_backend and be_code:
            app_backends.install(plugin_id, be_code)
            # auto-enable startup if the backend defines on_startup()
            import sys as _sys
            mod = _sys.modules.get(f"app_backend_{plugin_id}")
            if mod is not None and hasattr(mod, "on_startup"):
                from .startup import _init_startup_db, run_startup_apps
                from .db import get_conn as _get_conn
                _init_startup_db()
                with _get_conn() as _c:
                    _c.execute(
                        "INSERT OR IGNORE INTO startup_apps(app_id,enabled) VALUES(?,1)",
                        (plugin_id,)
                    )
                import asyncio as _asyncio
                try:
                    _asyncio.get_running_loop().create_task(mod.on_startup())
                except RuntimeError:
                    pass
        if install_backend and pub_code:
            from . import public_loader
            public_loader.install(plugin_id, pub_code)
        if os.path.isfile(os.path.join(app_dir, "api.py")) or os.path.isfile(os.path.join(app_dir, "desktop.py")):
            # api.py/desktop.py were just written straight into app_dir above
            # (the modern format) rather than passed as pub_code — public_loader
            # only picks those up at process startup unless told to reload now,
            # which would otherwise leave the app's routes 404 until a restart.
            from . import public_loader
            public_loader.reload_app(plugin_id)

        return {"manifest": mf_data, "needs_backend_confirm": False}


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
                if not app.get("zip_url") and not app.get("base_url") and not app.get("js_url"):
                    return JSONResponse({"error": f"App '{app['id']}' is missing 'zip_url', 'base_url' or 'js_url'"}, status_code=400)
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
            item["replaces_widget"] = mf.get("replaces_widget")
            # manifest.json sits beside public/, not inside it, so the loader
            # cannot fetch it over HTTP any more — it reads entry/css here.
            item["entry"] = mf.get("entry", "main.js")
            item["css"] = mf.get("css")
            # public_directory: false means the app has no single public page of
            # its own (e.g. mvmSiteBuilder — each site gets its own URL under
            # /pub/mvmsitebuilder/<slug>, so the bare public_url is meaningless) —
            # same flag backend/apphub.py's public-apps listing already honors.
            item["public_url"] = mf.get("public_url") if mf.get("public_directory") is not False else None
            try:
                from .extensions import load_extension_metadata
                ext = load_extension_metadata(r["id"])
                item["browser_extension"] = {
                    "version": ext["version"],
                    "targets": ext["targets"],
                    "distribution": ext["distribution"],
                } if ext else None
            except Exception:
                item["browser_extension"] = None
        except Exception:
            item["settings"] = []
            item["replaces_widget"] = None
            # System apps have no manifest.json, so the lookup above always
            # fails for them — but apphub's public page is core-wired (not
            # manifest-driven), so it needs a hardcoded public_url or its
            # desktop window never gets the shared footer's public-page link.
            item["public_url"] = "/pub/apphub/" if r["id"] == "apphub" else None
            item["browser_extension"] = None
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
    # preferred: zip_url pointing to a .zip package
    zip_url: str = ""
    # legacy: a direct js_url (single-file) or a base_url to fetch manifest.json from
    js_url: str = ""
    base_url: str = ""
    store_id: int = 0
    install_backend: bool = False


@router.post("/install")
async def install_plugin(body: InstallRequest, session=Depends(get_current_session)):
    app_dir = _app_dir(body.id)
    os.makedirs(app_dir, exist_ok=True)

    async with httpx.AsyncClient(timeout=30) as client:
        if body.zip_url:
            # ── Zip-based install ──────────────────────────────────────────
            try:
                r = await client.get(body.zip_url)
                r.raise_for_status()
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch zip: {e}"}, status_code=502)

            try:
                result = _install_from_zip(r.content, body.id, body.install_backend)
            except Exception as e:
                return JSONResponse({"error": str(e)}, status_code=400)

            if result.get("needs_backend_confirm"):
                return JSONResponse({"needs_backend_confirm": True, "entry": result["manifest"].get("entry", "main.js")})

            mf = result["manifest"]

            # check min_core_version
            min_ver = mf.get("min_core_version")
            if min_ver and not _satisfies_min_version(min_ver):
                return JSONResponse({"error": f"requires_core_{min_ver}", "min_core_version": min_ver, "current_core_version": _core_version()}, status_code=422)

            with get_conn() as conn:
                conn.execute(
                    """INSERT OR REPLACE INTO plugins
                       (id, name, icon, category, version, description, store_id, installed_at, open_count)
                       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), COALESCE(
                           (SELECT open_count FROM plugins WHERE id=?), 0))""",
                    (body.id, mf.get("name", body.name), mf.get("icon", body.icon),
                     mf.get("category", body.category),
                     mf.get("version", body.version), mf.get("description", body.description),
                     body.store_id or None, body.id),
                )
            # Always: clears any premium build left from the previous version,
            # then re-fetches it only if this installation is licensed right
            # now. Without this an update silently keeps a stale premium/.
            await _sync_premium(body.id)
            return JSONResponse({"ok": True, "entry": mf.get("entry", "main.js")})

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

            # check min_core_version requirement
            min_ver = mf.get("min_core_version")
            if min_ver and not _satisfies_min_version(min_ver):
                return JSONResponse({"error": f"requires_core_{min_ver}", "min_core_version": min_ver, "current_core_version": _core_version()}, status_code=422)

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

            # fetch and apply db.json schema if present
            try:
                db_r = await client.get(body.base_url.rstrip("/") + "/db.json")
                if db_r.status_code == 200:
                    schema = db_r.json()
                    db_path = os.path.join(app_dir, "data.db")
                    _apply_schema(db_path, schema)
                    with open(os.path.join(app_dir, "db.json"), "w") as f:
                        f.write(db_r.text)
            except Exception:
                pass

            if body.install_backend and has_be and be_code:
                app_backends.install(body.id, be_code)

            # install public.py if present
            pub_url = body.base_url.rstrip("/") + "/public.py"
            try:
                pub_r = await client.get(pub_url)
                if pub_r.status_code == 200:
                    from . import public_loader
                    public_loader.install(body.id, pub_r.text)
            except Exception:
                pass

            # install public/ static files declared in manifest
            pub_files = mf.get("public_files", [])
            if pub_files:
                backend_pub_dir = os.path.join(os.path.dirname(__file__), "apps", body.id, "public")
                os.makedirs(backend_pub_dir, exist_ok=True)
                for rel_path in pub_files:
                    try:
                        f_r = await client.get(body.base_url.rstrip("/") + "/" + rel_path)
                        if f_r.status_code == 200:
                            dest = os.path.join(backend_pub_dir, os.path.basename(rel_path))
                            os.makedirs(os.path.dirname(dest), exist_ok=True)
                            with open(dest, "wb") as f:
                                f.write(f_r.content)
                    except Exception:
                        pass

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
            (body.id, mf.get("name", body.name), mf.get("icon", body.icon),
             mf.get("category", body.category),
             mf.get("version", body.version), mf.get("description", body.description), body.store_id or None, body.id),
        )
    await _sync_premium(body.id)
    return JSONResponse({"ok": True, "entry": entry_path})


# ── Uninstall ─────────────────────────────────────────────────────────────────

def _review_headers() -> dict:
    return {
        "X-mvmOS-Device": premium.installation_id(),
        "X-mvmOS-Name": socket.gethostname()[:80],
        "User-Agent": f"mvmOS/{_core_version()}",
    }


@router.get("/{plugin_id}/reviews")
async def plugin_reviews(plugin_id: str, session=Depends(get_current_session)):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{premium.SITE}/api/reviews/apps/{plugin_id}", headers=_review_headers())
    return JSONResponse(response.json(), status_code=response.status_code)


class ReviewBody(BaseModel):
    score: int
    body: str = ""


@router.put("/{plugin_id}/reviews")
async def save_plugin_review(plugin_id: str, body: ReviewBody, session=Depends(get_current_session)):
    if plugin_id not in _installed_map():
        return JSONResponse({"error": "app_not_installed"}, status_code=403)
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.put(f"{premium.SITE}/api/reviews/apps/{plugin_id}", headers=_review_headers(), json=body.model_dump())
    return JSONResponse(response.json(), status_code=response.status_code)


@router.delete("/{plugin_id}/reviews")
async def delete_plugin_review(plugin_id: str, session=Depends(get_current_session)):
    if plugin_id not in _installed_map():
        return JSONResponse({"error": "app_not_installed"}, status_code=403)
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.delete(f"{premium.SITE}/api/reviews/apps/{plugin_id}", headers=_review_headers())
    return JSONResponse(response.json(), status_code=response.status_code)

@router.delete("/{plugin_id}")
async def uninstall_plugin(plugin_id: str, session=Depends(get_current_session)):
    if any(a["id"] == plugin_id for a in SYSTEM_APPS):
        return JSONResponse({"error": "System apps cannot be uninstalled"}, status_code=400)
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
        cur = conn.execute(
            "UPDATE plugins SET open_count=open_count+1, last_opened_at=strftime('%s','now') WHERE id=?",
            (plugin_id,),
        )
        if cur.rowcount == 0:
            sys_app = next((a for a in SYSTEM_APPS if a["id"] == plugin_id), None)
            if sys_app:
                conn.execute(
                    "INSERT OR IGNORE INTO plugins (id, name, icon, category, version, description, is_system, open_count, last_opened_at) "
                    "VALUES (?, ?, ?, ?, '1.0.0', '', 1, 1, strftime('%s','now'))",
                    (sys_app["id"], sys_app["name"], sys_app["icon"], sys_app["category"]),
                )
    return JSONResponse({"ok": True})
