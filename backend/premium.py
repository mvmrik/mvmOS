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
_BTC_INVOICE_URL = SITE + "/api/premium/btc/invoice"
_BTC_QUOTE_URL = SITE + "/api/premium/btc/quote"

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
    "pending_invoice": None,
    "invoice_history": [],
}

# How many past payments to remember locally. This is the installation's own
# record for its own owner — mvmos.org is never asked to correlate invoices
# back to a device, so this is the only place such a history exists at all.
_INVOICE_HISTORY_LIMIT = 50


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


def installation_id() -> str:
    """Stable installation id for services that need one vote per mvmOS."""
    state = _load()
    return _device_id(state)


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
    if result.get("seats"):
        state["seats"] = result["seats"]
    return result


async def heartbeat_loop() -> None:
    """Check in every HEARTBEAT_SECONDS for as long as a key is stored."""
    while True:
        try:
            state = _load()
            if state.get("pending_invoice"):
                inv_id = state["pending_invoice"]["invoice_id"]
                data = await _poll_invoice(inv_id)
                if data:
                    await _apply_invoice_result(state, inv_id, data)
                    state = _load()
            if state.get("license_key"):
                await _refresh(state)
                _save(state)
                # A licensed installation that has no core premium build on disk
                # is one that was just updated or restored; fetch it here so the
                # feature comes back on its own instead of waiting for someone to
                # re-enter the key.
                if state.get("status") == "premium":
                    for name in CORE_PREMIUM_MODULES:
                        if not os.path.isdir(_core_premium_dir(name)):
                            try:
                                await download_core_premium(name)
                            except (PermissionError, RuntimeError):
                                pass
                else:
                    # A key that no longer checks out as premium (expired,
                    # revoked, regenerated elsewhere...) must not leave last
                    # licence's code sitting around still working off a stale
                    # local cache — same cleanup as removing the key outright.
                    # _refresh() leaves status untouched when mvmos.org was
                    # simply unreachable, so this never fires on a network blip.
                    clear_all_premium()
            else:
                clear_all_premium()
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


CORE_PREMIUM_MODULES = ("apphub",)

_core_modules = {}


def _core_premium_dir(name: str) -> str:
    """Where a core premium build lives: backend/premium/<name>/, beside the
    subsystem it extends, exactly as an app keeps its own in apps/<id>/premium/.
    """
    return os.path.join(os.path.dirname(__file__), "premium", name)


