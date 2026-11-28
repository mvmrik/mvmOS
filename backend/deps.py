"""System programs that apps need: check what is missing, and install it with the live output in a terminal.

Flow for the desktop: opening an app asks /api/deps/check; when something is
missing the browser shows a window with the list. Its Install button asks
POST /api/deps/start (administrator only, so the password dialog appears when
needed) which returns a one-time ticket, and then the window connects to
/ws/deps/install with the ticket and shows the output of the installation in a
terminal. The browser never sends a command: the server builds it from its own
table of dependencies.

An app lists what it needs in its manifest.json:
    "system_requires": ["mysql-client", {"id": "mytool", "cmds": ["mytool"], "packages": {"apt": "mytool", "dnf": "mytool"}}]
A string is the id of a dependency the core already knows (backend/deps_core.py).
An object describes one of the app's own.

A backend that finds a program missing at the moment it needs it answers with
missing_dependency(...), and the desktop shows the same window and repeats the request.
"""

import asyncio
import json
import os
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from pydantic import BaseModel
from ptyprocess import PtyProcess

from . import deps_core
from .auth import get_current_session, require_admin
from .db import APPS_DIR

router = APIRouter(tags=["deps"])

# Apps that were published before the manifest had "system_requires". Their own
# files are not touched, so what they need is listed here. New apps declare it in
# their manifest instead, and the manifest wins when both exist.
LEGACY_APP_REQUIRES = {
    "statetracker": ["ping"],
    "git-manager": ["git", "openssh-client"],
}


def app_requirements(app_id: str) -> list:
    """The dependency records an app needs, from its manifest or the legacy table."""
    if not app_id or "/" in app_id or app_id.startswith("."):
        return []
    specs = None
    try:
        with open(os.path.join(APPS_DIR, app_id, "manifest.json"), encoding="utf-8") as f:
            specs = json.load(f).get("system_requires")
    except (OSError, ValueError):
        specs = None
    if not isinstance(specs, list):
        specs = LEGACY_APP_REQUIRES.get(app_id, [])
    out = []
    for spec in specs:
        dep = deps_core.normalize(spec)
        if dep:
            out.append(dep)
    return out


def missing_dependency(*ids: str) -> HTTPException:
    """The answer for a backend that needs a program the system does not have. The desktop shows the
    installation window and, when it succeeds, repeats the request."""
    return HTTPException(status_code=424, detail={"code": "missing_dependency", "deps": list(ids)})


def dependency_for_command(cmd: str):
    """The id of the known dependency that provides a command, or None."""
    cmd = os.path.basename(str(cmd or ""))
    for dep_id, dep in deps_core.DEPS.items():
        if cmd in dep["cmds"]:
            return dep_id
    return None


def _is_admin(session: dict) -> bool:
    return session.get("effective_user") == "root"


def _specs_for(app: str, apps, ids) -> list:
    """The dependency records for one app, several apps (each needed once) or plain ids."""
    names = [a for a in (apps or []) if a]
    if app:
        names.append(app)
    if names:
        seen, out = set(), []
        for name in names:
            for dep in app_requirements(name):
                if dep["id"] not in seen:
                    seen.add(dep["id"])
                    out.append(dep)
        return out
    return [i for i in ids if i in deps_core.DEPS]


@router.get("/api/deps/check")
async def check(app: str = "", apps: str = "", ids: str = "", session=Depends(get_current_session)):
    if app or apps:
        specs = _specs_for(app, apps.split(","), [])
    else:
        specs = [i for i in ids.split(",") if i in deps_core.DEPS]
    result = deps_core.status(specs)
    result["root"] = _is_admin(session)
    return result


class StartBody(BaseModel):
    app: str = ""
    apps: list[str] = []
    ids: list[str] = []


_tickets: dict[str, dict] = {}
_tasks: set = set()  # a task nobody refers to can be collected before it finishes


@router.post("/api/deps/start")
async def start(body: StartBody, request: Request, session=Depends(require_admin)):
    specs = _specs_for(body.app, body.apps, body.ids)
    deps = [d for d in (deps_core.normalize(s) for s in specs) if d and deps_core.missing_commands(d)]
    if not deps:
        return {"ok": True, "nothing": True}
    script = deps_core.install_script(deps)
    if not script:
        raise HTTPException(status_code=400, detail="no_package_manager")
    now = time.time()
    for k in [k for k, v in _tickets.items() if v["expires"] < now]:
        del _tickets[k]
    ticket = secrets.token_urlsafe(24)
    _tickets[ticket] = {"session": session["token"], "script": script, "expires": now + 60}
    return {"ok": True, "ticket": ticket}


@router.websocket("/ws/deps/install")
async def install_ws(websocket: WebSocket):
    from .terminal import get_session
    s = get_session(websocket.cookies.get("session"))
    entry = _tickets.pop(websocket.query_params.get("ticket", ""), None)
    if not s or not entry or entry["session"] != s["token"] or entry["expires"] < time.time():
        await websocket.close(code=4401)
        return
    await websocket.accept()
    argv = ["/bin/bash", "-c", "set -e\n" + entry["script"]]
    if os.geteuid() != 0:
        argv = ["sudo", "-n"] + argv
    env = {**os.environ, "TERM": "xterm-256color", "LANG": os.environ.get("LANG") or "C.UTF-8",
           "PATH": deps_core.search_path()}
    proc = PtyProcess.spawn(argv, dimensions=(24, 80), env=env)
    loop = asyncio.get_event_loop()

    async def pump():
        # The output is read to the end even when the window was closed: stopping a package manager halfway
        # leaves the system worse off than letting it finish.
        connected = True
        while True:
            try:
                data = await loop.run_in_executor(None, proc.read, 4096)
            except Exception:
                break
            if connected:
                try:
                    await websocket.send_bytes(data)
                except Exception:
                    connected = False
        try:
            await loop.run_in_executor(None, proc.wait)
        except Exception:
            pass
        if connected:
            try:
                await websocket.send_text(json.dumps({"type": "done", "code": proc.exitstatus}))
                await websocket.close()
            except Exception:
                pass

    task = asyncio.create_task(pump())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if "text" in msg:
                data = json.loads(msg["text"])
                if data.get("type") == "resize":
                    proc.setwinsize(data["rows"], data["cols"])
    except Exception:
        pass
