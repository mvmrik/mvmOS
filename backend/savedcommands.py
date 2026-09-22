"""
Saved terminal commands — a personal shelf of commands the Terminal can run
with one click or from the quick prompt.

The server only stores them and answers two questions while one is being
written: which commands exist on this machine, and what does `<command> --help`
say. Running a saved command never happens here. The browser types it into the
person's own Terminal session, so it runs as the same Linux user, in the same
shell, with the same output and Ctrl+C as anything typed by hand.

Commands belong to the signed-in Linux user (the session's effective_user).
"""

import os
import pwd
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_session
from .db import get_conn
from .system import _as_user

router = APIRouter(prefix="/api/terminal")

MAX_COMMANDS = 200
MAX_NAME = 80
MAX_COMMAND = 4000
MAX_CWD = 500
MAX_HELP_CHARS = 60_000
HELP_TIMEOUT = 5

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$")
_PREFIX_RE = re.compile(r"^[A-Za-z0-9._+-]{1,64}$")
_EXTRA_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/snap/bin"]

_names_cache = {"at": 0.0, "names": []}


class CommandBody(BaseModel):
    name: str = ""
    command: str
    cwd: str = ""


def _clean(body: CommandBody) -> tuple:
    command = body.command.strip()
    if not command:
        raise HTTPException(400, "The command is empty")
    if len(command) > MAX_COMMAND:
        raise HTTPException(400, "The command is too long")
    # One line: the browser types it into a shell, and a hidden line break
    # would run a second command the person never saw in the list.
    if any(ch in command for ch in "\n\r\0"):
        raise HTTPException(400, "A saved command must be a single line")
    name = " ".join(body.name.split())[:MAX_NAME] or command[:MAX_NAME]
    cwd = body.cwd.strip()
    if len(cwd) > MAX_CWD or any(ch in cwd for ch in "\n\r\0"):
        raise HTTPException(400, "Invalid working folder")
    if cwd and not (cwd.startswith("/") or cwd == "~" or cwd.startswith("~/")):
        raise HTTPException(400, "The working folder must be an absolute path")
    return name, command, cwd


def _row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "command": r["command"], "cwd": r["cwd"]}


@router.get("/commands")
def list_commands(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, command, cwd FROM saved_commands WHERE owner = ? "
            "ORDER BY name COLLATE NOCASE, id",
            (session["effective_user"],),
        ).fetchall()
    return [_row(r) for r in rows]


@router.post("/commands")
def create_command(body: CommandBody, session=Depends(get_current_session)):
    name, command, cwd = _clean(body)
    owner = session["effective_user"]
    with get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM saved_commands WHERE owner = ?", (owner,)).fetchone()[0]
        if count >= MAX_COMMANDS:
            raise HTTPException(400, f"You can keep up to {MAX_COMMANDS} saved commands")
        cur = conn.execute(
            "INSERT INTO saved_commands (owner, name, command, cwd, created_at) VALUES (?, ?, ?, ?, ?)",
            (owner, name, command, cwd, datetime.now(timezone.utc).isoformat()),
        )
        row = conn.execute(
            "SELECT id, name, command, cwd FROM saved_commands WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _row(row)


@router.put("/commands/{command_id}")
def update_command(command_id: int, body: CommandBody, session=Depends(get_current_session)):
    name, command, cwd = _clean(body)
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE saved_commands SET name = ?, command = ?, cwd = ? WHERE id = ? AND owner = ?",
            (name, command, cwd, command_id, session["effective_user"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Command not found")
        row = conn.execute(
            "SELECT id, name, command, cwd FROM saved_commands WHERE id = ?", (command_id,)
        ).fetchone()
    return _row(row)


@router.delete("/commands/{command_id}")
def delete_command(command_id: int, session=Depends(get_current_session)):
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM saved_commands WHERE id = ? AND owner = ?",
            (command_id, session["effective_user"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Command not found")
    return {"ok": True}


# ── While writing a command ───────────────────────────────────────

def _search_path() -> str:
    dirs = [d for d in os.environ.get("PATH", "").split(":") if d]
    for d in _EXTRA_PATH:
        if d not in dirs:
            dirs.append(d)
    return ":".join(dirs)


def _all_names() -> list:
    """Every executable name on the search path. Cached for a minute: a busy
    /usr/bin holds a couple of thousand entries and this is asked per keystroke."""
    now = time.time()
    if now - _names_cache["at"] < 60 and _names_cache["names"]:
        return _names_cache["names"]
    names = set()
    for d in _search_path().split(":"):
        try:
            with os.scandir(d) as it:
                for entry in it:
                    try:
                        if entry.is_file() and os.access(entry.path, os.X_OK):
                            names.add(entry.name)
                    except OSError:
                        continue
        except OSError:
            continue
    _names_cache.update(at=now, names=sorted(names))
    return _names_cache["names"]


@router.get("/commands/names")
def command_names(prefix: str = "", session=Depends(get_current_session)):
    if not _PREFIX_RE.match(prefix):
        return []
    found = [n for n in _all_names() if n.startswith(prefix)]
    found.sort(key=lambda n: (len(n), n))
    return found[:12]


def _user_env(user: str) -> dict:
    try:
        home = pwd.getpwnam(user).pw_dir
    except KeyError:
        home = os.path.expanduser("~")
    return {
        "PATH": _search_path(), "HOME": home, "USER": user, "LOGNAME": user,
        "LANG": "C.UTF-8", "TERM": "dumb", "NO_COLOR": "1", "MANWIDTH": "100",
        "MANPAGER": "cat", "PAGER": "cat",
    }


def _capture(argv: list, env: dict) -> str:
    try:
        r = subprocess.run(
            argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=HELP_TIMEOUT, env=env,
        )
    except (subprocess.TimeoutExpired, OSError):
        return ""
    return r.stdout.decode("utf-8", errors="replace")


@router.get("/help")
def command_help(cmd: str, session=Depends(get_current_session)):
    """`<cmd> --help`, or the man page when that prints no options. Only a bare
    command name found on the search path is accepted — never a path, never a
    shell string — and it runs as the person's own Linux user with no input and a
    short timeout."""
    if not _NAME_RE.match(cmd):
        raise HTTPException(400, "Invalid command name")
    path = shutil.which(cmd, path=_search_path())
    if not path:
        raise HTTPException(404, "Command not found")
    user = session["effective_user"]
    env = _user_env(user)

    text = _capture(_as_user(user, [path, "--help"]), env)
    source = "help"
    if not re.search(r"^\s*-", text, re.MULTILINE):
        man = shutil.which("man", path=_search_path())
        page = _capture(_as_user(user, [man, cmd]), env) if man else ""
        page = re.sub(r".\x08", "", page)          # man's bold/underline overstrike
        if re.search(r"^\s*-", page, re.MULTILINE):
            text, source = page, "man"
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text).strip()
    if not text:
        raise HTTPException(404, "No help available for this command")
    return {"source": source, "text": text[:MAX_HELP_CHARS]}
