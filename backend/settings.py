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


def available_languages() -> set:
    """Whatever core actually ships, read from the language files themselves.

    Not a hardcoded list: a language is available exactly when its table
    exists, which is the same rule frontend/i18n/i18n.js follows when it falls
    back to English on a 404 and the same one _public_lang_bootstrap() in
    main.py resolves 'auto' against.
    """
    i18n_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "i18n")
    try:
        return {f[:-3] for f in os.listdir(i18n_dir)
                if f.endswith(".js") and f != "i18n.js"}
    except OSError:
        return {"en"}


def resolve_language(value) -> str:
    """The language that will really be shown, not the one that is stored.

    Dropping an entry from the picker does not drop the value already saved,
    and the settings blob is merged rather than replaced, so the three
    untranslated languages removed in 0.41.0-beta (it, tr, ar) stayed in the
    database of every installation that had picked one. The desktop hid it
    twice over — the loader 404s on the missing table and falls back to
    English, and the picker has no matching <option> so the browser shows its
    first one — while anything reading the value literally, the anonymous
    statistics among them, went on reporting a language that was never
    translated. Every reader goes through here instead.
    """
    return value if value in available_languages() else DEFAULTS["language"]


class SettingsBody(BaseModel):
    settings: dict


@router.get("")
async def get_settings(_session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'main'").fetchone()
    if not row:
        return JSONResponse(DEFAULTS)
    saved = json.loads(row["value"])
    merged = {**DEFAULTS, **saved}
    merged["language"] = resolve_language(merged.get("language"))
    return JSONResponse(merged)


@router.post("")
async def save_settings(body: SettingsBody, _session=Depends(get_current_session)):
    """Merge the posted keys into the stored settings.

    Callers send only the keys they own — the regional tab sends the seven
    regional keys, the error reporter sends one. Writing the body as the whole
    blob therefore deleted every setting the caller happened not to mention,
    so changing the language silently reset the wallpaper, the gestures and the
    error-reporting choice. Merging keeps each caller to its own keys.
    """
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'main'").fetchone()
        try:
            saved = json.loads(row["value"]) if row else {}
        except (TypeError, ValueError):
            saved = {}
        if not isinstance(saved, dict):
            saved = {}
        incoming = dict(body.settings or {})
        if "language" in incoming:
            incoming["language"] = resolve_language(incoming["language"])
        saved.update(incoming)
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('main', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(saved),)
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
