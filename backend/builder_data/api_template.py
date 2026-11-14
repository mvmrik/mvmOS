"""
Written by mvmOS App Builder. This file is a template of the platform, identical for every
app made with the builder: it contains nothing that came from the app's author or from the AI.
It stores the app's data in the app's own database and hands the sandbox its files.
"""

import json
import os
import sqlite3
import sys
import time
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

APP_ID = "__ID__"
PROFILES = __PROFILES__
PUBLIC = __PUBLIC__

_DIR = os.path.dirname(os.path.abspath(__file__))
_PUB = os.path.join(_DIR, "public")
_DB = os.path.join(_DIR, "data.db")
MAX_VALUE = 256 * 1024
MAX_KEYS = 1000

current_session = sys.modules["backend.auth"].get_current_session
desktop_router = APIRouter()
router = APIRouter() if PUBLIC else None


def _hub():
    return sys.modules.get("backend.apphub")


def _builder():
    return sys.modules.get("backend.builder")


def _conn():
    c = sqlite3.connect(_DB)
    c.execute("CREATE TABLE IF NOT EXISTS kv (owner TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, updated REAL, PRIMARY KEY (owner, k))")
    return c


def _profile(token):
    hub = _hub()
    sess = hub.get_pub_session(token) if hub and token else None
    return (sess or {}).get("id") or ""


def _key(k):
    if not k or len(k) > 100:
        raise HTTPException(400, "Invalid key")
    return k


