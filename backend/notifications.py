import json
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
                         source: str = "system", action_app: str = None, ref: str = None,
                         sender: str = None, title_key: str = None, body_key: str = None,
                         vars: dict = None, link: str = None, audience: str = "hub") -> dict:
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
    going through the bell icon.

    `title_key`/`body_key`/`vars` are the translated form — see notify() below,
    which is what apps should call.

    `audience` says which of the two account systems `username` belongs to:
    'hub' (the default — an Apps Hub profile, which is who an app notifies) or
    'os' (an mvmOS desktop login). The two namespaces can collide, so this is
    the only thing that keeps a host-only notice such as a system update out of
    the public Apps Hub bell of someone who merely shares that name."""
    now = datetime.now(timezone.utc).isoformat()
    audience = "os" if audience == "os" else "hub"
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO notifications (username, kind, source, title, body, action_app, ref, "
            "sender, title_key, body_key, vars, link, audience, is_read, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (username, kind, source, title, body, action_app, ref, sender, title_key, body_key,
             json.dumps(vars) if vars else None, link, audience, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM notifications WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def notify(app_id: str, *, to: str, title: str = "", body: str = "", sender: str = None,
           title_key: str = None, body_key: str = None, vars: dict = None,
           link: str = None, ref: str = None, kind: str = "persistent",
           audience: str = "hub") -> dict:
    """Send one person a notification from one app. This is the call an app
    makes; create_notification() above is the raw row insert underneath it.

    `to` is the recipient's Apps Hub username (or an mvmOS login, for an app
    whose users are OS users) — see notify_hub_user() to address someone by
    their Apps Hub id instead, which is what an app usually holds.

    On the text: an app that knows what its notification says should send a
    translation key and its variables, not a finished sentence. The recipient
    is a different person from the sender and may well be reading in another
    language — and will read it days later, in whatever language they are using
    then. `title`/`body` stay as the fallback for clients with no table for the
    key, and as the only sane form for genuinely free text (a note someone
    typed). Sending both costs nothing and always renders something.

        notify("mvmshare", to=username, sender="Иван",
               title_key="msh_notif_shared_url", vars={"name": "Иван"},
               title="Иван shared a link with you", link=share_url)
    """
    return create_notification(
        username=to, title=title, body=body, kind=kind, source=app_id,
        action_app=app_id, ref=ref, sender=sender, title_key=title_key,
        body_key=body_key, vars=vars, link=link, audience=audience,
    )


def notify_hub_user(app_id: str, *, user_id: str, **kwargs):
    """notify() addressed by Apps Hub user id, which is the identifier an app
    actually stores. Returns None when there is no such profile — a recipient
    who deleted their account is a routine outcome, not an error."""
    hub = sys.modules.get("backend.apphub")
    if not hub:
        return None
    found = hub.get_users_by_ids([user_id])
    if not found:
        return None
    return notify(app_id, to=found[0]["username"], **kwargs)


def _hub_username(x_pub_token: str = None) -> Optional[str]:
    if not x_pub_token:
        return None
    hub = sys.modules.get("backend.apphub")
    pub = hub.get_pub_session(x_pub_token) if hub else None
    return pub["username"] if pub and pub.get("username") else None


def _scope(session, x_pub_token: str = None, surface: str = None) -> tuple:
    """Which rows the asking surface may see: (usernames, hub_only).

    mvmOS accounts and Apps Hub profiles are separate account systems that
    share this table and can share a name — a Linux login "martin" and an Apps
    Hub profile "martin" are different people. The desktop is both identities
    at once and sees everything addressed to either; a public page is only ever
    the Hub profile, and `hub_only` additionally drops anything written for the
    OS account, which is what keeps system notices out of the public bell.

    The desktop says which surface it is (frontend/mvmos.js sends the header)
    rather than being inferred from the session cookie: a public page opened in
    the same browser carries that cookie too, and the owner's own browser is
    exactly where the two identities overlap.
    """
    hub_name = _hub_username(x_pub_token)
    if surface == "desktop" and session:
        ids = [session["effective_user"]]
        if hub_name and hub_name not in ids:
            ids.append(hub_name)
        return ids, False
    if hub_name:
        return [hub_name], True
    if session:
        return [session["effective_user"]], False
    return [], True


def _where(ids: list, hub_only: bool) -> tuple:
    """SQL fragment + params selecting exactly the rows `ids` may see."""
    sql = f"username IN ({','.join('?' * len(ids))})"
    if hub_only:
        # NULL only for a row written before the column existed and somehow
        # missed the backfill; treat it as visible rather than losing it.
        sql += " AND (audience IS NULL OR audience <> 'os')"
    return sql, list(ids)


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
    name = _hub_username(x_pub_token)
    if not name:
        return JSONResponse({})
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT action_app FROM notifications "
            "WHERE username = ? AND is_read = 0 AND action_app IS NOT NULL "
            "AND (audience IS NULL OR audience <> 'os')",
            (name,),
        ).fetchall()
    return JSONResponse({r["action_app"]: True for r in rows})


notification_badges.no_session_auth = True


# The four routes below take an optional OS session, so an Apps Hub profile with
# no mvmOS desktop account at all — the only kind of account most public-page
# users have — can read and manage its own notifications from the bell in the
# public header. Without this they could see the unread dot on an app card and
# nothing else: /badges was the one route they could reach.
@router.get("")
async def list_notifications(session=Depends(get_current_session_optional),
                             x_pub_token: str = Header(default=None),
                             x_mvm_surface: str = Header(default=None)):
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse([])
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM notifications WHERE {where} ORDER BY created_at DESC LIMIT 300",
            params,
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


list_notifications.no_session_auth = True


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
                "AND audience = 'os' ORDER BY created_at DESC LIMIT 1",
                (username, body.source, body.ref),
            ).fetchone()
            if existing:
                if existing["title"] == body.title and existing["body"] == body.body and not existing["is_read"]:
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
    # Everything posted here comes from the desktop with an mvmOS session, so it
    # is addressed to that OS account — never to the Apps Hub profile that
    # happens to carry the same name.
    row = create_notification(username, body.title, body.body, body.kind, body.source,
                              body.action_app, body.ref, audience="os")
    return JSONResponse(row)


@router.post("/read-all")
async def mark_all_read(session=Depends(get_current_session_optional),
                        x_pub_token: str = Header(default=None),
                        x_mvm_surface: str = Header(default=None)):
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"ok": True})
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        conn.execute(f"UPDATE notifications SET is_read = 1 WHERE {where} AND is_read = 0", params)
        conn.commit()
    return JSONResponse({"ok": True})


mark_all_read.no_session_auth = True


class ReadByRefBody(BaseModel):
    source: str
    ref: str


@router.post("/read-by-ref")
async def mark_read_by_ref(body: ReadByRefBody, session=Depends(get_current_session_optional),
                           x_pub_token: str = Header(default=None),
                           x_mvm_surface: str = Header(default=None)):
    """Lets an app clear its own unread notifications for the current user
    when they view the underlying content directly (e.g. opening a chat
    thread), without going through the bell icon. Matches by (source, ref) —
    whatever value the app passed as `ref` when it called create_notification().

    Optional OS session: reachable from the standalone public chat page,
    which has no mvmOS desktop session at all — only an Apps Hub token. The
    same shared notifications row gets marked read regardless of which
    client (public page or desktop) triggers this, so unread status never
    diverges between them."""
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"ok": True})
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE notifications SET is_read = 1 WHERE {where} AND source = ? AND ref = ? AND is_read = 0",
            params + [body.source, body.ref],
        )
        conn.commit()
    return JSONResponse({"ok": True})


mark_read_by_ref.no_session_auth = True


@router.post("/{notif_id}/read")
async def mark_read(notif_id: int, session=Depends(get_current_session_optional),
                    x_pub_token: str = Header(default=None),
                    x_mvm_surface: str = Header(default=None)):
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"ok": True})
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE notifications SET is_read = 1 WHERE id = ? AND {where}",
            [notif_id] + params,
        )
        conn.commit()
    return JSONResponse({"ok": True})


mark_read.no_session_auth = True


@router.delete("")
async def delete_all(session=Depends(get_current_session_optional),
                     x_pub_token: str = Header(default=None),
                     x_mvm_surface: str = Header(default=None)):
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"ok": True})
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        conn.execute(f"DELETE FROM notifications WHERE {where}", params)
        conn.commit()
    return JSONResponse({"ok": True})


delete_all.no_session_auth = True


@router.delete("/{notif_id}")
async def delete_notification(notif_id: int, session=Depends(get_current_session_optional),
                              x_pub_token: str = Header(default=None),
                              x_mvm_surface: str = Header(default=None)):
    ids, hub_only = _scope(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"ok": True})
    where, params = _where(ids, hub_only)
    with get_conn() as conn:
        conn.execute(
            f"DELETE FROM notifications WHERE id = ? AND {where}",
            [notif_id] + params,
        )
        conn.commit()
    return JSONResponse({"ok": True})


delete_notification.no_session_auth = True
