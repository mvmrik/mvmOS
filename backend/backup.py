"""
mvmOS Backup — create, list, download and delete backups.

Backups go to one or more places chosen in Settings (default /var/backups/mvmos/):
a folder on this server and/or a folder shared from another mvmOS. Each backup is a folder:
  mvmos-backup-TIMESTAMP/
    backup.tar.gz  — installation files (excluding venv / __pycache__)
    restore.sh     — run: bash restore.sh  (reads backup.tar.gz from same folder)
"""

import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from .auth import get_current_session, require_admin
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


def _setting(key, default=None):
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def _loc_id(loc):
    key = loc["path"] if loc["type"] == "server" else f"{loc['owner']}:{loc['folder_id']}:{loc.get('path', '')}"
    return hashlib.sha1(key.encode()).hexdigest()[:10]


SCHEDULES = ("disabled", "daily", "weekly", "monthly")


def _place_options(loc):
    """Own schedule and number of copies to keep; the old global settings are the fallback."""
    schedule = loc.get("schedule")
    if schedule not in SCHEDULES:
        schedule = _setting("backup_schedule", "disabled")
        if schedule not in SCHEDULES:
            schedule = "disabled"
    try:
        keep = int(loc.get("keep"))
    except (TypeError, ValueError):
        try:
            keep = int(_setting("backup_keep", 5))
        except (TypeError, ValueError):
            keep = 5
    return {"schedule": schedule, "keep": max(1, min(keep, 99))}


def get_locations():
    """Configured backup places. Server: {type, path}. Shared: {type, owner, folder_id, path, name}.
    Every place also has its own ``schedule`` and ``keep``."""
    try:
        data = json.loads(_setting("backup_locations") or "[]")
    except ValueError:
        data = []
    result = []
    for loc in data if isinstance(data, list) else []:
        if isinstance(loc, dict) and loc.get("type") == "server" and isinstance(loc.get("path"), str) and os.path.isabs(loc["path"]):
            result.append({"type": "server", "path": os.path.normpath(loc["path"]), **_place_options(loc)})
        elif (isinstance(loc, dict) and loc.get("type") == "shared" and loc.get("owner") and loc.get("folder_id")):
            result.append({"type": "shared", "owner": loc["owner"], "folder_id": loc["folder_id"],
                           "path": str(loc.get("path") or "").strip("/"), "name": str(loc.get("name") or ""),
                           **_place_options(loc)})
    return result or [{"type": "server", "path": BACKUP_DIR, **_place_options({})}]


def _describe(loc):
    d = dict(loc)
    d["id"] = _loc_id(loc)
    if loc["type"] == "shared":
        d.pop("owner", None)
        d["label"] = (loc.get("name") or "Shared folder") + ("/" + loc["path"] if loc["path"] else "")
    else:
        d["label"] = loc["path"]
    return d


def _server_dirs():
    return [l for l in get_locations() if l["type"] == "server"]


def _find_server(loc_id):
    for l in _server_dirs():
        if not loc_id or _loc_id(l) == loc_id:
            return l
    raise HTTPException(404, "Backup location not found")


def _folders_in(base):
    try:
        names = os.listdir(base)
    except OSError:
        return []
    return sorted([n for n in names if not n.startswith(".") and os.path.isfile(os.path.join(base, n, "backup.tar.gz"))], reverse=True)


def _prune_server(base, keep):
    for old in _folders_in(base)[keep:]:
        shutil.rmtree(os.path.join(base, old), ignore_errors=True)


def _remote_path(loc, *parts):
    return "/".join(x for x in ((loc.get("path") or ""),) + parts if x)


def _prune_shared(loc, keep):
    from . import filepicker
    try:
        entries, perms = filepicker.shared_listing(loc["owner"], loc["folder_id"], loc.get("path", ""))
    except HTTPException:
        return
    if "delete" not in perms:
        return
    names = sorted([e["name"] for e in entries if e.get("type") == "dir" and str(e.get("name", "")).startswith("mvmos-backup-")], reverse=True)
    for old in names[keep:]:
        for fname in ("backup.tar.gz", "restore.sh"):
            filepicker.shared_delete(loc["owner"], loc["folder_id"], _remote_path(loc, old, fname))
        filepicker.shared_delete(loc["owner"], loc["folder_id"], _remote_path(loc, old))


