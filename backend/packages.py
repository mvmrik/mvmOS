import asyncio
import subprocess
import re
import time
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from .auth import get_current_session

router = APIRouter(prefix="/api/packages", tags=["packages"])

# ── Package index cache ────────────────────────────────────────────────────
_pkg_cache: list = []
_pkg_cache_time: float = 0
_CACHE_TTL = 300  # 5 minutes

SECTION_LABELS = {
    "admin":      ("🔧", "Administration"),
    "net":        ("🌐", "Networking"),
    "utils":      ("🛠️", "Utilities"),
    "devel":      ("💻", "Development"),
    "python":     ("🐍", "Python"),
    "web":        ("🌍", "Web"),
    "games":      ("🎮", "Games"),
    "editors":    ("📝", "Editors"),
    "graphics":   ("🖼️", "Graphics"),
    "sound":      ("🎵", "Sound"),
    "video":      ("🎬", "Video"),
    "science":    ("🔬", "Science"),
    "math":       ("📐", "Mathematics"),
    "text":       ("📄", "Text"),
    "x11":        ("🖥️", "Desktop"),
    "libs":       ("📦", "Libraries"),
    "doc":        ("📚", "Documentation"),
    "misc":       ("🗂️", "Miscellaneous"),
    "shells":      ("🐚", "Shells"),
    "database":    ("🗄️", "Database"),
    "mail":        ("📧", "Mail"),
    "news":        ("📰", "News"),
    "security":    ("🔒", "Security"),
    "localization":("🌏", "Localization"),
    "kernel":      ("⚙️", "Kernel"),
    "libdevel":    ("🔩", "Lib Dev"),
    "java":        ("☕", "Java"),
    "ruby":        ("💎", "Ruby"),
    "perl":        ("🐪", "Perl"),
    "php":         ("🐘", "PHP"),
    "fonts":       ("🔤", "Fonts"),
    "electronics": ("⚡", "Electronics"),
    "gnome":       ("🖥️", "GNOME"),
    "kde":         ("🖥️", "KDE"),
    "cli-mono":    ("📟", "CLI"),
    "oldlibs":     ("📦", "Old Libs"),
    "debug":       ("🐛", "Debug"),
    "virtual":     ("🔲", "Virtual"),
    "introspection":("🔍", "Introspection"),
}


def _build_cache() -> list:
    global _pkg_cache, _pkg_cache_time
    r = subprocess.run(
        ["apt-cache", "dumpavail"],
        capture_output=True, text=True
    )
    pkgs = []
    cur: dict = {}
    for line in r.stdout.splitlines():
        if line == "":
            if cur.get("name"):
                pkgs.append(cur)
            cur = {}
        elif line.startswith("Package: "):
            cur["name"] = line[9:].strip()
        elif line.startswith("Section: "):
            raw = line[9:].strip()
            cur["section"] = raw.split("/")[-1]  # strip optional "non-free/" prefix
        elif line.startswith("Description: ") or line.startswith("Description-en: "):
            cur["description"] = line.split(": ", 1)[1].strip()
        elif line.startswith("Version: "):
            cur["version"] = line[9:].strip()
    _pkg_cache = pkgs
    _pkg_cache_time = time.time()
    return pkgs


def get_cache() -> list:
    if not _pkg_cache or time.time() - _pkg_cache_time > _CACHE_TTL:
        _build_cache()
    return _pkg_cache


@router.get("/categories")
async def categories(session=Depends(get_current_session)):
    pkgs = get_cache()
    counts: dict[str, int] = {}
    for p in pkgs:
        s = p.get("section", "misc") or "misc"
        counts[s] = counts.get(s, 0) + 1

    result = []
    for sec, count in sorted(counts.items(), key=lambda x: -x[1]):
        label_info = SECTION_LABELS.get(sec, ("📦", sec.capitalize()))
        result.append({
            "section": sec,
            "icon": label_info[0],
            "label": label_info[1],
            "count": count,
        })
    return JSONResponse(result)


@router.get("/by-category")
async def by_category(
    section: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(40, le=100),
    q: str = Query(""),
    session=Depends(get_current_session),
):
    pkgs = get_cache()

    # get installed set
    ri = subprocess.run(["dpkg", "-l"], capture_output=True, text=True)
    installed_set = set()
    for line in ri.stdout.splitlines():
        p = _parse_dpkg(line)
        if p:
            installed_set.add(p["name"])

    filtered = [
        p for p in pkgs
        if (not section or p.get("section", "misc") == section)
        and (not q or q.lower() in p["name"].lower() or q.lower() in p.get("description", "").lower())
    ]

    total = len(filtered)
    start = (page - 1) * limit
    page_pkgs = filtered[start:start + limit]

    result = [
        {**p, "installed": p["name"] in installed_set}
        for p in page_pkgs
    ]
    return JSONResponse({"total": total, "page": page, "limit": limit, "pkgs": result})


def _parse_dpkg(line: str):
    # ii  package  version  arch  description
    m = re.match(r'^ii\s+(\S+?)(?::\S+)?\s+(\S+)\s+\S+\s+(.*)', line)
    if m:
        return {"name": m.group(1), "version": m.group(2), "description": m.group(3).strip()}
    return None


@router.get("/installed")
async def installed(session=Depends(get_current_session)):
    r = subprocess.run(["dpkg", "-l"], capture_output=True, text=True)
    pkgs = []
    for line in r.stdout.splitlines():
        p = _parse_dpkg(line)
        if p:
            pkgs.append(p)
    return JSONResponse(pkgs)


