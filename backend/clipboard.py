"""
Clipboard — a small shared shelf for text and files.

Whatever a person pastes, drops, types or photographs lands here and can be
picked up from any other device: the desktop, or the public page at
/pub/clipboard/ for an Apps Hub profile (a phone, typically).

Text lives only in the database. Files live in <install>/clipboard/ (ignored by
git) under a name that starts with the row id, and every row records who owns it.
There are no per-profile folders on the server: ownership is a column, and every
query filters on it.

Owners follow the same two account systems as notifications: an Apps Hub profile
(audience 'hub', owner = profile id) or an mvmOS desktop login (audience 'os',
owner = username). The desktop is both at once when its browser is also signed
in to a profile; a public page is only ever the profile. New items from the
desktop belong to the profile when there is one, so that what is pasted at the
computer is what the phone sees.

Everything is served under /pub/clipboard/ so it stays reachable on a
public-only server, where nothing outside /pub/ is.
"""

import mimetypes
import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .auth import get_current_session_optional
from .db import get_conn

CLIP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "clipboard"))
_PUB_DIR = os.path.join(os.path.dirname(__file__), "clipboard_pub")

RETENTION_HOURS = 24                     # how long an item lives unless pinned
MAX_FILE_BYTES = 50 * 1024 * 1024        # one file
MAX_OWNER_BYTES = 250 * 1024 * 1024      # everything one owner keeps at once
MAX_TEXT_CHARS = 200_000
MAX_ITEMS_PER_OWNER = 200

# Shown inline in the browser. Anything else is only ever downloaded, and SVG is
# deliberately not here: an SVG opened on this origin can run script.
_INLINE_IMAGES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
}

router = APIRouter()


def _open(fn):
    """Reachable without a desktop session — the page's own identity check is
    the Apps Hub token, or the desktop session when there is one."""
    fn.no_session_auth = True
    return fn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _expiry() -> str:
    return _iso(_now() + timedelta(hours=RETENTION_HOURS))


# ── Who is asking ─────────────────────────────────────────────────

def _hub_profile(x_pub_token: Optional[str]) -> Optional[dict]:
    hub = sys.modules.get("backend.apphub")
    if not hub or not x_pub_token:
        return None
    return hub.get_pub_session(x_pub_token)


def _identities(session, x_pub_token: Optional[str], surface: Optional[str]) -> list:
    """[(audience, owner), ...] the asking surface may read; the last is where
    new items go. Mirrors notifications: a desktop sees the OS login and the
    profile its browser is signed in to; a public page sees the profile only."""
    profile = _hub_profile(x_pub_token)
    ids = []
    if surface == "desktop" and session:
        ids.append(("os", session["effective_user"]))
        if profile:
            ids.append(("hub", profile["id"]))
    elif profile:
        ids.append(("hub", profile["id"]))
    elif session:
        ids.append(("os", session["effective_user"]))
    return ids


def _resolve(session, x_pub_token, surface) -> list:
    ids = _identities(session, x_pub_token, surface)
    if not ids:
        raise HTTPException(401, "Sign in to use the clipboard")
    # A public page is only there when the administrator turned it on; the API
    # behind it must respect that, or switching the page off would be cosmetic.
    if not (surface == "desktop" and session):
        from .apphub import is_app_public
        if not is_app_public("clipboard"):
            raise HTTPException(403, "The clipboard's public page is turned off")
    return ids


def _where(ids: list) -> tuple:
    sql = "(" + " OR ".join("(audience = ? AND owner = ?)" for _ in ids) + ")"
    params = []
    for audience, owner in ids:
        params += [audience, owner]
    return sql, params


def _target(ids: list) -> tuple:
    """Where a new item goes: the profile when there is one, else the OS login."""
    for ident in ids:
        if ident[0] == "hub":
            return ident
    return ids[-1]


# ── Storage ───────────────────────────────────────────────────────

def _safe_name(name: Optional[str]) -> str:
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\- ()]", "_", name, flags=re.UNICODE).strip(" .")
    if not name:
        return "file"
    if len(name) > 120:
        base, ext = os.path.splitext(name)
        name = base[: 120 - len(ext[:12])] + ext[:12]
    return name


def _file_path(stored: str) -> str:
    path = os.path.abspath(os.path.join(CLIP_DIR, stored))
    if os.path.dirname(path) != CLIP_DIR:
        raise HTTPException(404)
    return path


