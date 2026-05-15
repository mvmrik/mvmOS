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
    """Run a command as the given user."""
    if user and user != "root":
        prefix = [] if os.geteuid() == 0 else ["sudo"]
        cmd = prefix + ["runuser", "-u", user, "--"] + cmd
    r = subprocess.run(cmd, capture_output=True, text=True, input=input_data)
    return r


def mkdir_as(path: str, user: str):
    run_as(user, ["mkdir", "-p", path])

def read_file_as(path: str, user: str) -> str:
    r = run_as(user, ["cat", path])
    if r.returncode != 0:
        raise PermissionError(r.stderr)
    return r.stdout

def write_file_as(path: str, content: str, user: str):
    r = run_as(user, ["tee", path], input_data=content)
    if r.returncode != 0:
        raise PermissionError(r.stderr)

def stat_mtime_as(path: str, user: str) -> float:
    r = run_as(user, ["stat", "-c", "%Y", path])
    return float(r.stdout.strip()) if r.returncode == 0 else 0.0



def readdir_as_user(path: str, username: str) -> list:
    """Return [{name,type,size,modified,permissions,owner,group}] as the given user."""
    import json as _json, stat as _stat, datetime as _dt
    script = """
import os, json, stat, pwd, grp, datetime
path = {path!r}
entries = []
for name in sorted(os.listdir(path)):
    full = os.path.join(path, name)
    try:
        st = os.stat(full)
    except Exception:
        continue
    try: owner = pwd.getpwuid(st.st_uid).pw_name
    except KeyError: owner = str(st.st_uid)
    try: group = grp.getgrgid(st.st_gid).gr_name
    except KeyError: group = str(st.st_gid)
    entries.append({{
        'name': name,
        'type': 'dir' if os.path.isdir(full) else 'file',
        'size': st.st_size,
        'modified': datetime.datetime.fromtimestamp(st.st_mtime).isoformat(),
        'permissions': oct(stat.S_IMODE(st.st_mode))[2:],
        'owner': owner, 'group': group,
    }})
print(json.dumps(entries))
""".format(path=path)
    try:
        prefix = [] if os.geteuid() == 0 else ["sudo"]
        r = subprocess.run(
            prefix + ["runuser", "-u", username, "--", "python3", "-c", script],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            return _json.loads(r.stdout)
        raise PermissionError(r.stderr.strip())
    except PermissionError:
        raise
    except Exception:
        pass
    # fallback: direct read (works when server is root)
    entries = []
    for name in sorted(os.listdir(path)):
        full = os.path.join(path, name)
        try:
            st = os.stat(full)
        except Exception:
            continue
        try: owner = pwd.getpwuid(st.st_uid).pw_name
        except KeyError: owner = str(st.st_uid)
        try: group = grp.getgrgid(st.st_gid).gr_name
        except KeyError: group = str(st.st_gid)
        entries.append({
            'name': name,
            'type': 'dir' if os.path.isdir(full) else 'file',
            'size': st.st_size,
            'modified': datetime.fromtimestamp(st.st_mtime).isoformat(),
            'permissions': oct(stat.S_IMODE(st.st_mode))[2:],
            'owner': owner, 'group': group,
        })
    return entries


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
        if run_as(username, ["test", "-d", path]).returncode == 0:
            xdg.append({"name": p["name"], "icon": p["icon"], "path": path})

    return JSONResponse({
        "username": username,
        "home": home,
        "xdg": xdg,
    })


@router.get("")
async def list_dir(path: str = "/", as_root: bool = False, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(path, home_for(eu))
    check_user = "root" if as_root else eu
    if run_as(check_user, ["test", "-d", real]).returncode != 0:
        raise HTTPException(status_code=404, detail="Not a directory")
    try:
        entries = readdir_as_user(real, check_user)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    return JSONResponse({"path": path, "entries": entries, "as_root": as_root})


@router.post("/upload")
async def upload_file(
    path: str = Form("/"),
    file: UploadFile = File(...),
    session=Depends(get_current_session),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")
    eu = session["effective_user"]
    dest = safe_path(os.path.join(path, os.path.basename(file.filename)))
    import tempfile
    data = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mvmostmp") as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        r = run_as(eu, ["cp", tmp_path, dest])
    finally:
        os.unlink(tmp_path)
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True, "name": file.filename}


class RenameRequest(BaseModel):
    path: str
    new_name: str


class CopyRequest(BaseModel):
    src: str
    dst_dir: str
    move: bool = False

@router.post("/copy")
async def copy_file(body: CopyRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    src = safe_path(body.src)
    dst_dir = safe_path(body.dst_dir)
    dst = os.path.join(dst_dir, os.path.basename(src))
    cmd = ["mv" if body.move else "cp", "-r", src, dst]
    r = run_as(eu, cmd)
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}

@router.post("/rename")
async def rename(body: RenameRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    src = safe_path(body.path)
    dst = safe_path(os.path.join(os.path.dirname(body.path), body.new_name))
    r = run_as(eu, ["mv", src, dst])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}


class DeleteRequest(BaseModel):
    path: str


@router.delete("/delete")
async def delete(body: DeleteRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(body.path)
    r = run_as(eu, ["rm", "-rf", real])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}


class MkdirRequest(BaseModel):
    path: str


@router.post("/mkdir")
async def mkdir(body: MkdirRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(body.path)
    r = run_as(eu, ["mkdir", "-p", real])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}


class ChmodRequest(BaseModel):
    path: str
    mode: str


@router.post("/chmod")
async def chmod(body: ChmodRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(body.path)
    r = run_as(eu, ["chmod", body.mode, real])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}


class ChownRequest(BaseModel):
    path: str
    owner: str
    group: str = ""


class WriteRequest(BaseModel):
    path: str
    content: str

@router.post("/write")
async def write_file(body: WriteRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(body.path)
    if run_as(eu, ["test", "-d", real]).returncode == 0:
        raise HTTPException(status_code=400, detail="Path is a directory")
    r = run_as(eu, ["tee", real], input_data=body.content)
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}

@router.get("/search")
async def search_files(path: str, q: str, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(path, home_for(eu))
    if run_as(eu, ["test", "-d", real]).returncode != 0:
        raise HTTPException(status_code=400, detail="Not a directory")
    r = run_as(eu, ["find", real, "-maxdepth", "5",
                    "!", "-name", ".*",
                    "-iname", f"*{q}*",
                    "-not", "-path", "*/.*/*"])
    results = []
    for line in r.stdout.splitlines()[:200]:
        line = line.strip()
        if not line or line == real:
            continue
        stat_r = run_as(eu, ["stat", "-c", "%F\t%s\t%Y", line])
        if stat_r.returncode != 0:
            continue
        parts = stat_r.stdout.strip().split("\t")
        if len(parts) != 3:
            continue
        ftype, size, mtime = parts
        results.append({
            "name": os.path.basename(line),
            "path": line,
            "type": "dir" if ftype == "directory" else "file",
            "size": int(size),
            "modified": datetime.fromtimestamp(int(mtime)).isoformat(),
        })
    return JSONResponse({"results": results})

@router.get("/dirsize")
async def dir_size(path: str, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(path, home_for(eu))
    if run_as(eu, ["test", "-d", real]).returncode != 0:
        raise HTTPException(status_code=400, detail="Not a directory")
    r = run_as(eu, ["du", "-sb", real])
    try:
        total = int(r.stdout.split()[0])
    except (IndexError, ValueError):
        total = 0
    return {"size": total}

@router.get("/raw")
async def raw_file(path: str, session=Depends(get_current_session)):
    import mimetypes
    from fastapi.responses import Response
    eu = session["effective_user"]
    real = safe_path(path, home_for(eu))
    if run_as(eu, ["test", "-f", real]).returncode != 0:
        raise HTTPException(status_code=404, detail="Not found")
    prefix = [] if os.geteuid() == 0 else ["sudo"]
    cmd = (prefix + ["runuser", "-u", eu, "--", "cat", real]) if eu != "root" else ["cat", real]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    mime, _ = mimetypes.guess_type(real)
    return Response(content=r.stdout, media_type=mime or "application/octet-stream")

@router.get("/desktop/watch")
async def desktop_watch(session=Depends(get_current_session)):
    import asyncio
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    mkdir_as(desktop_dir, username)

    def _snapshot():
        r = run_as(username, ["ls", "-1", desktop_dir])
        files = [f for f in r.stdout.splitlines() if f and not f.startswith('.')]
        return {f: stat_mtime_as(os.path.join(desktop_dir, f), username) for f in files}

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
    mkdir_as(desktop_dir, username)
    r = run_as(username, ["ls", "-1", desktop_dir])
    entries = []
    for name in sorted(r.stdout.splitlines()):
        if not name or name.startswith('.'):
            continue
        full = os.path.join(desktop_dir, name)
        entry = {"name": name, "path": full}
        is_dir = run_as(username, ["test", "-d", full]).returncode == 0
        if is_dir:
            entry["type"] = "dir"
        elif name.endswith(".url"):
            entry["type"] = "url"
            try:
                content = read_file_as(full, username)
                for line in content.splitlines():
                    if line.startswith("URL="):
                        entry["url"] = line[4:].strip()
            except Exception:
                pass
        elif name.endswith(".mvmos"):
            entry["type"] = "app"
            try:
                entry["app_id"] = read_file_as(full, username).strip()
            except Exception:
                pass
        else:
            entry["type"] = "file"
            entry["ext"] = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        entries.append(entry)
    return JSONResponse({"entries": entries, "desktop_dir": desktop_dir})

class NewAppRequest(BaseModel):
    app_id: str
    label: str = ""

@router.post("/desktop/app")
async def desktop_new_app(body: NewAppRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    mkdir_as(desktop_dir, username)
    safe_name = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in (body.label or body.app_id))
    filename = safe_name + ".mvmos"
    write_file_as(os.path.join(desktop_dir, filename), body.app_id, username)
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
    mkdir_as(desktop_dir, username)
    from urllib.parse import urlparse
    label = body.label or urlparse(body.url).hostname or "link"
    safe_name = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in label)
    filename = safe_name + ".url"
    write_file_as(os.path.join(desktop_dir, filename), f"[InternetShortcut]\nURL={body.url}\n", username)
    return JSONResponse({"ok": True, "name": filename})

@router.post("/desktop/folder")
async def desktop_new_folder(body: NewFolderRequest, session=Depends(get_current_session)):
    username = session["effective_user"]
    desktop_dir = os.path.join(home_for(username), "Desktop")
    mkdir_as(os.path.join(desktop_dir, body.name), username)
    return JSONResponse({"ok": True})

@router.delete("/desktop/entry")
async def desktop_delete_entry(path: str, session=Depends(get_current_session)):
    username = session["effective_user"]
    real = safe_path(path)
    desktop_dir = safe_path(os.path.join(home_for(username), "Desktop"))
    if not real.startswith(desktop_dir):
        raise HTTPException(status_code=403, detail="Access denied")
    r = run_as(username, ["rm", "-rf", real])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return JSONResponse({"ok": True})

@router.post("/chown")
async def chown(body: ChownRequest, session=Depends(get_current_session)):
    eu = session["effective_user"]
    real = safe_path(body.path)
    spec = body.owner + ((":" + body.group) if body.group else "")
    r = run_as(eu, ["chown", spec, real])
    if r.returncode != 0:
        raise HTTPException(status_code=403, detail="Permission denied")
    return {"ok": True}
