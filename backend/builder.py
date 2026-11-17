"""
mvmOS App Builder — build a small mvmOS app by talking to the AI.

Everything a person builds lives in <install>/builder/projects/<id>/ and is never
an installed app until they press Install. An app is a plain web page (index.html,
script, style, i18n.json, icon.svg) that runs in a sandboxed iframe with a single
door to the system (frontend/builder-runtime.js). The AI can only read and write
files inside that one folder; it never touches core, other apps or the server.

What gets installed is made of two parts that must never be confused:
  * the person's files, kept in apps/<id>/builder/app/ (not reachable by URL), and
    packed into apps/<id>/public/bundle.json for the sandbox;
  * trusted files written by this module from templates (main.js, api.py, the
    runtime copy, and for a game mp.js + mp_game.py). Nothing that arrives from the
    AI or from an imported archive is ever executed on the server or in the
    desktop's own page.

An archive can be exported and imported, but only in this format. An ordinary
mvmOS app (manifest.json, api.py, a premium folder...) is refused.
"""

import asyncio
import base64
import contextlib
import hashlib
import inspect
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
import zipfile
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import builder_check as chk
from . import builder_sandbox
from .auth import get_current_session, require_admin
from .db import APPS_DIR, get_conn

router = APIRouter(prefix="/api/builder")

_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILDER_DIR = os.path.join(_BASE, "builder")
PROJECTS_DIR = os.path.join(BUILDER_DIR, "projects")
DATA_DIR = os.path.join(os.path.dirname(__file__), "builder_data")
FRONTEND_DIR = os.path.join(_BASE, "frontend")
MIN_CORE = "1.25.0"
FORMAT = "mvmos-app-builder"

_PID_RE = re.compile(r"^[0-9a-f]{12}$")
_APP_RE = re.compile(r"^my-[a-z0-9]+(-[a-z0-9]+)*$")
MAX_SNAPSHOTS = 15


def _hub():
    return sys.modules.get("backend.apphub")


def _now() -> float:
    return time.time()


def core_version() -> str:
    try:
        with open(os.path.join(_BASE, "version.txt")) as f:
            return f.read().strip()
    except OSError:
        return MIN_CORE


# ── Projects on disk ──────────────────────────────────────────────────────────

def _pdir(pid: str) -> str:
    if not _PID_RE.match(str(pid or "")):
        raise HTTPException(404, "Project not found")
    return os.path.join(PROJECTS_DIR, pid)


def _app_dir(pid: str) -> str:
    return os.path.join(_pdir(pid), "app")


def load_project(pid: str, owner: Optional[str] = None) -> dict:
    path = os.path.join(_pdir(pid), "project.json")
    try:
        with open(path, encoding="utf-8") as f:
            p = json.load(f)
    except (OSError, ValueError):
        raise HTTPException(404, "Project not found")
    if owner is not None and p.get("owner") != owner:
        raise HTTPException(404, "Project not found")
    return p


def save_project(p: dict) -> None:
    p["updated"] = _now()
    d = _pdir(p["id"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "project.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(d, "project.json"))


def list_projects(owner: str) -> list:
    out = []
    if os.path.isdir(PROJECTS_DIR):
        for pid in os.listdir(PROJECTS_DIR):
            if not _PID_RE.match(pid):
                continue
            try:
                p = load_project(pid, owner)
            except HTTPException:
                continue
            out.append(_public(p))
    out.sort(key=lambda p: p.get("updated", 0), reverse=True)
    return out


def _public(p: dict) -> dict:
    inst = p.get("installed")
    changed, nxt = False, None
    if inst:
        try:
            changed = content_hash(read_files(p["id"]), p) != inst.get("hash")
        except Exception:
            changed = False
        if changed:
            parts = [int(x) if str(x).isdigit() else 0 for x in str(inst.get("version", "1.0.0")).split(".")[:3]] + [0, 0, 0]
            nxt = f"{parts[0]}.{parts[1]}.{parts[2] + 1}"
    return {
        "changed_since_install": changed, "next_version": nxt,
        "id": p["id"], "app_id": p["app_id"], "name": p["name"], "name_i18n": p.get("name_i18n") or {},
        "description": p.get("description", ""), "category": p["category"], "emoji": p.get("emoji", "🧩"),
        "profiles": bool(p.get("profiles")), "public": bool(p.get("public")), "languages": project_languages(p),
        "integrations": p.get("integrations") or [], "version": p.get("version", "1.0.0"),
        "installed": inst, "imported": bool(p.get("imported")), "created": p.get("created"), "updated": p.get("updated"),
        "has_icon": os.path.isfile(os.path.join(_app_dir(p["id"]), "icon.svg")),
    }


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower().strip().encode("ascii", "ignore").decode()).strip("-")
    return s[:30].strip("-") or "app"


def _installed_ids() -> set:
    with get_conn() as conn:
        return {r["id"] for r in conn.execute("SELECT id FROM plugins").fetchall()}


def _taken_app_ids(owner: str = None) -> set:
    taken = set(_installed_ids())
    if os.path.isdir(APPS_DIR):
        taken |= set(os.listdir(APPS_DIR))
    if os.path.isdir(PROJECTS_DIR):
        for pid in os.listdir(PROJECTS_DIR):
            try:
                taken.add(load_project(pid)["app_id"])
            except Exception:
                pass
    return taken


def new_app_id(name: str) -> str:
    base = "my-" + slug(name)
    taken = _taken_app_ids()
    cand, n = base, 2
    while cand in taken:
        cand = f"{base}-{n}"
        n += 1
    return cand


def _clean_text(v, limit) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(v or "")).strip()[:limit]


