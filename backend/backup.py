"""
mvmOS Backup — create, list, download and delete backups.

Backups are stored in /var/backups/mvmos/ as folders:
  mvmos-backup-TIMESTAMP/
    backup.tar.gz  — installation files (excluding venv / __pycache__)
    restore.sh     — run: bash restore.sh  (reads backup.tar.gz from same folder)
"""

import os
import shutil
import subprocess
import zipfile
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/backup", tags=["backup"])

BACKUP_DIR = "/var/backups/mvmos"
INSTALL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

_RESTORE_SH = r"""#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/var/www/mvmos.mvmrik.com"

echo "=== mvmOS Restore ==="
echo ""

if [ ! -f "$SCRIPT_DIR/backup.tar.gz" ]; then
  echo "ERROR: backup.tar.gz not found next to restore.sh"
  exit 1
fi

echo "Stopping mvmOS..."
systemctl stop mvmos 2>/dev/null || true
systemctl stop mvmos-public 2>/dev/null || true

echo "Restoring files to $INSTALL_DIR ..."
tar -xzf "$SCRIPT_DIR/backup.tar.gz" -C "$INSTALL_DIR"

echo "Starting mvmOS..."
systemctl start mvmos

echo ""
echo "Done. Open your browser to access mvmOS."
"""


def _ensure_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _prune(keep: int):
    folders = sorted(
        [n for n in os.listdir(BACKUP_DIR)
         if os.path.isdir(os.path.join(BACKUP_DIR, n))
         and os.path.isfile(os.path.join(BACKUP_DIR, n, "backup.tar.gz"))],
        reverse=True,
    )
    for old in folders[keep:]:
        shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)


def _list():
    _ensure_dir()
    result = []
    for name in sorted(os.listdir(BACKUP_DIR), reverse=True):
        path = os.path.join(BACKUP_DIR, name)
        if not os.path.isdir(path):
            continue
        tar_path = os.path.join(path, "backup.tar.gz")
        if not os.path.isfile(tar_path):
            continue
        stat = os.stat(tar_path)
        result.append({
            "filename": name,
            "size": stat.st_size,
            "created_at": int(stat.st_mtime),
        })
    return result


@router.get("/list")
def list_backups(_session=Depends(get_current_session)):
    return JSONResponse(_list())


@router.post("/create")
def create_backup(_session=Depends(get_current_session)):
    _ensure_dir()
    ts = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    folder_name = f"mvmos-backup-{ts}"
    folder_path = os.path.join(BACKUP_DIR, folder_name)
    os.makedirs(folder_path)
    tar_path = os.path.join(folder_path, "backup.tar.gz")
    restore_path = os.path.join(folder_path, "restore.sh")

    try:
        r = subprocess.run(
            [
                "tar", "-czf", tar_path,
                "--exclude=./venv",
                "--exclude=*/__pycache__",
                "--exclude=*.pyc",
                "--exclude=*.pyo",
                "-C", INSTALL_DIR, ".",
            ],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            shutil.rmtree(folder_path, ignore_errors=True)
            raise HTTPException(500, f"Backup failed: {r.stderr.strip()}")

        with open(restore_path, "w") as f:
            f.write(_RESTORE_SH)
        os.chmod(restore_path, 0o755)

        with get_conn() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='backup_keep'").fetchone()
        keep = int(row["value"]) if row else 0
        if keep > 0:
            _prune(keep)

        stat = os.stat(tar_path)
        return JSONResponse({
            "ok": True,
            "filename": folder_name,
            "size": stat.st_size,
            "created_at": int(stat.st_mtime),
        })
    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(folder_path, ignore_errors=True)
        raise HTTPException(500, str(e))


@router.get("/download/{folder_name}")
def download_backup(folder_name: str, _session=Depends(get_current_session)):
    if "/" in folder_name or ".." in folder_name:
        raise HTTPException(400, "Invalid name")
    folder_path = os.path.join(BACKUP_DIR, folder_name)
    if not os.path.isdir(folder_path):
        raise HTTPException(404, "Backup not found")

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    try:
        with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as zf:
            for fname in ("backup.tar.gz", "restore.sh"):
                fpath = os.path.join(folder_path, fname)
                if os.path.isfile(fpath):
                    zf.write(fpath, fname)
    except Exception:
        os.unlink(tmp.name)
        raise

    def _stream():
        try:
            with open(tmp.name, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        finally:
            os.unlink(tmp.name)

    return StreamingResponse(
        _stream(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.zip"'},
    )


@router.delete("/{folder_name}")
def delete_backup(folder_name: str, _session=Depends(get_current_session)):
    if "/" in folder_name or ".." in folder_name:
        raise HTTPException(400, "Invalid name")
    folder_path = os.path.join(BACKUP_DIR, folder_name)
    if not os.path.isdir(folder_path):
        raise HTTPException(404, "Backup not found")
    shutil.rmtree(folder_path)
    return JSONResponse({"ok": True})


# ── Auto-backup schedule ───────────────────────────────────────────────────────

_VALID_SCHEDULES = ("disabled", "daily", "weekly", "monthly")


@router.get("/schedule")
def get_schedule(_session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key IN ('backup_schedule','backup_keep')"
        ).fetchall()
    cfg = {r["key"]: r["value"] for r in rows}
    return JSONResponse({
        "schedule": cfg.get("backup_schedule", "disabled"),
        "keep": int(cfg.get("backup_keep", 5)),
    })


class ScheduleRequest(BaseModel):
    schedule: str
    keep: int = 5


@router.post("/schedule")
def set_schedule(body: ScheduleRequest, _session=Depends(get_current_session)):
    if body.schedule not in _VALID_SCHEDULES:
        raise HTTPException(400, "Invalid schedule")
    keep = max(1, min(body.keep, 99))
    with get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('backup_schedule',?)", (body.schedule,))
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('backup_keep',?)", (str(keep),))
    return JSONResponse({"ok": True})
