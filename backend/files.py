import os
import shutil
import stat
import pwd
import grp
import subprocess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
from .auth import get_current_session

router = APIRouter(prefix="/api/files", tags=["files"])

BASE_DIR = "/"


def run_as(user: str, cmd: list, input_data: str = None):
    """Run a command as the given user (uses runuser if not root)."""
    if user and user != "root":
        cmd = ["runuser", "-u", user, "--"] + cmd
    r = subprocess.run(cmd, capture_output=True, text=True, input=input_data)
    return r


def home_for(username: str) -> str:
    try:
        return pwd.getpwnam(username).pw_dir
    except KeyError:
        return os.path.expanduser("~")


def safe_path(path: str, home: str = None) -> str:
    base = home or os.path.expanduser("~")
    resolved = os.path.realpath(path if os.path.isabs(path) else os.path.join(base, path))
    if not resolved.startswith("/"):
        raise HTTPException(status_code=403, detail="Access denied")
    return resolved


XDG_PLACES = [
    {"name": "Desktop",   "icon": "🖥️"},
    {"name": "Downloads", "icon": "📥"},
    {"name": "Documents", "icon": "📄"},
    {"name": "Music",     "icon": "🎵"},
    {"name": "Pictures",  "icon": "🖼️"},
    {"name": "Videos",    "icon": "🎬"},
]


@router.get("/places")
async def get_places(session=Depends(get_current_session)):
    username = session["effective_user"]
    home = home_for(username)

    xdg = []
    for p in XDG_PLACES:
        path = os.path.join(home, p["name"])
        if os.path.isdir(path):
            xdg.append({"name": p["name"], "icon": p["icon"], "path": path})

    return JSONResponse({
        "username": username,
        "home": home,
        "xdg": xdg,
    })


@router.get("")
async def list_dir(path: str = "/", session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(path, home_for(eu))
    if not os.path.isdir(real):
        raise HTTPException(status_code=404, detail="Not a directory")
    entries = []
    for name in sorted(os.listdir(real)):
        full = os.path.join(real, name)
        st = os.stat(full)
        try:
            owner = pwd.getpwuid(st.st_uid).pw_name
            group = grp.getgrgid(st.st_gid).gr_name
        except KeyError:
            owner, group = str(st.st_uid), str(st.st_gid)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": st.st_size,
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "permissions": oct(stat.S_IMODE(st.st_mode))[2:],
            "owner": owner,
            "group": group,
        })
    return JSONResponse({"path": path, "entries": entries})


@router.post("/upload")
async def upload_file(
    path: str = Form("/"),
    file: UploadFile = File(...),
    _session=Depends(get_current_session),
):
    dest = safe_path(os.path.join(path, file.filename))
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"ok": True, "name": file.filename}


class RenameRequest(BaseModel):
    path: str
    new_name: str


class CopyRequest(BaseModel):
    src: str
    dst_dir: str
    move: bool = False

@router.post("/copy")
async def copy_file(body: CopyRequest, _session=Depends(get_current_session)):
    src = safe_path(body.src)
    dst_dir = safe_path(body.dst_dir)
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="Source not found")
    if not os.path.isdir(dst_dir):
        raise HTTPException(status_code=400, detail="Destination is not a directory")
    dst = os.path.join(dst_dir, os.path.basename(src))
    if body.move:
        shutil.move(src, dst)
    else:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    return {"ok": True}

@router.post("/rename")
async def rename(body: RenameRequest, _session=Depends(get_current_session)):
    src = safe_path(body.path)
    dst = safe_path(os.path.join(os.path.dirname(body.path), body.new_name))
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="Not found")
    os.rename(src, dst)
    return {"ok": True}


class DeleteRequest(BaseModel):
    path: str


@router.delete("/delete")
async def delete(body: DeleteRequest, _session=Depends(get_current_session)):
    real = safe_path(body.path)
    if not os.path.exists(real):
        raise HTTPException(status_code=404, detail="Not found")
    if os.path.isdir(real):
        shutil.rmtree(real)
    else:
        os.remove(real)
    return {"ok": True}


class MkdirRequest(BaseModel):
    path: str


@router.post("/mkdir")
async def mkdir(body: MkdirRequest, _session=Depends(get_current_session)):
    real = safe_path(body.path)
    os.makedirs(real, exist_ok=True)
    return {"ok": True}


class ChmodRequest(BaseModel):
    path: str
    mode: str  # octal string e.g. "755"


@router.post("/chmod")
async def chmod(body: ChmodRequest, _session=Depends(get_current_session)):
    real = safe_path(body.path)
    if not os.path.exists(real):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        os.chmod(real, int(body.mode, 8))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid mode")
    return {"ok": True}


