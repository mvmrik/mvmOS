"""Community — the posts Apps Hub profiles share with each other.

A closed feed: only signed-in profiles of this installation ever see a post,
and the author picks who among them may — everyone, their favourites, or a
few chosen people. A post is free text (links and YouTube addresses are
recognised by the page), up to a few photos, or a repost of someone's public
post, and others can like, comment on and repost it.

Apps take no part in it. The only bridge is generic: when an app's own public
page makes a successful write to its own /pub/<app>/ routes, the response is
marked with the name of the handler that did it (X-Mvm-Action). layout.js
keeps the latest such actions in the visitor's own browser and offers them for
sharing, with the values the app itself sent and returned as suggestions. No
app is named anywhere here and none has to be written for it.
"""
import json, os, re, secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .apphub import PUB_COOKIE, _db, get_pub_session, get_users_by_ids, search_users
from .notifications import notify_hub_user

router = APIRouter(prefix="/api/pub/apphub/feed", tags=["apphub-feed"])

_MEDIA_DIR = os.path.join(os.path.dirname(__file__), "apphub_data", "feed")
AUDIENCES = ("all", "favourites", "people")
MAX_TEXT = 5000
MAX_COMMENT = 2000
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PEOPLE = 50
MAX_TEMPLATE_NAME = 60
MAX_TEMPLATES = 50
_MEDIA_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|gif|webp)$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS feed_posts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id  TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                text       TEXT NOT NULL DEFAULT '',
                audience   TEXT NOT NULL DEFAULT 'favourites',
                app_id     TEXT,
                media      TEXT,
                shared_id  INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS feed_posts_author ON feed_posts(author_id);
            CREATE TABLE IF NOT EXISTS feed_recipients (
                post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                PRIMARY KEY (post_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS feed_recipients_user ON feed_recipients(user_id);
            CREATE TABLE IF NOT EXISTS feed_likes (
                post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
                user_id    TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS feed_comments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
                author_id  TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                text       TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS feed_comments_post ON feed_comments(post_id);
            CREATE TABLE IF NOT EXISTS feed_templates (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                app_id     TEXT NOT NULL,
                name       TEXT NOT NULL,
                text       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (user_id, app_id, name)
            );
        """)
        conn.commit()
        kept = set()
        for row in conn.execute("SELECT media FROM feed_posts WHERE media IS NOT NULL"):
            kept.update(_media_list(row["media"]))
    # Photos of posts that went away with a deleted profile.
    try:
        for name in os.listdir(_MEDIA_DIR):
            if _MEDIA_RE.match(name) and name not in kept:
                os.remove(os.path.join(_MEDIA_DIR, name))
    except OSError:
        pass


def _media_list(raw) -> list:
    try:
        return [m for m in json.loads(raw or "[]") if isinstance(m, str) and _MEDIA_RE.match(m)]
    except ValueError:
        return []


def _user(token: Optional[str]) -> dict:
    u = get_pub_session(token)
    if not u:
        raise HTTPException(401)
    return u


# Who may see a post: its author, everyone for 'all', the author's favourites
# for 'favourites', and the chosen people for 'people'.
_VISIBLE = """(
    p.author_id = :me
    OR p.audience = 'all'
    OR (p.audience = 'favourites' AND EXISTS (
        SELECT 1 FROM favourites f WHERE f.user_id = p.author_id AND f.favourite_id = :me))
    OR (p.audience = 'people' AND EXISTS (
        SELECT 1 FROM feed_recipients r WHERE r.post_id = p.id AND r.user_id = :me))
)"""


def _visible_post(conn, post_id: int, me: str):
    return conn.execute(f"SELECT p.* FROM feed_posts p WHERE p.id = :id AND {_VISIBLE}",
                        {"id": post_id, "me": me}).fetchone()


def _profiles(ids) -> dict:
    return {u["id"]: {k: u[k] for k in ("id", "username", "display_name", "avatar_color", "avatar_svg")}
            for u in get_users_by_ids(list(ids))}


def _serialize(conn, rows, me: dict) -> list:
    """Posts as the page draws them: author, counts, the viewer's own like,
    the reposted original when the viewer may see it, and who it is for."""
    rows = [dict(r) for r in rows]
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    likes = {r[0]: r[1] for r in conn.execute(
        f"SELECT post_id, COUNT(*) FROM feed_likes WHERE post_id IN ({marks}) GROUP BY post_id", ids)}
    mine = {r[0] for r in conn.execute(
        f"SELECT post_id FROM feed_likes WHERE user_id = ? AND post_id IN ({marks})", [me["id"]] + ids)}
    comments = {r[0]: r[1] for r in conn.execute(
        f"SELECT post_id, COUNT(*) FROM feed_comments WHERE post_id IN ({marks}) GROUP BY post_id", ids)}
    shares = {r[0]: r[1] for r in conn.execute(
        f"SELECT shared_id, COUNT(*) FROM feed_posts WHERE shared_id IN ({marks}) GROUP BY shared_id", ids)}
    originals = {}
    for sid in {r["shared_id"] for r in rows if r["shared_id"]}:
        found = _visible_post(conn, sid, me["id"])
        if found:
            originals[sid] = dict(found)
    people = {}
    for r in rows:
        if r["audience"] == "people" and r["author_id"] == me["id"]:
            people[r["id"]] = [x[0] for x in conn.execute(
                "SELECT user_id FROM feed_recipients WHERE post_id = ?", (r["id"],))]
    authors = {r["author_id"] for r in rows} | {o["author_id"] for o in originals.values()}
    authors |= {uid for ids_ in people.values() for uid in ids_}
    prof = _profiles(authors)
    admin = bool(me.get("is_admin"))

    def one(r):
        return {
            "id": r["id"], "text": r["text"], "audience": r["audience"], "app_id": r["app_id"],
            "media": _media_list(r["media"]), "created_at": r["created_at"],
            "author": prof.get(r["author_id"]),
        }

    out = []
    for r in rows:
        post = one(r)
        post.update({
            "likes": likes.get(r["id"], 0), "liked": r["id"] in mine,
            "comments": comments.get(r["id"], 0), "shares": shares.get(r["id"], 0),
            "mine": r["author_id"] == me["id"],
            "can_delete": r["author_id"] == me["id"] or admin,
            "shared": None, "shared_missing": bool(r["shared_id"]) and r["shared_id"] not in originals,
        })
        if r["shared_id"] in originals:
            post["shared"] = one(originals[r["shared_id"]])
        if r["id"] in people:
            post["people"] = [prof[i] for i in people[r["id"]] if i in prof]
        out.append(post)
    return out


# ── Reading ───────────────────────────────────────────────────────────

@router.get("")
async def list_posts(before: int = 0, limit: int = 20, author: str = "",
                     x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    limit = max(1, min(limit, 50))
    where, args = [_VISIBLE], {"me": me["id"], "limit": limit}
    if before > 0:
        where.append("p.id < :before")
        args["before"] = before
    if author:
        where.append("p.author_id = :author")
        args["author"] = author
    with _db() as conn:
        rows = conn.execute(f"SELECT p.* FROM feed_posts p WHERE {' AND '.join(where)} "
                            f"ORDER BY p.id DESC LIMIT :limit", args).fetchall()
        return JSONResponse({"posts": _serialize(conn, rows, me)})


@router.get("/post/{post_id}")
async def get_post(post_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        row = _visible_post(conn, post_id, me["id"])
        if not row:
            raise HTTPException(404)
        return JSONResponse(_serialize(conn, [row], me)[0])


def _seen(conn, uid: str) -> int:
    row = conn.execute("SELECT value FROM user_prefs WHERE user_id = ? AND key = 'feed_seen'",
                       (uid,)).fetchone()
    try:
        return int(row["value"]) if row else 0
    except (TypeError, ValueError):
        return 0


@router.get("/unseen")
async def unseen(x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        seen = _seen(conn, me["id"])
        n = conn.execute(f"SELECT COUNT(*) FROM (SELECT 1 FROM feed_posts p WHERE p.id > :seen "
                         f"AND p.author_id != :me AND {_VISIBLE} LIMIT 100)",
                         {"seen": seen, "me": me["id"]}).fetchone()[0]
    return JSONResponse({"count": n})


class SeenBody(BaseModel):
    id: int


@router.post("/seen")
async def mark_seen(body: SeenBody, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        if body.id > _seen(conn, me["id"]):
            conn.execute("INSERT OR REPLACE INTO user_prefs(user_id, key, value) VALUES (?, 'feed_seen', ?)",
                         (me["id"], str(body.id)))
            conn.commit()
    return JSONResponse({"ok": True})


@router.get("/settings")
async def get_settings(x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        row = conn.execute("SELECT value FROM user_prefs WHERE user_id = ? AND key = 'feed_audience'",
                           (me["id"],)).fetchone()
    audience = row["value"] if row and row["value"] in ("all", "favourites") else "favourites"
    return JSONResponse({"audience": audience})


class SettingsBody(BaseModel):
    audience: str


@router.put("/settings")
async def set_settings(body: SettingsBody, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    if body.audience not in ("all", "favourites"):
        raise HTTPException(400)
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO user_prefs(user_id, key, value) VALUES (?, 'feed_audience', ?)",
                     (me["id"], body.audience))
        conn.commit()
    return JSONResponse({"audience": body.audience})


@router.get("/people")
async def find_people(q: str = "", x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    return JSONResponse(search_users(q, exclude_id=me["id"]) if q.strip() else [])


@router.get("/media/{name}")
async def media(name: str, request: Request, x_pub_token: Optional[str] = Header(default=None)):
    # An <img> cannot send a header, so the Apps Hub cookie stands in for it.
    me = _user(x_pub_token or request.cookies.get(PUB_COOKIE))
    if not _MEDIA_RE.match(name):
        raise HTTPException(404)
    with _db() as conn:
        rows = conn.execute(f"SELECT p.id FROM feed_posts p WHERE p.media LIKE :like AND {_VISIBLE} LIMIT 1",
                            {"like": f'%"{name}"%', "me": me["id"]}).fetchone()
    path = os.path.join(_MEDIA_DIR, name)
    if not rows or not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


# ── Writing ───────────────────────────────────────────────────────────

def _image_ext(head: bytes) -> Optional[str]:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


async def _save_images(files: List[UploadFile]) -> list:
    saved = []
    try:
        for f in files[:MAX_IMAGES]:
            data = await f.read(MAX_IMAGE_BYTES + 1)
            if not data:
                continue
            if len(data) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "feed_err_image_big")
            ext = _image_ext(data[:16])
            if not ext:
                raise HTTPException(400, "feed_err_image_type")
            os.makedirs(_MEDIA_DIR, exist_ok=True)
            name = f"{secrets.token_hex(16)}.{ext}"
            with open(os.path.join(_MEDIA_DIR, name), "wb") as out:
                out.write(data)
            saved.append(name)
    except Exception:
        _drop_media(saved)
        raise
    return saved


def _drop_media(names) -> None:
    for name in names:
        try:
            os.remove(os.path.join(_MEDIA_DIR, name))
        except OSError:
            pass


def _link() -> str:
    return "/pub/apphub/?tab=community"


@router.post("")
async def create_post(text: str = Form(""), audience: str = Form("favourites"),
                      people: str = Form(""), app_id: str = Form(""), shared_id: int = Form(0),
                      images: List[UploadFile] = File(default=[]),
                      x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    text = text.strip()[:MAX_TEXT]
    if audience not in AUDIENCES:
        raise HTTPException(400)
    app_id = app_id if re.match(r"^[a-zA-Z0-9_-]{1,64}$", app_id or "") else None
    recipients = []
    if audience == "people":
        wanted = [p for p in dict.fromkeys(people.split(",")) if p and p != me["id"]][:MAX_PEOPLE]
        recipients = [u["id"] for u in get_users_by_ids(wanted)]
        if not recipients:
            raise HTTPException(400, "feed_err_no_people")
    original = None
    if shared_id:
        with _db() as conn:
            found = _visible_post(conn, shared_id, me["id"])
            # A repost of a repost points at the original.
            if found and found["shared_id"]:
                found = _visible_post(conn, found["shared_id"], me["id"])
        # Only what everyone may already see can be passed on.
        if not found or found["audience"] != "all":
            raise HTTPException(400, "feed_err_not_shareable")
        original = dict(found)
    media = await _save_images(images or [])
    if not text and not media and not original:
        raise HTTPException(400, "feed_err_empty")
    with _db() as conn:
        cur = conn.execute(
            "INSERT INTO feed_posts (author_id, text, audience, app_id, media, shared_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (me["id"], text, audience, app_id, json.dumps(media) if media else None,
             original["id"] if original else None, _now()))
        post_id = cur.lastrowid
        conn.executemany("INSERT INTO feed_recipients (post_id, user_id) VALUES (?, ?)",
                         [(post_id, uid) for uid in recipients])
        conn.commit()
        row = conn.execute("SELECT * FROM feed_posts WHERE id = ?", (post_id,)).fetchone()
        post = _serialize(conn, [row], me)[0]
    name = me["display_name"] or me["username"]
    for uid in recipients:
        notify_hub_user("apphub", user_id=uid, sender=name, title_key="feed_notif_people",
                        vars={"name": name}, title=f"{name} shared a post with you", link=_link())
    if original and original["author_id"] != me["id"]:
        notify_hub_user("apphub", user_id=original["author_id"], sender=name, title_key="feed_notif_share",
                        vars={"name": name}, title=f"{name} shared your post", link=_link())
    return JSONResponse(post)


@router.delete("/post/{post_id}")
async def delete_post(post_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        row = conn.execute("SELECT * FROM feed_posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        if row["author_id"] != me["id"] and not me.get("is_admin"):
            raise HTTPException(403)
        conn.execute("DELETE FROM feed_posts WHERE id = ?", (post_id,))
        conn.commit()
    _drop_media(_media_list(row["media"]))
    return JSONResponse({"ok": True})


@router.post("/post/{post_id}/like")
async def toggle_like(post_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        row = _visible_post(conn, post_id, me["id"])
        if not row:
            raise HTTPException(404)
        gone = conn.execute("DELETE FROM feed_likes WHERE post_id = ? AND user_id = ?",
                            (post_id, me["id"])).rowcount
        if not gone:
            conn.execute("INSERT INTO feed_likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
                         (post_id, me["id"], _now()))
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM feed_likes WHERE post_id = ?", (post_id,)).fetchone()[0]
    if not gone and row["author_id"] != me["id"]:
        name = me["display_name"] or me["username"]
        notify_hub_user("apphub", user_id=row["author_id"], sender=name, title_key="feed_notif_like",
                        vars={"name": name}, title=f"{name} liked your post", link=_link())
    return JSONResponse({"liked": not gone, "likes": count})


@router.get("/post/{post_id}/comments")
async def list_comments(post_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        post = _visible_post(conn, post_id, me["id"])
        if not post:
            raise HTTPException(404)
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM feed_comments WHERE post_id = ? ORDER BY id", (post_id,))]
    prof = _profiles({r["author_id"] for r in rows})
    admin = bool(me.get("is_admin"))
    return JSONResponse([{
        "id": r["id"], "text": r["text"], "created_at": r["created_at"],
        "author": prof.get(r["author_id"]),
        "can_delete": r["author_id"] == me["id"] or post["author_id"] == me["id"] or admin,
    } for r in rows])


class CommentBody(BaseModel):
    text: str


@router.post("/post/{post_id}/comments")
async def add_comment(post_id: int, body: CommentBody, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    text = body.text.strip()[:MAX_COMMENT]
    if not text:
        raise HTTPException(400, "feed_err_empty")
    with _db() as conn:
        post = _visible_post(conn, post_id, me["id"])
        if not post:
            raise HTTPException(404)
        conn.execute("INSERT INTO feed_comments (post_id, author_id, text, created_at) VALUES (?, ?, ?, ?)",
                     (post_id, me["id"], text, _now()))
        conn.commit()
    if post["author_id"] != me["id"]:
        name = me["display_name"] or me["username"]
        notify_hub_user("apphub", user_id=post["author_id"], sender=name, title_key="feed_notif_comment",
                        vars={"name": name}, title=f"{name} commented on your post", body=text[:140],
                        link=_link())
    return await list_comments(post_id, x_pub_token)


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        row = conn.execute("SELECT c.author_id, p.author_id AS post_author FROM feed_comments c "
                           "JOIN feed_posts p ON p.id = c.post_id WHERE c.id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        if me["id"] not in (row["author_id"], row["post_author"]) and not me.get("is_admin"):
            raise HTTPException(403)
        conn.execute("DELETE FROM feed_comments WHERE id = ?", (comment_id,))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Templates ─────────────────────────────────────────────────────────
# A profile's own wording for sharing what an app did, kept per app. The text
# holds {field} where a suggested value went; the page fills those in with the
# values of the action being shared. Stored here so it follows the profile to
# every browser.

_APP_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _template(row) -> dict:
    return {"id": row["id"], "app_id": row["app_id"], "name": row["name"], "text": row["text"]}


@router.get("/templates")
async def list_templates(app_id: str = "", x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        rows = conn.execute("SELECT * FROM feed_templates WHERE user_id = ? AND app_id = ? ORDER BY name COLLATE NOCASE",
                            (me["id"], app_id)).fetchall()
    return {"templates": [_template(r) for r in rows]}


class TemplateBody(BaseModel):
    app_id: str
    name: str
    text: str


@router.post("/templates")
async def save_template(body: TemplateBody, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    name, text = body.name.strip()[:MAX_TEMPLATE_NAME], body.text.strip()[:MAX_TEXT]
    if not _APP_RE.match(body.app_id) or not name or not text:
        raise HTTPException(400, "feed_err_template")
    with _db() as conn:
        exists = conn.execute("SELECT id FROM feed_templates WHERE user_id = ? AND app_id = ? AND name = ?",
                              (me["id"], body.app_id, name)).fetchone()
        if exists:
            # The same name again is a new wording for that template.
            conn.execute("UPDATE feed_templates SET text = ? WHERE id = ?", (text, exists["id"]))
        else:
            count = conn.execute("SELECT COUNT(*) FROM feed_templates WHERE user_id = ? AND app_id = ?",
                                 (me["id"], body.app_id)).fetchone()[0]
            if count >= MAX_TEMPLATES:
                raise HTTPException(400, "feed_err_template_limit")
            conn.execute("INSERT INTO feed_templates (user_id, app_id, name, text, created_at) VALUES (?, ?, ?, ?, ?)",
                         (me["id"], body.app_id, name, text, _now()))
        conn.commit()
        row = conn.execute("SELECT * FROM feed_templates WHERE user_id = ? AND app_id = ? AND name = ?",
                           (me["id"], body.app_id, name)).fetchone()
    return _template(row)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, x_pub_token: Optional[str] = Header(default=None)):
    me = _user(x_pub_token)
    with _db() as conn:
        gone = conn.execute("DELETE FROM feed_templates WHERE id = ? AND user_id = ?", (template_id, me["id"])).rowcount
        conn.commit()
    if not gone:
        raise HTTPException(404)
    return JSONResponse({"ok": True})


# ── What an app's page just did ───────────────────────────────────────

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Handler names that undo, sign in, configure or touch secrets are never
# something to tell others about. Judged from the name alone, the same way for
# every app.
_SKIP_PREFIXES = ("delete", "remove", "clear", "reset", "discard", "undo", "un", "stop", "cancel",
                  "login", "logout", "signin", "signout", "register", "auth", "leave", "ping",
                  "heartbeat", "touch", "seen", "read", "upload", "import", "export",
                  "reorder", "move", "sort")
_SKIP_WORDS = ("setting", "pref", "password", "token", "secret", "vault", "totp", "wrap", "rekey",
               "sync", "key", "config", "session", "private", "draft", "presence", "typing", "cursor")


def _shareable(name: str) -> bool:
    n = name.lower().lstrip("_")
    if not n or n.startswith(_SKIP_PREFIXES) or any(w in n for w in _SKIP_WORDS):
        return False
    return True


async def mark_actions(request, call_next):
    """Middleware: a successful write an app's own public page made to its own
    routes carries the name of the handler that did it, so the page's shared
    header can offer it for sharing. Nothing is stored here."""
    response = await call_next(request)
    try:
        path = request.url.path
        if (request.method in WRITE_METHODS and path.startswith("/pub/")
                and response.status_code < 400 and request.headers.get("x-pub-token")):
            app_id = path.split("/", 3)[2]
            endpoint = request.scope.get("endpoint")
            if (endpoint is not None and app_id not in ("apphub", "automations", "clipboard")
                    and getattr(endpoint, "__module__", "") == f"app_public_{app_id}"
                    and _shareable(endpoint.__name__)):
                response.headers["X-Mvm-Action"] = endpoint.__name__
    except Exception:
        pass
    return response