def _store(loc, folder_name, tar_path, restore_path, keep):
    """Put one finished backup into one place. Returns None or an error text."""
    try:
        if loc["type"] == "server":
            base = loc["path"]
            dest = os.path.join(base, folder_name)
            if os.path.abspath(tar_path) != os.path.join(dest, "backup.tar.gz"):
                os.makedirs(dest, exist_ok=True)
                shutil.copy2(tar_path, os.path.join(dest, "backup.tar.gz"))
                shutil.copy2(restore_path, os.path.join(dest, "restore.sh"))
            if keep > 0:
                _prune_server(base, keep)
        else:
            from . import filepicker
            owner, fid = loc["owner"], loc["folder_id"]
            if not filepicker.shared_can_write(owner, fid, loc.get("path", "")):
                return "The shared folder does not allow uploads"
            folder = _remote_path(loc, folder_name)
            if not filepicker.shared_mkdir(owner, fid, folder):
                return "Could not create the backup folder in the shared folder"
            filepicker.shared_upload_file(owner, fid, f"{folder}/backup.tar.gz", tar_path)
            filepicker.shared_upload_file(owner, fid, f"{folder}/restore.sh", restore_path)
            if keep > 0:
                _prune_shared(loc, keep)
        return None
    except HTTPException as e:
        return str(e.detail)
    except Exception as e:
        return str(e) or e.__class__.__name__


def perform_backup(ids=None):
    """Create a backup and store it in the configured places (all, or only those whose id is in ``ids``).
    Every place prunes its own old backups by its own ``keep``.

    Returns ``{"folder", "size", "created_at", "results": [{"id","label","ok","error"}]}``;
    raises when the archive could not be made or no place received it.
    """
    import tempfile
    locations = [l for l in get_locations() if ids is None or _loc_id(l) in ids]
    if not locations:
        raise HTTPException(400, "No backup place selected")
    ts = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    folder_name = f"mvmos-backup-{ts}"
    # The archive is built once, in the first server place when there is one (no extra copy there).
    first = next((l for l in locations if l["type"] == "server"), None)
    work = None
    try:
        if first:
            os.makedirs(first["path"], exist_ok=True)
        work = tempfile.mkdtemp(prefix=".mvmos-backup-", dir=first["path"] if first else None)
        tar_path = os.path.join(work, "backup.tar.gz")
        restore_path = os.path.join(work, "restore.sh")
        r = subprocess.run(
            ["tar", "-czf", tar_path, "--exclude=./venv", "--exclude=*/__pycache__",
             "--exclude=*.pyc", "--exclude=*.pyo", "-C", INSTALL_DIR, "."],
            capture_output=True, text=True)
        # Exit code 1 only means some file changed while it was read, which happens on a live system.
        if r.returncode not in (0, 1) or not os.path.isfile(tar_path):
            raise HTTPException(500, f"Backup failed: {r.stderr.strip()}")
        with open(restore_path, "w") as f:
            f.write(_RESTORE_SH)
        os.chmod(restore_path, 0o755)
        results = []
        for loc in locations:
            if loc is first:
                dest = os.path.join(loc["path"], folder_name)
                os.makedirs(dest)
                os.replace(tar_path, os.path.join(dest, "backup.tar.gz"))
                os.replace(restore_path, os.path.join(dest, "restore.sh"))
                tar_path = os.path.join(dest, "backup.tar.gz")
                restore_path = os.path.join(dest, "restore.sh")
                error = _store(loc, folder_name, tar_path, restore_path, loc['keep'])
            else:
                error = _store(loc, folder_name, tar_path, restore_path, loc['keep'])
            results.append({"id": _loc_id(loc), "label": _describe(loc)["label"], "ok": error is None, "error": error})
        if not any(x["ok"] for x in results):
            raise HTTPException(500, "Backup failed: " + "; ".join(f"{x['label']}: {x['error']}" for x in results))
        stat = os.stat(tar_path)
        return {"folder": folder_name, "size": stat.st_size, "created_at": int(stat.st_mtime), "results": results}
    finally:
        if work:
            shutil.rmtree(work, ignore_errors=True)


def _list():
    result = []
    for loc in get_locations():
        d = _describe(loc)
        if loc["type"] == "server":
            for name in _folders_in(loc["path"]):
                stat = os.stat(os.path.join(loc["path"], name, "backup.tar.gz"))
                result.append({"filename": name, "size": stat.st_size, "created_at": int(stat.st_mtime),
                               "location": d["id"], "location_label": d["label"], "type": "server"})
        else:
            from . import filepicker
            try:
                entries, _ = filepicker.shared_listing(loc["owner"], loc["folder_id"], loc.get("path", ""))
                for e in sorted([e for e in entries if e.get("type") == "dir" and str(e.get("name", "")).startswith("mvmos-backup-")],
                                key=lambda e: e["name"], reverse=True)[:99]:
                    inner, _p = filepicker.shared_listing(loc["owner"], loc["folder_id"], _remote_path(loc, e["name"]))
                    tar = next((x for x in inner if x.get("name") == "backup.tar.gz"), None)
                    if not tar:
                        continue
                    try:
                        created = int(datetime.fromisoformat(str(tar.get("modified"))).timestamp())
                    except ValueError:
                        created = 0
                    result.append({"filename": e["name"], "size": int(tar.get("size") or 0), "created_at": created,
                                   "location": d["id"], "location_label": d["label"], "type": "shared"})
            except HTTPException:
                result.append({"filename": "", "size": 0, "created_at": 0, "location": d["id"],
                               "location_label": d["label"], "type": "shared", "unreachable": True})
    result.sort(key=lambda b: b["created_at"], reverse=True)
    return result


