"""Forum — talk with other mvmOS administrators on mvmos.org.

Posts live on mvmos.org (its public /forum shows them to everybody); this
module is the only way to write there. An installation is known to the site by
the digest of its installation id and by the nickname it chose, exactly like
app reviews, so nobody needs an account. Only administrators use the Forum app
and nothing here is public on the server itself.

What a person follows stays on this server and nowhere else:

  * forum_watch  the threads a login watches. A thread is watched
                 automatically when its owner starts or answers it, and can be
                 watched or let go by hand. A thread that is closed (by its
                 author, or after six months without a post) is no longer asked about.
  * notices      the asks of the site ride on the existing news check (a few
                 times a day, see newsfeed.news_loop) and nothing else: one
                 question — "what is new in these threads?" — and each answer
                 becomes an ordinary notification for the logins that watch
                 the thread. Without a watched, open thread nothing is asked.
                 While the Forum window is open it also asks every few minutes,
                 to show what is new in it, and stops when the window closes.

The site keeps no list of who watches what.
"""

import json
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from . import premium
from .auth import get_current_session, user_can_sudo
from .db import get_conn
from .notifications import create_notification
from .plugins import _core_version

router = APIRouter(prefix="/api/forum", tags=["forum"])

SITE = premium.SITE
_MAX_NOTIFY = 20         # most notifications one check may raise
_MIN_GAP = 60            # least seconds between two asks of the site about followed threads
_last_ask = 0.0
_ready = False


def _ensure() -> None:
    global _ready
    if _ready:
        return
    with get_conn() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS forum_watch ("
            "thread_id INTEGER NOT NULL, username TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', "
            "seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (thread_id, username))"
        )
        if "closed" not in [r["name"] for r in conn.execute("PRAGMA table_info(forum_watch)").fetchall()]:
            conn.execute("ALTER TABLE forum_watch ADD COLUMN closed INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    _ready = True


def _headers() -> dict:
    return {"X-mvmOS-Device": premium.installation_id(), "User-Agent": f"mvmOS/{_core_version()}"}


def _require_admin(session=Depends(get_current_session)) -> dict:
    # The forum is for those who run the server. Nothing here changes the server
    # itself, so — as with the news choices — no password is asked.
    if not user_can_sudo(session.get("effective_user") or ""):
        raise HTTPException(403, detail="admin_only")
    return session


def _user(session: dict) -> str:
    return session.get("effective_user") or ""


async def _site(method: str, path: str, *, params=None, body=None) -> JSONResponse:
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.request(method, f"{SITE}/api/forum{path}", headers=_headers(), params=params, json=body)
        data = r.json()
    except Exception:
        return JSONResponse({"detail": "site_unreachable"}, status_code=502)
    return JSONResponse(data, status_code=r.status_code)


async def _site_json(path: str, params=None):
    async with httpx.AsyncClient(timeout=12) as client:
        r = await client.get(f"{SITE}/api/forum{path}", headers=_headers(), params=params)
    r.raise_for_status()
    return r.json()


# ── Reading and writing (a thin door to the site) ────────────────────────────

@router.get("/me")
async def me(session=Depends(_require_admin)):
    return await _site("GET", "/me")


@router.put("/me")
async def set_nick(request: Request, session=Depends(_require_admin)):
    return await _site("PUT", "/me", body=await request.json())


@router.get("/categories")
async def categories(lang: str = "", session=Depends(_require_admin)):
    return await _site("GET", "/categories", params={"lang": lang})


@router.get("/subjects")
async def subjects(scope: str = "", q: str = "", names: str = "en", session=Depends(_require_admin)):
    """What a thread can be about (the system, a built-in app or a Store app), for suggestions."""
    return await _site("GET", "/subjects", params={"scope": scope, "q": q, "names": names})


@router.get("/threads")
async def threads(category: int = 0, mine: int = 0, offset: int = 0, lang: str = "", subject: str = "",
                  names: str = "en", session=Depends(_require_admin)):
    return await _site("GET", "/threads", params={"category": category, "mine": mine, "offset": offset,
                                                  "lang": lang, "subject": subject, "names": names})


@router.get("/latest")
async def latest(offset: int = 0, lang: str = "", names: str = "en", session=Depends(_require_admin)):
    return await _site("GET", "/latest", params={"offset": offset, "lang": lang, "names": names})


@router.get("/threads/{thread_id}")
async def thread(thread_id: int, offset: int = 0, names: str = "en", session=Depends(_require_admin)):
    _ensure()
    resp = await _site("GET", f"/threads/{thread_id}", params={"offset": offset, "names": names})
    if resp.status_code == 200:
        data = json.loads(resp.body)
        user = _user(session)
        with get_conn() as conn:
            row = conn.execute("SELECT 1 FROM forum_watch WHERE thread_id=? AND username=?", (thread_id, user)).fetchone()
            # Reading a thread is what the notifications about it were for.
            conn.execute("UPDATE notifications SET is_read=1 WHERE username=? AND source='forum' AND ref=? AND is_read=0",
                         (user, f"thread:{thread_id}"))
            if row:
                conn.execute("UPDATE forum_watch SET seen=MAX(seen, ?), title=? WHERE thread_id=? AND username=?",
                             (data.get("last_post_id") or 0, data["thread"]["title"], thread_id, user))
            conn.commit()
        data["watching"] = bool(row)
        return JSONResponse(data)
    return resp


def _watch(user: str, thread_id: int, title: str, seen: int) -> None:
    _ensure()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO forum_watch (thread_id, username, title, seen) VALUES (?,?,?,?) "
            "ON CONFLICT(thread_id, username) DO UPDATE SET title=excluded.title, seen=MAX(seen, excluded.seen)",
            (thread_id, user, title[:200], seen))
        conn.commit()