class ChownRequest(BaseModel):
    path: str
    owner: str
    group: str = ""


class WriteRequest(BaseModel):
    path: str
    content: str

@router.post("/write")
async def write_file(body: WriteRequest, _session=Depends(get_current_session)):
    real = safe_path(body.path)
    if os.path.isdir(real):
        raise HTTPException(status_code=400, detail="Path is a directory")
    with open(real, 'w', encoding='utf-8') as f:
        f.write(body.content)
    return {"ok": True}

@router.get("/raw")
async def raw_file(path: str, _session=Depends(get_current_session)):
    import mimetypes
    real = safe_path(path)
    if not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="Not found")
    mime, _ = mimetypes.guess_type(real)
    return FileResponse(real, media_type=mime or "application/octet-stream")

@router.get("/desktop/watch")
async def desktop_watch(session=Depends(get_current_session)):
    import asyncio
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    os.makedirs(desktop_dir, exist_ok=True)

    def _snapshot():
        try:
            return {f: os.stat(os.path.join(desktop_dir, f)).st_mtime
                    for f in os.listdir(desktop_dir) if not f.startswith('.')}
        except Exception:
            return {}

    async def generate():
        last = _snapshot()
        yield "data: ok\n\n"
        while True:
            await asyncio.sleep(2)
            current = _snapshot()
            if current != last:
                last = current
                yield "data: changed\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.get("/desktop/list")
async def desktop_files(session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    os.makedirs(desktop_dir, exist_ok=True)
    entries = []
    for name in sorted(os.listdir(desktop_dir)):
        full = os.path.join(desktop_dir, name)
        if name.startswith('.'):
            continue
        entry = {"name": name, "path": full}
        if os.path.isdir(full):
            entry["type"] = "dir"
        elif name.endswith(".url"):
            entry["type"] = "url"
            try:
                content = open(full).read()
                for line in content.splitlines():
                    if line.startswith("URL="):
                        entry["url"] = line[4:].strip()
            except Exception:
                pass
        elif name.endswith(".mvmos"):
            entry["type"] = "app"
            try:
                content = open(full).read().strip()
                entry["app_id"] = content
            except Exception:
                pass
        else:
            entry["type"] = "file"
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            entry["ext"] = ext
        entries.append(entry)
    return JSONResponse({"entries": entries, "desktop_dir": desktop_dir})

class NewAppRequest(BaseModel):
    app_id: str
    label: str = ""

@router.post("/desktop/app")
async def desktop_new_app(body: NewAppRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    os.makedirs(desktop_dir, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in (body.label or body.app_id))
    filename = safe_name + ".mvmos"
    path = os.path.join(desktop_dir, filename)
    with open(path, "w") as f:
        f.write(body.app_id)
    return JSONResponse({"ok": True, "name": filename})

class NewLinkRequest(BaseModel):
    url: str
    label: str = ""

class NewFolderRequest(BaseModel):
    name: str

@router.post("/desktop/link")
async def desktop_new_link(body: NewLinkRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    os.makedirs(desktop_dir, exist_ok=True)
    from urllib.parse import urlparse
    label = body.label or urlparse(body.url).hostname or "link"
    safe_name = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in label)
    filename = safe_name + ".url"
    path = os.path.join(desktop_dir, filename)
    with open(path, "w") as f:
        f.write(f"[InternetShortcut]\nURL={body.url}\n")
    return JSONResponse({"ok": True, "name": filename})

@router.post("/desktop/folder")
async def desktop_new_folder(body: NewFolderRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    folder_path = os.path.join(desktop_dir, body.name)
    os.makedirs(folder_path, exist_ok=True)
    return JSONResponse({"ok": True})

@router.delete("/desktop/entry")
async def desktop_delete_entry(path: str, session=Depends(get_current_session)):
    real = safe_path(path)
    desktop_dir = safe_path(os.path.join(home_for(session["effective_user"]), "Desktop"))
    if not real.startswith(desktop_dir):
        raise HTTPException(status_code=403, detail="Access denied")
    if os.path.isdir(real):
        shutil.rmtree(real)
    else:
        os.remove(real)
    return JSONResponse({"ok": True})

@router.post("/chown")
async def chown(body: ChownRequest, _session=Depends(get_current_session)):
    real = safe_path(body.path)
    if not os.path.exists(real):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        uid = pwd.getpwnam(body.owner).pw_uid
        gid = grp.getgrnam(body.group).gr_gid if body.group else -1
        os.chown(real, uid, gid)
    except KeyError:
        raise HTTPException(status_code=400, detail="Unknown user or group")
    return {"ok": True}