def _clean_i18n(v, limit) -> dict:
    out = {}
    if isinstance(v, dict):
        for l in chk.LANGS:
            t = _clean_text(v.get(l), limit)
            if t:
                out[l] = t
    return out


def _clean_integrations(v) -> list:
    out = []
    for a in v if isinstance(v, list) else []:
        a = str(a)
        if re.match(r"^[a-z0-9][a-z0-9-]{0,60}$", a) and a not in out:
            out.append(a)
    return out[:10]


def create_project(owner: str, name: str, category: str, profiles: bool, public: bool,
                   description: str = "", emoji: str = "", languages=None) -> dict:
    name = _clean_text(name, 40)
    if len(name) < 2:
        raise HTTPException(400, "The name is too short.")
    if category not in chk.CATEGORIES:
        raise HTTPException(400, "Unknown category.")
    pid = secrets.token_hex(6)
    p = {
        "id": pid, "owner": owner, "app_id": new_app_id(name), "name": name, "name_i18n": {"en": name},
        "description": _clean_text(description, 300), "description_i18n": {}, "category": category,
        "emoji": _clean_text(emoji, 8) or {"Games": "🎮", "Finance": "💰", "Productivity": "✅", "Media": "🎬", "Creative": "🎨"}.get(category, "🧩"),
        "tags": [], "profiles": bool(profiles or public), "public": bool(public), "integrations": [],
        "version": "1.0.0", "installed": None, "created": _now(), "game": {"metrics": {}},
        "multiplayer": False, "max_players": 1, "languages": chk.clean_languages(languages),
    }
    os.makedirs(os.path.join(_pdir(pid), "app"), exist_ok=True)
    save_project(p)
    return p


def delete_project(pid: str) -> None:
    shutil.rmtree(_pdir(pid), ignore_errors=True)


# ── Files of a project ────────────────────────────────────────────────────────

def read_files(pid: str) -> dict:
    """{path: str | bytes} for every file of the app folder."""
    root = _app_dir(pid)
    out = {}
    if not os.path.isdir(root):
        return out
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            full = os.path.join(dirpath, n)
            if os.path.islink(full):
                continue
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            try:
                chk.safe_rel(rel)
            except ValueError:
                continue
            with open(full, "rb") as f:
                data = f.read()
            out[rel] = data.decode("utf-8", "replace") if chk.is_text(rel) else data
    return out


def _resolve(pid: str, rel: str) -> str:
    rel = chk.safe_rel(rel)
    root = os.path.realpath(_app_dir(pid))
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep):
        raise ValueError("Invalid file name.")
    return full


def write_text_file(pid: str, rel: str, content: str) -> str:
    rel = chk.safe_rel(rel)
    if not chk.is_text(rel):
        raise ValueError("Only text files can be written here.")
    if not isinstance(content, str):
        raise ValueError("content must be text")
    data = content.encode("utf-8")
    if len(data) > chk.MAX_TEXT_BYTES:
        raise ValueError(f"The file is too large ({len(data) // 1024} KB; the limit is {chk.MAX_TEXT_BYTES // 1024} KB). Split it into several files.")
    current = read_files(pid)
    if rel not in current and len(current) >= chk.MAX_FILES:
        raise ValueError("Too many files.")
    total = sum(len(v.encode("utf-8")) if isinstance(v, str) else len(v) for k, v in current.items() if k != rel)
    if total + len(data) > chk.MAX_TOTAL_BYTES:
        raise ValueError("The app would exceed 5 MB.")
    full = _resolve(pid, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    tmp = full + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, full)
    return rel


def delete_file(pid: str, rel: str) -> bool:
    full = _resolve(pid, rel)
    if os.path.isfile(full):
        os.remove(full)
        d = os.path.dirname(full)
        root = os.path.realpath(_app_dir(pid))
        while d != root and os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
            d = os.path.dirname(d)
        return True
    return False


def snapshot(pid: str, label: str = "", version: Optional[str] = None) -> Optional[str]:
    """Copy the project files. `version` is the installed version the files belong to; when it is not given,
    the version that is installed right now is recorded, so the history shows what the work was based on."""
    src = _app_dir(pid)
    if not os.path.isdir(src) or not os.listdir(src):
        return None
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    dest = os.path.join(_pdir(pid), "snapshots", sid)
    shutil.copytree(src, os.path.join(dest, "app"))
    with open(os.path.join(dest, "label.txt"), "w", encoding="utf-8") as f:
        f.write(_clean_text(label, 120))
    if version is None:
        try:
            version = (load_project(pid) or {}).get("installed", {}).get("version")
        except Exception:
            version = None
    with open(os.path.join(dest, "version.txt"), "w", encoding="utf-8") as f:
        f.write(str(version or ""))
    snaps = sorted(os.listdir(os.path.join(_pdir(pid), "snapshots")))
    for old in snaps[:-MAX_SNAPSHOTS]:
        shutil.rmtree(os.path.join(_pdir(pid), "snapshots", old), ignore_errors=True)
    return sid


def list_snapshots(pid: str) -> list:
    root = os.path.join(_pdir(pid), "snapshots")
    out = []
    if os.path.isdir(root):
        for sid in sorted(os.listdir(root), reverse=True):
            try:
                with open(os.path.join(root, sid, "label.txt"), encoding="utf-8") as f:
                    label = f.read()
            except OSError:
                label = ""
            try:
                with open(os.path.join(root, sid, "version.txt"), encoding="utf-8") as f:
                    ver = f.read().strip()
            except OSError:
                ver = ""
            try:
                created_at = time.mktime(time.strptime(sid[:15], "%Y%m%d-%H%M%S"))
            except ValueError:
                created_at = None
            out.append({"id": sid, "label": label, "version": ver, "created_at": created_at,
                        "installed": label.startswith("Installed ")})
    return out


