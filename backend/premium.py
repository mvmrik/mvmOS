"""Premium subscription state for this installation.

The licence code never gates anything locally. It is stored here, server-side,
and attached to requests for premium content (app zips, add-on packs) — mvmos.org
answers with the file or refuses. There is no local "am I premium" decision for
a modified client to lie about; the only cached value is the badge state, which
is cosmetic.

The code is deliberately never exposed to the frontend: mvmOS is multi-user and
the owner's licence should not be readable by everyone with a desktop session.
"""

import asyncio
import json
import os
import socket
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/premium", tags=["premium"])

_SETTINGS_KEY = "premium"
SITE = os.getenv("MVMOS_PREMIUM_SITE", "https://mvmos.org")
_CHECK_URL = SITE + "/api/premium/check"
_RELEASE_URL = SITE + "/api/premium/release"

_DEVICES_URL = SITE + "/api/premium/devices"
_DEVICE_RELEASE_URL = SITE + "/api/premium/devices/release"

# How often this installation checks in while a key is stored. Each check-in
# spends the current token and receives the next one, so a copy of this
# installation running elsewhere cannot stay in step without someone carrying
# the new token over by hand every ten minutes.
HEARTBEAT_SECONDS = 600

# Fallback only: if the heartbeat task is not running for some reason, a badge
# older than this is refreshed on demand.
_STATUS_TTL = timedelta(hours=6)

_DEFAULT = {
    "license_key": "",
    "device_id": "",
    "token": "",
    "status": "free",
    "expires_at": None,
    "checked_at": None,
    "reason": "",
}


def _load() -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (_SETTINGS_KEY,)).fetchone()
    if not row:
        return dict(_DEFAULT)
    try:
        saved = json.loads(row["value"])
    except (TypeError, ValueError):
        saved = {}
    return {**_DEFAULT, **saved}


def _save(state: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (_SETTINGS_KEY, json.dumps(state)),
        )


def _device_id(state: dict) -> str:
    """Stable per-installation id, used for seat tracking on the server."""
    if not state.get("device_id"):
        state["device_id"] = str(uuid.uuid4())
        _save(state)
    return state["device_id"]


def license_headers() -> dict:
    """Headers identifying this installation for a premium content request.

    Empty when no code is stored — the caller still makes the request and lets
    the server refuse it, so no local branch decides what is allowed.
    """
    state = _load()
    key = state.get("license_key", "").strip()
    if not key:
        return {}
    return {"X-License-Code": key, "X-Device-Id": _device_id(state)}


def is_premium_content_url(url: str) -> bool:
    return url.startswith(SITE + "/api/premium/")


