import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session

router = APIRouter(prefix="/api/files", tags=["files"])

# Restrict file manager access to the user's home directory
BASE_DIR = os.path.expanduser("~")


def safe_path(path: str) -> str:
    """Resolve path and ensure it stays within BASE_DIR."""
    resolved = os.path.realpath(os.path.join(BASE_DIR, path.lstrip("/")))
    if not resolved.startswith(os.path.realpath(BASE_DIR)):
        raise HTTPException(status_code=403, detail="Access denied")
    return resolved


@router.get("")
async def list_dir(path: str = "/", _session=Depends(get_current_session)):
    real = safe_path(path)
    if not os.path.isdir(real):
        raise HTTPException(status_code=404, detail="Not a directory")
    entries = []
    for name in sorted(os.listdir(real)):
        full = os.path.join(real, name)
        stat = os.stat(full)
        entries.append({
            "name": name,
            "type": "dir" if os.path.isdir(full) else "file",
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
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
