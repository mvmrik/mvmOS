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
    use_domain: bool = False  # True = domain mode, False = path mode


@router.get("/webserver/status")
def webserver_status_early(session=Depends(get_current_session)):
    import subprocess, re
    r = subprocess.run(["systemctl", "is-active", "mvmos-public"], capture_output=True, text=True)
    active = r.stdout.strip() == "active"
    port = 80
    svc_path = "/etc/systemd/system/mvmos-public.service"
    if os.path.exists(svc_path):
        content = open(svc_path).read()
        m = re.search(r'--port (\d+)', content)
        if m:
            port = int(m.group(1))
    return {"active": active, "port": port}


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
            "domain": next((r["domain"] for r in rows if r["domain"]), None),
            "path": next((r["path"] for r in rows if r["path"]), f"/{pid}"),
            "watching": pid in _watchers,
            "published": len(rows) > 0,
            "built": built,
            "has_app": has_app,
            "sites": [dict(r) for r in rows],
            "project_dir": pdir,
        })
    return result


class WebServerBody(BaseModel):
    port: int = 80

@router.post("/webserver/start")
def webserver_start_early(body: WebServerBody, session=Depends(get_current_session)):
    import subprocess
    r = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True)
    if f":{body.port} " in r.stdout or f":{body.port}\n" in r.stdout:
        raise HTTPException(409, f"Port {body.port} is already in use")
    svc_path = f"/etc/systemd/system/{SERVICE_NAME}.service"
    content = SERVICE_TEMPLATE.format(
        work_dir=os.path.abspath(WORK_DIR),
        uvicorn=os.path.abspath(UVICORN_BIN),
        port=body.port,
    )
    with open(svc_path, "w") as f:
        f.write(content)
    subprocess.run(["systemctl", "daemon-reload"], capture_output=True)
    subprocess.run(["systemctl", "enable", SERVICE_NAME], capture_output=True)
    r = subprocess.run(["systemctl", "start", SERVICE_NAME], capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(500, r.stderr.strip() or r.stdout.strip())
    return {"ok": True, "port": body.port}

@router.post("/webserver/stop")
def webserver_stop_early(session=Depends(get_current_session)):
    import subprocess
    subprocess.run(["systemctl", "disable", SERVICE_NAME], capture_output=True)
    r = subprocess.run(["systemctl", "stop", SERVICE_NAME], capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(500, r.stderr.strip())
    return {"ok": True}


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
        if body.use_domain and body.domain:
            d = body.domain.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
            conn.execute("INSERT OR IGNORE INTO domains (app_id, domain) VALUES (?, ?)", (pid, d))
        else:
            conn.execute("INSERT OR IGNORE INTO domains (app_id, path) VALUES (?, ?)", (pid, f"/{pid}"))

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


class SiteAddressBody(BaseModel):
    use_domain: bool = False
    domain: str | None = None
    path: str | None = None

@router.post("/{project_id}/address")
def set_project_address(project_id: str, body: SiteAddressBody, session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM plugins WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        conn.execute("DELETE FROM domains WHERE app_id = ?", (project_id,))
        if body.use_domain and body.domain:
            domain = body.domain.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
            conflict = conn.execute("SELECT id FROM domains WHERE domain = ?", (domain,)).fetchone()
            if conflict:
                raise HTTPException(409, "Domain already in use")
            conn.execute("INSERT INTO domains (app_id, domain, path) VALUES (?, ?, NULL)", (project_id, domain))
        else:
            path = ("/" + body.path.strip().strip("/")) if body.path else f"/{project_id}"
            conflict = conn.execute("SELECT id FROM domains WHERE path = ? AND app_id != ?", (path, project_id)).fetchone()
            if conflict:
                raise HTTPException(409, "Path already in use")
            conn.execute("INSERT INTO domains (app_id, path, domain) VALUES (?, ?, NULL)", (project_id, path))
    return {"ok": True}


SERVICE_NAME = "mvmos-public"
SERVICE_TEMPLATE = """[Unit]
Description=mvmOS Public Web Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={work_dir}
ExecStart={uvicorn} backend.main:app --host 0.0.0.0 --port {port} --timeout-graceful-shutdown 3
Restart=always
RestartSec=2
Environment=PYTHONUNBUFFERED=1
Environment=MVMOS_PUBLIC=1

[Install]
WantedBy=multi-user.target
"""

WORK_DIR = os.path.join(os.path.dirname(__file__), "..")
UVICORN_BIN = os.path.join(WORK_DIR, "venv", "bin", "uvicorn")

class WebServerBody(BaseModel):
    port: int = 80


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
