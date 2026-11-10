"""
Service API keys for Apps Hub profiles.

An app that needs an outside service (Google Maps, Simkl) does not ask for the
key in its own settings. It names the service in its manifest

    "services": ["google_maps"]

and asks the server for the key of whoever is using it:

    hub = sys.modules.get("backend.apphub")
    hub.resolve_service_key(user_id, "google_maps", "<app id>")

which returns {"key": "...", "source": "own" | "shared" | ""}.

Where a key comes from, in this order:
  1. One of the profile's own keys. A profile may keep several per service,
     each with a name. A key with no apps ticked works for every app; a key
     with apps ticked works only for those, and wins over the general one for
     them. It is stored for that profile only, the administrator can neither
     read nor delete it.
  2. The administrator's shared key, only for the profiles the administrator
     picked and only for the apps the administrator left allowed.
  3. Nothing: the app tells the person to add a key in Apps Hub.

The app id is passed by the app's own server code, never by the browser, so a
page cannot claim to be another app to get around the per-app switch.
Core knows services, not apps: which apps use a service comes from manifests.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import apphub as _hub

require_admin = sys.modules["backend.auth"].require_admin

# Services an app may declare. Only the id and a label for the screens live here.
SERVICES = {
    "google_maps": {"label": "Google Maps", "help_url": "https://console.cloud.google.com/google/maps-apis/credentials"},
    # Only the administrator adds the key (people sign in to Simkl inside the app);
    # "redirect": the service asks for a return address when the key is registered.
    "simkl": {"label": "Simkl", "help_url": "https://simkl.com/settings/developer/", "redirect": True, "personal": False},
}

_KEY_RE = re.compile(r"^[A-Za-z0-9_\-.:]{8,256}$")
_APPS_DIR = os.path.join(os.path.dirname(__file__), "..", "apps")

_admin = APIRouter(prefix="/api/apphub/service-keys", tags=["apphub-service-keys"])
_pub = APIRouter(prefix="/api/pub/apphub/keys", tags=["apphub-service-keys-pub"])
router = APIRouter()


def init_db() -> None:
    with _hub._db() as conn:
        conn.executescript("""
            -- A profile's own keys. Any number per service.
            CREATE TABLE IF NOT EXISTS service_keys_mine (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                service TEXT NOT NULL,
                name    TEXT NOT NULL,
                key     TEXT NOT NULL,
                updated TEXT NOT NULL
            );
            -- Apps a personal key is limited to. No rows = every app.
            CREATE TABLE IF NOT EXISTS service_keys_mine_app (
                key_id INTEGER NOT NULL REFERENCES service_keys_mine(id) ON DELETE CASCADE,
                app_id TEXT NOT NULL,
                PRIMARY KEY (key_id, app_id)
            );
            -- Keys the administrator adds. Any number per service.
            CREATE TABLE IF NOT EXISTS service_keys (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                service TEXT NOT NULL,
                name    TEXT NOT NULL,
                key     TEXT NOT NULL,
                updated TEXT NOT NULL
            );
            -- A row means the key is valid for that app. all_users=1 means every
            -- profile, otherwise only the profiles listed in service_key_app_users.
            CREATE TABLE IF NOT EXISTS service_key_app (
                key_id    INTEGER NOT NULL,
                app_id    TEXT NOT NULL,
                all_users INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (key_id, app_id)
            );
            CREATE TABLE IF NOT EXISTS service_key_app_users (
                key_id  INTEGER NOT NULL,
                app_id  TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
                PRIMARY KEY (key_id, app_id, user_id)
            );
        """)
        _migrate_old(conn)
        _migrate_user_keys(conn)
        conn.commit()


def _migrate_old(conn) -> None:
    """Move the first version's single shared key per service (one people list,
    per-app deny list) into the per-key layout, then drop the old tables."""
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "service_keys_shared" not in have:
        return
    for row in conn.execute("SELECT service,key FROM service_keys_shared").fetchall():
        sid = row["service"]
        grants = [r[0] for r in conn.execute("SELECT user_id FROM service_key_grants WHERE service=?", (sid,))] \
            if "service_key_grants" in have else []
        blocked = {r[0] for r in conn.execute("SELECT app_id FROM service_key_apps WHERE service=? AND allowed=0", (sid,))} \
            if "service_key_apps" in have else set()
        kid = conn.execute("INSERT INTO service_keys(service,name,key,updated) VALUES(?,?,?,?)",
                           (sid, "Main", row["key"], _now())).lastrowid
        for app in apps_using(sid):
            if app["id"] in blocked:
                continue
            conn.execute("INSERT OR IGNORE INTO service_key_app(key_id,app_id,all_users) VALUES(?,?,0)", (kid, app["id"]))
            conn.executemany("INSERT OR IGNORE INTO service_key_app_users(key_id,app_id,user_id) VALUES(?,?,?)",
                             [(kid, app["id"], u) for u in grants])
    for tbl in ("service_keys_shared", "service_key_grants", "service_key_apps"):
        conn.execute(f"DROP TABLE IF EXISTS {tbl}")


def _migrate_user_keys(conn) -> None:
    """The single personal key per service becomes one key valid for every app."""
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "service_keys_user" not in have:
        return
    for r in conn.execute("SELECT user_id,service,key,updated FROM service_keys_user").fetchall():
        label = SERVICES.get(r["service"], {}).get("label", r["service"])
        conn.execute("INSERT INTO service_keys_mine(user_id,service,name,key,updated) VALUES(?,?,?,?,?)",
                     (r["user_id"], r["service"], label, r["key"], r["updated"]))
    conn.execute("DROP TABLE service_keys_user")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(key: Optional[str]) -> dict:
    return {"set": bool(key), "last4": key[-4:] if key and len(key) >= 8 else ""}


def _clean_key(raw: str) -> str:
    key = (raw or "").strip()
    if not _KEY_RE.match(key):
        raise HTTPException(400, detail="invalid_key")
    return key


def _service(service: str) -> str:
    if service not in SERVICES:
        raise HTTPException(404, detail="unknown_service")
    return service


def apps_using(service: str) -> list:
    """Apps whose manifest names the service, with what a screen needs to list them."""
    out = []
    if not os.path.isdir(_APPS_DIR):
        return out
    for app_id in sorted(os.listdir(_APPS_DIR)):
        path = os.path.join(_APPS_DIR, app_id, "manifest.json")
        try:
            with open(path, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        if service in (m.get("services") or []):
            out.append({"id": app_id, "name": m.get("name") or app_id, "name_i18n": m.get("name_i18n"),
                        "icon": m.get("icon") or "📦", "icon_image": _hub.icon_image(app_id, m)})
    return out


_QUALIFY = ("(a.all_users=1 OR EXISTS (SELECT 1 FROM service_key_app_users u "
            "WHERE u.key_id=k.id AND u.app_id=a.app_id AND u.user_id=?))")


def resolve_service_key(user_id: str, service: str, app_id: str) -> dict:
    """The key `user_id` may use for `service` inside `app_id`. Never raises.
    Of the profile's own keys, one limited to this app comes first, then one
    for every app; if several qualify, the one added first wins."""
    if not user_id or service not in SERVICES:
        return {"key": "", "source": ""}
    personal = SERVICES[service].get("personal", True)
    try:
        with _hub._db() as conn:
            row = None if not personal else conn.execute(
                "SELECT k.key FROM service_keys_mine k JOIN service_keys_mine_app a ON a.key_id=k.id "
                "WHERE k.user_id=? AND k.service=? AND a.app_id=? ORDER BY k.id LIMIT 1",
                (user_id, service, app_id)).fetchone()
            if personal and not row:
                row = conn.execute(
                    "SELECT key FROM service_keys_mine WHERE user_id=? AND service=? AND "
                    "NOT EXISTS (SELECT 1 FROM service_keys_mine_app a WHERE a.key_id=service_keys_mine.id) "
                    "ORDER BY id LIMIT 1", (user_id, service)).fetchone()
            if row and row["key"]:
                return {"key": row["key"], "source": "own"}
            shared = conn.execute(
                "SELECT k.key FROM service_keys k JOIN service_key_app a ON a.key_id=k.id "
                "WHERE k.service=? AND a.app_id=? AND " + _QUALIFY + " ORDER BY k.id LIMIT 1",
                (service, app_id, user_id)).fetchone()
            if shared and shared["key"]:
                return {"key": shared["key"], "source": "shared"}
    except Exception:
        pass
    return {"key": "", "source": ""}


# ── Profile (public) ────────────────────────────────────────────

def _user(token: Optional[str]) -> dict:
    u = _hub.get_pub_session(token)
    if not u:
        raise HTTPException(401)
    return u


def _mine_json(conn, k) -> dict:
    return {"id": k["id"], "name": k["name"], "key": _mask(k["key"]),
            "app_ids": [r[0] for r in conn.execute(
                "SELECT app_id FROM service_keys_mine_app WHERE key_id=? ORDER BY app_id", (k["id"],))]}


def _mine_row(conn, user_id: str, key_id: int):
    row = conn.execute("SELECT id,service,name,key FROM service_keys_mine WHERE id=? AND user_id=?",
                       (key_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, detail="unknown_key")
    return row


@_pub.get("")
async def list_my_keys(x_pub_token: Optional[str] = Header(default=None)):
    """Per service: the profile's own keys (never the key itself), the apps that
    use the service, and whether the administrator shares a key with it."""
    u = _user(x_pub_token)
    out = []
    with _hub._db() as conn:
        for sid, meta in SERVICES.items():
            if not meta.get("personal", True):
                continue
            rows = conn.execute("SELECT id,name,key FROM service_keys_mine WHERE user_id=? AND service=? ORDER BY id",
                                (u["id"], sid)).fetchall()
            shared = conn.execute(
                "SELECT 1 FROM service_keys k JOIN service_key_app a ON a.key_id=k.id "
                "WHERE k.service=? AND " + _QUALIFY + " LIMIT 1", (sid, u["id"])).fetchone()
            out.append({"service": sid, "label": meta["label"], "help_url": meta["help_url"],
                        "keys": [_mine_json(conn, r) for r in rows],
                        "apps": apps_using(sid),
                        "shared": bool(shared)})
    return JSONResponse(out)


class MyKeyBody(BaseModel):
    service: str
    name: str = ""
    key: str
    app_ids: list[str] = []


def _set_apps(conn, key_id: int, service: str, app_ids: list) -> None:
    valid = {a["id"] for a in apps_using(service)}
    conn.execute("DELETE FROM service_keys_mine_app WHERE key_id=?", (key_id,))
    conn.executemany("INSERT INTO service_keys_mine_app(key_id,app_id) VALUES(?,?)",
                     [(key_id, a) for a in dict.fromkeys(app_ids) if a in valid])


@_pub.post("")
async def add_my_key(body: MyKeyBody, x_pub_token: Optional[str] = Header(default=None)):
    u = _user(x_pub_token)
    _service(body.service)
    if not SERVICES[body.service].get("personal", True):
        raise HTTPException(403, detail="admin_only")
    key = _clean_key(body.key)
    name = (body.name or "").strip()[:60] or SERVICES[body.service]["label"]
    with _hub._db() as conn:
        kid = conn.execute("INSERT INTO service_keys_mine(user_id,service,name,key,updated) VALUES(?,?,?,?,?)",
                           (u["id"], body.service, name, key, _now())).lastrowid
        _set_apps(conn, kid, body.service, body.app_ids)
        conn.commit()
        return JSONResponse(_mine_json(conn, _mine_row(conn, u["id"], kid)))


class MyEditBody(BaseModel):
    name: Optional[str] = None
    key: Optional[str] = None
    app_ids: Optional[list[str]] = None


@_pub.patch("/{key_id}")
async def edit_my_key(key_id: int, body: MyEditBody, x_pub_token: Optional[str] = Header(default=None)):
    u = _user(x_pub_token)
    with _hub._db() as conn:
        k = _mine_row(conn, u["id"], key_id)
        if body.name is not None and body.name.strip():
            conn.execute("UPDATE service_keys_mine SET name=?,updated=? WHERE id=?",
                         (body.name.strip()[:60], _now(), key_id))
        if body.key:
            conn.execute("UPDATE service_keys_mine SET key=?,updated=? WHERE id=?",
                         (_clean_key(body.key), _now(), key_id))
        if body.app_ids is not None:
            _set_apps(conn, key_id, k["service"], body.app_ids)
        conn.commit()
        return JSONResponse(_mine_json(conn, _mine_row(conn, u["id"], key_id)))


@_pub.delete("/{key_id}")
async def delete_my_key(key_id: int, x_pub_token: Optional[str] = Header(default=None)):
    u = _user(x_pub_token)
    with _hub._db() as conn:
        _mine_row(conn, u["id"], key_id)
        conn.execute("DELETE FROM service_keys_mine_app WHERE key_id=?", (key_id,))
        conn.execute("DELETE FROM service_keys_mine WHERE id=?", (key_id,))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Administrator ───────────────────────────────────────────────

def _key_row(conn, key_id: int):
    row = conn.execute("SELECT id,service,name,key FROM service_keys WHERE id=?", (key_id,)).fetchone()
    if not row:
        raise HTTPException(404, detail="unknown_key")
    return row


def _key_json(conn, k) -> dict:
    cfg = {r["app_id"]: r["all_users"] for r in conn.execute(
        "SELECT app_id,all_users FROM service_key_app WHERE key_id=?", (k["id"],))}
    users: dict = {}
    for r in conn.execute("SELECT app_id,user_id FROM service_key_app_users WHERE key_id=?", (k["id"],)):
        users.setdefault(r["app_id"], []).append(r["user_id"])
    apps = [dict(a, enabled=a["id"] in cfg, all_users=bool(cfg.get(a["id"])), user_ids=users.get(a["id"], []))
            for a in apps_using(k["service"])]
    return {"id": k["id"], "service": k["service"], "name": k["name"], "key": _mask(k["key"]), "apps": apps}


@_admin.get("")
async def list_keys(_session=Depends(require_admin)):
    """The administrator's own keys with the apps and people each is valid for.
    Profiles' personal keys are not part of this."""
    with _hub._db() as conn:
        users = [dict(r) for r in conn.execute(
            "SELECT id,username,display_name,avatar_color,avatar_svg,avatar_data FROM public_users "
            "ORDER BY display_name COLLATE NOCASE").fetchall()]
        keys = [_key_json(conn, k) for k in conn.execute("SELECT id,service,name,key FROM service_keys ORDER BY id")]
    services = [{"service": sid, "label": m["label"], "help_url": m["help_url"], "redirect": bool(m.get("redirect"))} for sid, m in SERVICES.items()]
    return JSONResponse({"services": services, "keys": keys, "users": users})