@router.get("/search")
async def search(q: str = Query(""), session=Depends(get_current_session)):
    if not q.strip():
        return JSONResponse([])
    r = subprocess.run(
        ["apt-cache", "search", "--names-only", q],
        capture_output=True, text=True
    )
    # also get full search if names-only gives too few results
    r2 = subprocess.run(
        ["apt-cache", "search", q],
        capture_output=True, text=True
    )

    # get installed set
    ri = subprocess.run(["dpkg", "-l"], capture_output=True, text=True)
    installed_set = set()
    for line in ri.stdout.splitlines():
        p = _parse_dpkg(line)
        if p:
            installed_set.add(p["name"])

    seen = set()
    pkgs = []
    for line in r2.stdout.splitlines():
        m = re.match(r'^(\S+) - (.+)', line)
        if m:
            name = m.group(1)
            if name not in seen:
                seen.add(name)
                pkgs.append({
                    "name": name,
                    "description": m.group(2),
                    "installed": name in installed_set,
                })

    # enrich with section for first 80 results
    result = pkgs[:80]
    names = [p["name"] for p in result]
    if names:
        r3 = subprocess.run(["apt-cache", "show", "--no-all-versions"] + names,
                            capture_output=True, text=True)
        sections = {}
        cur = None
        for line in r3.stdout.splitlines():
            if line.startswith("Package: "):
                cur = line.split(": ", 1)[1].strip()
            elif line.startswith("Section: ") and cur:
                sections[cur] = line.split(": ", 1)[1].strip()
        for p in result:
            p["section"] = sections.get(p["name"], "")

    return JSONResponse(result)


@router.get("/info")
async def pkg_info(name: str = Query(""), session=Depends(get_current_session)):
    if not re.match(r'^[a-z0-9][a-z0-9.+\-]+$', name):
        return JSONResponse({"error": "Invalid"}, status_code=400)
    r = subprocess.run(["apt-cache", "show", name], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout:
        return JSONResponse({})
    info = {}
    desc_lines = []
    in_desc = False
    for line in r.stdout.splitlines():
        if in_desc:
            if line.startswith(' '):
                desc_lines.append(line.strip())
                continue
            else:
                in_desc = False
        if ': ' in line:
            key, _, val = line.partition(': ')
            key = key.strip()
            if key == 'Description':
                info['description_short'] = val.strip()
                in_desc = True
            elif key in ('Section', 'Installed-Size', 'Homepage', 'Maintainer', 'Version', 'Size'):
                info[key.lower().replace('-', '_')] = val.strip()
    info['description_long'] = '\n'.join(desc_lines)
    return JSONResponse(info)


class PkgRequest(BaseModel):
    name: str


async def _stream_apt(cmd: list):
    async def generate():
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={"DEBIAN_FRONTEND": "noninteractive", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
        )
        async for line in proc.stdout:
            yield f"data: {line.decode(errors='replace').rstrip()}\n\n"
        await proc.wait()
        code = proc.returncode
        yield f"data: __EXIT_{code}__\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_SYSTEM_SECTIONS = {'libs', 'libdevel', 'oldlibs', 'kernel', 'debug', 'introspection', 'virtual', 'fonts', 'localization', 'doc'}
_SYSTEM_PREFIXES = ('lib', 'linux-', 'firmware-', 'initramfs', 'grub', 'udev', 'systemd', 'dbus', 'gir1')

def _is_app_pkg(name: str, section: str) -> bool:
    if section in _SYSTEM_SECTIONS:
        return False
    for prefix in _SYSTEM_PREFIXES:
        if name.startswith(prefix):
            return False
    return True


@router.get("/upgradable")
async def upgradable(session=Depends(get_current_session)):
    proc_update = await asyncio.create_subprocess_exec(
        "apt-get", "update", "-qq",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc_update.wait()

    proc = await asyncio.create_subprocess_exec(
        "apt", "list", "--upgradable",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()

    pkgs = []
    for line in stdout.decode(errors="replace").splitlines():
        m = re.match(r'^([^/]+)/\S+\s+(\S+)\s+\S+\s+\[upgradable from: (\S+)\]', line)
        if not m:
            continue
        name, new_ver, cur_ver = m.group(1), m.group(2), m.group(3)
        proc2 = await asyncio.create_subprocess_exec(
            "apt-cache", "show", "--no-all-versions", name,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out2, _ = await proc2.communicate()
        section = ""
        description = ""
        for l in out2.decode(errors="replace").splitlines():
            if l.startswith("Section: "):
                section = l.split(": ", 1)[1].strip().split("/")[-1]
            if l.startswith("Description: ") or l.startswith("Description-en: "):
                description = l.split(": ", 1)[1].strip()
        pkgs.append({
            "name": name,
            "current_version": cur_ver,
            "new_version": new_ver,
            "section": section,
            "description": description,
            "is_app": _is_app_pkg(name, section),
        })
    return JSONResponse(pkgs)


@router.post("/upgrade")
async def upgrade(body: PkgRequest, session=Depends(get_current_session)):
    if not re.match(r'^[a-z0-9][a-z0-9.+\-]+$', body.name):
        return JSONResponse({"error": "Invalid package name"}, status_code=400)
    return await _stream_apt(["apt-get", "install", "-y", "--only-upgrade", body.name])


@router.post("/install")
async def install(body: PkgRequest, session=Depends(get_current_session)):
    if not re.match(r'^[a-z0-9][a-z0-9.+\-]+$', body.name):
        return JSONResponse({"error": "Invalid package name"}, status_code=400)
    return await _stream_apt(["apt-get", "install", "-y", body.name])


@router.post("/remove")
async def remove(body: PkgRequest, session=Depends(get_current_session)):
    if not re.match(r'^[a-z0-9][a-z0-9.+\-]+$', body.name):
        return JSONResponse({"error": "Invalid package name"}, status_code=400)
    return await _stream_apt(["apt-get", "remove", "-y", body.name])
