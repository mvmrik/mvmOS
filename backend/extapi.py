"""
External APIs — scripts and programs outside mvmOS calling app functions with
a token, the way apps already call each other inside it.

Two kinds of app take part, and they never mix:

  store  Store apps with an apps/<id>/app_api.py, the same functions Apps Hub
         lists under App APIs. A token belongs to an Apps Hub profile, made on
         the public page, and acts as that profile.
  core   Core apps with a backend/core_apis/<id>.py (for now Clipboard). A
         token belongs to a desktop login that may use sudo, the owner of the
         server, and acts as that login. Public users never see these.

An API function is any public function of such a module whose first parameter
is user_id. The caller never passes user_id: it is the identity of the token.
A module can keep a function for in-process calls only by naming it in
INTERNAL_ONLY. A parameter annotated UploadFile receives an uploaded file, and
a function returns a file by returning ApiFile.

External access is premium. What is here is the free part — finding the
functions and calling them, which core code may also do in-process — plus the
scaffolding of the routes. Tokens, which app the administrator opened to the
outside, which functions each token may call, and the gateway at /pub/api/v1
itself all live in backend/premium/extapi/, which only a licensed installation
ever downloads. Without it the desktop routes answer 402 and the public ones
404, so on a public page the feature simply does not exist.
"""

import dataclasses
import importlib
import inspect
import json
import os
import re
import sys
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import get_current_session, user_can_sudo

APPS_DIR = os.path.join(os.path.dirname(__file__), "..", "apps")

# Core apps with an API: id -> how it is shown. The module is
# backend/core_apis/<id>.py.
CORE_APIS = {
    "clipboard": {"name": "Clipboard", "icon": "📋"},
}

# Parameters that name the calling app. From outside the caller is always the
# External API, so these are filled here and can never be set by a request.
CALLER_PARAMS = {"source_app": "api", "source_app_name": "External API"}

# Only a hint for the "read only" shortcut when choosing a token's functions:
# the list of functions a token may call is always the explicit one.
_READ_PREFIXES = ("list_", "get_", "find_", "search_", "download_", "count_")

_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@dataclasses.dataclass
class ApiFile:
    """Returned by an API function to answer with a file instead of JSON."""
    path: str
    name: str


class ApiError(Exception):
    """An app or function that does not exist, or may not be called this way."""


def _hub():
    return sys.modules["backend.apphub"]


# ── Discovery ─────────────────────────────────────────────────────

def _module(kind: str, app_id: str):
    if not _SAFE_ID.match(app_id or ""):
        return None
    if kind == "core":
        if app_id not in CORE_APIS:
            return None
        return importlib.import_module(f"backend.core_apis.{app_id}")
    if kind == "store":
        return _hub()._load_app_api(app_id)
    return None


def _is_file_param(p) -> bool:
    return p.annotation is UploadFile


def _functions(mod) -> dict:
    """name -> function, for every function the module offers as API."""
    if mod is None:
        return {}
    internal = set(getattr(mod, "INTERNAL_ONLY", ()) or ())
    result = {}
    for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if name.startswith("_") or name in internal or fn.__module__ != mod.__name__:
            continue
        params = list(inspect.signature(fn).parameters)
        if params and params[0] == "user_id":
            result[name] = fn
    return result


def _describe(name: str, fn) -> dict:
    doc = inspect.getdoc(fn) or ""
    params = []
    for pname, p in list(inspect.signature(fn).parameters.items())[1:]:
        if pname in CALLER_PARAMS or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        entry = {"name": pname}
        if _is_file_param(p):
            entry["type"] = "file"
        elif p.annotation is not p.empty:
            entry["type"] = getattr(p.annotation, "__name__", str(p.annotation))
        if p.default is not p.empty:
            entry["optional"] = True
        params.append(entry)
    return {
        "name": name,
        "summary": doc.split("\n\n", 1)[0].replace("\n", " ").strip(),
        "description": doc,
        "params": params,
        "access": "read" if name.startswith(_READ_PREFIXES) else "write",
        "files": any(p.get("type") == "file" for p in params),
    }