def restore_snapshot(pid: str, sid: str) -> None:
    if not re.match(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$", sid or ""):
        raise HTTPException(404, "Snapshot not found")
    src = os.path.join(_pdir(pid), "snapshots", sid, "app")
    if not os.path.isdir(src):
        raise HTTPException(404, "Snapshot not found")
    snapshot(pid, "before restore")
    dest = _app_dir(pid)
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(src, dest)


def project_languages(p: dict) -> list:
    """Projects made before the choice existed keep all nine; a new one starts with English."""
    return chk.clean_languages(p["languages"]) if p.get("languages") else list(chk.LANGS)


def validate(pid: str) -> dict:
    p = load_project(pid)
    files = read_files(pid)
    res = chk.check_project(files, {"category": p["category"], "languages": project_languages(p)})
    res["ok"] = not res["errors"]
    res["files"] = len(files)
    return res


def content_hash(files: dict, p: dict) -> str:
    h = hashlib.sha256()
    for k in sorted(files):
        v = files[k]
        h.update(k.encode())
        h.update(v.encode("utf-8") if isinstance(v, str) else v)
    for k in ("name", "name_i18n", "description", "description_i18n", "category", "emoji", "tags", "profiles", "public", "integrations", "game"):
        h.update(json.dumps(p.get(k), sort_keys=True, ensure_ascii=False).encode())
    return h.hexdigest()[:16]


# ── What the sandbox is given ─────────────────────────────────────────────────

def make_bundle(files: dict, p: dict) -> dict:
    texts = {k: v for k, v in files.items() if isinstance(v, str)}
    assets = {}
    for k, v in files.items():
        ext = os.path.splitext(k)[1].lower()
        if isinstance(v, bytes):
            assets[k] = f"data:{chk.MIME.get(ext, 'application/octet-stream')};base64," + base64.b64encode(v).decode()
        elif ext == ".svg":
            assets[k] = "data:image/svg+xml;base64," + base64.b64encode(v.encode("utf-8")).decode()
    try:
        i18n = json.loads(texts.get("i18n.json", "{}"))
    except ValueError:
        i18n = {}
    return {
        "html": texts.get("index.html", ""),
        "scripts": {k: v for k, v in texts.items() if k.endswith(".js")},
        "styles": {k: v for k, v in texts.items() if k.endswith(".css")},
        "assets": assets,
        "i18n": i18n if isinstance(i18n, dict) else {},
        "name": p.get("name", ""),
        "integrations": p.get("integrations") or [],
        "default_lang": "en" if "en" in project_languages(p) else project_languages(p)[0],
    }


# ── Other apps, for apps that use them ────────────────────────────────────────
# Same rules as the AI chat's bridge: the app is on the person's Apps Hub shelf, is
# public, its app-to-app API is switched on, and the profile may use it. The caller
# is always the person's own profile; an app never chooses who it acts as.

def _extapi():
    from . import extapi
    return extapi


def _release():
    """Called from a built app's confined server file: the bridge is core code acting for the
    person, so it reads the other apps' manifests and the Apps Hub database itself."""
    iso = sys.modules.get("backend.app_isolation")
    return iso.release() if iso else contextlib.nullcontext()


def eligible_apps(user_id: str) -> list:
    with _release():
        return _eligible_apps(user_id)


def _eligible_apps(user_id: str) -> list:
    hub = _hub()
    if not hub or not user_id:
        return []
    shelf = hub.get_user_apps(user_id)
    out = []
    for app_id in hub._detect_app_apis():
        if not shelf.get(app_id) or app_id.startswith("my-"):
            continue
        try:
            if not (hub.is_app_public(app_id) and hub.is_app_api_enabled(app_id)):
                continue
            if hasattr(hub, "can_access_public_app") and not hub.can_access_public_app(app_id, user_id):
                continue
        except Exception as e:
            print(f"[builder] cannot check {app_id}: {e!r}")
            continue
        out.append(app_id)
    return out


def describe_integrations(user_id: str) -> list:
    with _release():
        return _describe_integrations(user_id)


def _describe_integrations(user_id: str) -> list:
    ext = _extapi()
    result = []
    for app_id in eligible_apps(user_id):
        try:
            fns = ext._functions(ext._module("store", app_id))
        except Exception as e:
            print(f"[builder] cannot read the API of {app_id}: {e!r}")
            continue
        if not fns:
            continue
        m = ext._manifest(app_id)
        funcs = []
        for name, fn in sorted(fns.items()):
            d = ext._describe(name, fn)
            if d["files"]:
                continue
            funcs.append({"name": name, "summary": d["summary"], "access": d["access"], "params": d["params"]})
        if funcs:
            result.append({"id": app_id, "name": m.get("name") or app_id, "icon": m.get("icon") or "🧩", "functions": funcs})
    return result


def bridge_list(user_id: str, declared: list) -> list:
    declared = set(declared or [])
    return [a for a in describe_integrations(user_id) if a["id"] in declared]


async def bridge_call(user_id: str, declared: list, app_id: str, fn: str, args: dict):
    if not user_id:
        raise HTTPException(401, "Sign in to Apps Hub to use other apps.")
    if app_id not in (declared or []) or app_id not in eligible_apps(user_id):
        raise HTTPException(403, "This app may not use that app.")
    ext = _extapi()
    with _release():
        known = fn in ext._functions(ext._module("store", app_id))
    if not known:
        raise HTTPException(404, "Unknown function.")
    try:
        result = await ext.invoke("store", app_id, fn, user_id, args or {})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e)[:300] or "The call failed.")
    return {"result": jsonable_encoder(result)}


