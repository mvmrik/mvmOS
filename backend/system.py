import asyncio
import os
import subprocess
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
from .auth import get_current_session, require_root_session

router = APIRouter(prefix="/api/system", tags=["system"])


def _as_user(user: str, cmd: list) -> list:
    """Wrap a command so it runs as `user` (the session's effective_user).

    uvicorn runs as root, so runuser drops to the target user. For a root
    session this is a no-op (still root); for a non-root session privileged
    commands then fail with permission denied, and the caller's sudo_password
    path can escalate — same model as the core terminal."""
    if os.geteuid() != 0:
        return ["sudo", "runuser", "-u", user, "--"] + cmd
    return ["runuser", "-u", user, "--"] + cmd

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
        import tempfile, tarfile, shutil, httpx
        repo_dir = os.path.abspath(REPO_DIR)
        tarball_url = "https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz"

        yield "data: Downloading update…\n\n"
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                r = await client.get(tarball_url)
                r.raise_for_status()
                tar_bytes = r.content
        except Exception as e:
            yield f"data: Download failed: {e}\n\n"
            yield "data: __EXIT_1__\n\n"
            return

        yield "data: Extracting…\n\n"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tar_path = os.path.join(tmp, "update.tar.gz")
                with open(tar_path, "wb") as f:
                    f.write(tar_bytes)
                with tarfile.open(tar_path, "r:gz") as tar:
                    tar.extractall(tmp)
                # extracted folder is mvmOS-main/
                extracted = next(
                    os.path.join(tmp, d) for d in os.listdir(tmp)
                    if os.path.isdir(os.path.join(tmp, d)) and d != "__MACOSX"
                )
                # backup database
                db_path = os.path.join(repo_dir, "backend", "mvmos.db")
                db_bak = os.path.join(tmp, "mvmos.db.bak")
                if os.path.exists(db_path):
                    shutil.copy2(db_path, db_bak)

                # overwrite everything except venv, .git, and installed app backends
                SKIP = {".git", "venv"}
                BACKEND_SKIP = {"apps"}
                for item in os.listdir(extracted):
                    if item in SKIP:
                        continue
                    src = os.path.join(extracted, item)
                    dst = os.path.join(repo_dir, item)
                    if os.path.isdir(src):
                        if item == "backend":
                            # merge backend/ file by file, skip apps/ subdir
                            os.makedirs(dst, exist_ok=True)
                            for sub in os.listdir(src):
                                if sub in BACKEND_SKIP:
                                    continue
                                s = os.path.join(src, sub)
                                d = os.path.join(dst, sub)
                                if os.path.isdir(s):
                                    if os.path.exists(d):
                                        shutil.rmtree(d)
                                    shutil.copytree(s, d)
                                else:
                                    shutil.copy2(s, d)
                        else:
                            if os.path.exists(dst):
                                shutil.rmtree(dst)
                            shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)

                # restore database
                if os.path.exists(db_bak):
                    shutil.copy2(db_bak, db_path)
        except Exception as e:
            yield f"data: Extract failed: {e}\n\n"
            yield "data: __EXIT_1__\n\n"
            return

        yield "data: Update applied.\n\n"
        yield "data: __RESTARTING__\n\n"
        asyncio.get_event_loop().call_later(1, _restart)

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _restart():
    import sys, signal
    os.kill(os.getpid(), signal.SIGINT)


@router.post("/power/restart")
async def power_restart(bg: BackgroundTasks, session=Depends(require_root_session)):
    bg.add_task(_restart)
    return JSONResponse({"ok": True})