@router.get("/list")
def list_backups(_session=Depends(get_current_session)):
    return JSONResponse(_list())


@router.get("/locations")
def get_backup_locations(_session=Depends(get_current_session)):
    return JSONResponse([_describe(l) for l in get_locations()])


class LocationItem(BaseModel):
    type: str
    path: str = ""
    folder_id: str = ""
    name: str = ""
    schedule: str = "disabled"
    keep: int = 5


class LocationsRequest(BaseModel):
    locations: list[LocationItem]


@router.post("/locations")
def set_backup_locations(body: LocationsRequest, session=Depends(require_admin)):
    from . import filepicker
    if not 1 <= len(body.locations) <= 10:
        raise HTTPException(400, "Choose between 1 and 10 places")
    owner = session["effective_user"]
    clean, seen = [], set()
    for item in body.locations:
        if item.schedule not in SCHEDULES:
            raise HTTPException(400, "Invalid schedule")
        options = {"schedule": item.schedule, "keep": max(1, min(item.keep, 99))}
        if item.type == "server":
            path = os.path.normpath(item.path)
            if not os.path.isabs(item.path) or "\0" in item.path:
                raise HTTPException(400, "Use an absolute folder path")
            real = os.path.realpath(path)
            if real == INSTALL_DIR or real.startswith(INSTALL_DIR + "/"):
                raise HTTPException(400, "The backup folder cannot be inside the mvmOS installation")
            if real in ("/", "/proc", "/sys", "/dev") or real.startswith(("/proc/", "/sys/", "/dev/")):
                raise HTTPException(400, "This folder cannot hold backups")
            try:
                os.makedirs(real, exist_ok=True)
            except OSError as e:
                raise HTTPException(400, f"Cannot use this folder: {e.strerror or e}")
            if not os.access(real, os.W_OK):
                raise HTTPException(400, "This folder is not writable")
            loc = {"type": "server", "path": real, **options}
        elif item.type == "shared":
            rel = item.path.strip("/")
            if any(p in ("", ".", "..") for p in rel.split("/")) and rel:
                raise HTTPException(400, "Invalid folder inside the shared folder")
            row = filepicker._shared_row(owner, item.folder_id)
            if not filepicker.shared_can_write(owner, item.folder_id, rel):
                raise HTTPException(400, "This shared folder does not allow uploading")
            loc = {"type": "shared", "owner": owner, "folder_id": item.folder_id, "path": rel, "name": item.name or row["name"], **options}
        else:
            raise HTTPException(400, "Invalid place")
        lid = _loc_id(loc)
        if lid in seen:
            continue
        seen.add(lid)
        clean.append(loc)
    with get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('backup_locations',?)", (json.dumps(clean),))
    return JSONResponse([_describe(l) for l in clean])


@router.post("/create")
def create_backup(_session=Depends(require_admin)):
    try:
        out = perform_backup()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    return JSONResponse({"ok": True, "filename": out["folder"], "size": out["size"],
                         "created_at": out["created_at"], "results": out["results"]})


@router.get("/download/{folder_name}")
def download_backup(folder_name: str, loc: str = "", _session=Depends(require_admin)):
    if "/" in folder_name or ".." in folder_name:
        raise HTTPException(400, "Invalid name")
    folder_path = os.path.join(_find_server(loc)["path"], folder_name)
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
def delete_backup(folder_name: str, loc: str = "", _session=Depends(require_admin)):
    if "/" in folder_name or ".." in folder_name:
        raise HTTPException(400, "Invalid name")
    folder_path = os.path.join(_find_server(loc)["path"], folder_name)
    if not os.path.isfile(os.path.join(folder_path, "backup.tar.gz")):
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
def set_schedule(body: ScheduleRequest, _session=Depends(require_admin)):
    if body.schedule not in _VALID_SCHEDULES:
        raise HTTPException(400, "Invalid schedule")
    keep = max(1, min(body.keep, 99))
    with get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('backup_schedule',?)", (body.schedule,))
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('backup_keep',?)", (str(keep),))
    return JSONResponse({"ok": True})
