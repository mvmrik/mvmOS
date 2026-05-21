import httpx
import time
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from .auth import get_current_session
from .db import get_conn
from .plugins import _satisfies_min_version, _core_version

router = APIRouter(prefix="/api/updates", tags=["updates"])

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


async def _collect_store_apps(manifest_url: str) -> list:
    try:
        data = await _fetch_json(manifest_url)
    except Exception:
        return []
    if "categories" in data:
        apps = []
        for cat in data["categories"]:
            cat_url = cat.get("manifest_url")
            if not cat_url:
                continue
            try:
                cat_data = await _fetch_json(cat_url)
                apps.extend(cat_data.get("apps", []))
            except Exception:
                pass
        return apps
    return data.get("apps", [])


async def _collect_store_widgets(manifest_url: str) -> list:
    try:
        data = await _fetch_json(manifest_url)
    except Exception:
        return []
    if "categories" in data:
        widgets = []
        for cat in data["categories"]:
            cat_url = cat.get("manifest_url")
            if not cat_url:
                continue
            try:
                cat_data = await _fetch_json(cat_url)
                widgets.extend(cat_data.get("widgets", []))
            except Exception:
                pass
        return widgets
    return data.get("widgets", [])


async def _collect_store_themes(manifest_url: str) -> list:
    try:
        data = await _fetch_json(manifest_url)
    except Exception:
        return []
    themes = []
    for cat in data.get("categories", []):
        cat_url = cat.get("manifest_url")
        if not cat_url:
            continue
        try:
            cat_data = await _fetch_json(cat_url)
            themes.extend(cat_data.get("themes", []))
        except Exception:
            pass
    return themes


@router.get("")
async def get_updates(session=Depends(get_current_session)):
    updates = []

    with get_conn() as conn:
        app_stores    = conn.execute("SELECT * FROM stores").fetchall()
        widget_stores = conn.execute("SELECT * FROM widget_stores").fetchall()
        theme_stores  = conn.execute("SELECT * FROM theme_stores").fetchall()
        installed_apps    = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM plugins").fetchall()}
        installed_widgets = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM widgets").fetchall()}
        installed_themes  = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM themes").fetchall()}

    # Apps
    for store in app_stores:
        for app in await _collect_store_apps(store["manifest_url"]):
            inst = installed_apps.get(app["id"])
            if inst and inst["version"] != app.get("version", ""):
                min_ver = app.get("min_core_version")
                compatible = _satisfies_min_version(min_ver) if min_ver else True
                updates.append({
                    "type": "app",
                    "id": app["id"],
                    "name": app.get("name", app["id"]),
                    "icon": app.get("icon", "📦"),
                    "current_version": inst["version"],
                    "new_version": app.get("version", ""),
                    "description": app.get("description", ""),
                    "zip_url": app.get("zip_url", ""),
                    "base_url": app.get("base_url", ""),
                    "js_url": app.get("js_url", ""),
                    "category": app.get("category", ""),
                    "store_id": store["id"],
                    "compatible": compatible,
                    "min_core_version": min_ver,
                })

    # Widgets
    for store in widget_stores:
        for w in await _collect_store_widgets(store["manifest_url"]):
            inst = installed_widgets.get(w["id"])
            if inst and inst["version"] != w.get("version", ""):
                updates.append({
                    "type": "widget",
                    "id": w["id"],
                    "name": w.get("name", w["id"]),
                    "icon": w.get("icon", "🔲"),
                    "current_version": inst["version"],
                    "new_version": w.get("version", ""),
                    "description": w.get("description", ""),
                    "base_url": w.get("base_url", ""),
                    "js_url": w.get("js_url", ""),
                    "widget_type": w.get("widget_type", "desktop"),
                    "store_id": store["id"],
                })

    # Themes
    for store in theme_stores:
        for t in await _collect_store_themes(store["manifest_url"]):
            inst = installed_themes.get(t["id"])
            if inst and inst["version"] != t.get("version", ""):
                updates.append({
                    "type": "theme",
                    "id": t["id"],
                    "name": t.get("name", t["id"]),
                    "icon": t.get("icon", "🎨"),
                    "current_version": inst["version"],
                    "new_version": t.get("version", ""),
                    "description": t.get("description", ""),
                    "base_url": t.get("base_url", ""),
                    "store_id": store["id"],
                })

    return JSONResponse(updates)
