"""System programs that mvmOS and its apps need, and how to install them.

This module uses only the standard library, so the installer can run it with
`python -m backend.deps_core base` before anything else exists. The web part
(check, ticket, live terminal) is in backend/deps.py.

A dependency is a program the Linux system must provide. It has an id, the
commands that prove it is there, and the package that provides them on each
package manager. Apps never name packages: an app lists dependency ids in its
manifest ("system_requires") and the core knows what to install.
"""

import json
import os
import shlex
import shutil
import sys

# Programs live in /usr/sbin or /sbin on some systems, which a service started by
# systemd does not always have on its PATH.
_EXTRA_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]


def search_path() -> str:
    parts = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    for p in _EXTRA_PATH:
        if p not in parts:
            parts.append(p)
    return os.pathsep.join(parts)


def has_command(cmd: str) -> bool:
    return shutil.which(cmd, path=search_path()) is not None


def _p(apt, dnf=None, pacman=None, zypper=None):
    """One package name per package manager; a name may also be a list."""
    return {"apt": apt, "dnf": dnf or apt, "pacman": pacman or apt, "zypper": zypper or apt}


# id -> {cmds, packages}. Every command has to exist for the dependency to count as present.
DEPS = {
    "curl": {"cmds": ["curl"], "packages": _p(["curl", "ca-certificates"], "curl", "curl", "curl")},
    "cron": {"cmds": ["crontab"], "packages": _p("cron", "cronie", "cronie", "cron")},
    "tar": {"cmds": ["tar"], "packages": _p("tar")},
    "unzip": {"cmds": ["unzip"], "packages": _p("unzip")},
    "zip": {"cmds": ["zip"], "packages": _p("zip")},
    "tmux": {"cmds": ["tmux"], "packages": _p("tmux")},
    "git": {"cmds": ["git"], "packages": _p("git")},
    "openssh-client": {"cmds": ["ssh", "ssh-keygen"], "packages": _p("openssh-client", "openssh-clients", "openssh", "openssh-clients")},
    "openssh-server": {"cmds": ["sshd"], "packages": _p("openssh-server", "openssh-server", "openssh", "openssh-server")},
    "ping": {"cmds": ["ping"], "packages": _p("iputils-ping", "iputils", "iputils", "iputils")},
    "procps": {"cmds": ["free", "uptime"], "packages": _p("procps", "procps-ng", "procps-ng", "procps")},
    "iproute": {"cmds": ["ss"], "packages": _p("iproute2", "iproute", "iproute2", "iproute2")},
    "util-linux": {"cmds": ["runuser", "lsblk", "mount"], "packages": _p("util-linux")},
    "mysql-client": {"cmds": ["mysql", "mysqldump"], "packages": _p("default-mysql-client", "mariadb", "mariadb-clients", "mariadb-client")},
    "postgresql-client": {"cmds": ["psql"], "packages": _p("postgresql-client", "postgresql", "postgresql", "postgresql")},
    "smartmontools": {"cmds": ["smartctl"], "packages": _p("smartmontools")},
    "ntfs-3g": {"cmds": ["ntfs-3g"], "packages": _p("ntfs-3g", "ntfs-3g", "ntfs-3g", "ntfs-3g")},
    "imagemagick": {"cmds": ["convert"], "packages": _p("imagemagick", "ImageMagick", "imagemagick", "ImageMagick")},
}

# What mvmOS itself uses all the time. The installer puts all of it on the system,
# so a new Linux never meets an unexplained failure in Core.
BASE = ["curl", "cron", "tar", "unzip", "zip", "tmux", "git", "openssh-client", "ping", "procps", "iproute", "util-linux"]

# Order in which the package managers are tried.
_MANAGERS = [("apt", "apt-get"), ("dnf", "dnf"), ("dnf", "yum"), ("zypper", "zypper"), ("pacman", "pacman")]


def package_manager():
    """(family, program) of the package manager of this system, or (None, None)."""
    for family, prog in _MANAGERS:
        if has_command(prog):
            return family, prog
    return None, None


def normalize(spec, known=None):
    """A dependency given as an id or as an object, as a complete record, or None."""
    known = DEPS if known is None else known
    if isinstance(spec, str):
        base = known.get(spec)
        if not base:
            return None
        return {"id": spec, "name": spec, "cmds": list(base["cmds"]), "packages": base["packages"]}
    if isinstance(spec, dict) and isinstance(spec.get("id"), str):
        base = known.get(spec["id"], {})
        cmds = spec.get("cmds") or base.get("cmds") or []
        packages = spec.get("packages") or base.get("packages") or {}
        if not isinstance(cmds, list) or not cmds or not isinstance(packages, dict):
            return None
        return {"id": spec["id"], "name": str(spec.get("name") or spec["id"]), "cmds": [str(c) for c in cmds], "packages": packages}
    return None


def missing_commands(dep: dict) -> list:
    return [c for c in dep["cmds"] if not has_command(c)]


def packages_for(dep: dict, family) -> list:
    value = dep["packages"].get(family) if family else None
    if not value:
        return []
    return [value] if isinstance(value, str) else [str(v) for v in value]


def status(specs, known=None) -> dict:
    """What of the given dependencies is missing on this system."""
    family, prog = package_manager()
    missing = []
    for spec in specs:
        dep = normalize(spec, known)
        if not dep:
            continue
        gone = missing_commands(dep)
        if gone:
            missing.append({"id": dep["id"], "name": dep["name"], "commands": gone,
                            "packages": packages_for(dep, family)})
    return {"manager": family, "program": prog, "missing": missing,
            "installable": bool(family and all(m["packages"] for m in missing))}


def install_script(deps: list) -> str:
    """The shell script that installs the given dependency records, or '' when there is nothing to do."""
    family, prog = package_manager()
    if not family:
        return ""
    pkgs = []
    for dep in deps:
        for p in packages_for(dep, family):
            if p not in pkgs:
                pkgs.append(p)
    if not pkgs:
        return ""
    names = shlex.join(pkgs)
    if family == "apt":
        steps = ["export DEBIAN_FRONTEND=noninteractive", "apt-get update || true",
                 f"apt-get install -y --no-install-recommends {names}"]
    elif prog == "yum":
        steps = [f"yum install -y {names}"]
    elif family == "dnf":
        steps = [f"dnf install -y {names}"]
    elif family == "zypper":
        steps = [f"zypper --non-interactive install {names}"]
    else:
        # A lone "pacman -Sy" would leave the system partially upgraded, so the databases are used as they are.
        steps = [f"pacman -S --needed --noconfirm {names}"]
    return "\n".join(f"echo '$ '{shlex.quote(s)}\n{s}" for s in steps)


def install_base_script() -> str:
    deps = [normalize(i) for i in BASE]
    return install_script([d for d in deps if d and missing_commands(d)])


def main(argv):
    """python -m backend.deps_core base   — install what mvmOS itself needs (used by the installer and updates).
       python -m backend.deps_core check  — print what is missing."""
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "check":
        print(json.dumps(status(BASE), indent=2))
        return 0
    if cmd == "base":
        script = install_base_script()
        if not script:
            print("  Everything mvmOS needs is already on this system.")
            return 0
        print("  Installing the programs mvmOS needs...")
        code = os.system("set -e\n" + script) >> 8
        if code:
            print("  Some programs could not be installed. mvmOS will offer to install them when they are needed.")
        return 0
    print("usage: python -m backend.deps_core [base|check]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