@router.post("/power/stop")
async def power_stop(bg: BackgroundTasks, session=Depends(require_root_session)):
    bg.add_task(_restart)
    return JSONResponse({"ok": True})


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
    # CPU — read /proc/stat twice with 200ms interval for accurate usage
    import re
    def _read_cpu_stat():
        with open('/proc/stat') as f:
            line = f.readline()
        vals = list(map(int, line.split()[1:]))
        idle = vals[3]
        total = sum(vals)
        return idle, total
    idle1, total1 = _read_cpu_stat()
    await asyncio.sleep(0.2)
    idle2, total2 = _read_cpu_stat()
    diff_total = total2 - total1
    diff_idle  = idle2  - idle1
    cpu_pct = round((1 - diff_idle / diff_total) * 100, 1) if diff_total else 0.0

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
        # run as the logged-in user — non-root can only signal their own processes
        proc = subprocess.run(_as_user(session["effective_user"], cmd),
                              capture_output=True, text=True)

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
        # run as the logged-in user — non-root falls through to permission_denied,
        # and the UI re-tries with sudo_password
        proc = subprocess.run(_as_user(session["effective_user"], cmd),
                              capture_output=True, text=True)

    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        # detect permission error
        if "Permission denied" in err or "Interactive" in err or "password" in err.lower():
            return JSONResponse({"error": "permission_denied", "detail": err}, status_code=403)
        return JSONResponse({"error": err}, status_code=500)

    status = _service_status(body.name)
    return JSONResponse({"ok": True, "status": status})


# ── PHP ini config ─────────────────────────────────────────────────────────────

PHP_INI_KEYS = [
    "memory_limit", "max_execution_time", "max_input_time", "max_input_vars",
    "upload_max_filesize", "post_max_size", "file_uploads",
    "display_errors", "error_reporting",
    "default_charset", "date.timezone",
    "session.gc_maxlifetime", "opcache.enable",
]

def _find_php_ini() -> str | None:
    """Find the active FPM php.ini path."""
    for pattern in ["/etc/php/*/fpm/php.ini"]:
        import glob
        matches = sorted(glob.glob(pattern), reverse=True)
        if matches:
            return matches[0]
    return None

def _read_php_ini(path: str) -> dict:
    values = {}
    with open(path, "r") as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith(";") or "=" not in stripped:
                continue
            key, _, val = stripped.partition("=")
            key = key.strip()
            if key in PHP_INI_KEYS:
                values[key] = val.strip()
    return values

def _write_php_ini_key(path: str, key: str, value: str, sudo_password: str = "") -> bool:
    import re, tempfile, shutil
    with open(path, "r") as f:
        content = f.read()
    # replace existing key (commented or not)
    pattern = re.compile(r"^[;\s]*" + re.escape(key) + r"\s*=.*$", re.MULTILINE)
    replacement = f"{key} = {value}"
    if pattern.search(content):
        new_content = pattern.sub(replacement, content, count=1)
    else:
        new_content = content + f"\n{replacement}\n"

    with tempfile.NamedTemporaryFile("w", suffix=".ini", delete=False) as tmp:
        tmp.write(new_content)
        tmp_path = tmp.name

    if sudo_password:
        proc = subprocess.run(
            ["sudo", "-S", "cp", tmp_path, path],
            input=sudo_password + "\n", capture_output=True, text=True
        )
    else:
        try:
            shutil.copy(tmp_path, path)
            proc = type("P", (), {"returncode": 0})()
        except PermissionError:
            proc = type("P", (), {"returncode": 1, "stderr": "Permission denied"})()
    os.unlink(tmp_path)
    return proc.returncode == 0


@router.get("/php-ini")
async def get_php_ini(session=Depends(get_current_session)):
    path = _find_php_ini()
    if not path:
        raise HTTPException(status_code=404, detail="php.ini not found")
    try:
        values = _read_php_ini(path)
        return JSONResponse({"path": path, "values": values})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class PhpIniSaveRequest(BaseModel):
    values: dict
    sudo_password: str = ""

@router.post("/php-ini")
async def save_php_ini(body: PhpIniSaveRequest, session=Depends(get_current_session)):
    path = _find_php_ini()
    if not path:
        raise HTTPException(status_code=404, detail="php.ini not found")
    for key, value in body.values.items():
        if key not in PHP_INI_KEYS:
            continue
        ok = _write_php_ini_key(path, key, str(value), body.sudo_password)
        if not ok:
            return JSONResponse({"error": "permission_denied"}, status_code=403)
    return JSONResponse({"ok": True, "path": path})


# ── MySQL config ───────────────────────────────────────────────────────────────

MYSQL_CNF_KEYS = [
    "max_connections", "bind-address", "max_allowed_packet",
    "innodb_buffer_pool_size", "key_buffer_size", "tmp_table_size",
    "innodb_flush_log_at_trx_commit", "slow_query_log", "long_query_time",
    "character-set-server", "collation-server",
]

