"""Anonymous installation statistics, off unless the owner turns them on.

What leaves the box is deliberately small enough to read in one glance: the
installation's own random id, the version it runs, the language it is set to,
whether it is licensed, how many store apps are installed, and the Python it
runs on. No hostname, no addresses, no user names, no app names, no licence
code. The id is the same random UUID the premium seat tracking already uses, so
enabling this adds no new identifier.

It rides the premium heartbeat rather than a timer of its own — that loop
already wakes every ten minutes, and one wake-up doing two cheap things costs
less than a second loop doing one.
"""

import json
import os
import platform
import urllib.request

from .db import get_conn, APPS_DIR

SITE = os.getenv("MVMOS_PREMIUM_SITE", "https://mvmos.org")
_STATS_URL = SITE + "/api/stats"
_SETTING = "analytics"


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


def _language() -> str:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
    try:
        return (json.loads(row["value"]) or {}).get("language") or "en"
    except (TypeError, ValueError, AttributeError):
        return "en"


def _version() -> str:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "version.txt")
        with open(path) as handle:
            return handle.read().strip() or "unknown"
    except OSError:
        return "unknown"


def _app_count() -> int:
    try:
        return sum(1 for name in os.listdir(APPS_DIR)
                   if os.path.isdir(os.path.join(APPS_DIR, name)))
    except OSError:
        return 0


def payload(installation_id: str, premium: bool) -> dict:
    return {
        "id": installation_id,
        "version": _version(),
        "language": _language(),
        "premium": bool(premium),
        "apps": _app_count(),
        "python": platform.python_version(),
        "os": platform.system(),
    }


def send(installation_id: str, premium: bool) -> None:
    """Best effort. A failure here must never disturb the heartbeat."""
    body = json.dumps(payload(installation_id, premium)).encode()
    request = urllib.request.Request(
        _STATS_URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "mvmOS/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8):
        pass
