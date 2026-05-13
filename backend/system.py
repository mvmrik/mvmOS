import asyncio
import os
import subprocess
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from .auth import get_current_session
from .db import load_config

router = APIRouter(prefix="/api/system", tags=["system"])

REPO_DIR = os.path.join(os.path.dirname(__file__), "..")
VERSION_FILE = os.path.join(REPO_DIR, "version.txt")
RELEASES_URL = "https://api.github.com/repos/mvmrik/mvmOS/releases/latest"


def _local_version() -> str:
    try:
        return open(VERSION_FILE).read().strip()
    except Exception:
        return "0.0.0"


def _git(args):
    return subprocess.run(
        ["git"] + args, capture_output=True, text=True, cwd=REPO_DIR
    )


@router.get("/info")
async def system_info(session=Depends(get_current_session)):
    cfg = load_config()
    version = _local_version()

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
    import httpx
    local = _local_version()
    try:
        async with httpx.AsyncClient(timeout=8, headers={"Accept": "application/vnd.github+json"}) as client:
            r = await client.get(RELEASES_URL)
            r.raise_for_status()
            data = r.json()
            remote = data["tag_name"].lstrip("v")
            notes = data.get("body", "")
    except Exception as e:
        return JSONResponse({"error": f"Could not reach GitHub: {e}"}, status_code=502)
    return JSONResponse({
        "up_to_date": local == remote,
        "local": local,
        "remote": remote,
        "notes": notes,
    })