def _post(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "mvmOS/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode())


def _check(code: str, device_id: str, token: str) -> dict:
    return _post(_CHECK_URL, {
        "code": code, "device_id": device_id, "token": token, "name": socket.gethostname(),
    })


def _release(code: str, device_id: str) -> None:
    request = urllib.request.Request(
        _RELEASE_URL,
        data=json.dumps({"code": code, "device_id": device_id}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "mvmOS/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8):
        pass


async def _refresh(state: dict) -> dict:
    """Check in with mvmos.org: refresh the badge and rotate this device's token.

    The token received here replaces the one just spent. Losing it is not fatal
    — the server keeps the previous one usable briefly, and a device that ends
    up out of step can always be freed from the device list.
    """
    key = state.get("license_key", "").strip()
    if not key:
        state.update({"status": "free", "expires_at": None, "checked_at": None, "reason": ""})
        return {"valid": False, "reason": "missing"}
    try:
        result = await asyncio.to_thread(_check, key, _device_id(state), state.get("token", ""))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        # Unreachable: keep the last known badge rather than flipping to free.
        return {"valid": None, "reason": "unreachable"}
    state["checked_at"] = datetime.now(timezone.utc).isoformat()
    state["reason"] = "" if result.get("valid") else (result.get("reason") or "")
    if result.get("token"):
        state["token"] = result["token"]
    if result.get("valid"):
        state.update({"status": "premium", "expires_at": result.get("valid_until")})
    else:
        state.update({"status": "free", "expires_at": result.get("valid_until")})
    return result


async def heartbeat_loop() -> None:
    """Check in every HEARTBEAT_SECONDS for as long as a key is stored."""
    while True:
        try:
            state = _load()
            if state.get("license_key"):
                await _refresh(state)
                _save(state)
        except Exception:
            pass
        await asyncio.sleep(HEARTBEAT_SECONDS)


def _is_stale(state: dict) -> bool:
    stamp = state.get("checked_at")
    if not stamp:
        return True
    try:
        checked = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return True
    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - checked > _STATUS_TTL


def load_premium_backend(app_id: str):
    """Import an app's premium/backend.py if it was downloaded, else None.

    Looked up in apps/<app_id>/premium/ first — ordinary app code, loaded
    confined to its own folder exactly like api.py, since a premium module is
    not a reason for an app to have a backend. backend/apps/<app_id>/premium/
    is the older location, still honoured for apps that do have one.

    There is nothing to feature-flag: the module simply does not exist unless
    sync_premium() fetched it for a licensed install, so a caller that finds
    None falls back to the free behaviour. That absence — not a check inside
    the module — is what makes premium unforgeable.
    """
    for path, confined in (
        (os.path.join(_premium_app_dir(app_id), "backend.py"), True),
        (os.path.join(_premium_backend_dir(app_id), "backend.py"), False),
    ):
        if not os.path.isfile(path):
            continue
        mod_name = f"app_backend_{app_id}_premium"
        if not confined:
            import importlib.util

            spec = importlib.util.spec_from_file_location(mod_name, path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        import types

        import sys as _sys

        isolation = _sys.modules.get("backend.app_isolation")
        with open(path) as fh:
            source = fh.read()
        mod = types.ModuleType(mod_name)
        mod.__file__ = path
        _sys.modules[mod_name] = mod
        app_dir = os.path.realpath(os.path.dirname(os.path.dirname(path)))
        if isolation is None:
            exec(compile(source, path, "exec"), mod.__dict__)
        else:
            with isolation.confine(app_dir):
                exec(compile(source, path, "exec"), mod.__dict__)
        return mod
    return None


def is_premium() -> bool:
    """Locally cached premium status, for backends gating a premium-only
    setting (not content delivery — that stays a real request to mvmos.org).
    Refreshed by the heartbeat loop and by the Subscription tab, so this is
    at most HEARTBEAT_SECONDS stale.
    """
    return _load().get("status") == "premium"


def _public(state: dict) -> dict:
    key = state.get("license_key", "")
    return {
        "status": state.get("status", "free"),
        "expires_at": state.get("expires_at"),
        "reason": state.get("reason", ""),
        "license_key_set": bool(key),
        "license_key_hint": ("••••" + key[-4:]) if key else "",
        "device_id": state.get("device_id", ""),
        "site": SITE + "/premium",
    }


class LicenseBody(BaseModel):
    license_key: str


@router.get("")
async def get_premium(refresh: bool = False, _session=Depends(get_current_session)):
    state = _load()
    if state.get("license_key") and (refresh or _is_stale(state)):
        await _refresh(state)
        _save(state)
    return JSONResponse(_public(state))


@router.put("/license")
async def save_license(body: LicenseBody, _session=Depends(get_current_session)):
    key = body.license_key.strip()
    if not key:
        raise HTTPException(400, detail="License key is required")
    if len(key) > 128:
        raise HTTPException(400, detail="License key is too long")
    state = _load()
    state["license_key"] = key
    result = await _refresh(state)
    if not result.get("valid") and result.get("reason") == "invalid":
        state.update({"license_key": "", "token": "", "status": "free",
                      "expires_at": None, "checked_at": None, "reason": ""})
    _save(state)
    if result.get("valid"):
        asyncio.create_task(sync_all_premium())
    return JSONResponse({**_public(state), "validation": result})


_SAFE_NAME = __import__("re").compile(r"^[A-Za-z0-9._-]+$")


def _premium_app_dir(app_id: str) -> str:
    """Where a premium build belongs: inside the app, like the rest of it."""
    from .db import APPS_DIR

    return os.path.join(APPS_DIR, app_id, "premium")


def _premium_backend_dir(app_id: str) -> str:
    """The older location, for apps that genuinely have a backend."""
    return os.path.join(os.path.dirname(__file__), "apps", app_id, "premium")


def clear_premium_dir(app_id: str) -> None:
    """Wipe the premium build from both possible locations so a stale build can
    never sit next to code it was not made for. Called before every fresh
    install/update, whether or not the installation ends up premium.
    """
    import shutil

    for target in (_premium_app_dir(app_id), _premium_backend_dir(app_id)):
        if os.path.isdir(target):
            shutil.rmtree(target)


async def download_premium(app_id: str) -> bool:
    """Fetch apps/<app_id>/premium.zip from mvmos.org and extract it into
    apps/<app_id>/premium/ — including premium/backend.py, which runs confined
    to the app's folder like the rest of its server code.

    A top-level backend/ folder in the zip still goes to
    backend/apps/<app_id>/premium/, but only for an app that already has a
    backend the user approved; needing premium is not itself such a reason.

    Nothing in premium.zip is ever visible without a valid licence — it is not
    part of the public app zip at all, and this request is the only way to it.
    The licence code goes out in the headers here and never reaches the app.

    There is exactly one premium build per app — no filename or version to
    track, mvmos.org always serves whatever is currently there. Returns False
    (nothing to do) if the app has no premium build at all; raises
    PermissionError if the licence is not valid right now.
    """
    import io
    import zipfile

    import httpx

    from .db import APPS_DIR

    if not _SAFE_NAME.match(app_id):
        raise RuntimeError("Bad name")
    app_dir = os.path.join(APPS_DIR, app_id)
    if not os.path.isdir(app_dir):
        raise RuntimeError("App is not installed")

    url = f"{SITE}/api/premium/content/{app_id}/premium.zip"
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            r = await client.get(url, headers=license_headers())
        except Exception:
            raise RuntimeError("Cannot fetch premium build")
    if r.status_code == 404:
        return False
    if r.status_code in (401, 402, 403):
        raise PermissionError("premium_required")
    if r.status_code != 200:
        raise RuntimeError("Cannot fetch premium build")

    frontend_target = _premium_app_dir(app_id)
    # A backend/ folder in the zip only lands in backend/apps/ when the app
    # already has one the user approved at install time. Otherwise it belongs
    # with the app, isolated like everything else it ships.
    has_backend = os.path.isdir(os.path.join(os.path.dirname(__file__), "apps", app_id))
    backend_target = _premium_backend_dir(app_id) if has_backend else frontend_target
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        for name in zf.namelist():
            if name.endswith("/") or name.startswith("/") or ".." in name:
                continue
            if name == "backend" or name.startswith("backend/"):
                sub = name[len("backend/"):]
                if not sub:
                    continue
                dest = os.path.join(backend_target, sub)
            else:
                dest = os.path.join(frontend_target, name)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(zf.read(name))
    return True


async def sync_premium(app_id: str) -> None:
    """The install/update hook: always clear the old premium build first, then
    fetch the current one only if this installation is premium right now. An
    expired licence, or an app with no premium build, just leaves it without
    one — never a mismatched leftover from a previous version.
    """
    clear_premium_dir(app_id)
    state = _load()
    if not state.get("license_key", "").strip():
        return
    try:
        await download_premium(app_id)
    except (PermissionError, RuntimeError):
        pass


def _installed_app_ids() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT id FROM plugins").fetchall()
    return [r["id"] for r in rows]


async def sync_all_premium() -> None:
    """Activation hook: fetch premium content for every already-installed app
    in one pass, so buying a subscription does not require reinstalling
    anything to get the premium build.
    """
    for app_id in _installed_app_ids():
        try:
            await download_premium(app_id)
        except (PermissionError, RuntimeError):
            pass


def clear_all_premium() -> None:
    """Removal hook: wipe premium/ from every installed app so nothing
    licensed stays behind once the key is gone.
    """
    for app_id in _installed_app_ids():
        clear_premium_dir(app_id)


@router.get("/devices")
async def get_devices(_session=Depends(get_current_session)):
    """The machines this key is installed on, straight from mvmos.org.

    Kept server-side like everything else about the key: the frontend gets the
    list, never the code that authenticates the request for it.
    """
    state = _load()
    key = state.get("license_key", "").strip()
    if not key:
        return JSONResponse({"devices": [], "this_device": "", "seats": 0})
    payload = {"code": key, "device_id": _device_id(state),
               "token": state.get("token", ""), "name": socket.gethostname()}
    try:
        result = await asyncio.to_thread(_post, _DEVICES_URL, payload)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return JSONResponse({"devices": [], "this_device": "", "seats": 0})
        raise HTTPException(502, detail="unreachable")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        raise HTTPException(502, detail="unreachable")
    if result.get("token"):
        state["token"] = result["token"]
        _save(state)
    return JSONResponse(result)


class DeviceBody(BaseModel):
    device_id: str


@router.post("/devices/release")
async def release_seat(body: DeviceBody, _session=Depends(get_current_session)):
    """Free a seat held by another machine — a reinstalled one, or a copy."""
    state = _load()
    key = state.get("license_key", "").strip()
    if not key:
        raise HTTPException(400, detail="No license key")
    payload = {"code": key, "device_id": _device_id(state), "target": body.device_id.strip()}
    try:
        result = await asyncio.to_thread(_post, _DEVICE_RELEASE_URL, payload)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        raise HTTPException(502, detail="unreachable")
    return JSONResponse(result)


@router.delete("/license")
async def remove_license(_session=Depends(get_current_session)):
    state = _load()
    key, device_id = state.get("license_key", ""), state.get("device_id", "")
    if key and device_id:
        # Best effort — a seat that is not released frees itself on SEAT_TTL.
        try:
            await asyncio.to_thread(_release, key, device_id)
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
    state.update({"license_key": "", "token": "", "status": "free",
                  "expires_at": None, "checked_at": None, "reason": ""})
    _save(state)
    clear_all_premium()
    return JSONResponse(_public(state))
