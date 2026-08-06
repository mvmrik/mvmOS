"""
Platform API — the documented endpoints every app may call.

An app in apps/<id>/ has no privileged access of its own: whatever it needs
from outside itself, it asks for here. These endpoints are the contract, and
they are the same for every app and every third-party developer — nothing is
handed to an app privately.

If something an app needs has no endpoint here, that app needs
backend/apps/<id>/ instead, which is why installing it asks for the password.

All routes are mounted under /api/platform.

  GET  /whoami            who is asking (desktop session and/or Apps Hub)
  GET  /settings          install-wide settings an app may read (currency, locale)
  GET  /apps              installed app ids, for feature detection
  GET  /premium           is this installation licensed; does this app have its build
  POST /apps/{id}/call    call another app's api.py (requires its API enabled)
  GET  /credits           Apps Hub credit balance for the caller
  POST /credits/spend     spend credits (idempotent)
  POST /notify            raise an mvmOS notification for the current user
"""

import json
import sys
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import app_isolation
from .auth import get_current_session_optional
from .db import get_conn

router = APIRouter(prefix="/api/platform", tags=["platform"])


def _hub():
    return sys.modules.get("backend.apphub")


def _caller(request: Request, x_pub_token: Optional[str]) -> dict:
    """Both identities an app can be called with. Either may be absent: a
    desktop-only window has no Apps Hub account until the user logs into one,
    and a public page has no desktop session at all."""
    # Both lookups read core/Apps Hub databases on the app's behalf — that is
    # what these endpoints are for, so they run with core's access.
    with app_isolation.release():
        session = get_current_session_optional(request)
        hub = _hub()
        pub_user = hub.get_pub_session(x_pub_token) if (hub and x_pub_token) else None
    return {
        "user": session.get("effective_user") if session else None,
        "pub_user_id": pub_user.get("id") if pub_user else None,
        "pub_user_name": pub_user.get("display_name") if pub_user else None,
    }


@router.get("/whoami")
async def whoami(request: Request, x_pub_token: Optional[str] = Header(default=None)):
    """Who is making this request. Apps scope their rows by whichever of the
    two identities they store against — never trust a user id from the body."""
    return JSONResponse(_caller(request, x_pub_token))


def get_settings() -> dict:
    """The same data GET /settings returns. An app running in this process
    calls this directly — sys.modules["backend.platform_api"].get_settings() —
    rather than making an HTTP request to its own server."""
    currency, locale, date_format = "EUR", "en", "DD/MM/YYYY"
    try:
        # Called from inside a confined app: this endpoint existing is exactly
        # what makes reading core settings sanctioned, so core answers it with
        # its own access rather than the caller's.
        with app_isolation.release(), get_conn() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
        if row:
            data = json.loads(row[0])
            currency = data.get("currency") or currency
            locale = data.get("lang") or data.get("locale") or locale
            date_format = data.get("date_format") or date_format
    except Exception:
        pass
    return {"currency": currency, "locale": locale, "date_format": date_format}


@router.get("/settings")
async def platform_settings():
    """Install-wide settings an app may read. Deliberately a small, fixed set —
    an app has no business reading the core settings table itself."""
    return JSONResponse(get_settings())


def get_premium(app_id: Optional[str] = None) -> dict:
    """The same data GET /premium returns, for in-process callers.

    `premium` is whether this installation currently holds a valid licence —
    core's answer, read from core's own settings, which no app can reach or
    write. `build` is whether this app actually has its premium code on disk.

    Neither is a secret and neither needs to be: an app cannot grant itself
    premium by lying here, because lying only unlocks code it does not have.
    sync_premium() wipes premium/ and re-fetches it from mvmos.org only for a
    licensed install, so an unlicensed one has nothing to unlock. Use this to
    decide what to *show*; never to decide what a missing module would do.
    """
    import os as _os

    out = {"premium": False, "build": False}
    try:
        prem = sys.modules.get("backend.premium")
        if prem is None:
            return out
        with app_isolation.release():
            out["premium"] = prem.is_premium()
            if app_id:
                out["build"] = any(
                    _os.path.isdir(d(app_id))
                    for d in (prem._premium_app_dir, prem._premium_backend_dir)
                )
    except Exception:
        pass
    return out


@router.get("/premium")
async def platform_premium(app_id: Optional[str] = None):
    """Whether this installation is licensed, and whether `app_id` has its
    premium build installed. For deciding what the UI offers — the enforcement
    is that unlicensed installs never receive the premium code at all."""
    return JSONResponse(get_premium(app_id))


@router.get("/apps")
async def installed_apps():
    """Installed app ids, so an app can degrade gracefully when the app it
    integrates with isn't present."""
    try:
        with app_isolation.release(), get_conn() as conn:
            rows = conn.execute("SELECT id FROM plugins").fetchall()
        return JSONResponse({"apps": [r[0] for r in rows]})
    except Exception:
        return JSONResponse({"apps": []})


def find_app_plugins(filename: str) -> list:
    """App ids that ship `filename` at the top of their folder.

    Some apps act as hosts for a convention other apps opt into by dropping a
    file next to their own code — Telegram Hub's telegram.py, Game Hub's
    mp_game.py. The host must not go rummaging through other apps' folders to
    find them, so it asks here instead."""
    import os as _os
    here = _os.path.dirname(__file__)
    result = []
    with app_isolation.release():
        for base in (_os.path.join(here, "..", "apps"), _os.path.join(here, "apps")):
            if not _os.path.isdir(base):
                continue
            for app_id in sorted(_os.listdir(base)):
                if app_id.startswith("_") or app_id in result:
                    continue
                if _os.path.isfile(_os.path.join(base, app_id, filename)):
                    result.append(app_id)
    return sorted(result)