@router.post("/threads")
async def new_thread(request: Request, session=Depends(_require_admin)):
    body = await request.json()
    resp = await _site("POST", "/threads", body=body)
    if resp.status_code == 200:
        data = json.loads(resp.body)
        _watch(_user(session), data["thread_id"], str(body.get("title") or ""), data["post_id"])
    return resp


@router.post("/threads/{thread_id}/posts")
async def reply(thread_id: int, request: Request, session=Depends(_require_admin)):
    body = await request.json()
    resp = await _site("POST", f"/threads/{thread_id}/posts", body=body)
    if resp.status_code == 200:
        data = json.loads(resp.body)
        title = ""
        _ensure()
        with get_conn() as conn:
            row = conn.execute("SELECT title FROM forum_watch WHERE thread_id=? AND username=?", (thread_id, _user(session))).fetchone()
        title = row["title"] if row else ""
        _watch(_user(session), thread_id, title, data["post_id"])
    return resp


@router.post("/threads/{thread_id}/close")
async def close_thread(thread_id: int, session=Depends(_require_admin)):
    resp = await _site("POST", f"/threads/{thread_id}/close")
    if resp.status_code == 200:
        _ensure()
        with get_conn() as conn:
            conn.execute("UPDATE forum_watch SET closed=1 WHERE thread_id=?", (thread_id,))
            conn.commit()
    return resp


@router.get("/pulse")
async def pulse(lang: str = "", session=Depends(_require_admin)):
    """What the open Forum window asks every few minutes: the categories (to show where
    there is something new) and, for followed threads, the notifications."""
    await check_now(throttle=True)
    return await _site("GET", "/categories", params={"lang": lang})


@router.put("/posts/{post_id}")
async def edit_post(post_id: int, request: Request, session=Depends(_require_admin)):
    return await _site("PUT", f"/posts/{post_id}", body=await request.json())


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, session=Depends(_require_admin)):
    return await _site("DELETE", f"/posts/{post_id}")


# ── Following ────────────────────────────────────────────────────────────────

@router.get("/watching")
async def watching(session=Depends(_require_admin)):
    _ensure()
    with get_conn() as conn:
        rows = conn.execute("SELECT thread_id, title, closed FROM forum_watch WHERE username=? ORDER BY rowid DESC", (_user(session),)).fetchall()
    return {"threads": [{"id": r["thread_id"], "title": r["title"], "closed": bool(r["closed"])} for r in rows]}


@router.put("/watch/{thread_id}")
async def watch(thread_id: int, request: Request, session=Depends(_require_admin)):
    body = await request.json()
    _watch(_user(session), thread_id, str(body.get("title") or ""), int(body.get("seen") or 0))
    return {"watching": True}


@router.delete("/watch/{thread_id}")
async def unwatch(thread_id: int, session=Depends(_require_admin)):
    _ensure()
    with get_conn() as conn:
        conn.execute("DELETE FROM forum_watch WHERE thread_id=? AND username=?", (thread_id, _user(session)))
        conn.commit()
    return {"watching": False}


# ── Notifications ────────────────────────────────────────────────────────────

async def check_now(throttle: bool = False) -> bool:
    """One question to the site about the followed, still open threads; every answer
    becomes a notification. True when it worked (or there was nothing to ask)."""
    global _last_ask
    _ensure()
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT thread_id, username, seen FROM forum_watch WHERE closed=0").fetchall()]
    if not rows:
        return True
    if throttle and time.time() - _last_ask < _MIN_GAP:
        return True
    _last_ask = time.time()
    ids = sorted({r["thread_id"] for r in rows})[:200]
    after = min(r["seen"] for r in rows if r["thread_id"] in ids)
    try:
        data = await _site_json("/updates", {"after": after, "threads": ",".join(map(str, ids))})
    except Exception:
        return False
    raised = 0
    advance: dict = {}
    for post in data.get("posts", []):
        for r in rows:
            if r["thread_id"] != post["thread_id"] or post["id"] <= r["seen"]:
                continue
            advance[(r["thread_id"], r["username"])] = max(advance.get((r["thread_id"], r["username"]), 0), post["id"])
            if raised >= _MAX_NOTIFY:
                continue
            raised += 1
            create_notification(
                r["username"], post["title"], f"{post['author'] or ''}: {post['body']}"[:240],
                kind="persistent", source="forum", action_app="forum", ref=f"thread:{post['thread_id']}",
                title_key="forum_notif_title", vars={"title": post["title"]}, audience="os")
    closed = [int(i) for i in data.get("closed", []) if str(i).isdigit()]
    if advance or closed:
        with get_conn() as conn:
            for (tid, user), seen in advance.items():
                conn.execute("UPDATE forum_watch SET seen=MAX(seen, ?) WHERE thread_id=? AND username=?", (seen, tid, user))
            for tid in closed:   # nothing more can come: stop asking about it
                conn.execute("UPDATE forum_watch SET closed=1 WHERE thread_id=?", (tid,))
            conn.commit()
    return True