def _find_mysql_cnf() -> str | None:
    for path in ["/etc/mysql/mysql.conf.d/mysqld.cnf", "/etc/mysql/my.cnf"]:
        if os.path.exists(path):
            return path
    return None

def _read_mysql_cnf(path: str) -> dict:
    values = {}
    in_mysqld = False
    with open(path, "r") as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith("["):
                in_mysqld = stripped == "[mysqld]"
                continue
            if not in_mysqld:
                continue
            if stripped.startswith("#") or "=" not in stripped and "\t" not in stripped:
                continue
            # support both = and \t as separator
            if "=" in stripped:
                key, _, val = stripped.partition("=")
            else:
                parts = stripped.split()
                key, val = parts[0], parts[1] if len(parts) > 1 else ""
            key = key.strip()
            if key in MYSQL_CNF_KEYS:
                values[key] = val.strip()
    return values

def _write_mysql_cnf_key(path: str, key: str, value: str, sudo_password: str = "") -> bool:
    import re, tempfile
    with open(path, "r") as f:
        content = f.read()
    pattern = re.compile(r"^[#\s]*" + re.escape(key) + r"[\s\t]*[=\t].*$", re.MULTILINE)
    replacement = f"{key}\t\t= {value}"
    if pattern.search(content):
        new_content = pattern.sub(replacement, content, count=1)
    else:
        # add under [mysqld] section
        new_content = re.sub(r"(\[mysqld\])", r"\1\n" + replacement, content, count=1)

    with tempfile.NamedTemporaryFile("w", suffix=".cnf", delete=False) as tmp:
        tmp.write(new_content)
        tmp_path = tmp.name

    if sudo_password:
        proc = subprocess.run(
            ["sudo", "-S", "cp", tmp_path, path],
            input=sudo_password + "\n", capture_output=True, text=True
        )
    else:
        try:
            import shutil
            shutil.copy(tmp_path, path)
            proc = type("P", (), {"returncode": 0})()
        except PermissionError:
            proc = type("P", (), {"returncode": 1})()
    os.unlink(tmp_path)
    return proc.returncode == 0


@router.get("/mysql-cnf")
async def get_mysql_cnf(session=Depends(get_current_session)):
    path = _find_mysql_cnf()
    if not path:
        raise HTTPException(status_code=404, detail="MySQL config not found")
    try:
        values = _read_mysql_cnf(path)
        return JSONResponse({"path": path, "values": values})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class MysqlCnfSaveRequest(BaseModel):
    values: dict
    sudo_password: str = ""

@router.post("/mysql-cnf")
async def save_mysql_cnf(body: MysqlCnfSaveRequest, session=Depends(get_current_session)):
    path = _find_mysql_cnf()
    if not path:
        raise HTTPException(status_code=404, detail="MySQL config not found")
    for key, value in body.values.items():
        if key not in MYSQL_CNF_KEYS:
            continue
        ok = _write_mysql_cnf_key(path, key, str(value), body.sudo_password)
        if not ok:
            return JSONResponse({"error": "permission_denied"}, status_code=403)
    return JSONResponse({"ok": True, "path": path})


# ── Nginx config ───────────────────────────────────────────────────────────────

NGINX_KEYS = [
    "worker_processes", "worker_connections", "keepalive_timeout",
    "client_max_body_size", "gzip", "gzip_comp_level",
    "sendfile", "tcp_nopush", "access_log", "error_log",
]

NGINX_CONF_PATH = "/etc/nginx/nginx.conf"

def _read_nginx_conf(path: str) -> dict:
    import re
    values = {}
    with open(path, "r") as f:
        content = f.read()
    for key in NGINX_KEYS:
        m = re.search(r'^\s*' + re.escape(key) + r'\s+([^;]+);', content, re.MULTILINE)
        if m:
            values[key] = m.group(1).strip()
    return values

