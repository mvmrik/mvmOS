"""News from mvmos.org, shown inside the desktop.

The site publishes one small feed (/api/feed). The desktop asks for it when it
notices an update (the news explaining it replaces the notification), and a
timer asks at a long, jittered interval only when the administrator wants news
about apps that are not installed here. Items the administrator wants are kept
and handed to the desktop once. There is no read/unread bookkeeping: the only
thing remembered is the id of the newest item that was fetched, so an item
appears when it is newer than that and matches the chosen kinds, and never
again. Older news is for the website.

Nothing here is per user. The kinds are decided for the whole installation, in
the setup wizard or in the news window, and only an administrator sees and
changes them.
"""

import asyncio
import json
import os
import random
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import get_current_session, user_can_sudo
from .db import get_conn

router = APIRouter(prefix="/api/newsfeed", tags=["newsfeed"])

SITE = os.getenv("MVMOS_PREMIUM_SITE", "https://mvmos.org")
_FEED_URL = SITE + "/api/feed"
_SETTINGS_KEY = "newsfeed"

# Everything is on until the administrator says otherwise; only a choice to
# turn all of it off stops the checks.
DEFAULT_PREFS = {"core": True, "new_apps": True, "changed_apps": True, "changed_all": False}

_CHECK_EVERY = 6 * 3600       # between checks of the site
_JITTER = 1800                # random extra wait so installations do not line up
_RETRY_AFTER = 1800           # after a failed check
_MAX_PENDING = 10
_MIN_GAP = 600                # least time between two asks of the site that the desktop may cause
_REFINE_TIMEOUT = 8

_wake = asyncio.Event()


# ── Stored state ─────────────────────────────────────────────────────────────

def _load() -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (_SETTINGS_KEY,)).fetchone()
    try:
        saved = json.loads(row["value"]) if row else {}
    except (TypeError, ValueError):
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    prefs = {**DEFAULT_PREFS, **(saved.get("prefs") if isinstance(saved.get("prefs"), dict) else {})}
    prefs = {key: bool(prefs[key]) for key in DEFAULT_PREFS}
    pending = saved.get("pending") if isinstance(saved.get("pending"), list) else []
    last_id = saved.get("last_id")
    return {
        "prefs": prefs,
        "pending": [p for p in pending if isinstance(p, dict) and isinstance(p.get("id"), int)],
        "last_id": last_id if isinstance(last_id, int) else None,
        "etag": saved.get("etag") if isinstance(saved.get("etag"), str) else "",
        "checked_at": saved.get("checked_at") if isinstance(saved.get("checked_at"), (int, float)) else 0,
    }


def _save(state: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (_SETTINGS_KEY, json.dumps(state)),
        )


def _wants_anything(prefs: dict) -> bool:
    return bool(prefs["core"] or prefs["new_apps"] or prefs["changed_apps"])


def _watches_in_background(prefs: dict) -> bool:
    """Whether the site has to be asked on a timer.

    News about the system and about installed apps arrives with the update
    notification, which is what asks for it. The timer is only for what no
    notification will ever announce: apps that are not installed here, new ones
    or changed ones. Without those choices nothing is polled.
    """
    return bool(prefs["new_apps"] or (prefs["changed_apps"] and prefs["changed_all"]))


def _installed_ids() -> set:
    with get_conn() as conn:
        return {row["id"] for row in conn.execute("SELECT id FROM plugins").fetchall()}


def _language() -> str:
    from .settings import DEFAULTS, resolve_language
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
    try:
        value = json.loads(row["value"]).get("language") if row else None
    except (TypeError, ValueError, AttributeError):
        value = None
    return resolve_language(value or DEFAULTS["language"])


