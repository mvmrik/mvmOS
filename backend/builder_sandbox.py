"""
App Builder — how the server code of a built app is checked and run.

A built app may have server code: routes for its own pages (server.py), functions other
apps and Automations may call (app_api.py) and the rules of a Game Hub game (mp_game.py).
That code is written by an AI or arrives in an archive, so it is never trusted:

  1. It is checked before install (`check_source`): only a short list of harmless modules may
     be imported, and eval/exec/open/getattr and the usual ways out of Python are refused.
  2. It is run by `load()` with a replaced set of builtins: no open, no exec, no __import__
     except the list above. The platform gives it one object, `mvmx`, for what it may need:
     its own database, the Apps Hub profile of the caller, other apps the person declared,
     and outgoing web requests that are not allowed to reach this server or its network.
  3. mvmOS already confines every app's file and database access to the app's own folder.
  4. The administrator is told that the app has server code and confirms the install.

Python cannot be locked down completely from inside a process, so this is hardening and
review, not a guarantee: it stops mistakes and the obvious ways out, and the person decides
whether to trust an app made by someone else. A system backend (backend/apps/<id>) is never
created for a built app.
"""

import ast
import asyncio
import builtins as _b
import ipaddress
import json
import os
import socket
import sqlite3
import sys
import time
from typing import Optional
from urllib.parse import urlparse

ALLOWED_IMPORTS = {
    "json", "re", "math", "time", "datetime", "random", "secrets", "hashlib", "hmac", "base64", "uuid", "string",
    "itertools", "functools", "collections", "typing", "dataclasses", "enum", "decimal", "fractions", "statistics",
    "textwrap", "unicodedata", "html", "asyncio", "copy", "heapq", "bisect", "calendar",
    "fastapi", "pydantic", "urllib.parse",
}
SERVER_FILES = ("server.py", "app_api.py", "mp_game.py")
MAX_PY_BYTES = 200 * 1024

_DENIED_CALLS = {"eval", "exec", "compile", "open", "__import__", "input", "breakpoint", "globals", "locals", "vars", "getattr",
                 "setattr", "delattr", "memoryview", "exit", "quit", "help", "dir"}
_DENIED_NAMES = {"__builtins__", "__loader__", "__spec__", "__file__", "FileResponse", "StaticFiles", "Request", "WebSocket",
                 "WebSocketDisconnect", "UploadFile", "attrgetter", "methodcaller"}
_DENIED_ATTR_PREFIX = ("gi_", "cr_", "ag_", "tb_", "co_", "f_", "func_")
_DENIED_ATTRS = {"mro", "format_map", "system", "popen", "app", "scope", "state", "endpoint", "routes", "dependant", "cookies", "headers",
                 "client", "create_subprocess_exec", "create_subprocess_shell", "get_event_loop", "get_running_loop", "new_event_loop",
                 "run_in_executor", "to_thread", "open_connection", "start_server", "create_server", "create_connection", "subprocess",
                 "Formatter", "FileResponse", "StaticFiles", "Request", "WebSocket"}
_OK_DUNDER = {"__name__", "__doc__", "__init__"}


def check_source(source: str, label: str) -> list:
    """Reasons this file may not be installed (empty when it passes)."""
    errors = []
    if len(source.encode("utf-8")) > MAX_PY_BYTES:
        return [f"{label}: the file is too large."]
    try:
        tree = ast.parse(source, label)
    except SyntaxError as e:
        return [f"{label}: syntax error on line {e.lineno}: {e.msg}"]
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in ALLOWED_IMPORTS and a.name.split(".")[0] not in {m.split(".")[0] for m in ALLOWED_IMPORTS if "." not in m}:
                    errors.append(f"{label} line {line}: import of '{a.name}' is not allowed.")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level or not (mod in ALLOWED_IMPORTS or mod.split(".")[0] in {m for m in ALLOWED_IMPORTS if "." not in m}):
                errors.append(f"{label} line {line}: import from '{'.' * node.level}{mod}' is not allowed.")
            if any(a.name == "*" for a in node.names):
                errors.append(f"{label} line {line}: 'import *' is not allowed.")
            for a in node.names:
                if a.name in _DENIED_NAMES:
                    errors.append(f"{label} line {line}: '{a.name}' is not allowed.")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _DENIED_CALLS:
            errors.append(f"{label} line {line}: {node.func.id}() is not allowed.")
        elif isinstance(node, ast.Name) and (node.id in _DENIED_NAMES):
            errors.append(f"{label} line {line}: '{node.id}' is not allowed.")
        elif isinstance(node, ast.Attribute):
            a = node.attr
            if a in _DENIED_ATTRS or a.startswith(_DENIED_ATTR_PREFIX) or (a.startswith("__") and a.endswith("__") and a not in _OK_DUNDER):
                errors.append(f"{label} line {line}: access to '.{a}' is not allowed.")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            continue
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value and ("{" in node.value):
            errors.append(f"{label} line {line}: a format string that reaches into '__' names is not allowed.")
    return errors[:20]