def profile_id(token: Optional[str]) -> str:
    hub = _hub()
    sess = hub.get_pub_session(token) if hub and token else None
    return (sess or {}).get("id") or ""


# ── Preview data (kv) for a draft ─────────────────────────────────────────────

def _kv_conn(pid: str):
    conn = sqlite3.connect(os.path.join(_pdir(pid), "preview.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated REAL)")
    return conn


MAX_KV_BYTES = 256 * 1024
MAX_KV_KEYS = 1000


def _check_kv_key(key: str) -> str:
    if not key or len(key) > 100:
        raise HTTPException(400, "Invalid key")
    return key


# ── Install ───────────────────────────────────────────────────────────────────

def _template(name: str) -> str:
    with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
        return f.read()


def _js(v) -> str:
    return json.dumps(v, ensure_ascii=False).replace("</", "<\\/")


def template_hash() -> str:
    h = hashlib.sha256(MIN_CORE.encode())
    for n in sorted(os.listdir(DATA_DIR)):
        if n.endswith((".py", ".js", ".html")):
            with open(os.path.join(DATA_DIR, n), "rb") as f:
                h.update(f.read())
    for n in ("builder-runtime.js", "builder-sdk.js"):
        with open(os.path.join(FRONTEND_DIR, n), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:16]


def _full_i18n(p: dict, field: str, limit: int) -> dict:
    base = p.get(field) or {}
    fallback = base.get("en") or p["name"] if field == "name_i18n" else (base.get("en") or p.get("description") or "")
    return {l: base.get(l) or fallback for l in chk.LANGS}


def _manifest_for(p: dict, server=()) -> dict:
    mf = {
        "id": p["app_id"], "name": p["name"], "name_i18n": _full_i18n(p, "name_i18n", 40),
        "icon": p.get("emoji") or "🧩", "icon_image": "icon.svg", "category": p["category"], "tags": (p.get("tags") or [])[:5],
        "version": p.get("version", "1.0.0"), "min_core_version": MIN_CORE,
        "description": p.get("description") or p["name"], "entry": "main.js",
        "builder": {"format": 1, "template": template_hash()},
    }
    if p.get("public"):
        mf["public_url"] = f"/pub/{p['app_id']}/"
        mf["public_directory"] = True
    if p["category"] == "Games":
        multi = bool(p.get("multiplayer")) and "mp_game.py" in server
        mf.update({"multiplayer": multi, "max_players": max(2, min(8, int(p.get("max_players") or 2))) if multi else 1,
                   "themed": True, "public_directory": False, "gamehub": _gamehub_block(p)})
        mf.pop("public_url", None)
    return mf


def _gamehub_block(p: dict) -> dict:
    desc = _full_i18n(p, "description_i18n", 120)
    block = {"category": "arcade", "description": desc, "score": {"label": {"en": "Score"}}, "ranking": "score", "metrics": {}}
    for k, m in ((p.get("game") or {}).get("metrics") or {}).items():
        if re.match(r"^[a-z][a-z0-9_]{0,31}$", k) and isinstance(m, dict):
            label = _clean_text(m.get("label"), 40) or k
            block["metrics"][k] = {"label": {"en": label}, "type": m.get("type") if m.get("type") in ("number", "decimal", "duration", "percent") else "number",
                                   "better": "low" if m.get("better") == "low" else "high"}
    return block


def server_files(files: dict) -> list:
    return [n for n in chk.SERVER_FILES if n in files and isinstance(files[n], str)]


def trusted_files(p: dict, server=()) -> dict:
    """The server-side and loader files written next to a person's files. Rendered from
    templates only; no input from the app's own files reaches them except names and ids."""
    app_id = p["app_id"]
    names = _full_i18n(p, "name_i18n", 40)
    game = p["category"] == "Games"
    files = {}
    files["public/main.js"] = (_template("main_game.js" if game else "main_app.js")
                               .replace("__ID__", _js(app_id)).replace("__NAME_I18N__", _js(names))
                               .replace("__NAME__", _js(p["name"])).replace("__ICON__", _js(p.get("emoji") or "🧩"))
                               .replace("__CATEGORY__", _js(p["category"])).replace("__REQUIRES__", "true" if p.get("profiles") else "false"))
    files["api.py"] = _template("api_template.py").replace("__ID__", app_id).replace("__PROFILES__", "True" if p.get("profiles") else "False") \
        .replace("__PUBLIC__", "True" if p.get("public") else "False")
    with open(os.path.join(FRONTEND_DIR, "builder-runtime.js"), encoding="utf-8") as f:
        files["public/builder-runtime.js"] = f.read()
    with open(os.path.join(FRONTEND_DIR, "builder-sdk.js"), encoding="utf-8") as f:
        files["public/builder-sdk.js"] = f.read()
    if p.get("public") and not game:
        files["public/index.html"] = _template("public_page.html").replace("__ID__", app_id).replace("__NAME__", _clean_text(p["name"], 40).replace("<", "").replace(">", "").replace("&", ""))
    if "app_api.py" in server:
        files["app_api.py"] = _template("app_api_shim.py").replace("__ID__", app_id)
    if game:
        files["mp_game.py"] = _template("mp_game_shim.py" if "mp_game.py" in server else "mp_game_template.py").replace("__ID__", app_id)
        files["public/mp.js"] = _template("mp_template.js").replace("__ID__", _js(app_id)).replace("__NAME__", _js(p["name"])) \
            .replace("__ROOM__", "true" if "mp_game.py" in server else "false")
        tab = {l: {"tagline": (p.get("description_i18n") or {}).get(l) or p.get("description") or p["name"]} for l in chk.LANGS}
        files["public/style.css"] = "/* The game's own look is inside its sandbox. */\n"
        files["public/i18n.js"] = _template("game_i18n.js").replace("__TABLES__", _js(tab)).replace("__ID__", _js(app_id))
    return files


def _write_tree(app_dir: str, files: dict) -> None:
    for rel, content in files.items():
        full = os.path.join(app_dir, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        data = content.encode("utf-8") if isinstance(content, str) else content
        tmp = full + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, full)


def install_project(pid: str, owner: str, confirm_server: bool = False) -> dict:
    p = load_project(pid, owner)
    res = validate(pid)
    if res["errors"]:
        raise HTTPException(400, "The app still has problems: " + "; ".join(res["errors"][:3]))
    server = server_files(read_files(pid))
    if server and not confirm_server:
        raise HTTPException(409, "server_code_confirm")
    app_id = p["app_id"]
    if not _APP_RE.match(app_id):
        raise HTTPException(400, "Invalid app id")
    app_dir = os.path.join(APPS_DIR, app_id)
    mf_path = os.path.join(app_dir, "manifest.json")
    if os.path.isdir(app_dir):
        try:
            with open(mf_path, encoding="utf-8") as f:
                old = json.load(f)
        except (OSError, ValueError):
            old = {}
        if not old.get("builder"):
            raise HTTPException(409, "An app with this id already exists and was not made with App Builder.")
    elif app_id in _installed_ids():
        raise HTTPException(409, "An app with this id is already installed.")

    files = read_files(pid)
    h = content_hash(files, p)
    inst = p.get("installed") or {}
    new_release = not inst or inst.get("hash") != h
    if inst and inst.get("hash") != h:
        parts = [int(x) for x in str(p.get("version", "1.0.0")).split(".")[:3]] + [0, 0, 0]
        p["version"] = f"{parts[0]}.{parts[1]}.{parts[2] + 1}"
    mf = _manifest_for(p, server)
    trusted = trusted_files(p, server)

    os.makedirs(app_dir, exist_ok=True)
    keep = {"data.db", "data.db-wal", "data.db-shm"}
    for entry in os.listdir(app_dir):
        if entry in keep:
            continue
        full = os.path.join(app_dir, entry)
        shutil.rmtree(full) if os.path.isdir(full) and not os.path.islink(full) else os.remove(full)
    out = dict(trusted)
    out["manifest.json"] = json.dumps(mf, ensure_ascii=False, indent=1)
    out["public/icon.svg"] = files["icon.svg"]
    bundle = json.dumps(make_bundle(files, p), ensure_ascii=False)
    out["public/bundle.json"] = bundle
    if p["category"] == "Games":
        # Game Hub's page has an Apps Hub profile, not a desktop session, and only script files are public.
        out["public/bundle.js"] = "window.__MVM_BUNDLE=" + bundle.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029") + ";"
    out["builder/project.json"] = json.dumps(export_meta(p), ensure_ascii=False, indent=1)
    for rel, v in files.items():
        out["builder/app/" + rel] = v
    _write_tree(app_dir, out)

    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO plugins
               (id, name, icon, category, version, description, store_id, installed_at, open_count, last_opened_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, strftime('%s','now'), COALESCE((SELECT open_count FROM plugins WHERE id=?), 0),
                       (SELECT last_opened_at FROM plugins WHERE id=?))""",
            (app_id, p["name"], mf["icon"], p["category"], mf["version"], mf["description"], app_id, app_id),
        )
    hub = _hub()
    if hub:
        hub.forget_app_api(app_id)
    from . import public_loader
    public_loader.reload_app(app_id)
    p["installed"] = {"version": mf["version"], "hash": h, "at": _now()}
    save_project(p)
    if new_release:
        snapshot(pid, "Installed " + mf["version"], version=mf["version"])
    return {"app_id": app_id, "version": mf["version"], "public": bool(p.get("public")), "server": server}


def uninstall_project(pid: str, owner: str) -> None:
    p = load_project(pid, owner)
    app_id = p["app_id"]
    mf_path = os.path.join(APPS_DIR, app_id, "manifest.json")
    try:
        with open(mf_path, encoding="utf-8") as f:
            if not json.load(f).get("builder"):
                raise HTTPException(409, "This app was not installed by App Builder.")
    except (OSError, ValueError):
        pass
    from . import plugins
    plugins.uninstall_plugin(app_id, session=None)
    p["installed"] = None
    save_project(p)


def refresh_installed() -> None:
    """After a core update the runtime, the loaders and the server template may have changed:
    rewrite the trusted files of every app made here. The person's own files are not touched."""
    if not os.path.isdir(APPS_DIR):
        return
    current = template_hash()
    for app_id in os.listdir(APPS_DIR):
        if not _APP_RE.match(app_id):
            continue
        mf_path = os.path.join(APPS_DIR, app_id, "manifest.json")
        try:
            with open(mf_path, encoding="utf-8") as f:
                mf = json.load(f)
            if not mf.get("builder") or mf["builder"].get("template") == current:
                continue
            with open(os.path.join(APPS_DIR, app_id, "builder", "project.json"), encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        p = _project_from_meta(meta, app_id)
        p["version"] = mf.get("version", p.get("version"))
        mf["builder"]["template"] = current
        mf["min_core_version"] = MIN_CORE
        src = os.path.join(APPS_DIR, app_id, "builder", "app")
        server = [n for n in chk.SERVER_FILES if os.path.isfile(os.path.join(src, n))]
        _write_tree(os.path.join(APPS_DIR, app_id), {**trusted_files(p, server), "manifest.json": json.dumps(mf, ensure_ascii=False, indent=1)})


# ── Export and import ─────────────────────────────────────────────────────────

def export_meta(p: dict) -> dict:
    return {
        "format": FORMAT, "format_version": 1, "generator": "mvmos-app-builder/" + core_version(),
        "name": p["name"], "name_i18n": p.get("name_i18n") or {}, "description": p.get("description", ""),
        "description_i18n": p.get("description_i18n") or {}, "category": p["category"], "emoji": p.get("emoji", "🧩"),
        "tags": p.get("tags") or [], "profiles": bool(p.get("profiles")), "public": bool(p.get("public")),
        "integrations": p.get("integrations") or [], "version": p.get("version", "1.0.0"), "game": p.get("game") or {"metrics": {}},
        "multiplayer": bool(p.get("multiplayer")), "max_players": int(p.get("max_players") or 1),
        "languages": project_languages(p),
    }


def _project_from_meta(meta: dict, app_id: str, owner: str = "", pid: str = "") -> dict:
    cat = meta.get("category") if meta.get("category") in chk.CATEGORIES else "Utilities"
    game = meta.get("game") if isinstance(meta.get("game"), dict) else {}
    metrics = {}
    for k, m in (game.get("metrics") or {}).items() if isinstance(game.get("metrics"), dict) else []:
        if re.match(r"^[a-z][a-z0-9_]{0,31}$", str(k)) and isinstance(m, dict) and len(metrics) < 20:
            metrics[k] = {"label": _clean_text(m.get("label"), 40), "type": m.get("type"), "better": m.get("better")}
    name = _clean_text(meta.get("name"), 40) or "App"
    public = bool(meta.get("public"))
    return {
        "id": pid, "owner": owner, "app_id": app_id, "name": name, "name_i18n": _clean_i18n(meta.get("name_i18n"), 40) or {"en": name},
        "description": _clean_text(meta.get("description"), 300), "description_i18n": _clean_i18n(meta.get("description_i18n"), 300),
        "category": cat, "emoji": _clean_text(meta.get("emoji"), 8) or "🧩",
        "tags": [t for t in (re.sub(r"[^a-z0-9-]", "", str(x).lower())[:20] for x in (meta.get("tags") if isinstance(meta.get("tags"), list) else [])[:5]) if t],
        "profiles": bool(meta.get("profiles") or public), "public": public, "integrations": _clean_integrations(meta.get("integrations")),
        "version": meta.get("version") if re.match(r"^\d+\.\d+\.\d+$", str(meta.get("version", ""))) else "1.0.0",
        "game": {"metrics": metrics}, "multiplayer": bool(meta.get("multiplayer")),
        "languages": chk.clean_languages(meta["languages"]) if meta.get("languages") else list(chk.LANGS),
        "max_players": max(1, min(8, int(meta.get("max_players") or 1))) if str(meta.get("max_players") or "1").isdigit() else 1,
    }


def export_zip(pid: str, owner: str) -> tuple:
    p = load_project(pid, owner)
    files = read_files(pid)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("builder.json", json.dumps(export_meta(p), ensure_ascii=False, indent=1))
        for rel, v in sorted(files.items()):
            z.writestr("app/" + rel, v.encode("utf-8") if isinstance(v, str) else v)
    return f"{p['app_id']}-{p.get('version', '1.0.0')}.zip", buf.getvalue()


def import_zip(data: bytes, owner: str) -> dict:
    notarchive = "This is not an App Builder archive. Ordinary mvmOS apps cannot be imported or edited here."
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "This is not a valid archive.")
    infos = [i for i in z.infolist() if not i.filename.endswith("/")]
    if len(infos) > chk.MAX_FILES + 2:
        raise HTTPException(400, "The archive has too many files.")
    if sum(i.file_size for i in infos) > chk.MAX_TOTAL_BYTES + 100_000:
        raise HTTPException(400, "The archive is too large when unpacked.")
    names = {i.filename for i in infos}
    if "builder.json" not in names:
        raise HTTPException(400, notarchive)
    try:
        meta = json.loads(z.read("builder.json").decode("utf-8"))
    except ValueError:
        raise HTTPException(400, notarchive)
    if not isinstance(meta, dict) or meta.get("format") != FORMAT or meta.get("format_version") != 1:
        raise HTTPException(400, notarchive)
    files = {}
    for i in infos:
        n = i.filename
        if n == "builder.json":
            continue
        if ((i.external_attr >> 16) & 0o170000) == 0o120000 or n.startswith("/") or "\\" in n or ".." in n.split("/"):
            raise HTTPException(400, "The archive contains an unsafe file name.")
        if not n.startswith("app/"):
            raise HTTPException(400, "The archive contains files outside the app folder: " + n[:60])
        try:
            rel = chk.safe_rel(n[4:])
        except ValueError as e:
            raise HTTPException(400, f"{n[:60]}: {e}")
        raw = z.read(n)
        if chk.is_text(rel):
            try:
                files[rel] = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(400, f"{rel} is not text.")
        else:
            files[rel] = raw
    if "index.html" not in files:
        raise HTTPException(400, notarchive)
    pid = secrets.token_hex(6)
    p = _project_from_meta(meta, new_app_id(_clean_text(meta.get("name"), 40) or "app"), owner, pid)
    p.update({"created": _now(), "installed": None, "imported": True})
    os.makedirs(_app_dir(pid), exist_ok=True)
    for rel, v in files.items():
        full = _resolve(pid, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(v.encode("utf-8") if isinstance(v, str) else v)
    save_project(p)
    return p


# ── Routes ────────────────────────────────────────────────────────────────────

def _owner(session) -> str:
    return session["effective_user"]


def _ai_status() -> dict:
    from . import builder_ai
    return builder_ai.status()


class CreateBody(BaseModel):
    name: str
    category: str
    profiles: bool = False
    public: bool = False
    description: str = ""
    emoji: str = ""
    languages: Optional[list] = None


class UpdateBody(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    profiles: Optional[bool] = None
    public: Optional[bool] = None
    description: Optional[str] = None
    emoji: Optional[str] = None
    integrations: Optional[list] = None
    languages: Optional[list] = None


@router.get("/status")
def status(session=Depends(require_admin)):
    return {"core_version": core_version(), "categories": list(chk.CATEGORIES), "langs": list(chk.LANGS), "ai": _ai_status()}


@router.get("/projects")
def projects(session=Depends(require_admin)):
    return {"projects": list_projects(_owner(session))}


@router.post("/projects")
def create(body: CreateBody, session=Depends(require_admin)):
    p = create_project(_owner(session), body.name, body.category, body.profiles, body.public, body.description, body.emoji, body.languages)
    return _public(p)


@router.get("/projects/{pid}/icon")
def get_icon(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    try:
        with open(os.path.join(_app_dir(pid), "icon.svg"), "rb") as f:
            data = f.read(chk.MAX_ICON_BYTES + 1)
    except OSError:
        raise HTTPException(404, "No icon")
    if len(data) > chk.MAX_ICON_BYTES or chk.check_icon(data.decode("utf-8", "replace")):
        raise HTTPException(404, "No icon")
    return Response(data, media_type="image/svg+xml", headers={"Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
                                                              "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"})


@router.get("/integrations")
def integrations(x_pub_token: Optional[str] = Header(default=None), session=Depends(require_admin)):
    uid = profile_id(x_pub_token)
    return {"signed_in": bool(uid), "apps": [{"id": a["id"], "name": a["name"], "icon": a["icon"]} for a in describe_integrations(uid)] if uid else []}


@router.get("/projects/{pid}")
def get_project(pid: str, session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    out = _public(p)
    out["files"] = [{"path": k, "size": len(v.encode("utf-8")) if isinstance(v, str) else len(v)} for k, v in sorted(read_files(pid).items())]
    out["snapshots"] = list_snapshots(pid)
    out["imported_review"] = bool(p.get("imported")) and not p.get("reviewed")
    out["server_files"] = server_files(read_files(pid))
    out["multiplayer"] = bool(p.get("multiplayer"))
    return out


@router.patch("/projects/{pid}")
def update_project(pid: str, body: UpdateBody, session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    if body.name is not None:
        name = _clean_text(body.name, 40)
        if len(name) < 2:
            raise HTTPException(400, "The name is too short.")
        p["name"] = name
        p.setdefault("name_i18n", {})["en"] = name
    if body.category is not None:
        if body.category not in chk.CATEGORIES:
            raise HTTPException(400, "Unknown category.")
        if p.get("installed") and (body.category == "Games") != (p["category"] == "Games"):
            raise HTTPException(400, "Uninstall the app before changing it to or from a game.")
        p["category"] = body.category
    if body.public is not None:
        p["public"] = bool(body.public)
    if body.profiles is not None:
        p["profiles"] = bool(body.profiles)
    if p.get("public"):
        p["profiles"] = True
    if body.description is not None:
        p["description"] = _clean_text(body.description, 300)
    if body.emoji is not None:
        p["emoji"] = _clean_text(body.emoji, 8) or p.get("emoji", "🧩")
    if body.integrations is not None:
        p["integrations"] = _clean_integrations(body.integrations)
    if body.languages is not None:
        p["languages"] = chk.clean_languages(body.languages)
    p["reviewed"] = True
    save_project(p)
    return _public(p)


@router.delete("/projects/{pid}")
def remove_project(pid: str, session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    if p.get("installed"):
        raise HTTPException(409, "Uninstall the app first.")
    delete_project(pid)
    return {"ok": True}


@router.get("/projects/{pid}/file")
def get_file(pid: str, path: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    try:
        full = _resolve(pid, path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not os.path.isfile(full):
        raise HTTPException(404, "File not found")
    if not chk.is_text(path):
        return {"path": path, "binary": True, "size": os.path.getsize(full)}
    with open(full, encoding="utf-8", errors="replace") as f:
        return {"path": path, "content": f.read()}


class FileBody(BaseModel):
    path: str
    content: str


@router.put("/projects/{pid}/file")
def put_file(pid: str, body: FileBody, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    try:
        snapshot(pid, "manual edit")
        write_text_file(pid, body.path, body.content)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.delete("/projects/{pid}/file")
def del_file(pid: str, path: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    try:
        snapshot(pid, "manual delete")
        return {"ok": delete_file(pid, path)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/projects/{pid}/validate")
def validate_route(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    return validate(pid)


class RestoreBody(BaseModel):
    snapshot: str


@router.post("/projects/{pid}/restore")
def restore(pid: str, body: RestoreBody, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    restore_snapshot(pid, body.snapshot)
    return {"ok": True}


class InstallBody(BaseModel):
    confirm_server: bool = False


@router.post("/projects/{pid}/install")
async def install(pid: str, body: Optional[InstallBody] = None, session=Depends(require_admin)):
    return await run_in_threadpool(install_project, pid, _owner(session), bool(body and body.confirm_server))


@router.post("/projects/{pid}/uninstall")
async def uninstall(pid: str, session=Depends(require_admin)):
    await run_in_threadpool(uninstall_project, pid, _owner(session))
    return {"ok": True}


@router.get("/projects/{pid}/export")
def export(pid: str, session=Depends(require_admin)):
    name, data = export_zip(pid, _owner(session))
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


@router.post("/import")
async def import_route(request: Request, session=Depends(require_admin)):
    data = await request.body()
    if len(data) > chk.MAX_TOTAL_BYTES + 200_000:
        raise HTTPException(413, "The archive is too large.")
    p = await run_in_threadpool(import_zip, data, _owner(session))
    return _public(p)


# The preview runs the draft exactly as an installed app would, against these routes.

@router.get("/projects/{pid}/run/bundle")
def run_bundle(pid: str, session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    return make_bundle(read_files(pid), p)


@router.get("/projects/{pid}/run/kv")
def run_kv_list(pid: str, prefix: str = "", session=Depends(require_admin)):
    load_project(pid, _owner(session))
    with _kv_conn(pid) as c:
        rows = c.execute("SELECT k, v FROM kv WHERE k LIKE ? ESCAPE '\\' ORDER BY k LIMIT 500",
                         (prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%",)).fetchall()
    return {"items": [{"key": k, "value": json.loads(v)} for k, v in rows]}


@router.get("/projects/{pid}/run/kv/{key}")
def run_kv_get(pid: str, key: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    with _kv_conn(pid) as c:
        row = c.execute("SELECT v FROM kv WHERE k=?", (_check_kv_key(key),)).fetchone()
    return {"value": json.loads(row[0]) if row else None}


class KvBody(BaseModel):
    value: object = None


@router.put("/projects/{pid}/run/kv/{key}")
def run_kv_set(pid: str, key: str, body: KvBody, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    raw = json.dumps(body.value, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_KV_BYTES:
        raise HTTPException(413, "Value too large")
    with _kv_conn(pid) as c:
        if not c.execute("SELECT 1 FROM kv WHERE k=?", (_check_kv_key(key),)).fetchone() and c.execute("SELECT COUNT(*) FROM kv").fetchone()[0] >= MAX_KV_KEYS:
            raise HTTPException(413, "Too many keys")
        c.execute("INSERT OR REPLACE INTO kv(k, v, updated) VALUES (?,?,?)", (key, raw, _now()))
    return {"ok": True}


@router.delete("/projects/{pid}/run/kv/{key}")
def run_kv_delete(pid: str, key: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    with _kv_conn(pid) as c:
        c.execute("DELETE FROM kv WHERE k=?", (_check_kv_key(key),))
    return {"ok": True}


@router.delete("/projects/{pid}/run/data")
def run_data_reset(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    try:
        os.remove(os.path.join(_pdir(pid), "preview.db"))
    except OSError:
        pass
    return {"ok": True}


@router.get("/projects/{pid}/run/apps")
def run_apps(pid: str, x_pub_token: Optional[str] = Header(default=None), session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    return {"apps": bridge_list(profile_id(x_pub_token), p.get("integrations"))}


class CallBody(BaseModel):
    args: dict = {}


@router.post("/projects/{pid}/run/apps/{app_id}/{fn}")
async def run_apps_call(pid: str, app_id: str, fn: str, body: CallBody, x_pub_token: Optional[str] = Header(default=None), session=Depends(require_admin)):
    p = load_project(pid, _owner(session))
    return await bridge_call(profile_id(x_pub_token), p.get("integrations"), app_id, fn, body.args)


@router.get("/projects/{pid}/errors")
def get_errors(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    return {"errors": builder_ai.runtime_errors(pid)}


class ErrBody(BaseModel):
    message: str = ""
    stack: str = ""


@router.post("/projects/{pid}/errors")
def add_error(pid: str, body: ErrBody, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    builder_ai.add_runtime_error(pid, body.message, body.stack)
    return {"ok": True}


@router.delete("/projects/{pid}/errors")
def clear_errors(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    builder_ai.clear_runtime_errors(pid)
    return {"ok": True}


# The AI chat.

class ChatBody(BaseModel):
    message: str
    lang: str = "en"


@router.get("/projects/{pid}/chat")
def chat_history(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    return {"messages": builder_ai.history(pid), "running": builder_ai.running_turn(pid)}


@router.post("/projects/{pid}/chat")
async def chat(pid: str, body: ChatBody, x_pub_token: Optional[str] = Header(default=None), session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    return await builder_ai.start_turn(pid, _owner(session), session, body.message, body.lang, profile_id(x_pub_token))


@router.get("/projects/{pid}/turn/{turn_id}")
def turn(pid: str, turn_id: str, after: int = 0, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    return builder_ai.turn_state(pid, turn_id, after)


@router.post("/projects/{pid}/turn/{turn_id}/stop")
def turn_stop(pid: str, turn_id: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    builder_ai.stop_turn(pid, turn_id)
    return {"ok": True}


@router.delete("/projects/{pid}/chat")
def chat_clear(pid: str, session=Depends(require_admin)):
    load_project(pid, _owner(session))
    from . import builder_ai
    builder_ai.clear_history(pid)
    return {"ok": True}
