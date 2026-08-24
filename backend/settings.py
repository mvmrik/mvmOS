import json
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/settings", tags=["settings"])

import os


def _detect_server_tz() -> str:
    """IANA zone name for this server, e.g. "Europe/Sofia".

    str(datetime.now().astimezone().tzinfo) looks like the right thing but on
    Linux it gives the abbreviation (e.g. "EEST"), not an IANA name — and
    Intl.DateTimeFormat in the browser rejects an abbreviation outright. The
    zoneinfo symlink is what actually holds the name.
    """
    try:
        path = os.path.realpath("/etc/localtime")
        marker = "zoneinfo/"
        idx = path.find(marker)
        if idx != -1:
            return path[idx + len(marker):]
    except OSError:
        pass
    return "UTC"


_server_tz = _detect_server_tz()

DEFAULTS = {
    "timezone": _server_tz,
    "time_format": "24",       # "12" or "24"
    "date_format": "DD/MM/YYYY",  # "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"
    "week_starts": "monday",   # "monday" or "sunday"
    "language": "en",
    "currency": "EUR",         # ISO 4217 code, symbol-only display, no FX conversion
}


class SettingsBody(BaseModel):
    settings: dict


@router.get("")
async def get_settings(_session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'main'").fetchone()
    if not row:
        return JSONResponse(DEFAULTS)
    saved = json.loads(row["value"])
    return JSONResponse({**DEFAULTS, **saved})


@router.post("")
async def save_settings(body: SettingsBody, _session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('main', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(body.settings),)
        )
    return {"ok": True}


@router.get("/display")
async def get_display_settings():
    """Read-only subset of settings (date/time format, week start, timezone) with
    no OS session required — mvmOS is a single-owner box, so these display prefs
    are the same for everyone. Lets public-facing app pages without an OS session
    (Apps Hub profiles, Telegram mini-apps) render dates the same way the desktop does."""
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'main'").fetchone()
    saved = json.loads(row["value"]) if row else {}
    merged = {**DEFAULTS, **saved}
    keys = ("timezone", "time_format", "date_format", "week_starts", "currency")
    return JSONResponse({k: merged[k] for k in keys})


get_display_settings.no_session_auth = True