def _write_nginx_conf_key(path: str, key: str, value: str, sudo_password: str = "") -> bool:
    import re, tempfile, shutil
    with open(path, "r") as f:
        content = f.read()
    pattern = re.compile(r'^(\s*)' + re.escape(key) + r'\s+[^;]+;', re.MULTILINE)
    replacement = lambda m: f"{m.group(1)}{key} {value};"
    if pattern.search(content):
        new_content = pattern.sub(replacement, content, count=1)
    else:
        new_content = content

    with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as tmp:
        tmp.write(new_content)
        tmp_path = tmp.name

    if sudo_password:
        proc = subprocess.run(
            ["sudo", "-S", "cp", tmp_path, path],
            input=sudo_password + "\n", capture_output=True, text=True
        )
    else:
        try:
            shutil.copy(tmp_path, path)
            proc = type("P", (), {"returncode": 0})()
        except PermissionError:
            proc = type("P", (), {"returncode": 1})()
    os.unlink(tmp_path)
    return proc.returncode == 0


@router.get("/nginx-conf")
async def get_nginx_conf(session=Depends(get_current_session)):
    if not os.path.exists(NGINX_CONF_PATH):
        raise HTTPException(status_code=404, detail="nginx.conf not found")
    try:
        values = _read_nginx_conf(NGINX_CONF_PATH)
        return JSONResponse({"path": NGINX_CONF_PATH, "values": values})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class NginxConfSaveRequest(BaseModel):
    values: dict
    sudo_password: str = ""

@router.post("/nginx-conf")
async def save_nginx_conf(body: NginxConfSaveRequest, session=Depends(get_current_session)):
    if not os.path.exists(NGINX_CONF_PATH):
        raise HTTPException(status_code=404, detail="nginx.conf not found")
    for key, value in body.values.items():
        if key not in NGINX_KEYS:
            continue
        ok = _write_nginx_conf_key(NGINX_CONF_PATH, key, str(value), body.sudo_password)
        if not ok:
            return JSONResponse({"error": "permission_denied"}, status_code=403)
    return JSONResponse({"ok": True, "path": NGINX_CONF_PATH})


@router.post("/nginx-test")
async def nginx_test(session=Depends(get_current_session)):
    proc = subprocess.run(["sudo", "nginx", "-t"], capture_output=True, text=True)
    ok = proc.returncode == 0
    output = (proc.stderr or proc.stdout).strip()
    return JSONResponse({"ok": ok, "output": output})


# ── SSH ──────────────────────────────────────────────────────────────────────

SSH_KEYS = [
    "Port", "PermitRootLogin", "PasswordAuthentication",
    "PubkeyAuthentication", "MaxAuthTries", "LoginGraceTime",
    "AllowUsers", "AllowGroups", "X11Forwarding", "UsePAM",
]

SSH_CONF_PATH = "/etc/ssh/sshd_config"

def _read_sshd_conf(path: str) -> dict:
    import re
    values = {}
    with open(path, "r") as f:
        content = f.read()
    for key in SSH_KEYS:
        m = re.search(r'^\s*#?\s*' + re.escape(key) + r'\s+(.+)', content, re.MULTILINE | re.IGNORECASE)
        if m:
            values[key] = m.group(1).strip()
    return values

def _write_sshd_conf_key(path: str, key: str, value: str) -> bool:
    import re, tempfile, shutil
    with open(path, "r") as f:
        lines = f.readlines()

    pattern = re.compile(r'^\s*#?\s*' + re.escape(key) + r'\s+', re.IGNORECASE)
    replaced = False
    new_lines = []
    for line in lines:
        if pattern.match(line) and not replaced:
            new_lines.append(f"{key} {value}\n")
            replaced = True
        else:
            new_lines.append(line)
    if not replaced:
        new_lines.append(f"{key} {value}\n")

    with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as tmp:
        tmp.writelines(new_lines)
        tmp_path = tmp.name

    try:
        proc = subprocess.run(["sudo", "cp", tmp_path, path], capture_output=True, text=True)
    except Exception:
        proc = type("P", (), {"returncode": 1})()
    os.unlink(tmp_path)
    return proc.returncode == 0


@router.get("/sshd-conf")
async def get_sshd_conf(session=Depends(get_current_session)):
    if not os.path.exists(SSH_CONF_PATH):
        raise HTTPException(status_code=404, detail="sshd_config not found")
    try:
        values = _read_sshd_conf(SSH_CONF_PATH)
        return JSONResponse({"path": SSH_CONF_PATH, "values": values})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SshdConfSaveRequest(BaseModel):
    values: dict

