"""
mvmOS Projects — create, build, watch, deploy site projects.

Project layout (in ~/mvmos_projects/<id>/):
  manifest.json   – project metadata
  main.js         – mvmOS window UI (optional)
  public.py       – public API routes
  backend.py      – internal logic
  public/         – static site files (html, css, js, ...)

Deploy copies to:
  frontend:  apps/<id>/  (main.js, manifest.json, icons)
  backend:   backend/apps/<id>/  (public.py, backend.py, public/)
"""

import json
import os
import shutil
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .db import get_conn, APPS_DIR
from .auth import get_current_session
from . import app_backends, public_loader

router = APIRouter(prefix="/api/projects", tags=["projects"])

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")

# active watchers: project_id -> Observer
_watchers: dict = {}

# reference to FastAPI app set by main.py
_app_ref = None


def init(app):
    global _app_ref
    _app_ref = app


def _user_projects_dir(username: str) -> str:
    home = os.path.expanduser(f"~{username}")
    return os.path.join(home, "mvmos_projects")


# ── helpers ──────────────────────────────────────────────────────────────────

def _project_dir(project_id: str, username: str) -> str:
    return os.path.join(_user_projects_dir(username), project_id)


def _meta_path(project_id: str, username: str) -> str:
    return os.path.join(_project_dir(project_id, username), "mvmos_project.json")


def _read_meta(project_id: str, username: str) -> dict:
    try:
        return json.loads(open(_meta_path(project_id, username)).read())
    except Exception:
        return {}


def _write_meta(project_id: str, username: str, meta: dict):
    with open(_meta_path(project_id, username), "w") as f:
        json.dump(meta, f, indent=2)


def _deploy(project_id: str, username: str):
    """Copy project files to the correct app/backend locations."""
    src = _project_dir(project_id, username)
    app_dst = os.path.join(APPS_DIR, project_id)
    backend_dst = os.path.join(BACKENDS_DIR, project_id)
    os.makedirs(app_dst, exist_ok=True)
    os.makedirs(backend_dst, exist_ok=True)

    FRONTEND_FILES = {"main.js", "manifest.json", "style.css", "icon.png", "icon.svg"}
    BACKEND_FILES = {"public.py", "backend.py"}

    for name in os.listdir(src):
        if name.startswith(".") or name == "mvmos_project.json":
            continue
        full = os.path.join(src, name)
        if name in FRONTEND_FILES:
            shutil.copy2(full, os.path.join(app_dst, name))
        elif name in BACKEND_FILES:
            shutil.copy2(full, os.path.join(backend_dst, name))
        elif name == "public" and os.path.isdir(full):
            dst_pub = os.path.join(backend_dst, "public")
            if os.path.exists(dst_pub):
                shutil.rmtree(dst_pub)
            shutil.copytree(full, dst_pub)

    # reload backend routes
    if _app_ref:
        if os.path.exists(os.path.join(backend_dst, "backend.py")):
            app_backends._load_one(_app_ref, project_id)
        if os.path.exists(os.path.join(backend_dst, "public.py")):
            public_loader._load_one(_app_ref, project_id)


def _start_watcher(project_id: str, username: str):
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

    class Handler(FileSystemEventHandler):
        def on_modified(self, event):
            if not event.is_directory and not os.path.basename(event.src_path).startswith("."):
                _deploy(project_id, username)

        def on_created(self, event):
            self.on_modified(event)

    observer = Observer()
    observer.schedule(Handler(), _project_dir(project_id, username), recursive=True)
    observer.start()
    _watchers[project_id] = observer
    print(f"[projects] watching: {project_id}")


def _stop_watcher(project_id: str):
    obs = _watchers.pop(project_id, None)
    if obs:
        obs.stop()
        obs.join()
        print(f"[projects] stopped watching: {project_id}")


# ── API ───────────────────────────────────────────────────────────────────────

class NewProjectBody(BaseModel):
    id: str
    name: str
    domain: Optional[str] = None


@router.get("")
def list_projects(session=Depends(get_current_session)):
    username = session["effective_user"]
    projects_dir = _user_projects_dir(username)
    if not os.path.isdir(projects_dir):
        return []
    result = []
    for pid in sorted(os.listdir(projects_dir)):
        pdir = _project_dir(pid, username)
        if not os.path.isdir(pdir):
            continue
        meta = _read_meta(pid, username)
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT domain, path FROM domains WHERE app_id = ?", (pid,)
            ).fetchall()
        built = os.path.isfile(os.path.join(BACKENDS_DIR, pid, "public.py")) or \
                os.path.isfile(os.path.join(APPS_DIR, pid, "main.js"))
        has_app = os.path.isfile(os.path.join(APPS_DIR, pid, "main.js"))
        result.append({
            "id": pid,
            "name": meta.get("name", pid),
            "domain": meta.get("domain"),
            "path": f"/{pid}",
            "watching": pid in _watchers,
            "published": len(rows) > 0,
            "built": built,
            "has_app": has_app,
            "sites": [dict(r) for r in rows],
            "project_dir": pdir,
        })
    return result


