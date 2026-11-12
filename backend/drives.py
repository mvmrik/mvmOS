"""Extra and external disks for File Manager.

Lists the disks and partitions the system itself does not run from, and lets an
administrator mount and unmount them. Everyone signed in can see the list and
open a mounted disk; the Linux permissions of their own account still decide
what they can read inside it. A disk is mounted once by default and stays
mounted until it is unmounted or the server restarts. An administrator can also
ask for it to be mounted at every start: that adds one marked line to
/etc/fstab (by UUID, with nofail so a missing disk never stops the boot), and
the same line is removed again when the administrator turns it off.
"""
import json
import os
import pwd
import re
import shutil
import subprocess
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_session, require_admin

router = APIRouter(prefix="/api/files/drives", tags=["drives"])

MOUNT_ROOT = "/media/mvmos"
# Filesystems a person normally keeps files on. Swap, RAID, LVM and encrypted
# volumes are not file storage and are never offered.
FS_OK = {"ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "iso9660", "udf", "hfsplus"}
FS_UID = {"vfat", "exfat", "ntfs", "ntfs3", "hfsplus"}  # no Unix owners on disk: set at mount time
FSTAB = "/etc/fstab"
MARK = "# mvmos:"
SYSTEM_MOUNTS = ("/", "/boot", "/boot/efi", "/home", "/usr", "/var", "/opt", "/etc", "/srv", "/tmp", "/root")


def _lsblk() -> list:
    r = subprocess.run(
        ["lsblk", "-J", "-b", "-l", "-o", "NAME,PATH,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINTS,RM,HOTPLUG,TRAN,PKNAME,MODEL,RO,SERIAL,ROTA,VENDOR"],
        capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        return []
    try:
        return json.loads(r.stdout).get("blockdevices", [])
    except ValueError:
        return []


def _root_disks(devs: list) -> set:
    """Names of the disks the system runs from: whatever holds /, /boot or another
    system folder, followed down through LVM, RAID and partitions to the disk."""
    by_name = {d["name"]: d for d in devs}
    system = set()
    for d in devs:
        mps = [m for m in (d.get("mountpoints") or []) if m]
        if any(m in SYSTEM_MOUNTS or m.startswith(("/boot/", "/snap/")) for m in mps) or "[SWAP]" in mps:
            n = d["name"]
            while n and n not in system:
                system.add(n)
                n = (by_name.get(n) or {}).get("pkname")
    # A device that holds a system volume (LVM, RAID) is listed with that volume's
    # parents already; the disk itself is the last parent in the chain.
    return system


def _usage(path: str) -> dict:
    try:
        st = os.statvfs(path)
    except OSError:
        return {}
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    return {"total": total, "free": free, "used": max(total - st.f_bfree * st.f_frsize, 0)}


def _top(d: dict, devs: list) -> dict:
    """The physical disk a partition or volume lives on."""
    by_name = {x["name"]: x for x in devs}
    seen = set()
    while d.get("pkname") and d["name"] not in seen and d["pkname"] in by_name:
        seen.add(d["name"])
        d = by_name[d["pkname"]]
    return d


def _fstab_lines() -> list:
    try:
        with open(FSTAB, encoding="utf-8") as f:
            return f.read().splitlines()
    except OSError:
        return []


def _fstab_entry(uuid: str):
    """(mountpoint, managed) of the fstab line for this UUID, or None."""
    if not uuid:
        return None
    lines = _fstab_lines()
    for i, line in enumerate(lines):
        parts = line.split()
        if len(parts) >= 2 and not line.lstrip().startswith("#") and parts[0] in (f"UUID={uuid}", f"/dev/disk/by-uuid/{uuid}"):
            return parts[1], i > 0 and lines[i - 1].strip() == MARK + uuid
    return None


def _fstab_write(lines: list):
    mode = os.stat(FSTAB).st_mode & 0o777 if os.path.exists(FSTAB) else 0o644
    bak = FSTAB + ".mvmos.bak"
    if os.path.exists(FSTAB) and not os.path.exists(bak):
        with open(FSTAB, encoding="utf-8") as src, open(bak, "w", encoding="utf-8") as dst:
            dst.write(src.read())
    tmp = FSTAB + ".mvmos.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip("\n") + "\n")
    os.chmod(tmp, mode)
    os.replace(tmp, FSTAB)
    subprocess.run(["systemctl", "daemon-reload"], capture_output=True, timeout=30)


def _fstab_remove(uuid: str) -> bool:
    """Remove the line mvmOS added for this UUID. Lines the owner wrote are left."""
    lines = _fstab_lines()
    out, changed, i = [], False, 0
    while i < len(lines):
        if lines[i].strip() == MARK + uuid and i + 1 < len(lines):
            i += 2
            changed = True
            continue
        out.append(lines[i])
        i += 1
    if changed:
        _fstab_write(out)
    return changed


def _model(top: dict) -> str:
    return " ".join(((top.get("vendor") or "").strip() + " " + (top.get("model") or "").strip()).split())


def list_drives(skipped: list = None) -> list:
    """Disks that can be mounted. When `skipped` is a list, disks the system
    sees but File Manager does not offer are added to it with the reason."""
    devs = _lsblk()
    system = _root_disks(devs)
    children = {}
    for d in devs:
        if d.get("pkname"):
            children.setdefault(d["pkname"], []).append(d)
    out = []
    for d in devs:
        if d["type"] not in ("part", "disk", "crypt", "lvm") or d["name"] in system:
            continue
        # A disk split into partitions, or an encrypted volume that is already
        # unlocked, is offered through what is inside it.
        if children.get(d["name"]):
            continue
        fs = (d.get("fstype") or "").lower()
        top = _top(d, devs)
        mps = [m for m in (d.get("mountpoints") or []) if m]
        if fs not in FS_OK:
            if skipped is not None and int(d.get("size") or 0) >= 8 * 1024 * 1024 and not d["name"].startswith(("zram", "ram")):
                if fs in ("crypto_luks", "bitlocker"):
                    why = "encrypted"
                elif fs in ("swap", "lvm2_member", "linux_raid_member", "zfs_member"):
                    continue
                elif fs:
                    why = "unsupported"
                else:
                    why = "no_filesystem"
                skipped.append({"name": d["name"], "device": d["path"], "label": (d.get("label") or d.get("model") or d["name"]).strip(),
                                "size": int(d.get("size") or 0), "fstype": fs, "reason": why, "model": _model(top), "disk": top["path"],
                                "formattable": why == "no_filesystem" and not d.get("ro") and not mps})
            continue
        removable = bool(top.get("hotplug") or top.get("rm") or top.get("tran") == "usb")
        label = (d.get("label") or "").strip() or (top.get("model") or "").strip() or d["name"]
        fe = _fstab_entry(d.get("uuid") or "")
        out.append({
            "name": d["name"],
            "device": d["path"],
            "label": label,
            "model": _model(top),
            "disk": top["path"],
            "size": int(d.get("size") or 0),
            "usage": _usage(mps[0]) if mps else {},
            "fstype": fs,
            "uuid": d.get("uuid") or "",
            "mountpoint": mps[0] if mps else "",
            "persistent": bool(fe),
            "persistent_managed": bool(fe and fe[1]),
            "removable": removable,
            "usb": top.get("tran") == "usb",
            "readonly": bool(d.get("ro")) or fs in ("iso9660", "udf"),
        })
    out.sort(key=lambda x: (not x["removable"], x["label"].lower()))
    return out


@router.get("")
def drives(session=Depends(get_current_session)):
    skipped = []
    found = list_drives(skipped)
    return {"drives": found, "skipped": skipped}


def _find(device: str) -> dict:
    for d in list_drives():
        if d["device"] == device:
            return d
    raise HTTPException(status_code=404, detail="drive_not_found")


def _mount_dir(d: dict) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", d["label"]).strip("._") or d["name"]
    path = os.path.join(MOUNT_ROOT, base)
    n = 2
    while os.path.ismount(path) or (os.path.isdir(path) and os.listdir(path)):
        path = os.path.join(MOUNT_ROOT, f"{base}_{n}")
        n += 1
    return path


class DriveBody(BaseModel):
    device: str
    permanent: bool = False
    forget: bool = False
    recursive: bool = False


def _opts(d: dict, session) -> list:
    opts = ["nosuid", "nodev"]
    if d["readonly"]:
        opts.append("ro")
    if d["fstype"] in FS_UID:
        try:
            pw = pwd.getpwnam(session["effective_user"])
            opts += [f"uid={pw.pw_uid}", f"gid={pw.pw_gid}"]
        except KeyError:
            pass
    return opts


def _ntfs_type() -> str:
    return "ntfs3" if os.path.exists("/sys/module/ntfs3") or _has_ntfs3() else "ntfs-3g"


def _err(r, default: str) -> HTTPException:
    lines = [l.strip() for l in (r.stderr or "").splitlines() if l.strip()]
    return HTTPException(status_code=400, detail=(lines[-1] if lines else default)[:300])


def _make_permanent(d: dict, path: str, session):
    """Add the marked fstab line for a disk. Nothing is changed when the owner
    already has a line for it."""
    if not d["uuid"]:
        raise HTTPException(status_code=400, detail="no_uuid")
    if _fstab_entry(d["uuid"]):
        return
    fs = _ntfs_type() if d["fstype"] == "ntfs" else d["fstype"]
    opts = ",".join(_opts(d, session) + ["nofail", "x-systemd.device-timeout=5s"])
    lines = _fstab_lines()
    lines += [MARK + d["uuid"], f"UUID={d['uuid']} {path} {fs} {opts} 0 0"]
    _fstab_write(lines)


@router.post("/mount")
def mount(body: DriveBody, request: Request, session=Depends(require_admin)):
    d = _find(body.device)
    mp = d["mountpoint"]
    if mp:
        if body.permanent:
            _make_permanent(d, mp, session)
        return {"mountpoint": mp}
    entry = _fstab_entry(d["uuid"])
    path = entry[0] if entry else _mount_dir(d)
    os.makedirs(path, exist_ok=True)
    if body.permanent and not entry:
        _make_permanent(d, path, session)
        r = subprocess.run(["mount", path], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            _fstab_remove(d["uuid"])
            try:
                os.rmdir(path)
            except OSError:
                pass
            raise _err(r, "mount_failed")
        return {"mountpoint": path}
    cmd = ["mount", "-o", ",".join(_opts(d, session))]
    if d["fstype"] == "ntfs":
        cmd += ["-t", _ntfs_type()]
    cmd += [d["device"], path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0 and d["fstype"] == "ntfs":
        # The other NTFS driver may be the one this system has.
        other = "ntfs-3g" if _ntfs_type() == "ntfs3" else "ntfs3"
        r = subprocess.run(["mount", "-o", ",".join(_opts(d, session)), "-t", other, d["device"], path], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        if not entry:
            try:
                os.rmdir(path)
            except OSError:
                pass
        raise _err(r, "mount_failed")
    return {"mountpoint": path}


@router.post("/persist")
def persist(body: DriveBody, request: Request, session=Depends(require_admin)):
    """Turn mounting at every start on or off without touching the current mount."""
    d = _find(body.device)
    if body.permanent:
        if not d["mountpoint"]:
            return mount(body, request, session)
        _make_permanent(d, d["mountpoint"], session)
    else:
        entry = _fstab_entry(d["uuid"])
        if entry and not entry[1]:
            raise HTTPException(status_code=400, detail="fstab_not_managed")
        _fstab_remove(d["uuid"])
    return {"ok": True}


def _has_ntfs3() -> bool:
    r = subprocess.run(["modprobe", "-n", "ntfs3"], capture_output=True, text=True)
    return r.returncode == 0


@router.post("/unmount")
def unmount(body: DriveBody, request: Request, session=Depends(require_admin)):
    d = _find(body.device)
    if not d["mountpoint"]:
        if body.forget:
            entry = _fstab_entry(d["uuid"])
            if entry and entry[1]:
                _fstab_remove(d["uuid"])
        return {"ok": True}
    subprocess.run(["sync"], timeout=120)
    r = subprocess.run(["umount", d["device"]], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        lines = [l.strip() for l in (r.stderr or "").splitlines() if l.strip()]
        raise HTTPException(status_code=400, detail=(lines[-1] if lines else "unmount_failed")[:300])
    mp = d["mountpoint"]
    if body.forget:
        entry = _fstab_entry(d["uuid"])
        if entry and entry[1]:
            _fstab_remove(d["uuid"])
    keep = bool(_fstab_entry(d["uuid"]))
    if os.path.dirname(mp) == MOUNT_ROOT and not keep:
        try:
            os.rmdir(mp)
        except OSError:
            pass
    # A USB disk can be unplugged once none of its partitions is mounted.
    if d["usb"] and not any(x["mountpoint"] for x in list_drives() if x["name"] != d["name"] and x["name"].startswith(re.sub(r"\d+$", "", d["name"]))):
        disk = re.sub(r"p?\d+$", "", d["device"])
        subprocess.run(["udisksctl", "power-off", "-b", disk], capture_output=True, timeout=20)
    return {"ok": True}


# ---- Information, ownership and formatting ---------------------------------

def _smart(disk: str) -> dict:
    """Health of a physical disk from smartctl, when the server has it."""
    if not shutil.which("smartctl"):
        return {"state": "not_installed"}
    try:
        r = subprocess.run(["smartctl", "-j", "-H", "-A", "-i", disk], capture_output=True, text=True, timeout=25)
        j = json.loads(r.stdout or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {"state": "unavailable"}
    return _smart_parse(j)


def _smart_parse(j: dict) -> dict:
    if not j.get("smart_support", {}).get("available", True) or "smart_status" not in j:
        return {"state": "unavailable"}
    out = {"state": "ok" if j["smart_status"].get("passed") else "failing"}
    temp = (j.get("temperature") or {}).get("current")
    if temp is not None:
        out["temperature"] = temp
    hours = (j.get("power_on_time") or {}).get("hours")
    if hours is not None:
        out["hours"] = hours
    for a in (j.get("ata_smart_attributes") or {}).get("table", []):
        raw = (a.get("raw") or {}).get("value")
        if a.get("id") == 5:
            out["reallocated"] = raw
        elif a.get("id") == 197:
            out["pending"] = raw
    nvme = j.get("nvme_smart_health_information_log") or {}
    if nvme:
        out["percentage_used"] = nvme.get("percentage_used")
        out["media_errors"] = nvme.get("media_errors")
    return out


def _kind(top: dict) -> str:
    if top.get("tran") == "usb":
        return "usb"
    return "hdd" if top.get("rota") in (True, 1, "1") else "ssd"


def _disk_row(top: dict, with_smart: bool = True) -> dict:
    row = {"name": top["name"], "device": top["path"], "model": _model(top), "serial": (top.get("serial") or "").strip(),
           "size": int(top.get("size") or 0), "kind": _kind(top), "transport": top.get("tran") or ""}
    if with_smart:
        row["smart"] = _smart(top["path"])
    return row


@router.get("/info")
def info(device: str, session=Depends(get_current_session)):
    devs = _lsblk()
    d = next((x for x in devs if x["path"] == device and x["type"] in ("part", "disk", "crypt", "lvm")), None)
    if not d:
        raise HTTPException(status_code=404, detail="drive_not_found")
    top = _top(d, devs)
    mps = [m for m in (d.get("mountpoints") or []) if m]
    fe = _fstab_entry(d.get("uuid") or "")
    return {
        "device": d["path"], "label": (d.get("label") or "").strip(), "fstype": d.get("fstype") or "", "uuid": d.get("uuid") or "",
        "size": int(d.get("size") or 0), "mountpoint": mps[0] if mps else "", "usage": _usage(mps[0]) if mps else {},
        "persistent": bool(fe), "readonly": bool(d.get("ro")),
        "disk": _disk_row(top),
    }


@router.get("/computer")
def computer(session=Depends(get_current_session)):
    """Space on this computer's mounted file systems and the health of its disks."""
    devs = _lsblk()
    system = _root_disks(devs)
    seen, fss = set(), []
    try:
        mounts = open("/proc/mounts", encoding="utf-8").read().splitlines()
    except OSError:
        mounts = []
    for line in mounts:
        parts = line.split()
        if len(parts) < 3 or not parts[0].startswith("/dev/") or parts[1].startswith(("/snap/", "/var/lib/docker", "/run/")):
            continue
        dev = parts[0]
        if dev in seen or parts[2] in ("squashfs", "iso9660", "udf"):
            continue
        seen.add(dev)
        mp = parts[1].replace("\\040", " ")
        u = _usage(mp)
        if u.get("total"):
            fss.append({"device": dev, "mountpoint": mp, "fstype": parts[2], "system": any(x["path"] == dev and x["name"] in system for x in devs), **u})
    fss.sort(key=lambda x: (x["mountpoint"] != "/", x["mountpoint"]))
    disks = [_disk_row(x) for x in devs if x["type"] == "disk" and not x["name"].startswith(("loop", "zram", "ram", "sr", "nbd", "dm-"))]
    return {"filesystems": fss, "disks": disks}


@router.post("/owner")
def owner(body: DriveBody, request: Request, session=Depends(require_admin)):
    """Give the account that asked the top folder of a mounted disk (and, when
    `recursive` is set, everything inside it). Disks without Unix owners are skipped."""
    d = _find(body.device)
    if not d["mountpoint"]:
        raise HTTPException(status_code=400, detail="not_mounted")
    if d["fstype"] in FS_UID or d["readonly"]:
        raise HTTPException(status_code=400, detail="no_unix_owners")
    try:
        pw = pwd.getpwnam(session["effective_user"])
    except KeyError:
        raise HTTPException(status_code=400, detail="unknown_user")
    cmd = ["chown"] + (["-R"] if body.recursive else []) + [f"{pw.pw_uid}:{pw.pw_gid}", d["mountpoint"]]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise _err(r, "chown_failed")
    return {"ok": True}


class FormatBody(BaseModel):
    device: str
    label: str = ""
    confirm: str = ""


@router.post("/format")
def format_disk(body: FormatBody, request: Request, session=Depends(require_admin)):
    """Make a new ext4 file system on a disk or partition that has none. Anything
    that already holds a file system, a partition, a mount or the system is refused."""
    devs = _lsblk()
    system = _root_disks(devs)
    d = next((x for x in devs if x["path"] == body.device and x["type"] in ("disk", "part")), None)
    if not d or d["name"] in system or d.get("fstype") or d.get("ro") or any(m for m in (d.get("mountpoints") or []) if m):
        raise HTTPException(status_code=400, detail="not_formattable")
    if any(x.get("pkname") == d["name"] for x in devs) or d["name"].startswith(("zram", "ram", "sr")):
        raise HTTPException(status_code=400, detail="not_formattable")
    if body.confirm != d["name"]:
        raise HTTPException(status_code=400, detail="confirm_mismatch")
    label = re.sub(r"[^A-Za-z0-9._-]+", "_", body.label).strip("._")[:16] or "Storage"
    target = d["path"]
    if d["type"] == "disk":
        r = subprocess.run(["sfdisk", "--wipe", "always", "--wipe-partitions", "always", d["path"]],
                           input="label: gpt\n,,L\n", capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise _err(r, "partition_failed")
        subprocess.run(["udevadm", "settle", "--timeout=15"], capture_output=True)
        part = next((x for x in _lsblk() if x.get("pkname") == d["name"] and x["type"] == "part"), None)
        if not part:
            raise HTTPException(status_code=500, detail="partition_missing")
        target = part["path"]
    r = subprocess.run(["mkfs.ext4", "-F", "-q", "-m", "0", "-L", label, target], capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise _err(r, "mkfs_failed")
    subprocess.run(["udevadm", "settle", "--timeout=15"], capture_output=True)
    # A new disk starts owned by whoever formatted it, so it can be used straight away.
    try:
        pw = pwd.getpwnam(session["effective_user"])
        tmp = tempfile.mkdtemp(prefix="mvmos-fmt-")
        if subprocess.run(["mount", target, tmp], capture_output=True, timeout=60).returncode == 0:
            os.chown(tmp, pw.pw_uid, pw.pw_gid)
            subprocess.run(["umount", tmp], capture_output=True, timeout=60)
        os.rmdir(tmp)
    except (KeyError, OSError):
        pass
    return {"ok": True, "device": target, "label": label}
