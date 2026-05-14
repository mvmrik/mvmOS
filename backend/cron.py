import os
import re
import asyncio
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/cron", tags=["cron"])

CRON_D_DIR = "/etc/cron.d"

FIELD_NAMES = ["minute", "hour", "day", "month", "weekday"]

def _parse_crontab(text: str) -> list:
    entries = []
    for i, line in enumerate(text.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        # disabled entry: line starts with # followed by a valid cron expression
        enabled = True
        content = stripped
        if stripped.startswith("#"):
            rest = stripped[1:].strip()
            # check if it looks like a cron line (shortcut or 5-field)
            if re.match(r'^@\w+\s+\S', rest) or re.match(r'^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S', rest):
                enabled = False
                content = rest
            else:
                continue  # regular comment
        # @reboot / @daily etc shortcuts
        m_at = re.match(r'^(@\w+)\s+(.*)', content)
        if m_at:
            entries.append({
                "id": i,
                "schedule": m_at.group(1),
                "command": m_at.group(2),
                "enabled": enabled,
                "raw": stripped,
            })
            continue
        # standard 5-field
        m = re.match(r'^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)', content)
        if m:
            entries.append({
                "id": i,
                "minute":  m.group(1),
                "hour":    m.group(2),
                "day":     m.group(3),
                "month":   m.group(4),
                "weekday": m.group(5),
                "command": m.group(6),
                "schedule": None,
                "enabled": enabled,
                "raw": stripped,
            })
    return entries


def _read_crontab(username: str) -> str:
    r = subprocess.run(["crontab", "-l", "-u", username],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return ""
    return r.stdout


def _write_crontab(username: str, text: str):
    r = subprocess.run(["crontab", "-u", username, "-"],
                       input=text, capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(status_code=500, detail=r.stderr.strip() or "crontab write failed")


def _build_crontab(entries: list) -> str:
    lines = []
    for e in entries:
        if e.get("schedule"):
            lines.append(f"{e['schedule']} {e['command']}")
        else:
            lines.append(f"{e['minute']} {e['hour']} {e['day']} {e['month']} {e['weekday']} {e['command']}")
    return "\n".join(lines) + "\n" if lines else ""


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_cron(session=Depends(get_current_session)):
    username = session["effective_user"]
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
    return JSONResponse({"user": username, "entries": entries, "cron_d": cron_d})


# ── Add ───────────────────────────────────────────────────────────────────────

class AddRequest(BaseModel):
    minute:  str = "*"
    hour:    str = "*"
    day:     str = "*"
    month:   str = "*"
    weekday: str = "*"
    command: str
    schedule: str = ""  # e.g. @reboot


@router.post("")
async def add_cron(body: AddRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    text = _read_crontab(username)
    if body.schedule:
        new_line = f"{body.schedule} {body.command}\n"
    else:
        new_line = f"{body.minute} {body.hour} {body.day} {body.month} {body.weekday} {body.command}\n"
    _write_crontab(username, text + new_line)
    return JSONResponse({"ok": True})


# ── Edit ──────────────────────────────────────────────────────────────────────

class EditRequest(BaseModel):
    old_raw:  str
    minute:   str = "*"
    hour:     str = "*"
    day:      str = "*"
    month:    str = "*"
    weekday:  str = "*"
    command:  str
    schedule: str = ""


@router.put("")
async def edit_cron(body: EditRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
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
    raw: str
    enabled: bool


@router.post("/toggle")
async def toggle_cron(body: ToggleRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    text = _read_crontab(username)
    lines = text.splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip() == body.raw.strip():
            if body.enabled:
                # remove leading # to enable
                lines[i] = re.sub(r'^#\s*', '', line)
            else:
                # prefix with # to disable
                lines[i] = "# " + line.strip()
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
        output = stdout.decode(errors="replace")
        return JSONResponse({"ok": True, "output": output, "returncode": proc.returncode})
    except asyncio.TimeoutError:
        return JSONResponse({"ok": False, "output": "Command timed out after 30 seconds.", "returncode": -1})
    except Exception as e:
        return JSONResponse({"ok": False, "output": str(e), "returncode": -1})


# ── Delete ────────────────────────────────────────────────────────────────────

class DeleteRequest(BaseModel):
    raw: str


@router.delete("")
async def delete_cron(body: DeleteRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    text = _read_crontab(username)
    lines = [l for l in text.splitlines() if l.strip() != body.raw.strip()]
    _write_crontab(username, "\n".join(lines) + "\n" if lines else "")
    return JSONResponse({"ok": True})
