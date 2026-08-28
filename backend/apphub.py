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
  get_credit_balance(uid) -> int
  spend_credits(uid, app_id, amount, reason="", idempotency_key=None) -> int  (raises CreditError)
  grant_credits(uid, app_id, amount, reason="", idempotency_key=None) -> int  (raises CreditError)
  call_app_api(target_app_id, method, *args, **kwargs) -> Any  (raises AppApiError)

Credits — a shared, account-wide balance apps can charge against for optional
paid features, and a premium feature of mvmOS itself. The implementation lives
in backend/premium/apphub/, which only a licensed installation downloads; the
functions above are the scaffolding that delegates to it and raises
CreditError("premium_required") when it is not there. Use credits_available()
before offering the feature anywhere.

Apps never touch the balance column directly: spend_credits() does the
check-and-deduct as a single atomic UPDATE (balance is only decremented when
the WHERE clause proves it's sufficient), so two concurrent spends from the
same user can't both succeed against a balance that only covers one of them.
idempotency_key (unique per app_id) makes retries safe — replaying the same key
returns the same result instead of charging twice.

App-to-app API — the only sanctioned way for one app's backend to reach into
another's. An app opts in by adding backend/apps/<id>/api.py, a plain Python
module exposing whatever functions it's willing to let other apps call (never
raw DB access). Apps Hub admin must explicitly enable the target app's API
(off by default, same posture as the public-page toggle) before any call
succeeds. Callers must always go through call_app_api() here — never import
another app's api.py directly — so this stays the single enforceable trust
boundary even after apps are sandboxed into separate processes down the line.
"""

import contextlib, hashlib, json, os, secrets, sqlite3, sys, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

TOKEN_DAYS = 30

_DB_PATH = os.path.join(os.path.dirname(__file__), "apphub_data", "data.db")

# Display name/icon for core system apps that have no manifest.json.
_CORE_APP_META = {"apphub": {"name": "Apps Hub", "icon": "🧩"}}

# Public-page appearance prefs: a fixed set of ready-made color pairs and text
# sizes (not free-form color pickers) so a non-technical user can't land on an
# unreadable combination. Values are stored on public_users and read by every
# /pub/<app>/ page via layout.js (see backend/apphub_pub/layout.js THEMES/FONT_SCALE).
VALID_THEMES     = {"dark", "light", "auto"}
VALID_FONT_SIZES = {"sm", "md", "lg", "xl", "xxl", "xxxl"}


def valid_languages() -> set:
    """'auto' (navigator.language on the client) plus whatever languages core
    actually ships — derived from frontend/i18n/*.js rather than a hardcoded
    list, so a new language file is enough to make it choosable here too."""
    i18n_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "i18n")
    langs = {"auto"}
    try:
        for fname in os.listdir(i18n_dir):
            if fname.endswith(".js") and fname != "i18n.js":
                langs.add(fname[:-3])
    except OSError:
        pass
    return langs


def _db():
    # Apps Hub's own database, opened on behalf of whoever is calling —
    # including a confined app going through the Platform API. Core answers
    # with its own access; the app never touches this file itself.
    with sys.modules["backend.app_isolation"].release():
        os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
        conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
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
                theme         TEXT NOT NULL DEFAULT 'auto',
                font_size     TEXT NOT NULL DEFAULT 'md',
                language      TEXT NOT NULL DEFAULT 'auto',
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
            CREATE TABLE IF NOT EXISTS app_apis (
                app_id     TEXT PRIMARY KEY,
                enabled    INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS hub_config (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS favourites (
                user_id      TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                favourite_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                created_at   TEXT NOT NULL,
                PRIMARY KEY (user_id, favourite_id)
            );
            CREATE TABLE IF NOT EXISTS app_usage (
                user_id        TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                app_id         TEXT NOT NULL,
                open_count     INTEGER NOT NULL DEFAULT 0,
                last_opened_at TEXT,
                PRIMARY KEY (user_id, app_id)
            );
            -- Which of the public apps this profile keeps on its own home
            -- screen. The admin decides what the server offers at all; this is
            -- each person choosing what they want to look at, and "uninstall"
            -- here only hides the card — the app and its data are untouched.
            CREATE TABLE IF NOT EXISTS user_apps (
                user_id      TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                app_id       TEXT NOT NULL,
                installed    INTEGER NOT NULL DEFAULT 0,
                installed_at TEXT,
                PRIMARY KEY (user_id, app_id)
            );
            -- Per-account view preferences (sort order, category filter). In
            -- the database rather than localStorage so the same account opens
            -- the same way on every device it logs in from.
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                key     TEXT NOT NULL,
                value   TEXT,
                PRIMARY KEY (user_id, key)
            );
        """)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(public_users)")}
        if "is_admin" not in cols:
            conn.execute("ALTER TABLE public_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        if "theme" not in cols:
            conn.execute("ALTER TABLE public_users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'")
        if "font_size" not in cols:
            conn.execute("ALTER TABLE public_users ADD COLUMN font_size TEXT NOT NULL DEFAULT 'md'")
        if "language" not in cols:
            conn.execute("ALTER TABLE public_users ADD COLUMN language TEXT NOT NULL DEFAULT 'auto'")
        conn.commit()


def is_app_public(app_id: str) -> bool:
    with _db() as conn:
        row = conn.execute("SELECT enabled FROM public_apps WHERE app_id=?", (app_id,)).fetchone()
    return bool(row and row["enabled"])


# ── Config & registrations ──────────────────────────────────────────
# There is no account limit. An admin can turn public self-registration off
# entirely; that toggle never restricts an admin creating a user from inside
# the system.


def get_config(key: str, default: Optional[str] = None) -> Optional[str]:
    with _db() as conn:
        row = conn.execute("SELECT value FROM hub_config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_config(key: str, value: str) -> None:
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO hub_config(key,value) VALUES(?,?)", (key, str(value)))
        conn.commit()


def registrations_enabled() -> bool:
    return get_config("registrations_enabled", "1") == "1"


def user_count() -> int:
    with _db() as conn:
        return conn.execute("SELECT COUNT(*) FROM public_users").fetchone()[0]


def registration_status() -> dict:
    """Whether a NEW public self-registration is currently allowed, plus the
    reason it isn't (`disabled` = admin turned registrations off). The reason
    stays server-side; the public page only ever shows/hides the register
    option."""
    if not registrations_enabled():
        return {"allowed": False, "reason": "disabled"}
    return {"allowed": True, "reason": None}


class RegistrationBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def create_user_row(uid: str, body: "UserBody", password_hash: Optional[str], now: str,
                    public_registration: bool) -> None:
    """Create a user, re-checking the registration toggle in the same write
    transaction so it can't change between the check and the insert."""
    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        config = dict(conn.execute(
            "SELECT key,value FROM hub_config WHERE key='registrations_enabled'"
        ).fetchall())
        registrations_open = config.get("registrations_enabled", "1") == "1"
        if public_registration and not registrations_open:
            raise RegistrationBlocked("disabled")
        conn.execute(
            "INSERT INTO public_users(id,username,display_name,avatar_color,password_hash,theme,created_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (uid, body.username.strip().lower(), body.display_name.strip(),
             body.avatar_color, password_hash, "auto", now)
        )
        conn.commit()


def _detect_public_apps() -> list:
    """Apps able to serve a public page: apps/<id>/api.py in the current
    layout, backend/apps/<id>/public.py in the older one. apphub's own public
    page is core-wired (backend/apphub_pub/), so include it explicitly."""
    here = os.path.dirname(__file__)
    result = ["apphub"]

    # New layout: api.py counts only when it actually serves a public page.
    # An app with desktop_router alone (no public router) is not public.
    live = os.path.join(here, "..", "apps")
    if os.path.isdir(live):
        for app_id in sorted(os.listdir(live)):
            if app_id.startswith("_") or app_id in result:
                continue
            path = os.path.join(live, app_id, "api.py")
            if not os.path.isfile(path):
                continue
            mod = sys.modules.get(f"app_public_{app_id}")
            if mod is not None and getattr(mod, "router", None) is None:
                continue
            result.append(app_id)

    old = os.path.join(here, "apps")
    if os.path.isdir(old):
        for app_id in sorted(os.listdir(old)):
            if app_id.startswith("_") or app_id in result:
                continue
            if os.path.isfile(os.path.join(old, app_id, "public.py")):
                result.append(app_id)
    return sorted(result)


# ── App-to-app API ──────────────────────────────────────────────
# Same shape as the public.py convention above, and as telegramhub's own
# per-app adapter loader (backend/apps/telegramhub/backend.py) — an app opts
# in by dropping a file next to its other backend files, this module
# discovers it, and an admin toggle gates whether it's actually reachable.

def is_app_api_enabled(app_id: str) -> bool:
    with _db() as conn:
        row = conn.execute("SELECT enabled FROM app_apis WHERE app_id=?", (app_id,)).fetchone()
    return bool(row and row["enabled"])


def _detect_app_apis() -> list:
    """Apps exposing an app-to-app API: apps/<id>/app_api.py in the current
    layout, backend/apps/<id>/api.py in the older one — same two locations
    _load_app_api() actually loads from."""
    result = set()

    live = os.path.join(os.path.dirname(__file__), "..", "apps")
    if os.path.isdir(live):
        for app_id in sorted(os.listdir(live)):
            if not app_id.startswith("_") and os.path.isfile(os.path.join(live, app_id, "app_api.py")):
                result.add(app_id)

    old = os.path.join(os.path.dirname(__file__), "apps")
    if os.path.isdir(old):
        for app_id in sorted(os.listdir(old)):
            if not app_id.startswith("_") and os.path.isfile(os.path.join(old, app_id, "api.py")):
                result.add(app_id)

    return sorted(result)


_api_modules: dict = {}  # app_id -> loaded api.py module (or None if load failed)


def _confine_app(app_id: str):
    """Confine to the target app's own folder for an app-to-app call.

    A call arrives already confined to the *caller's* folder, so without this
    the callee cannot open its own files — loading apps/<id>/app_api.py raised
    AppIsolationError, which _load_app_api() then reported as the misleading
    "has no api.py". Swapping the root to the callee's (rather than release()ing
    outright) is what keeps this a boundary and not a hole: each side only ever
    reaches its own folder. release() first, because confine() never widens an
    already-set root.

    This is not a permission check and must never be treated as one — the
    is_app_api_enabled() gate in call_app_api() stays the sole authority on
    whether a call is allowed at all.
    """
    app_dir = os.path.realpath(
        os.path.join(os.path.dirname(__file__), "..", "apps", app_id)
    )
    iso = sys.modules["backend.app_isolation"]

    @contextlib.contextmanager
    def _swap():
        with iso.release():
            with iso.confine(app_dir):
                yield

    return _swap()


def _load_app_api(app_id: str):
    if app_id in _api_modules:
        return _api_modules[app_id]
    # In the new layout api.py holds the app's own routes, so the app-to-app
    # surface is a separate file: apps/<id>/app_api.py. The old location
    # (backend/apps/<id>/api.py) still works for apps that haven't moved.
    path = None
    for candidate in (
        os.path.join(os.path.dirname(__file__), "..", "apps", app_id, "app_api.py"),
        os.path.join(os.path.dirname(__file__), "apps", app_id, "api.py"),
    ):
        if os.path.isfile(candidate):
            path = candidate
            break
    if path is None:
        _api_modules[app_id] = None
        return None
    import types
    mod_name = f"app_api_{app_id}"
    try:
        # Read/exec under the target's own root: the first call arrives inside
        # the caller's confinement, which would otherwise make merely opening
        # the callee's file an isolation violation.
        with _confine_app(app_id):
            with open(path) as f:
                source = f.read()
            mod = types.ModuleType(mod_name)
            mod.__file__ = path
            sys.modules[mod_name] = mod
            exec(compile(source, path, "exec"), mod.__dict__)
        _api_modules[app_id] = mod
    except Exception as e:
        print(f"[app-api] failed to load api.py for {app_id}: {e}")
        _api_modules[app_id] = None
    return _api_modules[app_id]


def _introspect_app_api_actions(app_id: str) -> list:
    """Auto-discover the functions an app's app_api.py exposes to
    call_app_api() — name, parameters and a one-line summary, read straight
    off the function's signature and docstring. This is the single source
    for both the App APIs accordion (a human reads it) and mvmAI's future
    tool discovery (a model reads it): a function just needs a docstring,
    nothing gets declared a second time anywhere."""
    import inspect
    mod = _load_app_api(app_id)
    if mod is None:
        return []
    actions = []
    for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if name.startswith("_") or fn.__module__ != mod.__name__:
            continue
        doc = inspect.getdoc(fn) or ""
        summary = doc.split("\n\n", 1)[0].replace("\n", " ").strip()
        params = []
        for pname, p in inspect.signature(fn).parameters.items():
            if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
                continue
            entry = {"name": pname}
            if p.annotation is not p.empty:
                entry["type"] = getattr(p.annotation, "__name__", str(p.annotation))
            if p.default is not p.empty:
                entry["optional"] = True
            params.append(entry)
        actions.append({"name": name, "summary": summary, "params": params})
    return sorted(actions, key=lambda a: a["name"])


class AppApiError(Exception):
    """Raised by call_app_api() when the target app has no api.py, its API is
    disabled by the admin, or it doesn't expose the requested method. Callers
    should expect this as a normal, non-exceptional outcome (the target app
    may simply not be installed) and degrade gracefully — e.g. a task's
    reward-to-budget link silently not firing if Budget isn't installed or
    its API isn't enabled, rather than the task itself failing."""
    pass


def call_app_api(target_app_id: str, method: str, *args, **kwargs):
    """Call a function exposed by another app's backend/apps/<id>/api.py,
    in-process. The target app receives only the args/kwargs you pass — it
    has no way to know which app is calling."""
    if not is_app_api_enabled(target_app_id):
        raise AppApiError(f"'{target_app_id}' app API is not enabled")
    mod = _load_app_api(target_app_id)
    if mod is None:
        raise AppApiError(f"'{target_app_id}' has no api.py")
    fn = getattr(mod, method, None)
    if fn is None or not callable(fn):
        raise AppApiError(f"'{target_app_id}' does not expose '{method}'")
    with _confine_app(target_app_id):
        return fn(*args, **kwargs)


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


# The token is also mirrored into a cookie. localStorage is per-origin, so an
# installation reachable over both http and https looks logged out the moment a
# link crosses from one scheme to the other; a cookie is not tied to the scheme
# and carries the session across. Deliberately not httponly: the page copies it
# back into localStorage, which is where every app already reads the token from,
# and localStorage is JS-readable anyway, so nothing is exposed that was not.
PUB_COOKIE = "apphub_token"


def _with_pub_cookie(resp: JSONResponse, token: str) -> JSONResponse:
    resp.set_cookie(PUB_COOKIE, token, httponly=False, samesite="lax",
                    max_age=TOKEN_DAYS * 24 * 3600, path="/")
    return resp


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
            "INSERT OR IGNORE INTO public_users(id,username,display_name,avatar_color,password_hash,theme,created_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (user["id"], user.get("username",""), user.get("display_name","?"),
             user.get("avatar_color","#89b4fa"), user.get("password_hash"), "auto",
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
                "(id,username,display_name,avatar_color,avatar_data,avatar_svg,password_hash,theme,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (p["id"], p["username"], p["display_name"],
                 p.get("avatar_color") or "#89b4fa",
                 p.get("avatar_data"), p.get("avatar_svg"),
                 p.get("password_hash"), "auto", p.get("created_at") or "")
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


# ── Per-profile app shelf & view preferences ────────────────────
# Two different decisions, kept apart on purpose: the admin decides which apps
# this server publishes at all (public_apps), and each profile then decides
# which of those it wants on its own home screen (user_apps). Hiding an app
# here is not an uninstall — nothing is deleted, no data is touched, the card
# simply stops being shown and the Store tab offers it back.

_VIEW_PREF_KEYS = {"apps_sort", "apps_category"}
_SEEDED_KEY = "apps_seeded"


def get_user_prefs(user_id: str) -> dict:
    with _db() as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_prefs WHERE user_id=? AND key IN ({})".format(
                ",".join("?" * len(_VIEW_PREF_KEYS))),
            [user_id] + sorted(_VIEW_PREF_KEYS),
        ).fetchall()
    return {r["key"]: r["value"] for r in rows}


def set_user_prefs(user_id: str, values: dict) -> dict:
    """Store the view preferences named in `values`. Unknown keys are ignored
    rather than rejected — the client is the only writer and a newer one may
    know keys this server does not."""
    accepted = {k: str(v)[:64] for k, v in values.items() if k in _VIEW_PREF_KEYS and v is not None}
    if accepted:
        with _db() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO user_prefs(user_id,key,value) VALUES(?,?,?)",
                [(user_id, k, v) for k, v in accepted.items()],
            )
            conn.commit()
    return get_user_prefs(user_id)


def _seed_user_apps(conn, user_id: str) -> None:
    """First contact with the shelf: an account that has been using apps since
    before it existed keeps them. New profiles start empty and pick what they
    want from the Store tab. The marker means an account that deliberately
    hides everything is never handed its old apps back on the next request."""
    if conn.execute("SELECT 1 FROM user_prefs WHERE user_id=? AND key=?",
                    (user_id, _SEEDED_KEY)).fetchone():
        return
    conn.execute(
        "INSERT OR IGNORE INTO user_apps(user_id, app_id, installed, installed_at) "
        "SELECT user_id, app_id, 1, ? FROM app_usage WHERE user_id=? AND open_count > 0",
        (datetime.now(timezone.utc).isoformat(), user_id),
    )
    conn.execute("INSERT OR REPLACE INTO user_prefs(user_id,key,value) VALUES(?,?,'1')",
                 (user_id, _SEEDED_KEY))
    conn.commit()


def get_user_apps(user_id: str) -> dict:
    """{app_id: True} for the apps this profile keeps. Anything absent is
    hidden — the default for every app nobody has asked for."""
    with _db() as conn:
        _seed_user_apps(conn, user_id)
        rows = conn.execute("SELECT app_id, installed FROM user_apps WHERE user_id=?",
                            (user_id,)).fetchall()
    return {r["app_id"]: bool(r["installed"]) for r in rows}


def set_user_app(user_id: str, app_id: str, installed: bool) -> None:
    with _db() as conn:
        _seed_user_apps(conn, user_id)
        conn.execute(
            "INSERT OR REPLACE INTO user_apps(user_id, app_id, installed, installed_at) VALUES(?,?,?,?)",
            (user_id, app_id, 1 if installed else 0,
             datetime.now(timezone.utc).isoformat() if installed else None),
        )
        conn.commit()


# ── Credits — a premium feature ─────────────────────────────────
# Shared, account-wide balance apps charge against for optional paid features.
# The implementation is not here: it lives in backend/premium/apphub/, which
# only a licensed installation ever downloads. What is left below is the
# scaffolding — the names other modules import, each of which asks for that
# module and refuses when it is absent. An installation without a licence has
# no credit code and no credit tables at all, so there is nothing to unlock.

class CreditError(Exception):
    """Raised by spend_credits/grant_credits on insufficient balance or bad input."""
    pass


def _credits():
    """The premium credits module, or None on an unlicensed installation.

    Asked for per call rather than held in a variable: a licence entered in
    Settings makes the folder appear in this running process, and removing one
    deletes it, so anything cached at import time would be permanently wrong
    in one direction or the other.
    """
    prem = sys.modules.get("backend.premium")
    return prem.load_core_premium("apphub") if prem else None


def credits_available() -> bool:
    """Whether this installation has credits at all.

    Public surfaces use this to leave the feature out entirely — no pill, no
    menu item, no tab — because the people there cannot buy a licence and
    nothing about it would be actionable to them.
    """
    mod = _credits()
    return bool(mod and getattr(mod, "is_available", lambda: False)())


def credit_service_catalog() -> list:
    """Discover optional paid actions declared by installed Store apps."""
    root = Path(__file__).resolve().parents[1] / "apps"
    items = []
    for manifest_path in root.glob("*/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        app_id, app_name = str(manifest.get("id") or ""), str(manifest.get("name") or "")
        for feature in manifest.get("credit_features") or []:
            if not isinstance(feature, dict):
                continue
            feature_id = str(feature.get("id") or "")
            if not app_id or not app_name or not feature_id or not feature_id.replace("_", "").replace("-", "").isalnum():
                continue
            items.append({"app_id": app_id, "app_name": app_name,
                "app_icon": str(manifest.get("icon") or "🧩"), "feature_id": feature_id,
                "name": str(feature.get("name") or feature_id.replace("_", " ").title()),
                "description": str(feature.get("description") or ""), "unit": str(feature.get("unit") or "use")})
    return sorted(items, key=lambda item: (item["app_name"].lower(), item["name"].lower()))


