import httpx
import time
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

MANIFEST_URL = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/manifest.json"

_manifest_cache: dict = {}
_manifest_cache_time: float = 0
_CACHE_TTL = 120  # 2 minutes


async def _fetch_manifest():
    global _manifest_cache, _manifest_cache_time
    if _manifest_cache and time.time() - _manifest_cache_time < _CACHE_TTL:
        return _manifest_cache
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(MANIFEST_URL)
        r.raise_for_status()
        _manifest_cache = r.json()
        _manifest_cache_time = time.time()
    return _manifest_cache


@router.get("/manifest")
async def get_manifest(session=Depends(get_current_session)):
    try:
        data = await _fetch_manifest()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    with get_conn() as conn:
        rows = conn.execute("SELECT id, version FROM plugins").fetchall()
    installed = {r["id"]: r["version"] for r in rows}
    apps = data.get("apps", [])
    for app in apps:
        inst_ver = installed.get(app["id"])
        app["installed"] = inst_ver is not None
        app["update_available"] = inst_ver is not None and inst_ver != app.get("version", "")
    return JSONResponse(apps)


@router.get("")
async def list_plugins(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, icon, category, version, description, js_code, installed_at FROM plugins"
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class InstallRequest(BaseModel):
    id: str
    name: str
    icon: str = "📦"
    category: str = "Utilities"
    version: str = "1.0.0"
    description: str = ""
    js_url: str


@router.post("/install")
async def install_plugin(body: InstallRequest, session=Depends(get_current_session)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(body.js_url)
            r.raise_for_status()
            js_code = r.text
    except Exception as e:
        return JSONResponse({"error": f"Failed to fetch plugin: {e}"}, status_code=502)

    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO plugins (id, name, icon, category, version, description, js_code, manifest_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.id, body.name, body.icon, body.category, body.version,
             body.description, js_code, MANIFEST_URL),
        )
    return JSONResponse({"ok": True})


@router.delete("/{plugin_id}")
async def uninstall_plugin(plugin_id: str, session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute("DELETE FROM plugins WHERE id = ?", (plugin_id,))
    return JSONResponse({"ok": True})