@router.post("/sshd-conf")
async def save_sshd_conf(body: SshdConfSaveRequest, session=Depends(get_current_session)):
    if not os.path.exists(SSH_CONF_PATH):
        raise HTTPException(status_code=404, detail="sshd_config not found")
    for key, value in body.values.items():
        if key not in SSH_KEYS:
            continue
        ok = _write_sshd_conf_key(SSH_CONF_PATH, key, str(value))
        if not ok:
            return JSONResponse({"error": "permission_denied"}, status_code=403)
    return JSONResponse({"ok": True, "path": SSH_CONF_PATH})


@router.post("/sshd-test")
async def sshd_test(session=Depends(get_current_session)):
    proc = subprocess.run(["sudo", "sshd", "-t"], capture_output=True, text=True)
    ok = proc.returncode == 0
    output = (proc.stderr or proc.stdout).strip()
    return JSONResponse({"ok": ok, "output": output})


# ── UFW ──────────────────────────────────────────────────────────────────────

@router.get("/ufw-status")
async def ufw_status(session=Depends(get_current_session)):
    import re
    proc = subprocess.run(["sudo", "ufw", "status", "numbered"], capture_output=True, text=True)
    output = proc.stdout.strip()
    enabled = "Status: active" in output
    rules = []
    if enabled:
        for line in output.splitlines():
            m = re.match(r'^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$', line)
            if m:
                rules.append({"num": int(m.group(1)), "to": m.group(2).strip(), "action": m.group(3).strip(), "from": m.group(4).strip()})
    else:
        # show pending rules even when inactive
        added = subprocess.run(["sudo", "ufw", "show", "added"], capture_output=True, text=True)
        for i, line in enumerate(added.stdout.splitlines(), 1):
            m = re.match(r'^ufw\s+(\S+)\s+(.+)$', line.strip())
            if m:
                rules.append({"num": i, "to": m.group(2).strip(), "action": m.group(1).upper(), "from": "Anywhere"})
    return JSONResponse({"enabled": enabled, "rules": rules})


@router.post("/ufw-toggle")
async def ufw_toggle(session=Depends(get_current_session)):
    proc = subprocess.run(["sudo", "ufw", "status"], capture_output=True, text=True)
    enabled = "Status: active" in proc.stdout
    cmd = ["sudo", "ufw", "disable"] if enabled else ["sudo", "ufw", "--force", "enable"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return JSONResponse({"error": r.stderr.strip()}, status_code=500)
    return JSONResponse({"enabled": not enabled})


class UfwRuleRequest(BaseModel):
    rule: str  # e.g. "22/tcp", "80", "from 192.168.1.0/24 to any port 22"

@router.post("/ufw-allow")
async def ufw_allow(body: UfwRuleRequest, session=Depends(get_current_session)):
    r = subprocess.run(["sudo", "ufw", "allow"] + body.rule.split(), capture_output=True, text=True)
    if r.returncode != 0:
        return JSONResponse({"error": r.stderr.strip() or r.stdout.strip()}, status_code=500)
    return JSONResponse({"ok": True})


class UfwDeleteRequest(BaseModel):
    num: int = 0
    rule: str = ""  # used when UFW is inactive

@router.post("/ufw-delete")
async def ufw_delete(body: UfwDeleteRequest, session=Depends(get_current_session)):
    proc = subprocess.run(["sudo", "ufw", "status"], capture_output=True, text=True)
    enabled = "Status: active" in proc.stdout
    if enabled and body.num:
        r = subprocess.run(["sudo", "ufw", "--force", "delete", str(body.num)], capture_output=True, text=True)
    elif body.rule:
        r = subprocess.run(["sudo", "ufw", "--force", "delete", "allow"] + body.rule.split(), capture_output=True, text=True)
    else:
        return JSONResponse({"error": "no rule specified"}, status_code=400)
    if r.returncode != 0:
        return JSONResponse({"error": r.stderr.strip() or r.stdout.strip()}, status_code=500)
    return JSONResponse({"ok": True})
