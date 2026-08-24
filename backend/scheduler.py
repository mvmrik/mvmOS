"""
mvmOS App Scheduler

One Linux cron runs every minute against this installation's own port,
e.g. * * * * * curl -s http://127.0.0.1:2052/api/scheduler/tick — never
through nginx or any domain name, since this is a purely local, self-to-self
call. A machine can host several mvmOS installs on different ports sharing
the same root crontab, so the exact command is always derived from this
process's own --port argument (see _own_port), never guessed from a browser
URL or hardcoded — that way each install only ever recognizes, installs, or
removes its own line and never touches another install's.

On each tick, this module:
1. Reads all installed apps from data.db
2. Checks each app's manifest.json for a "scheduler" field
3. If found, loads and runs that Python file from backend/apps/<id>/<scheduler>
   passing: run(now, db_path, config)
     now       — datetime of this tick
     db_path   — path to the app's SQLite DB (apps/<id>/data.db), may not exist yet
     config    — dict of app settings from the app's cfg table (if exists)
"""

import importlib
import importlib.util
import json
import os
import sys
import sqlite3
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import get_current_session, verify_linux_password
from .cron import _read_crontab, _write_crontab
from .db import get_conn, APPS_DIR

router = APIRouter()


def _own_port() -> str:
    """This process's own listening port, read from its own --port argv.

    uvicorn's CLI runs in this same interpreter, so sys.argv still holds the
    exact flags it was launched with — the only place this process can learn
    its own port from, since nothing else (env, config file) tracks it.
    """
    argv = sys.argv
    for i, a in enumerate(argv):
        if a == "--port" and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith("--port="):
            return a.split("=", 1)[1]
    return "80"


def _tick_marker() -> str:
    """Substring unique to this install's tick line, e.g. ':2052/api/scheduler/tick'."""
    return f":{_own_port()}/api/scheduler/tick"


def _tick_command() -> str:
    return f"curl -s http://127.0.0.1:{_own_port()}/api/scheduler/tick > /dev/null 2>&1"

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")
_THIS_DIR = os.path.dirname(__file__)

SYSTEM_SCHEDULERS = [
    {
        "id": "__ssh_access__",
        "name": "SSH Access",
        "scheduler": "ssh_access.py",
        "path": os.path.join(_THIS_DIR, "ssh_access.py"),
    },
    {
        "id": "__backup__",
        "name": "Backup",
        "scheduler": "backup_scheduler.py",
        "path": os.path.join(_THIS_DIR, "backup_scheduler.py"),
    },
]


def _get_system_config(scheduler_id: str) -> dict:
    if scheduler_id == "__ssh_access__":
        return {"schedule": "every_minute"}
    if scheduler_id == "__backup__":
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT key, value FROM settings WHERE key IN ('backup_schedule','backup_keep')"
            ).fetchall()
        cfg = {r["key"]: r["value"] for r in rows}
        return {
            "schedule": cfg.get("backup_schedule", "disabled"),
            "keep": int(cfg.get("backup_keep", 5)),
        }
    return {}


def _get_config(app_id: str) -> dict:
    """Read app cfg table if it exists."""
    db_path = os.path.join(APPS_DIR, app_id, "data.db")
    if not os.path.isfile(db_path):
        return {}
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT key, value FROM cfg").fetchall()
        conn.close()
        cfg = {}
        for r in rows:
            try:
                cfg[r["key"]] = json.loads(r["value"])
            except Exception:
                cfg[r["key"]] = r["value"]
        return cfg
    except Exception:
        return {}


