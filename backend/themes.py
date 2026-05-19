import io
import os
import time
import httpx
import zipfile
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from .db import get_conn, THEMES_DIR

router = APIRouter()

_cache: dict = {}
CACHE_TTL = 120


async def _fetch_json(url: str) -> dict:
    now = time.time()
    if url in _cache and now - _cache[url]["ts"] < CACHE_TTL:
        return _cache[url]["data"]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    _cache[url] = {"ts": now, "data": data}
    return data


# ── Stores ──────────────────────────────────────────────────────────────────

@router.get("/api/themes/stores")
def list_theme_stores():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM theme_stores ORDER BY official DESC, id").fetchall()
    return [dict(r) for r in rows]


class AddThemeStore(BaseModel):
    name: str
    manifest_url: str


@router.post("/api/themes/stores")
def add_theme_store(body: AddThemeStore):
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO theme_stores (name, manifest_url) VALUES (?, ?)",
                (body.name, body.manifest_url),
            )
        except Exception:
            raise HTTPException(400, "Store already exists")
    return {"ok": True}


@router.delete("/api/themes/stores/{store_id}")
def remove_theme_store(store_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT official FROM theme_stores WHERE id=?", (store_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Store not found")
        if row["official"]:
            raise HTTPException(400, "Cannot remove official store")
        conn.execute("DELETE FROM theme_stores WHERE id=?", (store_id,))
    return {"ok": True}


# ── Browse ───────────────────────────────────────────────────────────────────

@router.get("/api/themes/categories")
async def list_theme_categories():
    with get_conn() as conn:
        stores = conn.execute("SELECT * FROM theme_stores").fetchall()
    all_cats = []
    for store in stores:
        try:
            data = await _fetch_json(store["manifest_url"])
            cats = data.get("categories", [])
            for c in cats:
                c["store_id"] = store["id"]
            all_cats.extend(cats)
        except Exception:
            pass
    return all_cats


@router.get("/api/themes/category-themes")
async def list_category_themes(manifest_url: str):
    try:
        data = await _fetch_json(manifest_url)
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch manifest: {e}")
    return data.get("themes", [])


# ── Installed ─────────────────────────────────────────────────────────────────

@router.get("/api/themes")
def list_themes():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM themes ORDER BY is_active DESC, installed_at").fetchall()
    return [dict(r) for r in rows]


class InstallTheme(BaseModel):
    id: str
    name: str
    icon: str = "🎨"
    category: str = "Dark"
    version: str = "1.0.0"
    description: str = ""
    layout: str = "macos"
    zip_url: str = ""
    base_url: str = ""
    store_id: int | None = None


@router.post("/api/themes/install")
async def install_theme(body: InstallTheme):
    theme_dir = os.path.join(THEMES_DIR, body.id)
    os.makedirs(theme_dir, exist_ok=True)

    async with httpx.AsyncClient(timeout=30) as client:
        if body.zip_url:
            try:
                r = await client.get(body.zip_url)
                r.raise_for_status()
            except Exception as e:
                raise HTTPException(502, f"Failed to fetch theme zip: {e}")
            try:
                with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                    names = zf.namelist()
                    prefix = ""
                    if names and "/" in names[0]:
                        candidate = names[0].split("/")[0] + "/"
                        if all(n.startswith(candidate) for n in names):
                            prefix = candidate
                    for zname in names:
                        rel = zname[len(prefix):]
                        if not rel or rel.endswith("/"):
                            continue
                        dest = os.path.join(theme_dir, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        open(dest, "wb").write(zf.read(zname))
            except Exception as e:
                raise HTTPException(400, str(e))
        else:
            css_url = body.base_url.rstrip("/") + "/theme.css"
            try:
                r = await client.get(css_url)
                r.raise_for_status()
            except Exception as e:
                raise HTTPException(502, f"Failed to fetch theme CSS: {e}")
            with open(os.path.join(theme_dir, "theme.css"), "w") as f:
                f.write(r.text)

    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO themes (id, name, icon, category, version, description, layout, store_id, installed_at, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'),
                 (SELECT is_active FROM themes WHERE id=? LIMIT 1))""",
            (body.id, body.name, body.icon, body.category, body.version,
             body.description, body.layout, body.store_id, body.id),
        )
    return {"ok": True}


@router.delete("/api/themes/{theme_id}")
def uninstall_theme(theme_id: str):
    if theme_id == "default":
        raise HTTPException(400, "Cannot uninstall default theme")
    with get_conn() as conn:
        row = conn.execute("SELECT is_active FROM themes WHERE id=?", (theme_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Theme not found")
        if row["is_active"]:
            raise HTTPException(400, "Cannot uninstall active theme — activate another theme first")
        conn.execute("DELETE FROM themes WHERE id=?", (theme_id,))

    import shutil
    theme_dir = os.path.join(THEMES_DIR, theme_id)
    if os.path.isdir(theme_dir):
        shutil.rmtree(theme_dir)
    return {"ok": True}


@router.post("/api/themes/{theme_id}/activate")
def activate_theme(theme_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM themes WHERE id=?", (theme_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Theme not installed")
        conn.execute("UPDATE themes SET is_active=0")
        conn.execute("UPDATE themes SET is_active=1 WHERE id=?", (theme_id,))
    return {"ok": True}


@router.get("/api/themes/active/css")
def active_theme_css():
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM themes WHERE is_active=1 LIMIT 1").fetchone()
    theme_id = row["id"] if row else "default"
    css_path = os.path.join(THEMES_DIR, theme_id, "theme.css")
    if not os.path.isfile(css_path):
        css_path = os.path.join(THEMES_DIR, "default", "theme.css")
    if not os.path.isfile(css_path):
        from fastapi.responses import Response
        return Response(content="", media_type="text/css")
    from fastapi.responses import Response
    with open(css_path) as f:
        css = f.read()
    return Response(content=css, media_type="text/css")
