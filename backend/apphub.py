"""
Apps Hub — central public identity for all public-facing apps.

Exports (used by other modules via sys.modules["backend.apphub"]):
  get_pub_session(token)  -> dict | None   (includes "is_admin": 0|1)
  get_users_by_ids(ids)   -> list[dict]
  get_favourites(uid)     -> list[dict]
  add_favourite(uid, fav_id) -> None (raises ValueError)
  remove_favourite(uid, fav_id) -> None
  issue_pub_token(uid)    -> str
  revoke_token(token)     -> None
  migrate_from_gamehub(players, tokens) -> int
"""

import hashlib, os, secrets, sqlite3, sys, uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

TOKEN_DAYS = 30

_DB_PATH = os.path.join(os.path.dirname(__file__), "apphub_data", "data.db")

# Display name/icon for core system apps that have no manifest.json.
_CORE_APP_META = {"apphub": {"name": "Apps Hub", "icon": "🧩"}}


def _db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS public_users (
                id            TEXT PRIMARY KEY,
                username      TEXT UNIQUE NOT NULL,
                display_name  TEXT NOT NULL,
                avatar_color  TEXT NOT NULL DEFAULT '#89b4fa',
                avatar_data   TEXT,
                avatar_svg    TEXT,
                password_hash TEXT,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pub_tokens (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS public_apps (
                app_id     TEXT PRIMARY KEY,
                enabled    INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS favourites (
                user_id      TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                favourite_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                created_at   TEXT NOT NULL,
                PRIMARY KEY (user_id, favourite_id)
            );
        """)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(public_users)")}
        if "is_admin" not in cols:
            conn.execute("ALTER TABLE public_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def is_app_public(app_id: str) -> bool:
    with _db() as conn:
        row = conn.execute("SELECT enabled FROM public_apps WHERE app_id=?", (app_id,)).fetchone()
    return bool(row and row["enabled"])


def _detect_public_apps() -> list:
    """Scan backend/apps/ for directories with public.py — these are public-capable.
    apphub's own public page is core-wired (backend/apphub_pub/, not under backend/apps/),
    so include it explicitly."""
    base = os.path.join(os.path.dirname(__file__), "apps")
    result = ["apphub"]
    if not os.path.isdir(base):
        return result
    for app_id in sorted(os.listdir(base)):
        if app_id.startswith("_"):
            continue
        if os.path.isfile(os.path.join(base, app_id, "public.py")):
            result.append(app_id)
    return result


def _hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(32)
    key  = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000)
    return salt.hex() + ':' + key.hex()


def _verify_pw(stored: str, pw: str) -> bool:
    try:
        salt_hex, key_hex = stored.split(':')
        key = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt_hex), 100000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


# ── Exported helpers ───────────────────────────────────────────

def get_pub_session(token: Optional[str]) -> Optional[dict]:
    """Validate a public token. Returns full user dict or None."""
    if not token:
        return None
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        row = conn.execute(
            "SELECT u.* FROM public_users u JOIN pub_tokens t ON t.user_id=u.id "
            "WHERE t.token=? AND t.expires_at>?",
            (token, now)
        ).fetchone()
    return dict(row) if row else None


def get_users_by_ids(ids: list) -> list:
    """Bulk-lookup public profile fields for a list of user ids. Used by other
    app backends to render display name/avatar for ids they've stored but
    don't hold a session token for."""
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT id, username, display_name, avatar_color, avatar_svg FROM public_users "
            f"WHERE id IN ({placeholders})",
            ids
        ).fetchall()
    return [dict(r) for r in rows]


def get_favourites(user_id: str) -> list:
    """Full profile list of user_id's favourites, ordered by display_name.
    Shared by every app (Game Hub, Chat, ...) so favourites are one list."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT pu.id, pu.username, pu.display_name, pu.avatar_color, pu.avatar_svg "
            "FROM favourites f JOIN public_users pu ON pu.id = f.favourite_id "
            "WHERE f.user_id=? ORDER BY pu.display_name",
            (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def add_favourite(user_id: str, favourite_id: str) -> None:
    """Raises ValueError with a user-facing message on invalid input."""
    if favourite_id == user_id:
        raise ValueError("Cannot favourite yourself")
    with _db() as conn:
        target = conn.execute("SELECT id FROM public_users WHERE id=?", (favourite_id,)).fetchone()
        if not target:
            raise ValueError("User not found")
        conn.execute(
            "INSERT OR IGNORE INTO favourites(user_id,favourite_id,created_at) VALUES(?,?,?)",
            (user_id, favourite_id, datetime.now(timezone.utc).isoformat())
        )
        conn.commit()


def remove_favourite(user_id: str, favourite_id: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM favourites WHERE user_id=? AND favourite_id=?", (user_id, favourite_id))
        conn.commit()


def issue_pub_token(user_id: str) -> str:
    """Issue a new token for user_id. Returns the token string."""
    token = secrets.token_urlsafe(32)
    now   = datetime.now(timezone.utc)
    exp   = (now + timedelta(days=TOKEN_DAYS)).isoformat()
    with _db() as conn:
        conn.execute(
            "INSERT INTO pub_tokens(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
            (token, user_id, now.isoformat(), exp)
        )
        conn.commit()
    return token


def revoke_token(token: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM pub_tokens WHERE token=?", (token,))
        conn.commit()


def sync_user_from_backend(user: dict) -> None:
    """
    Called by app backends to sync user data into apphub.
    Inserts if new, then updates mutable fields. Safe to call repeatedly.
    user dict: id, username, display_name, avatar_color, [password_hash], [avatar_data], [avatar_svg], [created_at]
    """
    with _db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO public_users(id,username,display_name,avatar_color,password_hash,created_at)"
            " VALUES(?,?,?,?,?,?)",
            (user["id"], user.get("username",""), user.get("display_name","?"),
             user.get("avatar_color","#89b4fa"), user.get("password_hash"),
             user.get("created_at") or datetime.now(timezone.utc).isoformat())
        )
        fields = ["display_name=?", "avatar_color=?"]
        vals   = [user.get("display_name","?"), user.get("avatar_color","#89b4fa")]
        if user.get("password_hash"):
            fields.append("password_hash=?"); vals.append(user["password_hash"])
        if "avatar_data" in user:
            fields.append("avatar_data=?"); vals.append(user["avatar_data"])
        if "avatar_svg" in user:
            fields.append("avatar_svg=?"); vals.append(user["avatar_svg"])
        vals.append(user["id"])
        conn.execute(f"UPDATE public_users SET {','.join(fields)} WHERE id=?", vals)
        conn.commit()


def search_users(q: str, exclude_id: Optional[str] = None, limit: int = 20) -> list:
    """Search public users by username/display_name substring. Shared by the
    REST /search endpoint and other in-process callers (e.g. Telegram Hub
    adapters) so there is one matching rule."""
    q = q.strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, avatar_color, avatar_svg FROM public_users "
            "WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT ?",
            (like, like, exclude_id or "", limit)
        ).fetchall()
    return [dict(r) for r in rows]


def migrate_from_gamehub(players: list, tokens: list) -> int:
    """Copy GameHub players and tokens into apphub (INSERT OR IGNORE). Returns new user count."""
    count = 0
    with _db() as conn:
        for p in players:
            res = conn.execute(
                "INSERT OR IGNORE INTO public_users"
                "(id,username,display_name,avatar_color,avatar_data,avatar_svg,password_hash,created_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (p["id"], p["username"], p["display_name"],
                 p.get("avatar_color") or "#89b4fa",
                 p.get("avatar_data"), p.get("avatar_svg"),
                 p.get("password_hash"), p.get("created_at") or "")
            )
            count += res.rowcount
        migrated_ids = {p["id"] for p in players}
        for t in tokens:
            if t.get("player_id") not in migrated_ids:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO pub_tokens(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                (t["token"], t["player_id"], t["created_at"], t["expires_at"])
            )
        conn.commit()
    return count


# ── Routers ────────────────────────────────────────────────────

_admin = APIRouter(prefix="/api/apphub",     tags=["apphub"])
_pub   = APIRouter(prefix="/api/pub/apphub", tags=["apphub-pub"])
router = APIRouter()


# ── Public endpoints ───────────────────────────────────────────

class RegisterBody(BaseModel):
    username:     str
    display_name: str
    password:     str
    avatar_color: str = '#89b4fa'


@_pub.post("/register")
async def register(body: RegisterBody):
    if len(body.password) < 4:
        raise HTTPException(400, detail="Password too short")
    uid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _db() as conn:
            conn.execute(
                "INSERT INTO public_users(id,username,display_name,avatar_color,password_hash,created_at)"
                " VALUES(?,?,?,?,?,?)",
                (uid, body.username.strip().lower(), body.display_name.strip(),
                 body.avatar_color, _hash_pw(body.password), now)
            )
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    token = issue_pub_token(uid)
    return JSONResponse({"token": token, "user": {
        "id": uid, "username": body.username.strip().lower(),
        "display_name": body.display_name.strip(), "avatar_color": body.avatar_color,
        "avatar_data": None, "avatar_svg": None,
    }})


class LoginBody(BaseModel):
    username: str
    password: str


@_pub.post("/login")
async def login(body: LoginBody):
    with _db() as conn:
        row = conn.execute("SELECT * FROM public_users WHERE username=?",
                           (body.username.strip().lower(),)).fetchone()
    if not row or not row["password_hash"] or not _verify_pw(row["password_hash"], body.password):
        raise HTTPException(401, detail="Invalid username or password")
    token = issue_pub_token(row["id"])
    return JSONResponse({"token": token, "user": {
        "id": row["id"], "username": row["username"],
        "display_name": row["display_name"], "avatar_color": row["avatar_color"],
        "avatar_data": row["avatar_data"], "avatar_svg": row["avatar_svg"],
    }})


@_pub.post("/logout")
async def logout_pub(x_pub_token: Optional[str] = Header(default=None)):
    if x_pub_token:
        revoke_token(x_pub_token)
    return JSONResponse({"ok": True})


@_pub.get("/me")
async def me_pub(x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse({k: u[k] for k in
        ("id", "username", "display_name", "avatar_color", "avatar_data", "avatar_svg")})


class MeUpdateBody(BaseModel):
    display_name: Optional[str] = None
    password:     Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_data:  Optional[str] = None
    avatar_svg:   Optional[str] = None


@_pub.put("/me")
async def update_me_pub(body: MeUpdateBody, x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    fields, vals = [], []
    if body.display_name is not None:
        dn = body.display_name.strip()
        if not dn:
            raise HTTPException(400, detail="Display name required")
        fields.append("display_name=?"); vals.append(dn)
    if body.password:
        if len(body.password) < 4:
            raise HTTPException(400, detail="Password too short")
        fields.append("password_hash=?"); vals.append(_hash_pw(body.password))
    if body.avatar_color is not None:
        fields.append("avatar_color=?"); vals.append(body.avatar_color)
    if body.avatar_data is not None:
        fields.append("avatar_data=?"); vals.append(body.avatar_data)
    if body.avatar_svg is not None:
        fields.append("avatar_svg=?"); vals.append(body.avatar_svg)
    if fields:
        vals.append(u["id"])
        with _db() as conn:
            conn.execute(f"UPDATE public_users SET {','.join(fields)} WHERE id=?", vals)
            conn.commit()
    return JSONResponse({"ok": True})


@_pub.get("/search")
async def search_users_pub(q: str = ""):
    return JSONResponse(search_users(q))


@_pub.get("/favourites")
async def get_favourites_pub(x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse(get_favourites(u["id"]))


@_pub.post("/favourites/{fav_id}")
async def add_favourite_pub(fav_id: str, x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    try:
        add_favourite(u["id"], fav_id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return JSONResponse({"ok": True})


@_pub.delete("/favourites/{fav_id}")
async def remove_favourite_pub(fav_id: str, x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    remove_favourite(u["id"], fav_id)
    return JSONResponse({"ok": True})


@_pub.get("/apps")
async def list_public_apps():
    """Return enabled public apps (have public.py + enabled in DB)."""
    import json
    enabled = _detect_public_apps()
    apps_dir = os.path.join(os.path.dirname(__file__), "..", "apps")
    result = []
    for app_id in enabled:
        if app_id == "apphub":
            continue
        if not is_app_public(app_id):
            continue
        mpath = os.path.join(apps_dir, app_id, "manifest.json")
        try:
            m = json.load(open(mpath)) if os.path.isfile(mpath) else {}
        except Exception:
            m = {}
        if m.get("public_directory") is False:
            continue
        result.append({
            "id":          app_id,
            "name":        m.get("name", app_id),
            "icon":        m.get("icon", "📦"),
            "description": m.get("description", ""),
            "public_url":  f"/pub/{app_id}/",
        })
    return JSONResponse(result)


# ── Admin: public apps management ─────────────────────────────────

@_admin.get("/public-apps")
async def list_public_apps_admin(session=Depends(get_current_session)):
    """List all public-capable apps with their enabled status."""
    import json
    detected = _detect_public_apps()
    apps_dir = os.path.join(os.path.dirname(__file__), "..", "apps")
    with _db() as conn:
        rows = {r["app_id"]: r["enabled"] for r in conn.execute("SELECT app_id, enabled FROM public_apps").fetchall()}
    result = []
    for app_id in detected:
        mpath = os.path.join(apps_dir, app_id, "manifest.json")
        try:
            m = json.load(open(mpath)) if os.path.isfile(mpath) else {}
        except Exception:
            m = {}
        meta = _CORE_APP_META.get(app_id, {})
        result.append({
            "id":      app_id,
            "name":    m.get("name") or meta.get("name", app_id),
            "icon":    m.get("icon") or meta.get("icon", "📦"),
            "enabled": bool(rows.get(app_id, 0)),
        })
    return JSONResponse(result)


class PublicAppToggle(BaseModel):
    enabled: bool


@_admin.put("/public-apps/{app_id}")
async def toggle_public_app(app_id: str, body: PublicAppToggle, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO public_apps(app_id, enabled) VALUES(?,?)",
            (app_id, 1 if body.enabled else 0)
        )
        conn.commit()
    return JSONResponse({"ok": True})


# ── Admin endpoints ────────────────────────────────────────────

@_admin.get("/users")
async def list_users(session=Depends(get_current_session)):
    with _db() as conn:
        rows = conn.execute(
            "SELECT id,username,display_name,avatar_color,is_admin,created_at FROM public_users ORDER BY created_at DESC"
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class UserBody(BaseModel):
    username:     str
    display_name: str
    avatar_color: str = '#89b4fa'
    password:     Optional[str] = None


@_admin.post("/users")
async def create_user_admin(body: UserBody, session=Depends(get_current_session)):
    uid  = str(uuid.uuid4())[:8]
    now  = datetime.now(timezone.utc).isoformat()
    phash = _hash_pw(body.password) if body.password else None
    try:
        with _db() as conn:
            conn.execute(
                "INSERT INTO public_users(id,username,display_name,avatar_color,password_hash,created_at)"
                " VALUES(?,?,?,?,?,?)",
                (uid, body.username.strip().lower(), body.display_name.strip(),
                 body.avatar_color, phash, now)
            )
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    return JSONResponse({"id": uid})


@_admin.put("/users/{uid}")
async def update_user_admin(uid: str, body: UserBody, session=Depends(get_current_session)):
    fields = ["username=?", "display_name=?", "avatar_color=?"]
    vals   = [body.username.strip().lower(), body.display_name.strip(), body.avatar_color]
    if body.password:
        fields.append("password_hash=?"); vals.append(_hash_pw(body.password))
    vals.append(uid)
    try:
        with _db() as conn:
            conn.execute(f"UPDATE public_users SET {','.join(fields)} WHERE id=?", vals)
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    return JSONResponse({"ok": True})


@_admin.delete("/users/{uid}")
async def delete_user_admin(uid: str, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute("DELETE FROM public_users WHERE id=?", (uid,))
        conn.commit()
    return JSONResponse({"ok": True})


class AdminToggle(BaseModel):
    is_admin: bool


@_admin.put("/users/{uid}/admin")
async def toggle_user_admin(uid: str, body: AdminToggle, session=Depends(get_current_session)):
    """Marks a public profile as an mvmOS admin — other modules (e.g. Telegram
    Hub) can gate owner-only features on user["is_admin"] from get_pub_session()."""
    with _db() as conn:
        conn.execute("UPDATE public_users SET is_admin=? WHERE id=?", (1 if body.is_admin else 0, uid))
        conn.commit()
    return JSONResponse({"ok": True})


@_admin.get("/stats")
async def get_stats_admin(session=Depends(get_current_session)):
    with _db() as conn:
        total  = conn.execute("SELECT COUNT(*) FROM public_users").fetchone()[0]
        active = conn.execute(
            "SELECT COUNT(DISTINCT user_id) FROM pub_tokens WHERE expires_at > ?",
            (datetime.now(timezone.utc).isoformat(),)
        ).fetchone()[0]
    return JSONResponse({"total_users": total, "active_sessions": active})


router.include_router(_admin)
router.include_router(_pub)


# ── Public page (served at /pub/apphub/) ───────────────────────────
# Core-wired: assets live in backend/apphub_pub/ and this router is mounted
# directly in main.py at prefix /pub/apphub (not via the generic public_loader,
# which only scans backend/apps/). This is what makes apphub a core system app
# with all its files under backend/ instead of the ignored apps/ folders.

_PUB_DIR = os.path.join(os.path.dirname(__file__), "apphub_pub")

public_page_router = APIRouter()


def _apphub_private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Apps Hub</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Apps Hub is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@public_page_router.get("/")
async def _apphub_public_index():
    if not is_app_public("apphub"):
        return _apphub_private_page()
    return FileResponse(os.path.join(_PUB_DIR, "index.html"))


@public_page_router.get("/avatar.js")
async def _apphub_avatar_js():
    return FileResponse(os.path.join(_PUB_DIR, "avatar.js"),
                        media_type="application/javascript")


@public_page_router.get("/layout.js")
async def _apphub_layout_js():
    return FileResponse(os.path.join(_PUB_DIR, "layout.js"),
                        media_type="application/javascript")