def _relevant(item: dict, prefs: dict, installed: set) -> dict | None:
    """The parts of a news item this installation asked for, or None."""
    new_ids = [i for i in item.get("new", []) if isinstance(i, str)] if prefs["new_apps"] else []
    changed = [i for i in item.get("changed", []) if isinstance(i, str)] if prefs["changed_apps"] else []
    if not prefs["changed_all"]:
        changed = [i for i in changed if i in installed]
    core = bool(item.get("core")) and prefs["core"]
    if not (core or new_ids or changed):
        return None
    return {
        "id": item["id"],
        "title": str(item.get("title") or ""),
        "body": str(item.get("body") or ""),
        "image": str(item.get("image") or ""),
        "url": str(item.get("url") or ""),
        "published_at": item.get("published_at"),
        "core": core,
        "new": new_ids,
        "changed": changed,
    }


# ── Checking the site ────────────────────────────────────────────────────────

async def check_now() -> bool:
    """Ask the site once. True when the answer could be read (or was unchanged)."""
    state = _load()
    if not _wants_anything(state["prefs"]):
        return True
    since = state["last_id"] or 0
    # The cache validator belongs to the exact question that was asked.
    headers = {"Accept": "application/json"}
    if state["etag"] and since:
        headers["If-None-Match"] = state["etag"]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(_FEED_URL, params={"since": since, "lang": _language()}, headers=headers)
        if res.status_code == 304:
            state = _load()
            state["checked_at"] = time.time()
            _save(state)
            return True
        res.raise_for_status()
        data = res.json()
        latest = int(data["latest"])
        items = [i for i in data.get("items", []) if isinstance(i, dict) and isinstance(i.get("id"), int)]
    except Exception:
        return False

    state = _load()
    installed = _installed_ids()
    have = {p["id"] for p in state["pending"]}
    fresh = [r for r in (_relevant(i, state["prefs"], installed) for i in items)
             if r and r["id"] not in have]
    # The unfiltered item is what is stored: the choices may change before the
    # window is shown, and the filter runs again when it is.
    raw = {i["id"]: i for i in items}
    for r in fresh:
        state["pending"].append({k: raw[r["id"]].get(k) for k in
                                 ("id", "title", "body", "image", "url", "published_at", "core", "new", "changed")})
    state["pending"] = sorted(state["pending"], key=lambda p: p["id"])[-_MAX_PENDING:]
    state["last_id"] = latest
    state["etag"] = res.headers.get("etag", "")
    state["checked_at"] = time.time()
    _save(state)
    return True


async def news_loop() -> None:
    """Background check for as long as the server runs, when it is wanted."""
    await asyncio.sleep(random.uniform(30, 120))
    while True:
        ok = True
        try:
            if _watches_in_background(_load()["prefs"]):
                ok = await check_now()
        except Exception:
            ok = False
        wait = _CHECK_EVERY + random.uniform(0, _JITTER) if ok else _RETRY_AFTER
        try:
            # A change of the choices wakes the loop early.
            await asyncio.wait_for(_wake.wait(), timeout=wait)
            _wake.clear()
            await asyncio.sleep(random.uniform(2, 10))
        except asyncio.TimeoutError:
            pass


# ── API ──────────────────────────────────────────────────────────────────────

def _is_admin(session: dict) -> bool:
    return user_can_sudo(session.get("effective_user") or "")


def _require_manager(session=Depends(get_current_session)) -> dict:
    # Deciding what news the installation receives is a system choice, like the
    # update settings: for those who may administer it. No password is asked
    # for it — it changes nothing on the server.
    if not _is_admin(session):
        raise HTTPException(status_code=403, detail="Administrator required")
    return session


async def _store_entries(ids: list) -> dict:
    """The Store entry (with installed / update_available) of each id found."""
    from .plugins import _annotate, _fetch_json, _installed_map
    from .storemerge import build_merged_tree
    wanted = {i for i in ids if isinstance(i, str)}
    if not wanted:
        return {}
    with get_conn() as conn:
        stores = [dict(r) for r in conn.execute("SELECT * FROM stores").fetchall()]
    tree = await build_merged_tree(
        stores, "apps", _fetch_json, lambda items: _annotate(items, _installed_map()))
    found: dict = {}
    _walk({"categories": tree.get("categories", [])}, wanted, found)
    return found