def load_app_plugin(app_id: str, filename: str, mod_name: str = None):
    """Load one such file as a module, or None if the app doesn't ship it.

    The module is executed confined to its own app's folder, exactly as its
    api.py would be — opting into a host's convention buys an app no extra
    reach, and the host inherits none of the caller's either."""
    import os as _os
    import types as _types
    here = _os.path.dirname(__file__)
    path = None
    with app_isolation.release():
        for base in (_os.path.join(here, "..", "apps"), _os.path.join(here, "apps")):
            p = _os.path.join(base, app_id, filename)
            if _os.path.isfile(p):
                path = p
                break
    if path is None:
        return None
    name = mod_name or f"app_plugin_{app_id}_{filename.replace('.', '_')}"
    app_dir = _os.path.realpath(_os.path.dirname(path))
    try:
        with app_isolation.release(), open(path) as f:
            source = f.read()
        mod = _types.ModuleType(name)
        mod.__file__ = path
        sys.modules[name] = mod
        with app_isolation.confine(app_dir):
            exec(compile(source, path, "exec"), mod.__dict__)
        return mod
    except Exception as e:
        print(f"[platform] failed to load {filename} for {app_id}: {e}")
        return None


class CallBody(BaseModel):
    method: str
    args: list = []
    kwargs: dict = {}


@router.post("/apps/{app_id}/call")
async def call_app(app_id: str, body: CallBody, request: Request,
                   x_pub_token: Optional[str] = Header(default=None)):
    """Call another app's api.py. The target must expose the method and have
    its API enabled in Apps Hub — that switch, not this endpoint, is the
    trust boundary between two apps.

    The caller's identity is filled in here rather than taken from the body:
    a method declaring user_id gets the Apps Hub account that is actually
    making the request, so no app can act on behalf of someone else."""
    hub = _hub()
    if hub is None:
        raise HTTPException(503, "Apps Hub unavailable")
    kwargs = dict(body.kwargs)
    who = _caller(request, x_pub_token)
    if "user_id" not in kwargs and who["pub_user_id"]:
        kwargs["user_id"] = who["pub_user_id"]
    try:
        # The target app's api.py runs with core's access here, not the
        # caller's — an app must not inherit reach by calling another app.
        with app_isolation.release():
            result = hub.call_app_api(app_id, body.method, *body.args, **kwargs)
    except TypeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, str(e))
    return JSONResponse({"result": result})


@router.get("/credits")
async def credits_balance(request: Request, x_pub_token: Optional[str] = Header(default=None)):
    """Credit balance for the calling Apps Hub account. Credits are keyed on
    the hub account, so a desktop-only user has none until they log in.

    404 on an installation without a premium licence: credits do not exist
    there, and an app asking for them should fall back to its free behaviour
    rather than show a locked feature to someone who cannot unlock it."""
    who = _caller(request, x_pub_token)
    if not who["pub_user_id"]:
        raise HTTPException(401, "Apps Hub account required")
    hub = _hub()
    if hub is None:
        raise HTTPException(503, "Apps Hub unavailable")
    if not hub.credits_available():
        raise HTTPException(404, "credits_unavailable")
    with app_isolation.release():
        balance = hub.get_credit_balance(who["pub_user_id"])
    return JSONResponse({"balance": balance})


class SpendBody(BaseModel):
    app_id: str
    amount: int
    reason: str = ""
    idempotency_key: str


@router.post("/credits/spend")
async def credits_spend(body: SpendBody, request: Request,
                        x_pub_token: Optional[str] = Header(default=None)):
    """Spend credits. Always pass a client-generated idempotency_key — a retry
    or a double-click replays the original result instead of charging twice."""
    who = _caller(request, x_pub_token)
    if not who["pub_user_id"]:
        raise HTTPException(401, "Apps Hub account required")
    hub = _hub()
    if hub is not None and not hub.credits_available():
        raise HTTPException(404, "credits_unavailable")
    try:
        with app_isolation.release():
            result = hub.spend_credits(who["pub_user_id"], body.app_id, body.amount,
                                       body.reason, body.idempotency_key)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=402)
    return JSONResponse({"ok": True, "result": result})


class NotifyBody(BaseModel):
    title: str
    body: str = ""
    app_id: Optional[str] = None


@router.post("/notify")
async def notify(data: NotifyBody, request: Request,
                 session=Depends(get_current_session_optional)):
    """Raise an mvmOS notification for the logged-in desktop user."""
    if not session:
        raise HTTPException(401, "desktop session required")
    try:
        with app_isolation.release(), get_conn() as conn:
            conn.execute(
                "INSERT INTO notifications (username, kind, source, title, body, action_app, created_at) "
                "VALUES (?,'persistent',?,?,?,?,datetime('now'))",
                (session["effective_user"], data.app_id or "app", data.title,
                 data.body, data.app_id),
            )
        return JSONResponse({"ok": True})
    except Exception as e:
        raise HTTPException(400, str(e))