def get_credit_feature_price(app_id: str, feature_id: str) -> int:
    """Effective price. Without a current Premium subscription every action is free."""
    mod = _credits()
    if not mod or not getattr(mod, "is_available", lambda: False)():
        return 0
    return mod.get_service_price(app_id, feature_id)


def charge_credit_feature(user_id: str, app_id: str, feature_id: str, reason: str,
                          idempotency_key: Optional[str] = None) -> dict:
    """Resolve and charge an app-declared service entirely on the server."""
    mod = _credits()
    if not mod or not getattr(mod, "is_available", lambda: False)():
        return {"price": 0, "balance": get_credit_balance(user_id)}
    return mod.charge_service(user_id, app_id, feature_id, reason, idempotency_key)


def _require_credits():
    mod = _credits()
    if mod is None:
        raise CreditError("premium_required")
    return mod


def get_credit_balance(user_id: str) -> int:
    """The balance, or 0 where the feature does not exist — a caller that only
    wants to show a number should not have to handle premium at all."""
    mod = _credits()
    return mod.get_balance(user_id) if mod else 0


def get_credit_transactions(user_id: str, limit: int = 50) -> list:
    mod = _credits()
    return mod.get_transactions(user_id, limit) if mod else []


def spend_credits(user_id: str, app_id: str, amount: int, reason: str = "",
                   idempotency_key: Optional[str] = None) -> int:
    """Deduct `amount` credits from user_id on behalf of app_id. Returns the
    resulting balance. Raises CreditError if amount is invalid, the balance is
    insufficient, or this installation has no licence. Safe to retry with the
    same idempotency_key (per app_id) — a repeat call returns the original
    result instead of charging again."""
    return _require_credits().spend(user_id, app_id, amount, reason, idempotency_key)