def load_core_premium(name: str):
    """The premium module for a core subsystem, or None when this installation
    has no licence. Core code, so it is loaded unconfined like the rest of
    backend/ — the sandbox is for app code, and this never is.

    Cached on the file's mtime, because the folder appears and disappears while
    the process runs: a licence typed into Settings downloads it seconds later,
    and removing one deletes it. That is also why callers ask here per request
    instead of mounting a router at startup — a router assembled at boot could
    never see a folder that arrives afterwards.
    """
    path = os.path.join(_core_premium_dir(name), "backend.py")
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        _core_modules.pop(name, None)
        return None
    cached = _core_modules.get(name)
    if cached and cached[0] == stamp:
        return cached[1]
    import importlib.util
    import sys as _sys

    isolation = _sys.modules.get("backend.app_isolation")
    spec = importlib.util.spec_from_file_location(f"backend_premium_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    # The request that asks for this may come from a confined app going through
    # the Platform API, and core code is never loaded under an app's root.
    if isolation is None:
        spec.loader.exec_module(mod)
    else:
        with isolation.release():
            spec.loader.exec_module(mod)
    _core_modules[name] = (stamp, mod)
    return mod


async def download_core_premium(name: str) -> bool:
    """Fetch core/<name>/premium.zip from mvmos.org into backend/premium/<name>/.

    Same deal as an app's build: the licence goes out in the headers and the
    server answers with the file or refuses, so an unlicensed installation
    never receives the code and has nothing to unlock.
    """
    import io
    import zipfile

    import httpx

    if not _SAFE_NAME.match(name):
        raise RuntimeError("Bad name")
    url = f"{SITE}/api/premium/content/core/{name}/premium.zip"
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            r = await client.get(url, headers=license_headers())
        except Exception:
            raise RuntimeError("Cannot fetch core premium build")
    if r.status_code == 404:
        return False
    if r.status_code in (401, 402, 403):
        raise PermissionError("premium_required")
    if r.status_code != 200:
        raise RuntimeError("Cannot fetch core premium build")

    # Only now, with the new build already in hand, is the old one removed —
    # a download that fails must never leave the installation with neither.
    clear_core_premium(name)
    target = _core_premium_dir(name)
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        for entry in zf.namelist():
            if entry.endswith("/") or entry.startswith("/") or ".." in entry:
                continue
            dest = os.path.join(target, entry)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(zf.read(entry))
    _core_modules.pop(name, None)
    return True


def clear_core_premium(name: str = None) -> None:
    """Wipe one core premium build, or every one of them. Called when the
    licence goes away, and before every fresh download so a stale build can
    never sit next to code it was not made for.
    """
    import shutil

    for mod_name in ((name,) if name else CORE_PREMIUM_MODULES):
        target = _core_premium_dir(mod_name)
        if os.path.isdir(target):
            shutil.rmtree(target)
        _core_modules.pop(mod_name, None)


async def sync_core_premium() -> None:
    """Bring every core premium build in line with the licence: gone when there
    is no key, freshly downloaded when there is one."""
    state = _load()
    if not state.get("license_key", "").strip():
        clear_core_premium()
        return
    for name in CORE_PREMIUM_MODULES:
        try:
            await download_core_premium(name)
        except PermissionError:
            clear_core_premium(name)
        except RuntimeError:
            # Unreachable site: keep whatever is already on disk rather than
            # breaking a working feature because of a network blip.
            pass


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
        "site": SITE + "/pricing",
        "pending_invoice": state.get("pending_invoice"),
        "invoice_history": state.get("invoice_history", []),
        "seats": state.get("seats", 1),
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


def _real_app_ids() -> list:
    """Installed apps that are actual store apps with an apps/<id>/ folder
    on disk — unlike the core apps (Apps Hub, App Store, Notifications...)
    that are seeded into the same `plugins` table purely for Start Menu
    recent/most-used tracking (see db.py's SYSTEM_APPS) but never have a
    folder of their own and so can never have premium content to check.
    Same test download_premium() already makes internally before ever
    reaching out to mvmos.org — done here first so a system app is never
    even attempted, let alone reported as missing something it could never
    have had.
    """
    from .db import APPS_DIR

    return [app_id for app_id in _installed_app_ids() if os.path.isdir(os.path.join(APPS_DIR, app_id))]


def _installed_app_names() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name FROM plugins").fetchall()
    return {r["id"]: r["name"] for r in rows}


# --- content delivery status -------------------------------------------------
#
# The Settings "Premium content" panel exists because sync_all_premium() is a
# fire-and-forget background task: if the process restarts, crashes, or hits
# a network blip while it's mid-run, the badge above can say "premium" while
# some app's premium/ never actually arrived, with nothing telling anyone.
# This records the outcome of every attempt (delivered / not applicable to
# this app / failed) so the count on the button is accurate without anyone
# needing to click anything, and "Check for missing content" gives a way to
# retry without waiting for the next heartbeat or re-entering the key.
_CONTENT_STATUS_KEY = "premium_content_status"


def _load_content_status() -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (_CONTENT_STATUS_KEY,)).fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return {}


def _save_content_status(status: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (_CONTENT_STATUS_KEY, json.dumps(status)),
        )


