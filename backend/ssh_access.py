"""Managed SSH public-key access for mvmOS Settings.

Only keys stored in the mvmOS database are rendered to a separate
``~/.ssh/mvmos_keys`` file.  Manual authorized_keys entries are never read,
rewritten, or removed.
"""
import os
import pwd
import grp
import re
import sqlite3
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import get_current_session, verify_linux_password
from .db import get_conn

router = APIRouter(prefix="/api/ssh-access", tags=["ssh-access"])

SSHD_CONFIG = Path("/etc/ssh/sshd_config")
SSHD_DROPIN_DIR = Path("/etc/ssh/sshd_config.d")
DROPIN = SSHD_DROPIN_DIR / "90-mvmos-ssh-access.conf"
DROPIN_CONTENT = "# Managed by mvmOS SSH Access. Do not edit manually.\nAuthorizedKeysFile .ssh/authorized_keys .ssh/authorized_keys2 .ssh/mvmos_keys\n"
KEY_RE = re.compile(r"^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$")


def init_ssh_access_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ssh_access_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                label TEXT NOT NULL,
                public_key TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
                start_time TEXT NOT NULL DEFAULT '00:00',
                end_time TEXT NOT NULL DEFAULT '24:00',
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )
        """)


def _require_root(session):
    if session.get("effective_user") != "root":
        raise HTTPException(status_code=403, detail="Root access is required")


def _is_admin(username: str) -> bool:
    if username == "root":
        return True
    try:
        account = pwd.getpwnam(username)
        groups = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(username, account.pw_gid)}
        return bool(groups & {"sudo", "wheel"})
    except KeyError:
        return False


def _actor(session) -> str:
    username = session.get("effective_user", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid session")
    return username


def _verify_actor(password: str, session) -> str:
    username = _actor(session)
    if not password or not verify_linux_password(username, password):
        raise HTTPException(status_code=403, detail="Wrong password")
    return username


def _has_dropin_support() -> bool:
    try:
        return bool(re.search(r"^\s*Include\s+.*sshd_config\.d", SSHD_CONFIG.read_text(), re.MULTILINE))
    except OSError:
        return False


def _reload_sshd():
    for command in (["systemctl", "reload", "ssh"], ["systemctl", "reload", "sshd"], ["service", "ssh", "reload"], ["service", "sshd", "reload"]):
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            return
    raise RuntimeError("Could not reload the SSH service")


def _is_allowed(row, now: datetime) -> bool:
    if not row["enabled"]:
        return False
    try:
        days = {int(day) for day in row["days"].split(",") if day != ""}
        if now.weekday() not in days:
            return False
        current = now.strftime("%H:%M")
        start, end = row["start_time"], row["end_time"]
        if start == end:
            return True
        return start <= current < end if start < end else current >= start or current < end
    except Exception:
        return False


def _keys_file(username: str) -> tuple[Path, int, int]:
    account = pwd.getpwnam(username)
    return Path(account.pw_dir) / ".ssh" / "mvmos_keys", account.pw_uid, account.pw_gid


def reconcile(now: datetime | None = None):
    """Atomically render only currently allowed mvmOS-managed keys."""
    now = now or datetime.now()
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ssh_access_keys ORDER BY id").fetchall()
    by_user = {}
    for row in rows:
        by_user.setdefault(row["username"], []).append(row)
    for username, user_rows in by_user.items():
        keys_file, uid, gid = _keys_file(username)
        if not keys_file.parent.is_dir():
            raise RuntimeError(f"SSH directory is missing for {username}")
        allowed = [row["public_key"].strip() + "\n" for row in user_rows if _is_allowed(row, now)]
        fd, tmp_name = tempfile.mkstemp(prefix=".mvmos_keys.", dir=str(keys_file.parent), text=True)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as tmp:
                tmp.writelines(allowed)
            os.chown(tmp_name, uid, gid)
            os.replace(tmp_name, keys_file)
            os.chmod(keys_file, 0o600)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)


def _row_json(row, now: datetime):
    return {
        "id": row["id"], "label": row["label"], "public_key": row["public_key"],
        "enabled": bool(row["enabled"]), "days": [int(d) for d in row["days"].split(",") if d],
        "start_time": row["start_time"], "end_time": row["end_time"],
        "active_now": _is_allowed(row, now), "created_at": row["created_at"],
    }


class PasswordRequest(BaseModel):
    password: str


@router.get("/status")
async def status(session=Depends(get_current_session)):
    username = _actor(session)
    return {"enabled": DROPIN.exists(), "supported": _has_dropin_support(), "can_admin": _is_admin(username)}


@router.post("/enable")
async def enable(body: "PasswordRequest", session=Depends(get_current_session)):
    username = _verify_actor(body.password, session)
    if not _is_admin(username):
        raise HTTPException(status_code=403, detail="Administrator access is required")
    if not _has_dropin_support():
        raise HTTPException(status_code=400, detail="This SSH configuration does not support drop-in files")
    if not SSHD_DROPIN_DIR.is_dir():
        raise HTTPException(status_code=400, detail="SSH drop-in directory is missing")
    DROPIN.write_text(DROPIN_CONTENT)
    os.chmod(DROPIN, 0o644)
    test = subprocess.run(["sshd", "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        DROPIN.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=(test.stderr or test.stdout).strip())
    reconcile()
    _reload_sshd()
    return {"ok": True}


class KeyRequest(PasswordRequest):
    label: str = Field(min_length=1, max_length=80)
    public_key: str
    enabled: bool = True
    days: list[int] = Field(default_factory=lambda: list(range(7)))
    start_time: str = "00:00"
    end_time: str = "24:00"


class KeySettingsRequest(PasswordRequest):
    enabled: bool = True
    days: list[int] = Field(default_factory=lambda: list(range(7)))
    start_time: str = "00:00"
    end_time: str = "24:00"


def _validate_key(body: KeyRequest):
    key = " ".join(body.public_key.strip().split())
    if not KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Invalid public SSH key")
    if any(day not in range(7) for day in body.days) or not body.days:
        raise HTTPException(status_code=400, detail="Invalid days")
    if not re.match(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", body.start_time):
        raise HTTPException(status_code=400, detail="Invalid start time")
    if body.end_time != "24:00" and not re.match(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", body.end_time):
        raise HTTPException(status_code=400, detail="Invalid end time")
    return key


def _validate_schedule(body):
    if any(day not in range(7) for day in body.days) or not body.days:
        raise HTTPException(status_code=400, detail="Invalid days")
    if not re.match(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", body.start_time):
        raise HTTPException(status_code=400, detail="Invalid start time")
    if body.end_time != "24:00" and not re.match(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", body.end_time):
        raise HTTPException(status_code=400, detail="Invalid end time")


@router.get("/keys")
async def list_keys(session=Depends(get_current_session)):
    username = _actor(session)
    now = datetime.now()
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM ssh_access_keys WHERE username = ? ORDER BY id DESC", (username,)).fetchall()
    return JSONResponse([_row_json(row, now) for row in rows])


@router.post("/keys")
async def add_key(body: KeyRequest, session=Depends(get_current_session)):
    username = _verify_actor(body.password, session)
    if not DROPIN.exists():
        raise HTTPException(status_code=409, detail="SSH Access is not enabled")
    key = _validate_key(body)
    _validate_schedule(body)
    try:
        with get_conn() as conn:
            conn.execute("INSERT INTO ssh_access_keys(username, label, public_key, enabled, days, start_time, end_time) VALUES(?,?,?,?,?,?,?)",
                         (username, body.label.strip(), key, int(body.enabled), ",".join(map(str, sorted(set(body.days)))), body.start_time, body.end_time))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="This key is already managed")
    reconcile()
    return {"ok": True}


@router.put("/keys/{key_id}")
async def update_key(key_id: int, body: KeySettingsRequest, session=Depends(get_current_session)):
    username = _verify_actor(body.password, session)
    _validate_schedule(body)
    with get_conn() as conn:
        cur = conn.execute("UPDATE ssh_access_keys SET enabled=?, days=?, start_time=?, end_time=? WHERE id=? AND username=?",
                           (int(body.enabled), ",".join(map(str, sorted(set(body.days)))), body.start_time, body.end_time, key_id, username))
    if not cur.rowcount:
        raise HTTPException(status_code=404, detail="Key not found")
    reconcile()
    return {"ok": True}


def run(now, _db_path="", _config=None):
    """mvmOS scheduler entrypoint."""
    reconcile(now)


@router.delete("/keys/{key_id}")
async def delete_key(key_id: int, body: PasswordRequest, session=Depends(get_current_session)):
    username = _verify_actor(body.password, session)
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM ssh_access_keys WHERE id = ? AND username = ?", (key_id, username))
    if not cur.rowcount:
        raise HTTPException(status_code=404, detail="Key not found")
    reconcile()
    return {"ok": True}
