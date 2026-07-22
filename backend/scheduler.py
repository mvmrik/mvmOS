"""
mvmOS App Scheduler

One Linux cron runs every minute: * * * * * curl -s http://localhost:2052/api/scheduler/tick

On each tick, this module:
1. Reads all installed apps from data.db
2. Checks each app's manifest.json for a "scheduler" field
3. If found, loads and runs that Python file from backend/apps/<id>/<scheduler>
   passing: run(now, db_path, config)
     now       — datetime of this tick
     db_path   — path to the app's SQLite DB (apps/<id>/data.db), may not exist yet
     config    — dict of app settings from the app's cfg table (if exists)
"""

import importlib.util
import json
import os
import sys
import sqlite3
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .db import get_conn, APPS_DIR

router = APIRouter()

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

        # Look in backend/apps/<id>/<scheduler_file>
        sched_path = os.path.join(BACKENDS_DIR, app_id, scheduler_file)
        if not os.path.isfile(sched_path):
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
            mod_name = f"_scheduler_{sys_sched['id']}"
            spec = importlib.util.spec_from_file_location(mod_name, sys_sched["path"])
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.run(now, "", config)
            results.append({"app": sys_sched["id"], "ok": True})
        except Exception as e:
            results.append({"app": sys_sched["id"], "ok": False, "error": str(e)})

    return JSONResponse({"tick": now.isoformat(), "results": results})


@router.get("/api/scheduler/status")
async def scheduler_status():
    """Returns which installed apps have a scheduler defined, and whether the system cron is installed."""
    import subprocess as _sp
    r = _sp.run(["crontab", "-l", "-u", "root"], capture_output=True, text=True)
    root_crontab = r.stdout if r.returncode == 0 else ""
    cron_installed = any(
        "/api/scheduler/tick" in line
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
                sched_path = os.path.join(BACKENDS_DIR, app_id, sched)
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