class NewKeyBody(BaseModel):
    service: str
    name: str = ""
    key: str


@_admin.post("")
async def add_key(body: NewKeyBody, _session=Depends(require_admin)):
    _service(body.service)
    key = _clean_key(body.key)
    name = (body.name or "").strip()[:60] or SERVICES[body.service]["label"]
    with _hub._db() as conn:
        kid = conn.execute("INSERT INTO service_keys(service,name,key,updated) VALUES(?,?,?,?)",
                           (body.service, name, key, _now())).lastrowid
        conn.commit()
        return JSONResponse(_key_json(conn, _key_row(conn, kid)))


class EditKeyBody(BaseModel):
    name: Optional[str] = None
    key: Optional[str] = None


@_admin.patch("/{key_id}")
async def edit_key(key_id: int, body: EditKeyBody, _session=Depends(require_admin)):
    with _hub._db() as conn:
        _key_row(conn, key_id)
        if body.name is not None:
            name = body.name.strip()[:60]
            if name:
                conn.execute("UPDATE service_keys SET name=?,updated=? WHERE id=?", (name, _now(), key_id))
        if body.key:
            conn.execute("UPDATE service_keys SET key=?,updated=? WHERE id=?", (_clean_key(body.key), _now(), key_id))
        conn.commit()
        return JSONResponse(_key_json(conn, _key_row(conn, key_id)))