@router.post("/update")
async def do_update(session=Depends(get_current_session)):
    async def generate():
        user = session.get("effective_user", "")
        if user:
            cmd = ["su", user, "-c", f"cd {os.path.abspath(REPO_DIR)} && git pull origin main"]
        else:
            cmd = ["git", "pull", "origin", "main"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
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
    os.kill(os.getpid(), signal.SIGINT)


# ── System hardware info ──────────────────────────────────────────────────────

@router.get("/hardware")
async def get_hardware(session=Depends(get_current_session)):
    import re, time

    def read_file(path, fallback=""):
        try: return open(path).read().strip()
        except: return fallback

    # CPU
    cpuinfo = read_file("/proc/cpuinfo")
    cpu_model = ""
    cpu_cores = 0
    cpu_mhz   = []
    for line in cpuinfo.splitlines():
        if "model name" in line and not cpu_model:
            cpu_model = line.split(":", 1)[1].strip()
        if line.startswith("processor"):
            cpu_cores += 1
        if "cpu MHz" in line:
            try: cpu_mhz.append(float(line.split(":", 1)[1].strip()))
            except: pass
    cpu_freq_avg = round(sum(cpu_mhz) / len(cpu_mhz), 0) if cpu_mhz else 0

    # Load average
    loadavg = read_file("/proc/loadavg").split()
    load = {"1": loadavg[0], "5": loadavg[1], "15": loadavg[2]} if len(loadavg) >= 3 else {}

    # Uptime
    uptime_s = float(read_file("/proc/uptime").split()[0]) if read_file("/proc/uptime") else 0
    days  = int(uptime_s // 86400)
    hours = int((uptime_s % 86400) // 3600)
    mins  = int((uptime_s % 3600) // 60)
    uptime_str = f"{days}d {hours}h {mins}m" if days else f"{hours}h {mins}m"

    # Memory
    meminfo = {}
    for line in read_file("/proc/meminfo").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            try: meminfo[k.strip()] = int(v.strip().split()[0]) * 1024
            except: pass

    # Swap
    swap_total = meminfo.get("SwapTotal", 0)
    swap_free  = meminfo.get("SwapFree", 0)
    swap_used  = swap_total - swap_free

    # Disks
    df_r = subprocess.run(["df", "-B1", "--output=source,target,fstype,size,used,avail,pcent"],
                          capture_output=True, text=True)
    disks = []
    for line in df_r.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 7: continue
        src, mount, fstype, size, used, avail, pct = parts[:7]
        if fstype in ("tmpfs", "devtmpfs", "squashfs", "overlay", "udev"): continue
        if not mount.startswith("/") or mount.startswith("/sys") or mount.startswith("/proc"): continue
        try:
            disks.append({"device": src, "mount": mount, "fstype": fstype,
                          "total": int(size), "used": int(used), "free": int(avail),
                          "pct": int(pct.replace("%", ""))})
        except: pass

    # Network interfaces
    net_devs = []
    net_raw = read_file("/proc/net/dev")
    for line in net_raw.splitlines()[2:]:
        parts = line.split()
        if len(parts) < 17: continue
        iface = parts[0].rstrip(":")
        if iface == "lo": continue
        try:
            net_devs.append({"iface": iface,
                             "rx_bytes": int(parts[1]), "rx_packets": int(parts[2]),
                             "tx_bytes": int(parts[9]), "tx_packets": int(parts[10])})
        except: pass

    # Temperatures
    temps = []
    import glob
    for zone in glob.glob("/sys/class/thermal/thermal_zone*"):
        try:
            t = int(open(f"{zone}/temp").read().strip()) / 1000
            zone_type = read_file(f"{zone}/type", "thermal")
            if t > 0: temps.append({"label": zone_type, "temp": round(t, 1)})
        except: pass
    for hwmon in glob.glob("/sys/class/hwmon/hwmon*"):
        label_base = read_file(f"{hwmon}/name", "hwmon")
        for tf in glob.glob(f"{hwmon}/temp*_input"):
            try:
                t = int(open(tf).read().strip()) / 1000
                lf = tf.replace("_input", "_label")
                label = read_file(lf, label_base)
                if t > 0: temps.append({"label": label, "temp": round(t, 1)})
            except: pass

    # Hostname / OS
    hostname = subprocess.run(["hostname"], capture_output=True, text=True).stdout.strip()
    kernel   = subprocess.run(["uname", "-r"], capture_output=True, text=True).stdout.strip()
    os_name  = read_file("/etc/os-release").splitlines()
    os_pretty = ""
    for line in os_name:
        if line.startswith("PRETTY_NAME="):
            os_pretty = line.split("=", 1)[1].strip().strip('"')
            break

    return JSONResponse({
        "cpu_model": cpu_model,
        "cpu_cores": cpu_cores,
        "cpu_freq_mhz": cpu_freq_avg,
        "load": load,
        "uptime": uptime_str,
        "hostname": hostname,
        "kernel": kernel,
        "os": os_pretty,
        "mem_total": meminfo.get("MemTotal", 0),
        "mem_available": meminfo.get("MemAvailable", 0),
        "mem_used": meminfo.get("MemTotal", 0) - meminfo.get("MemAvailable", 0),
        "swap_total": swap_total,
        "swap_used": swap_used,
        "disks": disks,
        "network": net_devs,
        "temps": temps,
    })


# ── Process & resource monitoring ─────────────────────────────────────────────

@router.get("/resources")
async def get_resources(session=Depends(get_current_session)):
    # CPU
    cpu_r = subprocess.run(["top", "-bn1"], capture_output=True, text=True)
    cpu_pct = 0.0
    for line in cpu_r.stdout.splitlines():
        if line.startswith("%Cpu") or line.startswith("Cpu"):
            # extract idle and compute usage
            import re
            idle = re.search(r'([\d.]+)\s*id', line)
            if idle:
                cpu_pct = round(100 - float(idle.group(1)), 1)
            break

    # Memory
    mem_r = subprocess.run(["free", "-b"], capture_output=True, text=True)
    mem_total = mem_used = 0
    for line in mem_r.stdout.splitlines():
        if line.startswith("Mem:"):
            parts = line.split()
            mem_total = int(parts[1])
            mem_used  = int(parts[2])
            break

    # Disk
    df_r = subprocess.run(["df", "-B1", "/"], capture_output=True, text=True)
    disk_total = disk_used = 0
    lines = df_r.stdout.splitlines()
    if len(lines) > 1:
        parts = lines[1].split()
        disk_total = int(parts[1])
        disk_used  = int(parts[2])

    return JSONResponse({
        "cpu_pct":    cpu_pct,
        "mem_total":  mem_total,
        "mem_used":   mem_used,
        "disk_total": disk_total,
        "disk_used":  disk_used,
    })


@router.get("/processes")
async def get_processes(session=Depends(get_current_session)):
    r = subprocess.run(
        ["ps", "aux", "--sort=-%cpu"],
        capture_output=True, text=True
    )
    procs = []
    for line in r.stdout.splitlines()[1:]:  # skip header
        parts = line.split(None, 10)
        if len(parts) < 11:
            continue
        try:
            procs.append({
                "user":    parts[0],
                "pid":     int(parts[1]),
                "cpu":     float(parts[2]),
                "mem":     float(parts[3]),
                "vsz":     int(parts[4]),
                "rss":     int(parts[5]),
                "stat":    parts[7],
                "command": parts[10].strip(),
            })
        except (ValueError, IndexError):
            continue
    return JSONResponse(procs[:120])  # top 120


from pydantic import BaseModel as _BM2

class KillRequest(_BM2):
    pid: int
    signal: str = "TERM"
    sudo_password: str = ""

@router.post("/processes/kill")
async def kill_process(body: KillRequest, session=Depends(get_current_session)):
    if body.signal not in ("TERM", "KILL", "HUP", "INT", "STOP", "CONT"):
        return JSONResponse({"error": "Invalid signal"}, status_code=400)
    if body.pid <= 1:
        return JSONResponse({"error": "Cannot kill PID 1"}, status_code=400)

    cmd = ["kill", f"-{body.signal}", str(body.pid)]
    if body.sudo_password:
        cmd = ["sudo", "-S"] + cmd
        proc = subprocess.run(cmd, input=body.sudo_password + "\n",
                              capture_output=True, text=True)
    else:
        proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        err = proc.stderr.strip()
        if "Permission denied" in err or "Operation not permitted" in err:
            return JSONResponse({"error": "permission_denied"}, status_code=403)
        return JSONResponse({"error": err}, status_code=500)
    return JSONResponse({"ok": True})


# ── Service management ────────────────────────────────────────────────────────

KNOWN_SERVICES = [
    {"name": "nginx",           "label": "Nginx",         "icon": "🌐"},
    {"name": "apache2",         "label": "Apache",        "icon": "🌐"},
    {"name": "mysql",           "label": "MySQL",         "icon": "🗄️"},
    {"name": "mariadb",         "label": "MariaDB",       "icon": "🗄️"},
    {"name": "postgresql",      "label": "PostgreSQL",    "icon": "🗄️"},
    {"name": "redis-server",    "label": "Redis",         "icon": "🔴"},
    {"name": "php8.3-fpm",      "label": "PHP 8.3-FPM",  "icon": "🐘"},
    {"name": "php8.2-fpm",      "label": "PHP 8.2-FPM",  "icon": "🐘"},
    {"name": "php8.1-fpm",      "label": "PHP 8.1-FPM",  "icon": "🐘"},
    {"name": "php-fpm",         "label": "PHP-FPM",      "icon": "🐘"},
    {"name": "nodejs",          "label": "Node.js",       "icon": "💚"},
    {"name": "docker",          "label": "Docker",        "icon": "🐳"},
    {"name": "ssh",             "label": "SSH",           "icon": "🔑"},
    {"name": "ufw",             "label": "UFW Firewall",  "icon": "🛡️"},
    {"name": "cron",            "label": "Cron",          "icon": "⏰"},
    {"name": "fail2ban",        "label": "Fail2ban",      "icon": "🔒"},
    {"name": "memcached",       "label": "Memcached",     "icon": "⚡"},
    {"name": "mongodb",         "label": "MongoDB",       "icon": "🍃"},
    {"name": "elasticsearch",   "label": "Elasticsearch", "icon": "🔍"},
    {"name": "rabbitmq-server", "label": "RabbitMQ",      "icon": "🐇"},
]


def _service_exists(name: str) -> bool:
    r = subprocess.run(["systemctl", "list-unit-files", f"{name}.service"],
                       capture_output=True, text=True)
    return name in r.stdout


def _service_status(name: str) -> str:
    r = subprocess.run(["systemctl", "is-active", name],
                       capture_output=True, text=True)
    return r.stdout.strip()


def _service_enabled(name: str) -> bool:
    r = subprocess.run(["systemctl", "is-enabled", name],
                       capture_output=True, text=True)
    return r.stdout.strip() == "enabled"


@router.get("/services")
async def list_services(session=Depends(get_current_session)):
    result = []
    for svc in KNOWN_SERVICES:
        if not _service_exists(svc["name"]):
            continue  # not installed
        status = _service_status(svc["name"])
        result.append({
            **svc,
            "status": status,
            "enabled": _service_enabled(svc["name"]),
        })
    return JSONResponse(result)


class ServiceAction(BaseModel if False else object):
    pass


from pydantic import BaseModel as _BM

class ServiceRequest(_BM):
    name: str
    action: str   # start | stop | restart | enable | disable
    sudo_password: str = ""


@router.post("/services/action")
async def service_action(body: ServiceRequest, session=Depends(get_current_session)):
    if body.action not in ("start", "stop", "restart", "enable", "disable"):
        return JSONResponse({"error": "Invalid action"}, status_code=400)

    # whitelist service names
    allowed = {s["name"] for s in KNOWN_SERVICES}
    if body.name not in allowed:
        return JSONResponse({"error": "Unknown service"}, status_code=400)

    cmd = ["systemctl", body.action, body.name]

    # if sudo password provided, wrap with sudo -S
    if body.sudo_password:
        cmd = ["sudo", "-S"] + cmd
        proc = subprocess.run(
            cmd,
            input=body.sudo_password + "\n",
            capture_output=True, text=True,
        )
    else:
        proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        # detect permission error
        if "Permission denied" in err or "Interactive" in err or "password" in err.lower():
            return JSONResponse({"error": "permission_denied", "detail": err}, status_code=403)
        return JSONResponse({"error": err}, status_code=500)

    status = _service_status(body.name)
    return JSONResponse({"ok": True, "status": status})
