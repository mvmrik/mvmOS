"""
Startup manager — tracks which app backends auto-start with the system.
"""
import sys
import time
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from .auth import get_current_session
from .db import get_conn
from . import app_backends

router = APIRouter(prefix="/api/startup")

_started_at: dict[str, float] = {}


def _init_startup_db():
    with get_conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS startup_apps (
                app_id  TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0
            )
        """)


def _get_enabled() -> set:
    with get_conn() as c:
        rows = c.execute("SELECT app_id FROM startup_apps WHERE enabled=1").fetchall()
    return {r[0] for r in rows}


async def run_startup_apps():
    """Called on FastAPI startup — runs on_startup() for each enabled app backend."""
    enabled = _get_enabled()
    for app_id in enabled:
        mod = sys.modules.get(f"app_backend_{app_id}")
        if mod is None:
            continue
        fn = getattr(mod, "on_startup", None)
        if fn is None:
            continue
        try:
            await fn()
            _started_at[app_id] = time.time()
            print(f"[startup] started: {app_id}")
        except Exception as e:
            print(f"[startup] {app_id} error: {e}")


@router.get("")
async def list_startup(session=Depends(get_current_session)):
    enabled = _get_enabled()
    apps = []
    with get_conn() as c:
        names = {r[0]: r[1] for r in c.execute("SELECT id, name FROM plugins").fetchall()}
    for app_id in sorted(app_backends.list_backends()):
        mod = sys.modules.get(f"app_backend_{app_id}")
        if mod is None or not hasattr(mod, "on_startup"):
            continue
        apps.append({
            "id":      app_id,
            "name":    names.get(app_id, app_id),
            "enabled": app_id in enabled,
        })
    return JSONResponse(apps)


@router.get("/status")
async def get_status(session=Depends(get_current_session)):
    """Returns running state of all backend services with on_startup hooks."""
    enabled = _get_enabled()
    with get_conn() as c:
        names = {r[0]: r[1] for r in c.execute("SELECT id, name FROM plugins").fetchall()}
    result = []
    for app_id in sorted(app_backends.list_backends()):
        mod = sys.modules.get(f"app_backend_{app_id}")
        if mod is None or not hasattr(mod, "on_startup"):
            continue
        task = getattr(mod, "_loop_task", None)
        running = task is not None and not task.done()
        if not running:
            _started_at.pop(app_id, None)
        result.append({
            "id":         app_id,
            "name":       names.get(app_id, app_id),
            "enabled":    app_id in enabled,
            "running":    running,
            "started_at": _started_at.get(app_id),
        })
    return JSONResponse(result)


@router.post("/{app_id}/stop")
async def stop_service(app_id: str, session=Depends(get_current_session)):
    """Cancel the background task for an app."""
    mod = sys.modules.get(f"app_backend_{app_id}")
    if mod is None:
        return JSONResponse({"ok": False, "reason": "not loaded"})
    task = getattr(mod, "_loop_task", None)
    if task and not task.done():
        task.cancel()
    _started_at.pop(app_id, None)
    return JSONResponse({"ok": True})


@router.post("/{app_id}")
async def toggle_startup(app_id: str, session=Depends(get_current_session)):
    with get_conn() as c:
        row = c.execute("SELECT enabled FROM startup_apps WHERE app_id=?", (app_id,)).fetchone()
        if row is None:
            c.execute("INSERT INTO startup_apps(app_id,enabled) VALUES(?,1)", (app_id,))
            enabled = True
        else:
            enabled = not row[0]
            c.execute("UPDATE startup_apps SET enabled=? WHERE app_id=?", (int(enabled), app_id))
    return JSONResponse({"ok": True, "enabled": enabled})
