"""Anonymous installation statistics, off unless the owner turns them on.

What leaves the box is five values, and each one is here because a decision
depends on it: a random id so two installations can be told apart, the version
it runs, the interface language it is set to, and the distribution and
processor architecture it runs on. Whether the installation is licensed, how
many apps it has and which Python it runs used to travel with them and no
longer do — the licence count is already known exactly from the licence
records, and the other two answered no question anybody was asking. No
hostname, no addresses, no user names, no app names, no licence code.

It rides the premium heartbeat rather than a timer of its own — that loop
already wakes every ten minutes, and one wake-up doing two cheap things costs
less than a second loop doing one.
"""

import json
import os
import platform
import urllib.request
import uuid

from .db import get_conn
from .settings import resolve_language

SITE = os.getenv("MVMOS_PREMIUM_SITE", "https://mvmos.org")
_STATS_URL = SITE + "/api/stats"
_SETTING = "analytics"
_ID_SETTING = "analytics_id"


def enabled() -> bool:
    """Opt-in: absent means off. Only an explicit true turns this on."""
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
    if not row:
        return False
    try:
        saved = json.loads(row["value"])
    except (TypeError, ValueError):
        return False
    return isinstance(saved, dict) and saved.get(_SETTING) is True


def _report_id() -> str:
    """An identifier that exists for this report and for nothing else.

    The premium seat check already keeps a random device id, and reusing it
    was tempting — one identifier instead of two. But that one is matched
    against a licence on arrival, and a licence belongs to whoever paid for
    it, so a statistics report carrying it was linkable to a customer the
    moment it landed. This id is made on the first report, kept here, and
    never sent anywhere else or matched against anything; the site can tell
    two installations apart with it and that is all it can do.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key=?", (_ID_SETTING,)
        ).fetchone()
        if row and row["value"]:
            return row["value"]
        fresh = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_ID_SETTING, fresh),
        )
    return fresh


def _language() -> str:
    """The language the desktop really shows, not the one the row happens to hold.

    A language removed from the picker stays in the settings blob for good, so
    the stored value can name a table that has not existed since 0.41.0-beta.
    Reported raw it turned into a language nobody was ever able to read.
    """
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
    try:
        saved = (json.loads(row["value"]) or {}).get("language")
    except (TypeError, ValueError, AttributeError):
        return "en"
    return resolve_language(saved)


def _os() -> str:
    """The distribution and its version, not the kernel.

    platform.system() answers "Linux" on every installation there has ever
    been, which is a constant rather than a fact about any of them. install.sh
    installs through apt, dnf or zypper, so the distribution is the part that
    actually differs and the part a maintainer can act on. ID and VERSION_ID
    rather than PRETTY_NAME: the pretty name carries the point release, which
    would split one distribution into a row per patch level, and a Red Hat one
    is longer than the column the site keeps it in.
    """
    try:
        release = platform.freedesktop_os_release()
    except (OSError, AttributeError):
        return platform.system()
    name = (release.get("ID") or "").strip().lower()
    if not name:
        return platform.system()
    version = (release.get("VERSION_ID") or "").strip()
    return (name + " " + version).strip()


def _version() -> str:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "version.txt")
        with open(path) as handle:
            return handle.read().strip() or "unknown"
    except OSError:
        return "unknown"


def payload() -> dict:
    return {
        "id": _report_id(),
        "version": _version(),
        "language": _language(),
        "os": _os(),
        "arch": platform.machine(),
    }


def send() -> None:
    """Best effort. A failure here must never disturb the heartbeat."""
    body = json.dumps(payload()).encode()
    request = urllib.request.Request(
        _STATS_URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "mvmOS/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8):
        pass