def _bundle():
    try:
        with open(os.path.join(_PUB, "bundle.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        raise HTTPException(500, "The app is damaged. Reinstall it from App Builder.")


def _declared():
    return _bundle().get("integrations") or []


def _list(owner, prefix):
    like = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with _conn() as c:
        rows = c.execute("SELECT k, v FROM kv WHERE owner=? AND k LIKE ? ESCAPE '\\' ORDER BY k LIMIT 500", (owner, like)).fetchall()
    return {"items": [{"key": k, "value": json.loads(v)} for k, v in rows]}


def _get(owner, key):
    with _conn() as c:
        row = c.execute("SELECT v FROM kv WHERE owner=? AND k=?", (owner, _key(key))).fetchone()
    return {"value": json.loads(row[0]) if row else None}


def _set(owner, key, value):
    raw = json.dumps(value, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_VALUE:
        raise HTTPException(413, "Value too large")
    with _conn() as c:
        if not c.execute("SELECT 1 FROM kv WHERE owner=? AND k=?", (owner, _key(key))).fetchone() \
                and c.execute("SELECT COUNT(*) FROM kv WHERE owner=?", (owner,)).fetchone()[0] >= MAX_KEYS:
            raise HTTPException(413, "Too many keys")
        c.execute("INSERT OR REPLACE INTO kv(owner, k, v, updated) VALUES (?,?,?,?)", (owner, key, raw, time.time()))
    return {"ok": True}


def _delete(owner, key):
    with _conn() as c:
        c.execute("DELETE FROM kv WHERE owner=? AND k=?", (owner, _key(key)))
    return {"ok": True}


def _load_server():
    """The app's own routes (server.py), run with the restricted loader and mounted under /x."""
    path = os.path.join(_DIR, "builder", "app", "server.py")
    if not os.path.isfile(path):
        return None, None
    sandbox = sys.modules["backend.builder_sandbox"]
    try:
        declared = _declared()
    except Exception:
        declared = []
    ns = {"__name__": "builtapp_server"}
    sandbox.load(ns, path, APP_ID, _DIR, declared)
    return ns.get("router"), ns.get("desktop_router")


class KvBody(BaseModel):
    value: object = None


class CallBody(BaseModel):
    args: dict = {}


async def _call(uid, app_id, fn, args):
    b = _builder()
    if not b:
        raise HTTPException(503, "App Builder is not available.")
    return await b.bridge_call(uid, _declared(), app_id, fn, args)


# ── Desktop window: the mvmOS session ─────────────────────────────────────────

def _desktop_owner(session, token):
    pid = _profile(token)
    if PROFILES and not pid:
        raise HTTPException(401, "Sign in to Apps Hub to use this app.")
    return ("p:" + pid) if pid else ("o:" + str(session["effective_user"]))


@desktop_router.get("/bundle")
def d_bundle(session=Depends(current_session)):
    return _bundle()


@desktop_router.get("/kv")
def d_list(prefix: str = "", x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    return _list(_desktop_owner(session, x_pub_token), prefix[:100])


@desktop_router.get("/kv/{key}")
def d_get(key: str, x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    return _get(_desktop_owner(session, x_pub_token), key)


@desktop_router.put("/kv/{key}")
def d_set(key: str, body: KvBody, x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    return _set(_desktop_owner(session, x_pub_token), key, body.value)


@desktop_router.delete("/kv/{key}")
def d_delete(key: str, x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    return _delete(_desktop_owner(session, x_pub_token), key)


@desktop_router.get("/apps")
def d_apps(x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    b = _builder()
    return {"apps": b.bridge_list(_profile(x_pub_token), _declared()) if b else []}


@desktop_router.post("/apps/{app_id}/{fn}")
async def d_call(app_id: str, fn: str, body: CallBody, x_pub_token: Optional[str] = Header(default=None), session=Depends(current_session)):
    return await _call(_profile(x_pub_token), app_id, fn, body.args)


_ai_public, _ai_desktop = _load_server()
if _ai_desktop is not None and len(_ai_desktop.routes):
    desktop_router.include_router(_ai_desktop, prefix="/x")
elif _ai_public is not None:
    # An app written for Apps Hub profiles works the same in its desktop window.
    desktop_router.include_router(_ai_public, prefix="/x")


# ── Public page: an Apps Hub profile ──────────────────────────────────────────

if PUBLIC:
    def _guard(token):
        hub = _hub()
        if hub and not hub.is_app_public(APP_ID):
            raise HTTPException(403, "private")
        pid = _profile(token)
        if not pid:
            raise HTTPException(401, "login_required")
        return "p:" + pid

    @router.get("/")
    def p_index():
        hub = _hub()
        if hub and not hub.is_app_public(APP_ID):
            return HTMLResponse("<html><body>This app is private.</body></html>")
        return FileResponse(os.path.join(_PUB, "index.html"), headers={"Cache-Control": "no-store"})

    @router.get("/builder-runtime.js")
    def p_runtime():
        return FileResponse(os.path.join(_PUB, "builder-runtime.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})

    @router.get("/builder-sdk.js")
    def p_sdk():
        return FileResponse(os.path.join(_PUB, "builder-sdk.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})

    @router.get("/bundle")
    def p_bundle(x_pub_token: Optional[str] = Header(default=None)):
        _guard(x_pub_token)
        return _bundle()

    @router.get("/kv")
    def p_list(prefix: str = "", x_pub_token: Optional[str] = Header(default=None)):
        return _list(_guard(x_pub_token), prefix[:100])

    @router.get("/kv/{key}")
    def p_get(key: str, x_pub_token: Optional[str] = Header(default=None)):
        return _get(_guard(x_pub_token), key)

    @router.put("/kv/{key}")
    def p_set(key: str, body: KvBody, x_pub_token: Optional[str] = Header(default=None)):
        return _set(_guard(x_pub_token), key, body.value)

    @router.delete("/kv/{key}")
    def p_delete(key: str, x_pub_token: Optional[str] = Header(default=None)):
        return _delete(_guard(x_pub_token), key)

    @router.get("/apps")
    def p_apps(x_pub_token: Optional[str] = Header(default=None)):
        _guard(x_pub_token)
        b = _builder()
        return {"apps": b.bridge_list(_profile(x_pub_token), _declared()) if b else []}

    @router.post("/apps/{app_id}/{fn}")
    async def p_call(app_id: str, fn: str, body: CallBody, x_pub_token: Optional[str] = Header(default=None)):
        _guard(x_pub_token)
        return await _call(_profile(x_pub_token), app_id, fn, body.args)

    if _ai_public is not None:
        router.include_router(_ai_public, prefix="/x")