def _guarded_import(allowed_extra=()):
    real = _b.__import__

    def guarded(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        ok = level == 0 and (name in ALLOWED_IMPORTS or root in {m for m in ALLOWED_IMPORTS if "." not in m})
        if not ok:
            raise ImportError(f"import of '{name}' is not allowed in a built app")
        return real(name, globals, locals, fromlist, level)
    return guarded


def safe_builtins() -> dict:
    keep = ("abs all any ascii bin bool bytearray bytes callable chr classmethod complex dict divmod enumerate filter float "
            "format frozenset hasattr hash hex id int isinstance issubclass iter len list map max min next object oct ord pow "
            "print property range repr reversed round set slice sorted staticmethod str sum super tuple type zip "
            "Exception BaseException ArithmeticError AssertionError AttributeError EOFError IndexError KeyError LookupError "
            "NameError NotImplementedError OverflowError RuntimeError StopIteration StopAsyncIteration TypeError ValueError "
            "ZeroDivisionError KeyboardInterrupt GeneratorExit True False None Ellipsis NotImplemented").split()
    out = {k: getattr(_b, k) for k in keep if hasattr(_b, k)}
    out["__import__"] = _guarded_import()
    out["__build_class__"] = _b.__build_class__
    out["__name__"] = "builtapp"
    return out


# ── What the code may use: the `mvmx` object ──────────────────────────────────

def _public_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
    return bool(infos)


class _null:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def make_platform(app_id: str, app_dir: str, declared: list):
    """The `mvmx` object. Everything it holds is captured in closures, so the app's code gets
    working functions and nothing it could follow back to core objects."""
    from types import SimpleNamespace
    from fastapi import Depends, Header, HTTPException, Request
    declared = list(declared or [])

    def _hub():
        return sys.modules.get("backend.apphub")

    def _rel():
        iso = sys.modules.get("backend.app_isolation")
        return iso.release() if iso else _null()

    def db():
        """The app's own database file (data.db). Other files cannot be reached from it."""
        from . import db as core_db
        conn = core_db.connect_own_db(os.path.join(app_dir, "data.db"))
        conn.row_factory = sqlite3.Row
        return conn

    def profile(token):
        """The Apps Hub profile behind a token: {id, username, display_name, avatar_color}, or None."""
        hub = _hub()
        if not hub or not token:
            return None
        with _rel():
            u = hub.get_pub_session(str(token))
        return {k: u.get(k) for k in ("id", "username", "display_name", "avatar_color")} if u else None

    def profiles(ids):
        hub = _hub()
        if not hub:
            return []
        with _rel():
            rows = hub.get_users_by_ids([str(i) for i in list(ids)[:200]])
        return [{k: r.get(k) for k in ("id", "username", "display_name", "avatar_color")} for r in rows]

    def is_public():
        hub = _hub()
        if not hub:
            return False
        with _rel():
            return bool(hub.is_app_public(app_id))

    async def call_app(user_id, other_app, fn, **args):
        """Call a function of another app as that profile. Only apps declared for this app work."""
        res = await sys.modules["backend.builder"].bridge_call(user_id, declared, str(other_app), str(fn), args)
        return res["result"]

    async def fetch(url, method="GET", json_body=None, headers=None, timeout=10.0):
        """A web request to a public https address. Returns {status, json, text}. Addresses of this server
        and of private networks are refused."""
        import httpx
        u = urlparse(str(url))
        if u.scheme != "https" or not u.hostname or u.username or u.password:
            raise ValueError("only https addresses are allowed")
        if u.port not in (None, 443):
            raise ValueError("only the standard https port is allowed")
        if not await asyncio.to_thread(_public_ip, u.hostname):
            raise ValueError("this address is not allowed")
        h = {str(k)[:60]: str(v)[:500] for k, v in (headers or {}).items()}
        h.setdefault("User-Agent", "mvmOS-built-app")
        m = str(method).upper()
        async with httpx.AsyncClient(timeout=min(float(timeout), 20.0), follow_redirects=False) as c:
            r = await c.request(m if m in ("GET", "POST", "PUT", "DELETE") else "GET", str(url), headers=h, json=json_body)
        text = r.text[:1_000_000]
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        return {"status": r.status_code, "json": data, "text": text if data is None else ""}

    def profile_required(request: Request, x_pub_token: Optional[str] = Header(default=None)):
        """Route dependency: the signed-in Apps Hub profile (401 otherwise). On the public page the app's
        public switch in Apps Hub must be on; in the desktop window it need not be."""
        if request.url.path.startswith("/pub/") and not is_public():
            raise HTTPException(403, "private")
        prof = profile(x_pub_token)
        if not prof:
            raise HTTPException(401, "login_required")
        return prof

    def optional_profile(x_pub_token: Optional[str] = Header(default=None)):
        return profile(x_pub_token)

    def desktop_user(session=Depends(sys.modules["backend.auth"].get_current_session)):
        """Route dependency for the desktop window: the Linux user of the desktop session."""
        return session["effective_user"]

    return SimpleNamespace(app_id=app_id, db=db, profile=profile, profiles=profiles, is_public=is_public, call_app=call_app,
                           fetch=fetch, profile_required=profile_required, optional_profile=optional_profile, desktop_user=desktop_user)


def load(namespace: dict, path: str, app_id: str, app_dir: str, declared: list) -> None:
    """Run the app's server file into `namespace` with the restricted builtins and the mvmx object."""
    with open(path, encoding="utf-8") as f:
        source = f.read()
    errors = check_source(source, os.path.basename(path))
    if errors:
        raise RuntimeError("; ".join(errors[:3]))
    code = compile(source, os.path.basename(path), "exec")
    namespace["__builtins__"] = safe_builtins()
    namespace["mvmx"] = make_platform(app_id, app_dir, declared)
    exec(code, namespace)
