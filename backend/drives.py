"""Extra and external disks for File Manager.

Lists the disks and partitions the system itself does not run from, and lets an
administrator mount and unmount them. Everyone signed in can see the list and
open a mounted disk; the Linux permissions of their own account still decide
what they can read inside it. Nothing is written to /etc/fstab, so a disk is
mounted only until it is unmounted or the server restarts.
"""
import json
import os
import pwd
import re
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_session, require_admin

router = APIRouter(prefix="/api/files/drives", tags=["drives"])

MOUNT_ROOT = "/media/mvmos"
# Filesystems a person normally keeps files on. Swap, RAID, LVM and encrypted
# volumes are not file storage and are never offered.
FS_OK = {"ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "iso9660", "udf", "hfsplus"}
FS_UID = {"vfat", "exfat", "ntfs", "ntfs3", "hfsplus"}  # no Unix owners on disk: set at mount time
SYSTEM_MOUNTS = ("/", "/boot", "/boot/efi", "/home", "/usr", "/var", "/opt", "/etc", "/srv", "/tmp", "/root")


def _lsblk() -> list:
    r = subprocess.run(
        ["lsblk", "-J", "-b", "-l", "-o", "NAME,PATH,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINTS,RM,HOTPLUG,TRAN,PKNAME,MODEL,RO"],
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
        if d["type"] not in ("part", "disk") or d["name"] in system:
            continue
        # A disk that is split into partitions is offered through its partitions.
        if d["type"] == "disk" and children.get(d["name"]):
            continue
        fs = (d.get("fstype") or "").lower()
        if fs not in FS_OK:
            if skipped is not None and int(d.get("size") or 0) >= 8 * 1024 * 1024 and not d["name"].startswith(("zram", "ram")):
                if fs == "crypto_luks":
                    why = "encrypted"
                elif fs in ("swap", "lvm2_member", "linux_raid_member", "zfs_member"):
                    continue
                elif fs:
                    why = "unsupported"
                else:
                    why = "no_filesystem"
                skipped.append({"name": d["name"], "device": d["path"], "label": (d.get("label") or d.get("model") or d["name"]).strip(),
                                "size": int(d.get("size") or 0), "fstype": fs, "reason": why})
            continue
        parent = d["name"] if d["type"] == "disk" else d.get("pkname")
        top = next((x for x in devs if x["name"] == parent), d)
        mps = [m for m in (d.get("mountpoints") or []) if m]
        removable = bool(top.get("hotplug") or top.get("rm") or top.get("tran") == "usb")
        label = (d.get("label") or "").strip() or (top.get("model") or "").strip() or d["name"]
        out.append({
            "name": d["name"],
            "device": d["path"],
            "label": label,
            "size": int(d.get("size") or 0),
            "fstype": fs,
            "uuid": d.get("uuid") or "",
            "mountpoint": mps[0] if mps else "",
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


@router.post("/mount")
def mount(body: DriveBody, request: Request, session=Depends(require_admin)):
    d = _find(body.device)
    if d["mountpoint"]:
        return {"mountpoint": d["mountpoint"]}
    path = _mount_dir(d)
    os.makedirs(path, exist_ok=True)
    opts = ["nosuid", "nodev"]
    if d["readonly"]:
        opts.append("ro")
    fs = d["fstype"]
    if fs in FS_UID:
        try:
            pw = pwd.getpwnam(session["effective_user"])
            opts += [f"uid={pw.pw_uid}", f"gid={pw.pw_gid}"]
        except KeyError:
            pass
    cmd = ["mount", "-o", ",".join(opts)]
    if fs == "ntfs":
        cmd += ["-t", "ntfs3" if os.path.exists("/sys/module/ntfs3") or _has_ntfs3() else "ntfs-3g"]
    cmd += [d["device"], path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0 and fs == "ntfs":
        # The other NTFS driver may be the one this system has.
        alt = ["mount", "-o", ",".join(opts), "-t", "ntfs-3g", d["device"], path]
        r = subprocess.run(alt, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        try:
            os.rmdir(path)
        except OSError:
            pass
        lines = [l.strip() for l in (r.stderr or "").splitlines() if l.strip()]
        raise HTTPException(status_code=400, detail=(lines[-1] if lines else "mount_failed")[:300])
    return {"mountpoint": path}


def _has_ntfs3() -> bool:
    r = subprocess.run(["modprobe", "-n", "ntfs3"], capture_output=True, text=True)
    return r.returncode == 0


@router.post("/unmount")
def unmount(body: DriveBody, request: Request, session=Depends(require_admin)):
    d = _find(body.device)
    if not d["mountpoint"]:
        return {"ok": True}
    subprocess.run(["sync"], timeout=120)
    r = subprocess.run(["umount", d["device"]], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        lines = [l.strip() for l in (r.stderr or "").splitlines() if l.strip()]
        raise HTTPException(status_code=400, detail=(lines[-1] if lines else "unmount_failed")[:300])
    mp = d["mountpoint"]
    if os.path.dirname(mp) == MOUNT_ROOT:
        try:
            os.rmdir(mp)
        except OSError:
            pass
    # A USB disk can be unplugged once none of its partitions is mounted.
    if d["usb"] and not any(x["mountpoint"] for x in list_drives() if x["name"] != d["name"] and x["name"].startswith(re.sub(r"\d+$", "", d["name"]))):
        disk = re.sub(r"p?\d+$", "", d["device"])
        subprocess.run(["udisksctl", "power-off", "-b", disk], capture_output=True, timeout=20)
    return {"ok": True}