@router.api_route("/api/scheduler/tick", methods=["GET", "POST"])
async def scheduler_tick():
    now = datetime.now()
    results = []

    with get_conn() as conn:
        rows = conn.execute("SELECT id FROM plugins").fetchall()
        app_ids = [r["id"] for r in rows]

    for app_id in app_ids:
        manifest_path = os.path.join(APPS_DIR, app_id, "manifest.json")
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path) as f:
                manifest = json.load(f)
        except Exception:
            continue

        scheduler_file = manifest.get("scheduler")
        if not scheduler_file:
            continue

        # apps/<id>/<scheduler_file> in the current layout,
        # backend/apps/<id>/<scheduler_file> in the older one.
        sched_path = next(
            (p for p in (os.path.join(APPS_DIR, app_id, scheduler_file),
                         os.path.join(BACKENDS_DIR, app_id, scheduler_file))
             if os.path.isfile(p)),
            None,
        )
        if sched_path is None:
            continue

        db_path = os.path.join(APPS_DIR, app_id, "data.db")
        config = _get_config(app_id)

        try:
            mod_name = f"_scheduler_{app_id}"
            spec = importlib.util.spec_from_file_location(mod_name, sched_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.run(now, db_path, config)
            results.append({"app": app_id, "ok": True})
        except Exception as e:
            results.append({"app": app_id, "ok": False, "error": str(e)})

    for sys_sched in SYSTEM_SCHEDULERS:
        if not os.path.isfile(sys_sched["path"]):
            continue
        config = _get_system_config(sys_sched["id"])
        try:
            # System schedulers are part of the backend package. Importing
            # them by file path loses that package context, so relative
            # imports such as ``from .auth import ...`` fail (SSH Access).
            module_name = "backend." + os.path.splitext(
                os.path.basename(sys_sched["scheduler"])
            )[0]
            mod = importlib.import_module(module_name)
            mod.run(now, "", config)
            results.append({"app": sys_sched["id"], "ok": True})
        except Exception as e:
            results.append({"app": sys_sched["id"], "ok": False, "error": str(e)})

    return JSONResponse({"tick": now.isoformat(), "results": results})


@router.get("/api/scheduler/status")
async def scheduler_status():
    """Returns which installed apps have a scheduler defined, and whether
    THIS install's own cron line (matched by its own port, not just any
    line mentioning /api/scheduler/tick) is installed."""
    root_crontab = _read_crontab("root")
    marker = _tick_marker()
    cron_installed = any(
        marker in line
        for line in root_crontab.splitlines()
        if not line.strip().startswith("#")
    )

    apps = []
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name FROM plugins").fetchall()

    for r in rows:
        app_id, name = r["id"], r["name"]
        manifest_path = os.path.join(APPS_DIR, app_id, "manifest.json")
        try:
            with open(manifest_path) as f:
                manifest = json.load(f)
            sched = manifest.get("scheduler")
            if sched:
                # Same lookup order as the actual tick: apps/<id>/ in the
                # current layout, backend/apps/<id>/ in the older one.
                sched_path = next(
                    (p for p in (os.path.join(APPS_DIR, app_id, sched),
                                 os.path.join(BACKENDS_DIR, app_id, sched))
                     if os.path.isfile(p)),
                    os.path.join(APPS_DIR, app_id, sched),
                )
                apps.append({
                    "id": app_id,
                    "name": name,
                    "scheduler": sched,
                    "file_exists": os.path.isfile(sched_path),
                })
        except Exception:
            continue

    system_apps = []
    for sys_sched in SYSTEM_SCHEDULERS:
        config = _get_system_config(sys_sched["id"])
        system_apps.append({
            "id": sys_sched["id"],
            "name": sys_sched["name"],
            "scheduler": sys_sched["scheduler"],
            "file_exists": os.path.isfile(sys_sched["path"]),
            "config": config,
        })

    return JSONResponse({"apps": apps, "system_apps": system_apps, "cron_installed": cron_installed})


class ToggleSchedulerRequest(BaseModel):
    sudo_password: str = ""


@router.post("/api/scheduler/toggle")
async def toggle_scheduler(body: ToggleSchedulerRequest, session=Depends(get_current_session)):
    """Installs or removes THIS install's own tick line in root's crontab.

    The command is always built from this process's own port (_tick_command),
    never from a client-supplied URL — a host can run several mvmOS installs
    on different ports sharing the same root crontab, so matching and writing
    must stay scoped to this install's own line only.
    """
    me = session["effective_user"]
    # Same exemption as _resolve_target in cron.py: this endpoint always acts
    # on root's crontab, so a session already running as root needs no extra
    # password — it would just be re-proving an identity it already has.
    if me != "root":
        if not body.sudo_password or not verify_linux_password(me, body.sudo_password):
            raise HTTPException(status_code=403, detail="Incorrect password")

    marker = _tick_marker()
    text = _read_crontab("root")
    lines = text.splitlines()
    existing = next((l for l in lines if marker in l and not l.strip().startswith("#")), None)

    if existing:
        lines = [l for l in lines if l != existing]
        _write_crontab("root", "\n".join(lines) + "\n" if lines else "")
        return JSONResponse({"ok": True, "enabled": False})
    else:
        lines.append(f"* * * * * {_tick_command()}")
        _write_crontab("root", "\n".join(lines) + "\n")
        return JSONResponse({"ok": True, "enabled": True})