@_admin.delete("/{key_id}")
async def delete_key(key_id: int, _session=Depends(require_admin)):
    with _hub._db() as conn:
        for tbl in ("service_key_app_users", "service_key_app"):
            conn.execute(f"DELETE FROM {tbl} WHERE key_id=?", (key_id,))
        conn.execute("DELETE FROM service_keys WHERE id=?", (key_id,))
        conn.commit()
    return JSONResponse({"ok": True})


class AppCfgBody(BaseModel):
    enabled: bool
    all_users: bool = False
    user_ids: list[str] = []


@_admin.put("/{key_id}/apps/{app_id}")
async def set_key_app(key_id: int, app_id: str, body: AppCfgBody, _session=Depends(require_admin)):
    with _hub._db() as conn:
        k = _key_row(conn, key_id)
        if app_id not in {a["id"] for a in apps_using(k["service"])}:
            raise HTTPException(404, detail="unknown_app")
        conn.execute("DELETE FROM service_key_app WHERE key_id=? AND app_id=?", (key_id, app_id))
        conn.execute("DELETE FROM service_key_app_users WHERE key_id=? AND app_id=?", (key_id, app_id))
        if body.enabled:
            known = {r["id"] for r in conn.execute("SELECT id FROM public_users")}
            ids = [i for i in dict.fromkeys(body.user_ids) if i in known]
            conn.execute("INSERT INTO service_key_app(key_id,app_id,all_users) VALUES(?,?,?)",
                         (key_id, app_id, 1 if body.all_users else 0))
            conn.executemany("INSERT INTO service_key_app_users(key_id,app_id,user_id) VALUES(?,?,?)",
                             [(key_id, app_id, i) for i in ids])
        conn.commit()
    return JSONResponse({"ok": True})


router.include_router(_admin)
router.include_router(_pub)
