import asyncio
import os
import re
import json
import shlex
import shutil
import subprocess
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Cookie, HTTPException
from ptyprocess import PtyProcess
from .db import get_conn

router = APIRouter()

# A terminal opened with a session id lives in its own tmux session on a
# private tmux server, so a dropped connection only detaches from it: whatever
# runs inside (an editor, a Claude Code session) keeps going and the next
# connection with the same id picks it up exactly where it was.
TMUX = shutil.which("tmux")
TMUX_SOCKET = "mvmos"
TMUX_CONF = os.path.join(os.path.dirname(__file__), "terminal.tmux.conf")
_SID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _tmux_argv(eu: str, *args: str) -> list[str]:
    return [TMUX, "-L", TMUX_SOCKET, "-f", TMUX_CONF, *args]


def _as_user(eu: str, argv: list[str], needs_sudo: bool) -> list[str]:
    if eu == "root" and not needs_sudo:
        return argv
    cmd = ["runuser", "-l", eu, "-c", shlex.join(argv)]
    return ["sudo", *cmd] if needs_sudo else cmd


def get_session(token: str | None):
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT token, effective_user FROM sessions WHERE token = ?", (token,)).fetchone()
    return dict(row) if row else None


@router.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket, session: str | None = Cookie(default=None)):
    s = get_session(session)
    if not s:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    eu = s.get("effective_user", "root")
    needs_sudo = os.geteuid() != 0
    import pwd as _pwd
    try:
        home = _pwd.getpwnam(eu).pw_dir
    except KeyError:
        home = os.path.expanduser("~")

    # Where the shell starts: the folder asked for, else the user's home, never
    # whatever folder this server happens to run from.
    cwd = websocket.query_params.get("cwd") or ""
    if not os.path.isdir(cwd):
        cwd = home if os.path.isdir(home) else "/"

    sid = websocket.query_params.get("sid") or ""
    tmux_session = f"{eu}-{sid}" if TMUX and _SID_RE.match(sid) else None

    if tmux_session:
        cmd = _as_user(eu, _tmux_argv(eu, "new-session", "-A", "-s", tmux_session, "-c", cwd), needs_sudo)
    elif needs_sudo or (eu and eu != "root"):
        # A login shell (runuser -l) always starts in the user's home, so the
        # folder asked for has to be entered explicitly before the shell starts.
        cmd = _as_user(eu, ["/bin/bash", "-c", f"cd {shlex.quote(cwd)} && exec bash -i"], needs_sudo)
    else:
        cmd = ["/bin/bash", "--login"]

    proc = PtyProcess.spawn(
        cmd,
        cwd=cwd,
        dimensions=(24, 80),
        env={**os.environ, "TERM": "xterm-256color", "HOME": home, "USER": eu, "LOGNAME": eu},
    )

    loop = asyncio.get_event_loop()

    async def pty_to_ws():
        while proc.isalive():
            try:
                data = await loop.run_in_executor(None, proc.read, 4096)
                await websocket.send_bytes(data)
            except EOFError:
                break
            except Exception:
                break
        try:
            await websocket.close()
        except Exception:
            pass

    reader_task = asyncio.create_task(pty_to_ws())

    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if "bytes" in msg:
                proc.write(msg["bytes"])
            elif "text" in msg:
                data = json.loads(msg["text"])
                if data.get("type") == "resize":
                    proc.setwinsize(data["rows"], data["cols"])
                elif data.get("type") == "kill" and tmux_session:
                    # The terminal was closed on purpose: end the session itself,
                    # not just this connection to it.
                    subprocess.run(_as_user(eu, _tmux_argv(eu, "kill-session", "-t", tmux_session), needs_sudo),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                    break
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        if proc.isalive():
            proc.terminate(force=True)
