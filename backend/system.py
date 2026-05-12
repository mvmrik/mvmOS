import asyncio
import os
import subprocess
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from .auth import get_current_session
from .db import load_config

router = APIRouter(prefix="/api/system", tags=["system"])

REPO_DIR = os.path.join(os.path.dirname(__file__), "..")


def _git(args):
    return subprocess.run(
        ["git"] + args, capture_output=True, text=True, cwd=REPO_DIR
    )


@router.get("/info")
async def system_info(session=Depends(get_current_session)):
    cfg = load_config()
    version = cfg.get("app", "version", fallback="1.0.0")

    # git info
    commit = _git(["rev-parse", "--short", "HEAD"]).stdout.strip()
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()

    # system info
    def read(path, fallback=""):
        try: return open(path).read().strip()
        except: return fallback

    kernel  = subprocess.run(["uname", "-r"], capture_output=True, text=True).stdout.strip()
    uptime  = subprocess.run(["uptime", "-p"], capture_output=True, text=True).stdout.strip()
    hostname = subprocess.run(["hostname"], capture_output=True, text=True).stdout.strip()

    # disk usage for /
    df = subprocess.run(["df", "-h", "/"], capture_output=True, text=True).stdout.splitlines()
    disk = df[1].split() if len(df) > 1 else []
    disk_used  = disk[2] if len(disk) > 2 else "?"
    disk_total = disk[1] if len(disk) > 1 else "?"
    disk_pct   = disk[4] if len(disk) > 4 else "?"

    # memory
    free = subprocess.run(["free", "-h"], capture_output=True, text=True).stdout.splitlines()
    mem = free[1].split() if len(free) > 1 else []
    mem_used  = mem[2] if len(mem) > 2 else "?"
    mem_total = mem[1] if len(mem) > 1 else "?"

    return JSONResponse({
        "version": version,
        "commit": commit,
        "branch": branch,
        "kernel": kernel,
        "uptime": uptime,
        "hostname": hostname,
        "disk_used": disk_used,
        "disk_total": disk_total,
        "disk_pct": disk_pct,
        "mem_used": mem_used,
        "mem_total": mem_total,
    })


@router.get("/check-update")
async def check_update(session=Depends(get_current_session)):
    _git(["fetch", "origin"])
    local  = _git(["rev-parse", "HEAD"]).stdout.strip()
    remote = _git(["rev-parse", "origin/main"]).stdout.strip()
    behind = _git(["rev-list", "--count", f"HEAD..origin/main"]).stdout.strip()
    return JSONResponse({
        "up_to_date": local == remote,
        "commits_behind": int(behind) if behind.isdigit() else 0,
        "local": local[:7],
        "remote": remote[:7],
    })


@router.post("/update")
async def do_update(session=Depends(get_current_session)):
    async def generate():
        proc = await asyncio.create_subprocess_exec(
            "git", "pull", "origin", "main",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=os.path.abspath(REPO_DIR),
        )
        async for line in proc.stdout:
            yield f"data: {line.decode(errors='replace').rstrip()}\n\n"
        await proc.wait()
        if proc.returncode == 0:
            yield "data: __RESTARTING__\n\n"
            # restart uvicorn by replacing the process
            asyncio.get_event_loop().call_later(1, _restart)
        else:
            yield f"data: __EXIT_{proc.returncode}__\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _restart():
    import sys, signal
    os.kill(os.getpid(), signal.SIGTERM)