def grant_credits(user_id: str, app_id: str, amount: int, reason: str = "",
                   idempotency_key: Optional[str] = None) -> int:
    """Add `amount` credits to user_id, attributed to app_id (e.g. a reward,
    a refund, an admin top-up). Returns the resulting balance."""
    return _require_credits().grant(user_id, app_id, amount, reason, idempotency_key)


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
        create_user_row(uid, body, _hash_pw(body.password), now, public_registration=True)
    except RegistrationBlocked as blocked:
        # 403 with a machine-readable code; the page just shows a generic
        # "registration closed" message.
        raise HTTPException(403, detail="registration_" + blocked.reason)
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    token = issue_pub_token(uid)
    return _with_pub_cookie(JSONResponse({"token": token, "user": {
        "id": uid, "username": body.username.strip().lower(),
        "display_name": body.display_name.strip(), "avatar_color": body.avatar_color,
        "avatar_data": None, "avatar_svg": None,
        "theme": "auto", "font_size": "md", "language": "auto",
    }}), token)


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
    return _with_pub_cookie(JSONResponse({"token": token, "user": {
        "id": row["id"], "username": row["username"],
        "display_name": row["display_name"], "avatar_color": row["avatar_color"],
        "avatar_data": row["avatar_data"], "avatar_svg": row["avatar_svg"],
        "theme": row["theme"], "font_size": row["font_size"], "language": row["language"],
    }}), token)