def _refine(item: dict, entries: dict, prefs: dict) -> dict | None:
    """Drop what no longer needs anything from this installation.

    An update that was already installed when the notification arrived, or an
    app that was installed some other way, must not come back as news with a
    button for it hours later. Anything about the system itself stays.
    """
    new_ids = [i for i in item["new"] if i in entries and not entries[i].get("installed")]
    changed = []
    for i in item["changed"]:
        entry = entries.get(i)
        if not entry:
            continue
        if entry.get("installed"):
            if entry.get("update_available"):
                changed.append(i)
        elif prefs["changed_all"]:
            changed.append(i)
    if not (item["core"] or new_ids or changed):
        return None
    return {**item, "new": new_ids, "changed": changed}


@router.get("")
async def get_state(session=Depends(get_current_session)):
    """The choices and the news waiting to be shown (administrators only)."""
    state = _load()
    if not _is_admin(session):
        return JSONResponse({"can_manage": False, "prefs": state["prefs"], "items": []})
    installed = _installed_ids()
    items = [r for r in (_relevant(p, state["prefs"], installed) for p in state["pending"]) if r]
    if items:
        try:
            entries = await asyncio.wait_for(
                _store_entries([i for it in items for i in it["new"] + it["changed"]]), _REFINE_TIMEOUT)
        except Exception:
            entries = None   # the Store cannot be read: show everything rather than hide news
        if entries is not None:
            refined = [(it, _refine(it, entries, state["prefs"])) for it in items]
            done = {it["id"] for it, r in refined if r is None}
            if done:
                state["pending"] = [p for p in state["pending"] if p["id"] not in done]
                _save(state)
            items = [r for _, r in refined if r]
    return JSONResponse({"can_manage": True, "prefs": state["prefs"], "items": items})


@router.post("/check")
async def check_soon(session=Depends(_require_manager)):
    """Ask the site now, because an update notification has just appeared.

    The news about an update should arrive together with its notification, not
    hours later. The site is still asked at most once in ten minutes, however
    often the desktop calls this.
    """
    state = _load()
    if time.time() - state["checked_at"] < _MIN_GAP:
        return JSONResponse({"checked": False})
    return JSONResponse({"checked": await check_now()})


class PrefsBody(BaseModel):
    core: bool | None = None
    new_apps: bool | None = None
    changed_apps: bool | None = None
    changed_all: bool | None = None


@router.post("/prefs")
async def save_prefs(body: PrefsBody, session=Depends(_require_manager)):
    state = _load()
    was_prefs = dict(state["prefs"])
    for key, value in body.model_dump().items():
        if value is not None:
            state["prefs"][key] = bool(value)
    if not _wants_anything(state["prefs"]):
        # Nothing is wanted: stop remembering a cursor that will go stale, so
        # turning it on again later shows what is current, not a backlog.
        state["pending"] = []
        state["last_id"] = None
        state["etag"] = ""
    _save(state)
    if not _watches_in_background(was_prefs) and _watches_in_background(state["prefs"]):
        _wake.set()
    return JSONResponse({"prefs": state["prefs"]})


@router.post("/seen")
async def mark_seen(session=Depends(_require_manager)):
    """The window has been shown; what was waiting is not shown again."""
    state = _load()
    state["pending"] = []
    _save(state)
    return JSONResponse({"ok": True})


class AppsBody(BaseModel):
    ids: list[str]


def _walk(node: dict, wanted: set, found: dict) -> None:
    for item in node.get("items", []) or []:
        if item.get("id") in wanted and item["id"] not in found:
            found[item["id"]] = item
    for child in node.get("categories", []) or []:
        _walk(child, wanted, found)


@router.post("/apps")
async def apps_info(body: AppsBody, session=Depends(_require_manager)):
    """Store entries for the apps a news item mentions, ready for the Install
    and Update buttons (the same entries the App Store itself installs from)."""
    found = await _store_entries(body.ids)
    return JSONResponse({"apps": [found[i] for i in body.ids if i in found]})
