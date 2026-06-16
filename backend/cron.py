import os
import re
import asyncio
import subprocess
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session, verify_linux_password
from .db import get_conn

router = APIRouter(prefix="/api/cron", tags=["cron"])

CRON_D_DIR = "/etc/cron.d"

FIELD_NAMES = ["minute", "hour", "day", "month", "weekday"]

_NO_LOGIN_SHELLS = {"/bin/false", "/usr/sbin/nologin", "/sbin/nologin", "/usr/bin/false"}


def _parse_crontab(text: str) -> list:
    entries = []
    for i, line in enumerate(text.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        enabled = True
        content = stripped
        if stripped.startswith("#"):
            rest = stripped[1:].strip()
            if re.match(r'^@\w+\s+\S', rest) or re.match(r'^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S', rest):
                enabled = False
                content = rest
            else:
                continue
        m_at = re.match(r'^(@\w+)\s+(.*)', content)
        if m_at:
            entries.append({"id": i, "schedule": m_at.group(1), "command": m_at.group(2), "enabled": enabled, "raw": stripped})
            continue
        m = re.match(r'^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)', content)
        if m:
            entries.append({"id": i, "minute": m.group(1), "hour": m.group(2), "day": m.group(3),
                            "month": m.group(4), "weekday": m.group(5), "command": m.group(6),
                            "schedule": None, "enabled": enabled, "raw": stripped})
    return entries


def _read_crontab(username: str) -> str:
    r = subprocess.run(["crontab", "-l", "-u", username], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def _write_crontab(username: str, text: str):
    r = subprocess.run(["crontab", "-u", username, "-"], input=text, capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=r.stderr.strip() or "crontab write failed")


def _resolve_target(session: dict, target_user: str, sudo_password: str) -> str:
    """Returns the effective target username, verifying sudo password if needed."""
    me = session["effective_user"]
    target = target_user.strip() or me
    if target == me:
        return target
    if not sudo_password:
        raise HTTPException(403, "sudo_password required")
    if not verify_linux_password(me, sudo_password):
        raise HTTPException(403, "Incorrect password")
    return target


# ── Users list ────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_cron_users(session=Depends(get_current_session)):
    users = []
    try:
        with open("/etc/passwd") as f:
            for line in f:
                parts = line.strip().split(":")
                if len(parts) < 7:
                    continue
                uname, _, uid, _, _, _, shell = parts
                uid = int(uid)
                if shell in _NO_LOGIN_SHELLS:
                    continue
                if uname == "root" or uid >= 1000:
                    users.append(uname)
    except Exception:
        users = [session["effective_user"]]
    return JSONResponse(users)


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_cron(user: str = Query(""), session=Depends(get_current_session)):
    me = session["effective_user"]
    username = user.strip() or me
    text = _read_crontab(username)
    entries = _parse_crontab(text)
    cron_d = []
    if username == "root" and os.path.isdir(CRON_D_DIR):
        for fname in sorted(os.listdir(CRON_D_DIR)):
            fpath = os.path.join(CRON_D_DIR, fname)
            if os.path.isfile(fpath):
                try:
                    content = open(fpath).read()
                    cron_d.append({"file": fname, "entries": _parse_crontab(content)})
                except Exception:
                    pass
    return JSONResponse({"user": username, "me": me, "entries": entries, "cron_d": cron_d})


# ── Add ───────────────────────────────────────────────────────────────────────

class AddRequest(BaseModel):
    minute:       str = "*"
    hour:         str = "*"
    day:          str = "*"
    month:        str = "*"
    weekday:      str = "*"
    command:      str
    schedule:     str = ""
    target_user:  str = ""
    sudo_password: str = ""


@router.post("")
async def add_cron(body: AddRequest, session=Depends(get_current_session)):
    username = _resolve_target(session, body.target_user, body.sudo_password)
    text = _read_crontab(username)
    if body.schedule:
        new_line = f"{body.schedule} {body.command}\n"
    else:
        new_line = f"{body.minute} {body.hour} {body.day} {body.month} {body.weekday} {body.command}\n"
    _write_crontab(username, text + new_line)
    return JSONResponse({"ok": True})


# ── Edit ──────────────────────────────────────────────────────────────────────

class EditRequest(BaseModel):
    old_raw:      str
    minute:       str = "*"
    hour:         str = "*"
    day:          str = "*"
    month:        str = "*"
    weekday:      str = "*"
    command:      str
    schedule:     str = ""
    target_user:  str = ""
    sudo_password: str = ""


@router.put("")
async def edit_cron(body: EditRequest, session=Depends(get_current_session)):
    username = _resolve_target(session, body.target_user, body.sudo_password)
    text = _read_crontab(username)
    if body.schedule:
        new_line = f"{body.schedule} {body.command}"
    else:
        new_line = f"{body.minute} {body.hour} {body.day} {body.month} {body.weekday} {body.command}"
    lines = text.splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip() == body.old_raw.strip():
            lines[i] = new_line
            replaced = True
            break
    if not replaced:
        raise HTTPException(status_code=404, detail="Entry not found")
    _write_crontab(username, "\n".join(lines) + "\n")
    return JSONResponse({"ok": True})


# ── Toggle enable/disable ─────────────────────────────────────────────────────

class ToggleRequest(BaseModel):
    raw:          str
    enabled:      bool
    target_user:  str = ""
    sudo_password: str = ""


@router.post("/toggle")
async def toggle_cron(body: ToggleRequest, session=Depends(get_current_session)):
    username = _resolve_target(session, body.target_user, body.sudo_password)
    text = _read_crontab(username)
    lines = text.splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip() == body.raw.strip():
            lines[i] = re.sub(r'^#\s*', '', line) if body.enabled else "# " + line.strip()
            replaced = True
            break
    if not replaced:
        raise HTTPException(status_code=404, detail="Entry not found")
    _write_crontab(username, "\n".join(lines) + "\n")
    return JSONResponse({"ok": True})


# ── Run Now ───────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    command: str


@router.post("/run")
async def run_cron(body: RunRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    try:
        proc = await asyncio.create_subprocess_shell(
            body.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "HOME": f"/home/{username}" if username != "root" else "/root"}
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        return JSONResponse({"ok": True, "output": stdout.decode(errors="replace"), "returncode": proc.returncode})
    except asyncio.TimeoutError:
        return JSONResponse({"ok": False, "output": "Command timed out after 30 seconds.", "returncode": -1})
    except Exception as e:
        return JSONResponse({"ok": False, "output": str(e), "returncode": -1})


# ── Delete ────────────────────────────────────────────────────────────────────

class DeleteRequest(BaseModel):
    raw:          str
    target_user:  str = ""
    sudo_password: str = ""


@router.delete("")
async def delete_cron(body: DeleteRequest, session=Depends(get_current_session)):
    username = _resolve_target(session, body.target_user, body.sudo_password)
    text = _read_crontab(username)
    lines = [l for l in text.splitlines() if l.strip() != body.raw.strip()]
    _write_crontab(username, "\n".join(lines) + "\n" if lines else "")
    return JSONResponse({"ok": True})