def _manifest(app_id: str) -> dict:
    try:
        with open(os.path.join(APPS_DIR, app_id, "manifest.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def catalog(kind: str) -> list:
    """Every app of this kind with an API, and its functions."""
    result = []
    if kind == "core":
        for app_id, meta in CORE_APIS.items():
            fns = _functions(_module("core", app_id))
            result.append({"id": app_id, "name": meta["name"], "icon": meta["icon"],
                           "functions": [_describe(n, f) for n, f in sorted(fns.items())]})
    elif kind == "store":
        hub = _hub()
        for app_id in hub._detect_app_apis():
            fns = _functions(_module("store", app_id))
            if not fns:
                continue
            m = _manifest(app_id)
            result.append({"id": app_id, "name": m.get("name") or app_id, "icon": m.get("icon") or "📦",
                           "public": hub.is_app_public(app_id),
                           "functions": [_describe(n, f) for n, f in sorted(fns.items())]})
    return sorted(result, key=lambda a: a["name"].lower())


def function(kind: str, app_id: str, name: str):
    """The callable behind one API function, or ApiError."""
    fn = _functions(_module(kind, app_id)).get(name)
    if fn is None:
        raise ApiError(f"'{app_id}' has no API function '{name}'")
    return fn


async def invoke(kind: str, app_id: str, name: str, user_id: str, params: Optional[dict] = None):
    """Call one API function as user_id. Also the way core code calls a core
    app's API in-process — that needs no premium and no token."""
    fn = function(kind, app_id, name)
    kwargs = dict(params or {})
    kwargs.pop("user_id", None)
    sig = inspect.signature(fn).parameters
    for pname, value in CALLER_PARAMS.items():
        if pname in sig:
            kwargs[pname] = value
    if kind == "store":
        with _hub()._confine_app(app_id):
            result = fn(user_id, **kwargs)
            if inspect.isawaitable(result):
                result = await result
        return result
    result = fn(user_id, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


# ── Premium module ────────────────────────────────────────────────

def _premium():
    """backend/premium/extapi, or None — asked per call, because a licence
    makes the folder appear in a running process and removing one deletes it."""
    prem = sys.modules.get("backend.premium")
    return prem.load_core_premium("extapi") if prem else None


def available() -> bool:
    mod = _premium()
    return bool(mod and getattr(mod, "is_available", lambda: False)())


def public_available() -> bool:
    """Whether a public profile has an API section: premium, and at least one
    store app the administrator opened to the outside."""
    mod = _premium()
    return bool(mod and mod.is_available() and mod.allowed_apps("store"))


def _require_desktop():
    mod = _premium()
    if not mod or not mod.is_available():
        raise HTTPException(402, "premium_required")
    return mod


def _require_public():
    mod = _premium()
    if not mod or not mod.is_available():
        raise HTTPException(404)
    return mod


def _owner(session) -> str:
    """Only the owner of the server — a login that may use sudo — manages
    External APIs and holds tokens for core apps."""
    user = session["effective_user"]
    if not user_can_sudo(user):
        raise HTTPException(403, "extapi_error_not_owner")
    return user


def _call(fn, *args):
    try:
        return fn(*args)
    except (ApiError, ValueError) as e:
        raise HTTPException(400, str(e))
    except LookupError:
        raise HTTPException(404)


# ── Desktop (owner) routes ────────────────────────────────────────

admin_router = APIRouter(prefix="/api/extapi", tags=["extapi"])


@admin_router.get("/features")
async def features(session=Depends(get_current_session)):
    return JSONResponse({"available": available()})


@admin_router.get("/admin")
async def admin_state(session=Depends(get_current_session)):
    """Both lists of apps, shown even without premium so the owner can see
    what the feature would open up; only the switches are locked."""
    mod = _premium()
    on = mod.is_available() if mod else False
    enabled = mod.enabled_apps() if on else set()
    lists = {}
    for kind in ("core", "store"):
        lists[kind] = [{**a, "enabled": (kind, a["id"]) in enabled} for a in catalog(kind)]
    return JSONResponse({"available": on, "owner": user_can_sudo(session["effective_user"]), **lists})


class AppToggle(BaseModel):
    enabled: bool


@admin_router.put("/admin/{kind}/{app_id}")
async def set_app(kind: str, app_id: str, body: AppToggle, session=Depends(get_current_session)):
    _owner(session)
    mod = _require_desktop()
    _call(mod.set_app_enabled, kind, app_id, body.enabled)
    return JSONResponse({"ok": True})


class TokenBody(BaseModel):
    name: Optional[str] = None
    scopes: Optional[dict] = None


@admin_router.get("/tokens")
async def owner_tokens(session=Depends(get_current_session)):
    user = _owner(session)
    mod = _require_desktop()
    return JSONResponse({"apps": mod.allowed_apps("core"), "tokens": mod.list_tokens("os", user)})


@admin_router.post("/tokens")
async def owner_create_token(body: TokenBody, session=Depends(get_current_session)):
    user = _owner(session)
    mod = _require_desktop()
    return JSONResponse(_call(mod.create_token, "os", user, body.name or "", body.scopes or {}))


@admin_router.put("/tokens/{token_id}")
async def owner_update_token(token_id: int, body: TokenBody, session=Depends(get_current_session)):
    user = _owner(session)
    mod = _require_desktop()
    return JSONResponse(_call(mod.update_token, "os", user, token_id, body.name, body.scopes))


@admin_router.delete("/tokens/{token_id}")
async def owner_delete_token(token_id: int, session=Depends(get_current_session)):
    user = _owner(session)
    mod = _require_desktop()
    _call(mod.delete_token, "os", user, token_id)
    return JSONResponse({"ok": True})


# ── Public page (Apps Hub profile) routes ─────────────────────────

pub_router = APIRouter(prefix="/api/pub/extapi", tags=["extapi-pub"])


def _profile(x_pub_token: Optional[str]) -> str:
    user = _hub().get_pub_session(x_pub_token)
    if not user:
        raise HTTPException(401)
    return user["id"]


@pub_router.get("/tokens")
async def pub_tokens(x_pub_token: Optional[str] = Header(default=None)):
    mod = _require_public()
    uid = _profile(x_pub_token)
    return JSONResponse({"apps": mod.allowed_apps("store"), "tokens": mod.list_tokens("hub", uid)})


@pub_router.post("/tokens")
async def pub_create_token(body: TokenBody, x_pub_token: Optional[str] = Header(default=None)):
    mod = _require_public()
    uid = _profile(x_pub_token)
    return JSONResponse(_call(mod.create_token, "hub", uid, body.name or "", body.scopes or {}))


@pub_router.put("/tokens/{token_id}")
async def pub_update_token(token_id: int, body: TokenBody, x_pub_token: Optional[str] = Header(default=None)):
    mod = _require_public()
    uid = _profile(x_pub_token)
    return JSONResponse(_call(mod.update_token, "hub", uid, token_id, body.name, body.scopes))


@pub_router.delete("/tokens/{token_id}")
async def pub_delete_token(token_id: int, x_pub_token: Optional[str] = Header(default=None)):
    mod = _require_public()
    uid = _profile(x_pub_token)
    _call(mod.delete_token, "hub", uid, token_id)
    return JSONResponse({"ok": True})


# ── The API itself (/pub/api/v1) ──────────────────────────────────
# Under /pub/ so it is reachable on a public-only server too. It never uses a
# session cookie: the token in the Authorization header is the only identity.

gateway_router = APIRouter(prefix="/pub/api/v1", tags=["extapi-gateway"])


def _unavailable():
    return JSONResponse({"ok": False, "error": "The External API is not available on this server"}, status_code=404)


@gateway_router.get("")
async def gateway_describe(request: Request):
    mod = _premium()
    if not mod or not mod.is_available():
        return _unavailable()
    return await mod.describe(request)


@gateway_router.post("/{app_id}/{name}")
async def gateway_call(app_id: str, name: str, request: Request):
    mod = _premium()
    if not mod or not mod.is_available():
        return _unavailable()
    return await mod.handle(request, app_id, name)
