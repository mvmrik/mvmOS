import pwd
import grp
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session

router = APIRouter(prefix="/api/users", tags=["users"])


def _all_groups():
    return [g.gr_name for g in grp.getgrall()]


def _user_groups(username: str):
    return [g.gr_name for g in grp.getgrall() if username in g.gr_mem]


def _real_users():
    results = []
    for pw in pwd.getpwall():
        # show users with login shell and uid >= 0, skip nologin/false shells
        # include root and regular users (uid 0 or >= 1000)
        if pw.pw_uid != 0 and pw.pw_uid < 1000:
            continue
        if pw.pw_shell in ('/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/dev/null'):
            continue
        results.append({
            "username": pw.pw_name,
            "uid":      pw.pw_uid,
            "gid":      pw.pw_gid,
            "home":     pw.pw_dir,
            "shell":    pw.pw_shell,
            "groups":   _user_groups(pw.pw_name),
        })
    return sorted(results, key=lambda u: u["uid"])


@router.get("")
async def list_users(_session=Depends(get_current_session)):
    return JSONResponse({
        "users":  _real_users(),
        "groups": _all_groups(),
    })


class CreateUserRequest(BaseModel):
    username: str
    password: str
    groups:   list[str] = []
    shell:    str = "/bin/bash"
    create_home: bool = True


@router.post("")
async def create_user(body: CreateUserRequest, _session=Depends(get_current_session)):
    if not body.username.isidentifier():
        raise HTTPException(status_code=400, detail="Invalid username")
    try:
        cmd = ["useradd", "-s", body.shell]
        if body.create_home:
            cmd += ["-m"]
        if body.groups:
            cmd += ["-G", ",".join(body.groups)]
        cmd.append(body.username)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise HTTPException(status_code=400, detail=r.stderr.strip())
        # set password
        r2 = subprocess.run(["chpasswd"], input=f"{body.username}:{body.password}", capture_output=True, text=True)
        if r2.returncode != 0:
            raise HTTPException(status_code=400, detail=r2.stderr.strip())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True}


class UpdateUserRequest(BaseModel):
    groups:   list[str] | None = None
    shell:    str | None = None
    password: str | None = None


@router.patch("/{username}")
async def update_user(username: str, body: UpdateUserRequest, _session=Depends(get_current_session)):
    try:
        pwd.getpwnam(username)
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found")

    if body.groups is not None:
        r = subprocess.run(["usermod", "-G", ",".join(body.groups), username], capture_output=True, text=True)
        if r.returncode != 0:
            raise HTTPException(status_code=400, detail=r.stderr.strip())

    if body.shell:
        r = subprocess.run(["usermod", "-s", body.shell, username], capture_output=True, text=True)
        if r.returncode != 0:
            raise HTTPException(status_code=400, detail=r.stderr.strip())

    if body.password:
        r = subprocess.run(["chpasswd"], input=f"{username}:{body.password}", capture_output=True, text=True)
        if r.returncode != 0:
            raise HTTPException(status_code=400, detail=r.stderr.strip())

    return {"ok": True}


@router.delete("/{username}")
async def delete_user(username: str, _session=Depends(get_current_session)):
    if username == "root":
        raise HTTPException(status_code=403, detail="Cannot delete root")
    try:
        pwd.getpwnam(username)
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found")
    r = subprocess.run(["userdel", "-r", username], capture_output=True, text=True)
    if r.returncode != 0:
        raise HTTPException(status_code=400, detail=r.stderr.strip())
    return {"ok": True}
