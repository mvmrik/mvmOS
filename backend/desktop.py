import json
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/desktop", tags=["desktop"])


class DesktopConfig(BaseModel):
    config: dict


@router.get("")
async def get_desktop(_session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT config FROM desktop_state WHERE id = 1").fetchone()
    return JSONResponse(json.loads(row["config"]))


@router.post("")
async def save_desktop(body: DesktopConfig, _session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute(
            "UPDATE desktop_state SET config = ? WHERE id = 1",
            (json.dumps(body.config),)
        )
    return {"ok": True}