@router.post("")
def create_project(body: NewProjectBody, session=Depends(get_current_session)):
    username = session["effective_user"]
    pid = body.id.strip().lower().replace(" ", "-")
    if not pid or "/" in pid or ".." in pid:
        raise HTTPException(400, "Invalid project id")

    pdir = _project_dir(pid, username)
    if os.path.exists(pdir):
        raise HTTPException(409, "Project already exists")

    os.makedirs(os.path.join(pdir, "public"), exist_ok=True)

    # scaffold default files
    open(os.path.join(pdir, "public.py"), "w").write(
        'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get("/")\nasync def index():\n    return {"project": "' + pid + '"}\n'
    )
    open(os.path.join(pdir, "public", "index.html"), "w").write(
        f'<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>{body.name}</title></head>\n<body>\n<h1>{body.name}</h1>\n</body>\n</html>\n'
    )
    open(os.path.join(pdir, "manifest.json"), "w").write(
        json.dumps({"id": pid, "name": body.name, "icon": "🌐", "version": "1.0.0"}, indent=2)
    )

    _write_meta(pid, username, {"name": body.name, "domain": body.domain})

    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO plugins (id, name, icon) VALUES (?, ?, '🌐')", (pid, body.name))
        conn.execute("INSERT OR IGNORE INTO domains (app_id, path) VALUES (?, ?)", (pid, f"/{pid}"))
        if body.domain:
            d = body.domain.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
            conn.execute("INSERT OR IGNORE INTO domains (app_id, domain) VALUES (?, ?)", (pid, d))

    return {"ok": True, "id": pid, "project_dir": pdir}


@router.post("/{project_id}/publish")
def publish_project(project_id: str, session=Depends(get_current_session)):
    username = session["effective_user"]
    if not os.path.isdir(_project_dir(project_id, username)):
        raise HTTPException(404, "Project not found")
    meta = _read_meta(project_id, username)
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO plugins (id, name, icon) VALUES (?, ?, '🌐')", (project_id, meta.get("name", project_id)))
        conn.execute("INSERT OR IGNORE INTO domains (app_id, path) VALUES (?, ?)", (project_id, f"/{project_id}"))
        if meta.get("domain"):
            conn.execute("INSERT OR IGNORE INTO domains (app_id, domain) VALUES (?, ?)", (project_id, meta["domain"]))
    return {"ok": True, "published": True}


@router.post("/{project_id}/unpublish")
def unpublish_project(project_id: str, session=Depends(get_current_session)):
    _stop_watcher(project_id)
    with get_conn() as conn:
        conn.execute("DELETE FROM domains WHERE app_id = ?", (project_id,))
    return {"ok": True, "published": False}


@router.post("/{project_id}/build")
def start_build(project_id: str, session=Depends(get_current_session)):
    username = session["effective_user"]
    if not os.path.isdir(_project_dir(project_id, username)):
        raise HTTPException(404, "Project not found")
    _deploy(project_id, username)
    if project_id not in _watchers:
        _start_watcher(project_id, username)
    return {"ok": True, "watching": True}


@router.post("/{project_id}/stop")
def stop_build(project_id: str, session=Depends(get_current_session)):
    _stop_watcher(project_id)
    return {"ok": True, "watching": False}


@router.delete("/{project_id}")
def delete_project(project_id: str, session=Depends(get_current_session)):
    username = session["effective_user"]
    _stop_watcher(project_id)
    pdir = _project_dir(project_id, username)
    if os.path.isdir(pdir):
        shutil.rmtree(pdir)
    with get_conn() as conn:
        conn.execute("DELETE FROM domains WHERE app_id = ?", (project_id,))
        conn.execute("DELETE FROM plugins WHERE id = ?", (project_id,))
    app_dst = os.path.join(APPS_DIR, project_id)
    backend_dst = os.path.join(BACKENDS_DIR, project_id)
    if os.path.isdir(app_dst):
        shutil.rmtree(app_dst)
    if os.path.isdir(backend_dst):
        shutil.rmtree(backend_dst)
    return {"ok": True}
