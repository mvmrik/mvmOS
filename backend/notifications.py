import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .auth import get_current_session, get_current_session_optional
from .db import get_conn

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def create_notification(username: str, title: str, body: str = "", kind: str = "persistent",
                         source: str = "system", action_app: str = None, ref: str = None) -> dict:
    """Insert a notification row. Called both from the HTTP API (below) and
    directly by other backend modules (e.g. chat) that need to notify a user
    other than the current request's session.

    `username` identifies the recipient — either an mvmOS OS session username
    (session['effective_user']) or an Apps Hub username, whichever identity
    the calling app's users are keyed by (e.g. chat notifies Apps Hub users
    by their Apps Hub username, since that's who a chat message is "to").
    See _identities() below for how reads resolve both.

    `ref` is an opaque, app-chosen id for the underlying thing the
    notification is about (e.g. the sender's user id for a chat message).
    It lets the app that created the notification clear it later — see
    mark_read_by_ref() — when the user views that thing directly instead of
    going through the bell icon."""
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO notifications (username, kind, source, title, body, action_app, ref, is_read, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (username, kind, source, title, body, action_app, ref, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM notifications WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def _identities(session, x_pub_token: str = None) -> list:
    """A browser session carries two independent identities at once: the
    mvmOS OS login (session['effective_user']) and, if the user is also
    logged into an Apps Hub profile (e.g. to use Chat), that profile's own
    username — a separate account system, unrelated to the OS login. Bell/
    Notifications reads must match either, since a notification can be
    addressed to whichever identity the creating app knows its users by.

    `session` may be None for routes that accept an optional OS session
    (pure Apps Hub visitors with no mvmOS desktop session at all)."""
    ids = [session["effective_user"]] if session else []
    if x_pub_token:
        hub = sys.modules.get("backend.apphub")
        pub = hub.get_pub_session(x_pub_token) if hub else None
        if pub and pub.get("username") and pub["username"] not in ids:
            ids.append(pub["username"])
    return ids


class CreateBody(BaseModel):
    title: str
    body: str = ""
    kind: str = "persistent"
    source: str = "app"
    action_app: Optional[str] = None
    ref: Optional[str] = None


@router.get("/badges")
async def notification_badges(x_pub_token: str = Header(default=None)):
    """Per-app unread-notification presence, keyed by action_app — no counts,
    no title/body, just which apps have something new. Apps Hub-token only
    (no OS session): lets the public Apps Hub directory (a page someone can
    reach with only a public account, no mvmOS desktop session) show a plain
    badge dot on an app's card without revealing what the notification says."""
    hub = sys.modules.get("backend.apphub")
    pub = hub.get_pub_session(x_pub_token) if hub and x_pub_token else None
    if not pub:
        return JSONResponse({})
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT action_app FROM notifications "
            "WHERE username = ? AND is_read = 0 AND action_app IS NOT NULL",
            (pub["username"],),
        ).fetchall()
    return JSONResponse({r["action_app"]: True for r in rows})


notification_badges.no_session_auth = True


@router.get("")
async def list_notifications(session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    ids = _identities(session, x_pub_token)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM notifications WHERE username IN ({','.join('?' * len(ids))}) "
            "ORDER BY created_at DESC LIMIT 300",
            ids,
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


@router.post("")
async def post_notification(body: CreateBody, session=Depends(get_current_session)):
    username = session["effective_user"]
    # Callers that pass a `ref` are reporting an ongoing condition (e.g. "N
    # updates available"), not a discrete event — upsert in place instead of
    # inserting a new row every poll, regardless of read state, otherwise
    # re-opening the bell (which marks everything read) lets the next
    # periodic check spawn a duplicate. Callers with no ref (e.g. a plugin's
    # mvmOS.notify() for a one-off event) always insert, same as before.
    if body.ref:
        with get_conn() as conn:
            existing = conn.execute(
                "SELECT * FROM notifications WHERE username = ? AND source = ? AND ref = ? "
                "ORDER BY created_at DESC LIMIT 1",
                (username, body.source, body.ref),
            ).fetchone()
            if existing:
                if existing["title"] == body.title and existing["body"] == body.body:
                    return JSONResponse(dict(existing))
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "UPDATE notifications SET title = ?, body = ?, kind = ?, action_app = ?, "
                    "is_read = 0, created_at = ? WHERE id = ?",
                    (body.title, body.body, body.kind, body.action_app, now, existing["id"]),
                )
                conn.commit()
                row = conn.execute("SELECT * FROM notifications WHERE id = ?", (existing["id"],)).fetchone()
                return JSONResponse(dict(row))
    row = create_notification(username, body.title, body.body, body.kind, body.source, body.action_app, body.ref)
    return JSONResponse(row)


@router.post("/read-all")
async def mark_all_read(session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    ids = _identities(session, x_pub_token)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE notifications SET is_read = 1 WHERE username IN ({','.join('?' * len(ids))}) AND is_read = 0",
            ids,
        )
        conn.commit()
    return JSONResponse({"ok": True})


class ReadByRefBody(BaseModel):
    source: str
    ref: str


@router.post("/read-by-ref")
async def mark_read_by_ref(body: ReadByRefBody, session=Depends(get_current_session_optional), x_pub_token: str = Header(default=None)):
    """Lets an app clear its own unread notifications for the current user
    when they view the underlying content directly (e.g. opening a chat
    thread), without going through the bell icon. Matches by (source, ref) —
    whatever value the app passed as `ref` when it called create_notification().

    Optional OS session: reachable from the standalone public chat page,
    which has no mvmOS desktop session at all — only an Apps Hub token. The
    same shared notifications row gets marked read regardless of which
    client (public page or desktop) triggers this, so unread status never
    diverges between them."""
    ids = _identities(session, x_pub_token)
    if not ids:
        return JSONResponse({"ok": True})
    with get_conn() as conn:
        conn.execute(
            f"UPDATE notifications SET is_read = 1 WHERE username IN ({','.join('?' * len(ids))}) "
            "AND source = ? AND ref = ? AND is_read = 0",
            ids + [body.source, body.ref],
        )
        conn.commit()
    return JSONResponse({"ok": True})


mark_read_by_ref.no_session_auth = True


@router.post("/{notif_id}/read")
async def mark_read(notif_id: int, session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    ids = _identities(session, x_pub_token)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE notifications SET is_read = 1 WHERE id = ? AND username IN ({','.join('?' * len(ids))})",
            [notif_id] + ids,
        )
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("")
async def delete_all(session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    ids = _identities(session, x_pub_token)
    with get_conn() as conn:
        conn.execute(f"DELETE FROM notifications WHERE username IN ({','.join('?' * len(ids))})", ids)
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/{notif_id}")
async def delete_notification(notif_id: int, session=Depends(get_current_session), x_pub_token: str = Header(default=None)):
    ids = _identities(session, x_pub_token)
    with get_conn() as conn:
        conn.execute(
            f"DELETE FROM notifications WHERE id = ? AND username IN ({','.join('?' * len(ids))})",
            [notif_id] + ids,
        )
        conn.commit()
    return JSONResponse({"ok": True})
