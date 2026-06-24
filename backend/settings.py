import json
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/settings", tags=["settings"])

import datetime
_server_tz = str(datetime.datetime.now().astimezone().tzinfo)

DEFAULTS = {
    "timezone": _server_tz,
    "time_format": "24",       # "12" or "24"
    "date_format": "DD/MM/YYYY",  # "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"
    "week_starts": "monday",   # "monday" or "sunday"
    "language": "en",
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