@_pub.get("/registration")
async def registration_info_pub():
    """Public: may a visitor create a new account? Only exposes the boolean —
    the reason (cap reached vs. admin turned off) stays private."""
    return JSONResponse({"allowed": registration_status()["allowed"]})


@_pub.post("/logout")
async def logout_pub(x_pub_token: Optional[str] = Header(default=None)):
    if x_pub_token:
        revoke_token(x_pub_token)
    # The mirror goes with the token, or the next page load would read a cookie
    # for a session that no longer exists and look half logged in.
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(PUB_COOKIE, path="/")
    return resp


@_pub.get("/me")
async def me_pub(x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse({
        **{k: u[k] for k in
           ("id", "username", "display_name", "avatar_color", "avatar_data",
            "avatar_svg", "theme", "font_size", "language")},
        # Which optional features this installation actually has. Public pages
        # draw nothing for a feature that is missing — no locks, no upsell,
        # nothing to notice.
        "credits": credits_available(),
    })


class MeUpdateBody(BaseModel):
    display_name: Optional[str] = None
    password:     Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_data:  Optional[str] = None
    avatar_svg:   Optional[str] = None
    theme:        Optional[str] = None
    font_size:    Optional[str] = None
    language:     Optional[str] = None


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
    if body.theme is not None:
        if body.theme not in VALID_THEMES:
            raise HTTPException(400, detail="Invalid theme")
        fields.append("theme=?"); vals.append(body.theme)
    if body.font_size is not None:
        if body.font_size not in VALID_FONT_SIZES:
            raise HTTPException(400, detail="Invalid font_size")
        fields.append("font_size=?"); vals.append(body.font_size)
    if body.language is not None:
        if body.language not in valid_languages():
            raise HTTPException(400, detail="Invalid language")
        fields.append("language=?"); vals.append(body.language)
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
async def list_public_apps(x_pub_token: Optional[str] = Header(default=None)):
    """Return enabled public apps (have public.py + enabled in DB)."""
    import json
    enabled = _detect_public_apps()
    apps_dir = os.path.join(os.path.dirname(__file__), "..", "apps")

    u = get_pub_session(x_pub_token)
    usage, shelf = {}, None
    if u:
        with _db() as conn:
            rows = conn.execute(
                "SELECT app_id, open_count, last_opened_at FROM app_usage WHERE user_id=?",
                (u["id"],),
            ).fetchall()
        usage = {r["app_id"]: {"open_count": r["open_count"], "last_opened_at": r["last_opened_at"]} for r in rows}
        shelf = get_user_apps(u["id"])

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
        au = usage.get(app_id, {})
        result.append({
            "id":             app_id,
            "name":           m.get("name", app_id),
            "icon":           m.get("icon", "📦"),
            "category":       m.get("category", "Utilities"),
            "description":    m.get("description", ""),
            "public_url":     f"/pub/{app_id}/",
            "open_count":     au.get("open_count", 0),
            "last_opened_at": au.get("last_opened_at"),
            # The full list is always returned — it is what the Store tab
            # browses. `installed` is what the home screen filters on. Without
            # a session there is nobody to have a shelf, so nothing is hidden.
            "installed":      True if shelf is None else shelf.get(app_id, False),
        })
    return JSONResponse(result)


class InstalledBody(BaseModel):
    installed: bool


@_pub.put("/apps/{app_id}/installed")
async def set_app_installed_pub(app_id: str, body: InstalledBody,
                                x_pub_token: Optional[str] = Header(default=None)):
    """Show or hide one app on this profile's home screen. Hiding deletes
    nothing: the app keeps running, keeps its data, and can be added back from
    the Store tab at any time."""
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    if app_id == "apphub" or app_id not in _detect_public_apps() or not is_app_public(app_id):
        raise HTTPException(404)
    set_user_app(u["id"], app_id, body.installed)
    return JSONResponse({"ok": True, "installed": body.installed})


@_pub.get("/prefs")
async def get_prefs_pub(x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse(get_user_prefs(u["id"]))


class PrefsBody(BaseModel):
    apps_sort:     Optional[str] = None
    apps_category: Optional[str] = None


@_pub.put("/prefs")
async def set_prefs_pub(body: PrefsBody, x_pub_token: Optional[str] = Header(default=None)):
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse(set_user_prefs(u["id"], body.model_dump(exclude_none=True)))


@_pub.post("/apps/{app_id}/open")
async def record_app_open(app_id: str, x_pub_token: Optional[str] = Header(default=None)):
    """Called by the Apps Hub grid when a user actually opens an app, so
    open_count/last_opened_at live per account in the database instead of
    per browser in localStorage — the same account then sees identical
    recent/frequent ordering from any device."""
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    # Only apps the grid can actually offer. Without this any logged-in account
    # could fill app_usage with rows for ids that will never be listed again.
    if app_id not in _detect_public_apps():
        raise HTTPException(404)
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute(
            """INSERT INTO app_usage(user_id, app_id, open_count, last_opened_at)
               VALUES (?, ?, 1, ?)
               ON CONFLICT(user_id, app_id)
               DO UPDATE SET open_count = open_count + 1, last_opened_at = excluded.last_opened_at""",
            (u["id"], app_id, now),
        )
        conn.commit()
    return JSONResponse({"ok": True})


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
            "category": m.get("category", "Utilities"),
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


# ── Admin: app-to-app API management ──────────────────────────────

@_admin.get("/app-apis")
async def list_app_apis_admin(session=Depends(get_current_session)):
    """List all apps that expose an api.py, with their enabled status."""
    import json
    detected = _detect_app_apis()
    apps_dir = os.path.join(os.path.dirname(__file__), "..", "apps")
    with _db() as conn:
        rows = {r["app_id"]: r["enabled"] for r in conn.execute("SELECT app_id, enabled FROM app_apis").fetchall()}
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
            "actions": _introspect_app_api_actions(app_id),
        })
    return JSONResponse(result)