def _remove_file(stored: Optional[str]) -> None:
    if not stored:
        return
    try:
        os.remove(_file_path(stored))
    except (OSError, HTTPException):
        pass


def purge_expired() -> None:
    """Drop everything past its time. Pinned items have no expiry."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, stored FROM clipboard_items WHERE pinned = 0 AND expires_at IS NOT NULL AND expires_at < ?",
            (_iso(_now()),),
        ).fetchall()
        for row in rows:
            _remove_file(row["stored"])
        if rows:
            conn.execute(
                f"DELETE FROM clipboard_items WHERE id IN ({','.join('?' * len(rows))})",
                [r["id"] for r in rows],
            )
            conn.commit()


def _public_row(row) -> dict:
    return {
        "id": row["id"], "kind": row["kind"], "name": row["name"], "mime": row["mime"],
        "size": row["size"], "text": row["text"], "pinned": bool(row["pinned"]),
        "created_at": row["created_at"], "expires_at": row["expires_at"],
    }


def _owned(conn, item_id: int, ids: list):
    where, params = _where(ids)
    row = conn.execute(f"SELECT * FROM clipboard_items WHERE id = ? AND {where}", [item_id] + params).fetchone()
    if not row:
        raise HTTPException(404)
    return row


def _make_room(conn, audience: str, owner: str, incoming: int) -> None:
    used, count = conn.execute(
        "SELECT COALESCE(SUM(size), 0), COUNT(*) FROM clipboard_items WHERE audience = ? AND owner = ?",
        (audience, owner),
    ).fetchone()
    if count >= MAX_ITEMS_PER_OWNER:
        raise HTTPException(413, "clip_error_quota")
    if used + incoming > MAX_OWNER_BYTES:
        raise HTTPException(413, "clip_error_quota")


# ── API ───────────────────────────────────────────────────────────

@router.get("/api/items")
@_open
async def list_items(session=Depends(get_current_session_optional),
                     x_pub_token: str = Header(default=None),
                     x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    purge_expired()
    where, params = _where(ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM clipboard_items WHERE {where} ORDER BY id DESC", params
        ).fetchall()
    items = [_public_row(r) for r in rows]
    # The place on disk is for someone at the desktop (say, to point a terminal
    # tool at a screenshot). A public page never learns where the server keeps
    # its files.
    if x_mvm_surface == "desktop" and session:
        for item, r in zip(items, rows):
            if r["stored"]:
                item["path"] = _file_path(r["stored"])
    return JSONResponse({
        "items": items,
        "retention_hours": RETENTION_HOURS,
        "max_file_bytes": MAX_FILE_BYTES,
    })


@router.get("/api/summary")
@_open
async def summary(session=Depends(get_current_session_optional),
                  x_pub_token: str = Header(default=None),
                  x_mvm_surface: str = Header(default=None)):
    """Just enough for the taskbar dot: how many, and the newest id."""
    ids = _identities(session, x_pub_token, x_mvm_surface)
    if not ids:
        return JSONResponse({"count": 0, "latest_id": 0})
    where, params = _where(ids)
    with get_conn() as conn:
        count, latest = conn.execute(
            f"SELECT COUNT(*), COALESCE(MAX(id), 0) FROM clipboard_items WHERE {where}", params
        ).fetchone()
    return JSONResponse({"count": count, "latest_id": latest})


class TextBody(BaseModel):
    text: str


@router.post("/api/text")
@_open
async def add_text(body: TextBody,
                   session=Depends(get_current_session_optional),
                   x_pub_token: str = Header(default=None),
                   x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    text = body.text
    if not text.strip():
        raise HTTPException(400, "clip_error_empty")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(413, "clip_error_text_long")
    audience, owner = _target(ids)
    purge_expired()
    size = len(text.encode("utf-8"))
    with get_conn() as conn:
        _make_room(conn, audience, owner, size)
        cur = conn.execute(
            "INSERT INTO clipboard_items (audience, owner, kind, size, text, pinned, created_at, expires_at) "
            "VALUES (?, ?, 'text', ?, ?, 0, ?, ?)",
            (audience, owner, size, text, _iso(_now()), _expiry()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM clipboard_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    return JSONResponse(_public_row(row))


@router.post("/api/file")
@_open
async def add_file(request: Request,
                   file: UploadFile = File(...),
                   session=Depends(get_current_session_optional),
                   x_pub_token: str = Header(default=None),
                   x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    audience, owner = _target(ids)
    try:
        announced = int(request.headers.get("content-length") or 0)
    except ValueError:
        announced = 0
    if announced > MAX_FILE_BYTES + 1024 * 1024:
        raise HTTPException(413, "clip_error_file_big")
    purge_expired()
    os.makedirs(CLIP_DIR, mode=0o755, exist_ok=True)
    name = _safe_name(file.filename)
    tmp = os.path.join(CLIP_DIR, f".{secrets.token_hex(8)}.part")
    size = 0
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "clip_error_file_big")
                await run_in_threadpool(out.write, chunk)
        if size == 0:
            raise HTTPException(400, "clip_error_empty")
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        with get_conn() as conn:
            _make_room(conn, audience, owner, size)
            cur = conn.execute(
                "INSERT INTO clipboard_items (audience, owner, kind, name, mime, size, pinned, created_at, expires_at) "
                "VALUES (?, ?, 'file', ?, ?, ?, 0, ?, ?)",
                (audience, owner, name, mime, size, _iso(_now()), _expiry()),
            )
            item_id = cur.lastrowid
            stored = f"{item_id}_{name}"
            conn.execute("UPDATE clipboard_items SET stored = ? WHERE id = ?", (stored, item_id))
            os.replace(tmp, _file_path(stored))
            os.chmod(_file_path(stored), 0o644)
            conn.commit()
            row = conn.execute("SELECT * FROM clipboard_items WHERE id = ?", (item_id,)).fetchone()
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    return JSONResponse(_public_row(row))


@router.get("/api/items/{item_id}/file")
@_open
async def get_file(item_id: int, download: int = 0,
                   session=Depends(get_current_session_optional),
                   x_pub_token: str = Header(default=None),
                   x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        row = _owned(conn, item_id, ids)
    if row["kind"] != "file" or not row["stored"]:
        raise HTTPException(404)
    path = _file_path(row["stored"])
    if not os.path.isfile(path):
        raise HTTPException(404)
    mime = (mimetypes.guess_type(row["name"] or "")[0] or "application/octet-stream").lower()
    inline = mime in _INLINE_IMAGES and not download
    # Whatever someone uploads is opened on this origin, next to the desktop's
    # session, so it is never allowed to run: no sniffing, and a sandbox policy
    # that strips script even from a file that slips through as a document.
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:",
        "Cache-Control": "private, no-store",
    }
    return FileResponse(
        path,
        media_type=mime if inline else "application/octet-stream",
        filename=row["name"],
        content_disposition_type="inline" if inline else "attachment",
        headers=headers,
    )


class PinBody(BaseModel):
    pinned: bool


@router.post("/api/items/{item_id}/pin")
@_open
async def pin_item(item_id: int, body: PinBody,
                   session=Depends(get_current_session_optional),
                   x_pub_token: str = Header(default=None),
                   x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        _owned(conn, item_id, ids)
        conn.execute(
            "UPDATE clipboard_items SET pinned = ?, expires_at = ? WHERE id = ?",
            (1 if body.pinned else 0, None if body.pinned else _expiry(), item_id),
        )
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/api/items/{item_id}")
@_open
async def delete_item(item_id: int,
                      session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        row = _owned(conn, item_id, ids)
        _remove_file(row["stored"])
        conn.execute("DELETE FROM clipboard_items WHERE id = ?", (item_id,))
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/api/items")
@_open
async def clear_items(session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    """Clears everything that is not pinned."""
    ids = _resolve(session, x_pub_token, x_mvm_surface)
    where, params = _where(ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT id, stored FROM clipboard_items WHERE {where} AND pinned = 0", params
        ).fetchall()
        for row in rows:
            _remove_file(row["stored"])
        if rows:
            conn.execute(
                f"DELETE FROM clipboard_items WHERE id IN ({','.join('?' * len(rows))})",
                [r["id"] for r in rows],
            )
            conn.commit()
    return JSONResponse({"ok": True, "deleted": len(rows)})


# ── Public page (served at /pub/clipboard/) ───────────────────────
# Core-wired, like Apps Hub's own page: mounted directly in main.py rather than
# discovered from an app folder, because the clipboard belongs to the system.

@router.get("/")
async def public_index():
    from .apphub import is_app_public, private_page
    if not is_app_public("clipboard"):
        return private_page("Clipboard", "📋")
    with open(os.path.join(_PUB_DIR, "index.html"), encoding="utf-8") as f:
        return HTMLResponse(f.read())


def purge_on_startup() -> None:
    try:
        purge_expired()
    except Exception:
        pass