async def _check_app_content(app_id: str) -> dict:
    """Fetch (or confirm) one app's premium content and persist the result.
    `available` is False only for a real "nothing published for this app"
    (404) — that is not a failure and does not count against the badge.
    """
    entry = {"checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        found = await download_premium(app_id)
        entry["available"] = found
        entry["delivered"] = bool(found) and os.path.isdir(_premium_app_dir(app_id))
        entry["error"] = None
    except PermissionError:
        entry["available"] = True
        entry["delivered"] = False
        entry["error"] = "premium_required"
    except RuntimeError as e:
        entry["available"] = True
        entry["delivered"] = False
        entry["error"] = str(e)
    status = _load_content_status()
    status[app_id] = entry
    _save_content_status(status)
    return entry


# Display name per core premium module — short, curated list (see
# CORE_PREMIUM_MODULES above), unlike store apps there is no `plugins` row
# to read a name from.
_CORE_PREMIUM_NAMES = {"apphub": "Apps Hub"}
# Key prefix for a core module's entry in the same status dict as store
# apps — apphub the core module and a hypothetical "apphub"-named store app
# are different things and must not collide.
_CORE_STATUS_PREFIX = "core:"


async def _check_core_content(name: str) -> dict:
    """Same bookkeeping as _check_app_content, for a core premium module
    (backend/premium/<name>/) instead of a store app's apps/<id>/premium/."""
    entry = {"checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        found = await download_core_premium(name)
        entry["available"] = found
        entry["delivered"] = bool(found) and os.path.isdir(_core_premium_dir(name))
        entry["error"] = None
    except PermissionError:
        entry["available"] = True
        entry["delivered"] = False
        entry["error"] = "premium_required"
    except RuntimeError as e:
        entry["available"] = True
        entry["delivered"] = False
        entry["error"] = str(e)
    status = _load_content_status()
    status[_CORE_STATUS_PREFIX + name] = entry
    _save_content_status(status)
    return entry


def _content_status_payload() -> dict:
    state = _load()
    status = _load_content_status()
    names = _installed_app_names()
    apps = []
    for app_id in _real_app_ids():
        entry = status.get(app_id)
        if entry is None:
            # Never checked (app installed before this feature existed, or
            # before the first sync ran) — fall back to a live filesystem
            # look rather than showing an indefinite unknown state.
            delivered = os.path.isdir(_premium_app_dir(app_id))
            entry = {"available": delivered, "delivered": delivered, "checked_at": None, "error": None}
        else:
            # Trust the recorded "available" (does this app even have
            # premium content at all) but re-confirm "delivered" against the
            # filesystem right now — something else could have removed it
            # since the last check.
            entry = dict(entry)
            entry["delivered"] = bool(entry.get("available")) and os.path.isdir(_premium_app_dir(app_id))
        if entry.get("available"):
            apps.append({"app_id": app_id, "name": names.get(app_id, app_id), **entry})
    for name in CORE_PREMIUM_MODULES:
        entry = status.get(_CORE_STATUS_PREFIX + name)
        if entry is None:
            delivered = os.path.isdir(_core_premium_dir(name))
            entry = {"available": delivered, "delivered": delivered, "checked_at": None, "error": None}
        else:
            entry = dict(entry)
            entry["delivered"] = bool(entry.get("available")) and os.path.isdir(_core_premium_dir(name))
        if entry.get("available"):
            apps.append({"app_id": _CORE_STATUS_PREFIX + name, "name": _CORE_PREMIUM_NAMES.get(name, name), **entry})
    delivered_count = sum(1 for a in apps if a["delivered"])
    return {"apps": apps, "delivered": delivered_count, "total": len(apps),
            "premium": state.get("status") == "premium"}


@router.get("/content")
async def get_content_status(_session=Depends(get_current_session)):
    return JSONResponse(_content_status_payload())


@router.post("/content/recheck")
async def recheck_content(_session=Depends(get_current_session)):
    state = _load()
    if state.get("status") != "premium":
        return JSONResponse({"error": "not_premium"}, status_code=402)
    for app_id in _real_app_ids():
        try:
            await _check_app_content(app_id)
        except Exception:
            pass
    for name in CORE_PREMIUM_MODULES:
        try:
            await _check_core_content(name)
        except Exception:
            pass
    return JSONResponse(_content_status_payload())


async def sync_all_premium() -> None:
    """Activation hook: fetch premium content for every already-installed app
    (and every core premium module) in one pass, so buying a subscription
    does not require reinstalling anything to get the premium build. Each
    attempt's outcome is recorded (see _check_app_content/_check_core_content)
    so the Settings "Premium content" badge is accurate even though this
    whole function runs as a background task the caller never waits for.
    """
    for app_id in _real_app_ids():
        try:
            await _check_app_content(app_id)
        except Exception:
            pass
    for name in CORE_PREMIUM_MODULES:
        try:
            await _check_core_content(name)
        except Exception:
            pass


def clear_all_premium() -> None:
    """Removal hook: wipe premium/ from every installed app, and every core
    premium build, so nothing licensed stays behind once the key is gone.
    """
    for app_id in _installed_app_ids():
        clear_premium_dir(app_id)
    clear_core_premium()
    _save_content_status({})


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


class BtcInvoiceBody(BaseModel):
    plan: str
    seats: int = 1
    renew: bool = False


@router.post("/btc/quote")
async def btc_get_quote(body: BtcInvoiceBody, _session=Depends(get_current_session)):
    """Read-only preview of price + expiry effect for a plan/seat choice, so
    the frontend can show it before the buyer commits to anything. Mints
    nothing on mvmos.org's side — meant to be called on every change to the
    plan/seats selection.
    """
    import httpx

    state = _load()
    code = None
    if body.renew:
        code = state.get("license_key", "").strip()
        if not code:
            raise HTTPException(400, detail="No license key stored to renew")
    payload = {"plan": body.plan, "seats": body.seats}
    if code:
        payload["code"] = code
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(_BTC_QUOTE_URL, json=payload)
    except Exception:
        raise HTTPException(502, detail="unreachable")
    if r.status_code != 200:
        raise HTTPException(r.status_code, detail=r.text)
    return JSONResponse(r.json())


@router.post("/btc/invoice")
async def btc_create_invoice(body: BtcInvoiceBody, _session=Depends(get_current_session)):
    """Ask mvmos.org to mint a fresh receiving address for this plan. When
    renewing, the stored license key rides along so the payment extends it
    instead of minting a brand new one. Seat count always rides along too —
    unchanged seats just add the new period on top of what's left; a changed
    seat count re-values the remaining time at the new tier (see mvmos.org's
    _price_quote), so it has to reach the server on every call, renewal or
    not.
    """
    import httpx

    state = _load()
    code = None
    if body.renew:
        code = state.get("license_key", "").strip()
        if not code:
            raise HTTPException(400, detail="No license key stored to renew")
    payload = {"plan": body.plan, "seats": body.seats}
    if code:
        payload["code"] = code
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(_BTC_INVOICE_URL, json=payload)
    except Exception:
        raise HTTPException(502, detail="unreachable")
    if r.status_code != 200:
        raise HTTPException(r.status_code, detail=r.text)
    result = r.json()
    result["status"] = "pending"
    result["created_local_at"] = datetime.now(timezone.utc).isoformat()
    state["pending_invoice"] = result
    history = state.setdefault("invoice_history", [])
    history.insert(0, dict(result))
    del history[_INVOICE_HISTORY_LIMIT:]
    _save(state)
    return JSONResponse(result)


async def _poll_invoice(invoice_id: str) -> dict | None:
    """Ask mvmos.org whether this invoice is paid yet. On its own it changes
    nothing — the caller decides what to do with the result. A 404 (invoice
    gone from mvmos.org) is reported as such rather than folded into the
    same "network problem" bucket as an actual connection failure.
    """
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{_BTC_INVOICE_URL}/{invoice_id}")
    except Exception:
        return None
    if r.status_code == 404:
        return {"status": "not_found"}
    if r.status_code != 200:
        return None
    return r.json()


def _update_history_entry(state: dict, invoice_id: str, **fields) -> None:
    for entry in state.get("invoice_history", []):
        if entry.get("invoice_id") == invoice_id:
            entry.update(fields)
            return


async def _apply_invoice_result(state: dict, invoice_id: str, data: dict) -> None:
    """Update this invoice's stored status (so the user's own history stays
    current), and on a fresh "paid" result, save the code locally and refresh
    right away rather than waiting for the next heartbeat.
    """
    if data.get("status") == "paid" and data.get("license_code"):
        already_recorded = state.get("license_key") == data["license_code"] and not state.get("pending_invoice")
        _update_history_entry(state, invoice_id, status="paid",
                              paid_at=datetime.now(timezone.utc).isoformat())
        state["license_key"] = data["license_code"]
        state["pending_invoice"] = None
        result = await _refresh(state)
        _save(state)
        if result.get("valid") and not already_recorded:
            asyncio.create_task(sync_all_premium())
    elif data.get("status") in ("pending", "seen"):
        # received_sats rides along so a buyer who left mid-payment and comes
        # back later (settings reopened, invoice reopened from history) sees
        # what's already arrived without needing this tab to still be polling.
        pending = state.get("pending_invoice")
        if pending and pending.get("invoice_id") == invoice_id:
            pending["status"] = data.get("status")
            pending["received_sats"] = data.get("received_sats", 0)
        _update_history_entry(state, invoice_id, status=data.get("status"),
                              received_sats=data.get("received_sats", 0))
        _save(state)
    elif data.get("status") == "cancelled":
        # Mirrors the same cleanup as "not_found" — reached when the
        # heartbeat loop (not just the explicit cancel click) is the one that
        # sees the cancellation, e.g. after the settings panel was closed.
        pending = state.get("pending_invoice")
        if pending and pending.get("invoice_id") == invoice_id:
            state["pending_invoice"] = None
        _update_history_entry(state, invoice_id, status="cancelled")
        _save(state)
    elif data.get("status") == "not_found":
        # mvmos.org no longer has this invoice (an admin cleanup, for
        # instance) — stop showing it as "waiting" forever.
        pending = state.get("pending_invoice")
        if pending and pending.get("invoice_id") == invoice_id:
            state["pending_invoice"] = None
        _update_history_entry(state, invoice_id, status="not_found")
        _save(state)


@router.get("/btc/invoice/{invoice_id}")
async def btc_check_invoice(invoice_id: str, _session=Depends(get_current_session)):
    """Poll mvmos.org for this invoice. The moment it comes back paid, save
    the license code locally and refresh right away — activation should not
    wait for the next heartbeat. (The heartbeat loop polls the same way in
    the background, so this also gets caught even with Settings closed.)
    """
    data = await _poll_invoice(invoice_id)
    if data is None:
        raise HTTPException(502, detail="unreachable")
    state = _load()
    await _apply_invoice_result(state, invoice_id, data)
    if data.get("status") == "paid":
        data["premium"] = _public(state)
    return JSONResponse(data)


@router.post("/btc/invoice/{invoice_id}/cancel")
async def btc_cancel_invoice(invoice_id: str, _session=Depends(get_current_session)):
    """Cancel a pending invoice: recorded as cancelled on mvmos.org so it
    doesn't just sit there looking like an unpaid one forever, and dropped
    from local state so the QR/address box disappears here. A payment that
    slipped in right before the cancel click is still applied normally —
    cancelling never discards money that actually arrived.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{_BTC_INVOICE_URL}/{invoice_id}/cancel")
    except Exception:
        raise HTTPException(502, detail="unreachable")
    if r.status_code not in (200, 400):
        raise HTTPException(r.status_code, detail=r.text)
    data = r.json()

    state = _load()
    if data.get("status") == "paid":
        full = await _poll_invoice(invoice_id)
        if full:
            await _apply_invoice_result(state, invoice_id, full)
    else:
        pending = state.get("pending_invoice")
        if pending and pending.get("invoice_id") == invoice_id:
            state["pending_invoice"] = None
        _update_history_entry(state, invoice_id, status="cancelled")
        _save(state)
    return JSONResponse({"status": data.get("status", "cancelled")})


@router.get("/license/reveal")
async def reveal_license(_session=Depends(get_current_session)):
    """The full code, for copying into another installation sharing the same
    key. Gated client-side by mvmOS.confirmPassword before this is ever
    called — the code is otherwise never sent to the frontend at all.
    """
    state = _load()
    key = state.get("license_key", "").strip()
    if not key:
        raise HTTPException(404, detail="No license key stored")
    return JSONResponse({"license_key": key})