class AppApiToggle(BaseModel):
    enabled: bool


@_admin.put("/app-apis/{app_id}")
async def toggle_app_api(app_id: str, body: AppApiToggle, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO app_apis(app_id, enabled) VALUES(?,?)",
            (app_id, 1 if body.enabled else 0)
        )
        conn.commit()
    # Drop the cached module so toggling takes effect immediately: re-enabling
    # re-reads from disk (picking up an updated app), and disabling leaves
    # nothing loaded behind the now-closed gate.
    _api_modules.pop(app_id, None)
    return JSONResponse({"ok": True})


# ── Admin endpoints ────────────────────────────────────────────

@_admin.get("/users")
async def list_users(session=Depends(get_current_session)):
    with _db() as conn:
        rows = conn.execute(
            "SELECT id,username,display_name,avatar_color,avatar_svg,avatar_data,is_admin,created_at "
            "FROM public_users ORDER BY created_at DESC"
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
        create_user_row(uid, body, phash, now, public_registration=False)
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


@_admin.get("/settings")
async def get_settings_admin(session=Depends(get_current_session)):
    return JSONResponse({
        "registrations_enabled": registrations_enabled(),
        "user_count":            user_count(),
    })


class SettingsBody(BaseModel):
    registrations_enabled: Optional[bool] = None


@_admin.put("/settings")
async def update_settings_admin(body: SettingsBody, session=Depends(get_current_session)):
    if body.registrations_enabled is not None:
        set_config("registrations_enabled", "1" if body.registrations_enabled else "0")
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


@_admin.get("/features")
async def get_features_admin(session=Depends(get_current_session)):
    """Which optional Apps Hub features this installation actually has.

    The desktop asks here rather than reading the licence status: a valid
    licence whose premium build has not been downloaded yet is not the same
    thing as a working feature, and only the presence of the code decides.
    """
    return JSONResponse({"credits": credits_available()})


@_admin.get("/credit-services")
async def get_credit_services_admin(session=Depends(get_current_session)):
    """Configured optional services, automatically discovered from manifests.

    Saved prices are returned even after expiry so the owner can see what will
    resume; effective prices remain zero until Premium is current.
    """
    mod = _credits()
    saved = mod.get_service_prices() if mod and hasattr(mod, "get_service_prices") else {}
    active = credits_available()
    rows = []
    for item in credit_service_catalog():
        key = item["app_id"] + ":" + item["feature_id"]
        rows.append({**item, "saved_price": saved.get(key, 0), "price": saved.get(key, 0) if active else 0})
    return JSONResponse({"premium": active, "services": rows})


class CreditServicePriceBody(BaseModel):
    price: int = 0


@_admin.put("/credit-services/{app_id}/{feature_id}")
async def set_credit_service_price_admin(app_id: str, feature_id: str, body: CreditServicePriceBody,
                                         session=Depends(get_current_session)):
    _credits_or_402()
    if body.price < 0 or body.price > 1_000_000:
        raise HTTPException(400, detail="price must be between 0 and 1000000")
    if not any(x["app_id"] == app_id and x["feature_id"] == feature_id for x in credit_service_catalog()):
        raise HTTPException(404, detail="unknown credit service")
    try:
        _require_credits().set_service_price(app_id, feature_id, body.price)
    except CreditError as e:
        raise HTTPException(402, detail=str(e))
    return JSONResponse({"ok": True, "price": body.price})


# ── Credits: public (self) endpoints ───────────────────────────
# In-process app backends should call spend_credits()/grant_credits()
# directly (see module docstring). These HTTP routes exist for: (a) the
# apphub public page's own "Credits" tab, and (b) any app whose paid
# feature is implemented client-side or in a separate process that can't
# import backend.apphub directly.
#
# Without a licence they answer 404, not 402: to someone on a public page the
# feature does not exist, and a "payment required" would be an offer they have
# no way to accept — they cannot reach this machine's settings at all.

def _credits_or_404():
    if not credits_available():
        raise HTTPException(404)


@_pub.get("/credits")
async def get_credits_pub(x_pub_token: Optional[str] = Header(default=None)):
    _credits_or_404()
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse({"balance": get_credit_balance(u["id"])})


@_pub.get("/credits/transactions")
async def get_credit_transactions_pub(x_pub_token: Optional[str] = Header(default=None)):
    _credits_or_404()
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    return JSONResponse(get_credit_transactions(u["id"]))


class SpendBody(BaseModel):
    app_id:           str
    amount:           int
    reason:           str = ""
    idempotency_key:  Optional[str] = None


@_pub.post("/credits/spend")
async def spend_credits_pub(body: SpendBody, x_pub_token: Optional[str] = Header(default=None)):
    _credits_or_404()
    u = get_pub_session(x_pub_token)
    if not u:
        raise HTTPException(401)
    try:
        balance = spend_credits(u["id"], body.app_id, body.amount, body.reason, body.idempotency_key)
    except CreditError as e:
        raise HTTPException(402, detail=str(e))
    return JSONResponse({"ok": True, "balance": balance})


# ── Credits: admin endpoints ────────────────────────────────────
# The desktop is the one place where premium is worth naming: whoever is here
# can actually activate a licence, so these answer 402 premium_required and the
# Apps Hub window turns that into the usual premium modal.

def _credits_or_402():
    if not credits_available():
        raise HTTPException(402, detail="premium_required")


@_admin.get("/credits/{uid}")
async def get_credits_admin(uid: str, session=Depends(get_current_session)):
    _credits_or_402()
    return JSONResponse({
        "balance":      get_credit_balance(uid),
        "transactions": get_credit_transactions(uid),
    })


class GrantBody(BaseModel):
    amount: int
    reason: str = ""


@_admin.post("/credits/{uid}/grant")
async def grant_credits_admin(uid: str, body: GrantBody, session=Depends(get_current_session)):
    """Manual top-up/correction by an mvmOS admin. app_id is fixed to
    'apphub' so these are visibly distinct from app-issued rewards in the
    transaction log."""
    _credits_or_402()
    try:
        balance = grant_credits(uid, "apphub", body.amount, body.reason or "Admin grant")
    except CreditError as e:
        raise HTTPException(400, detail=str(e))
    return JSONResponse({"ok": True, "balance": balance})


class AdjustBody(BaseModel):
    amount: int
    reason: str = ""


@_admin.post("/credits/{uid}/deduct")
async def deduct_credits_admin(uid: str, body: AdjustBody, session=Depends(get_current_session)):
    """Manual correction (e.g. reversing a grant typo). Not gated on balance
    sufficiency the way spend_credits is for apps — admin can also zero out
    an over-grant."""
    _credits_or_402()
    if body.amount <= 0:
        raise HTTPException(400, detail="amount must be positive")
    try:
        result = _require_credits().admin_deduct(uid, body.amount, body.reason or "Admin deduct")
    except CreditError as e:
        raise HTTPException(400, detail=str(e))
    return JSONResponse({"ok": True, "balance": result["balance"]})


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

@public_page_router.get("/manifest.webmanifest")
async def _apphub_manifest():
    return FileResponse(os.path.join(_PUB_DIR, "manifest.webmanifest"), media_type="application/manifest+json")

@public_page_router.get("/sw.js")
async def _apphub_service_worker():
    return FileResponse(os.path.join(_PUB_DIR, "sw.js"), media_type="application/javascript")

@public_page_router.get("/icon.svg")
async def _apphub_icon_svg():
    return FileResponse(os.path.join(_PUB_DIR, "icon.svg"), media_type="image/svg+xml")

@public_page_router.get("/icon-192.png")
async def _apphub_icon_192():
    return FileResponse(os.path.join(_PUB_DIR, "icon-192.png"), media_type="image/png")

@public_page_router.get("/icon-512.png")
async def _apphub_icon_512():
    return FileResponse(os.path.join(_PUB_DIR, "icon-512.png"), media_type="image/png")


@public_page_router.get("/layout.js")
async def _apphub_layout_js():
    return FileResponse(os.path.join(_PUB_DIR, "layout.js"),
                        media_type="application/javascript")
