import asyncio
import os
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Cookie, HTTPException
from ptyprocess import PtyProcess
from .db import get_conn

router = APIRouter()


def verify_session(token: str | None) -> bool:
    if not token:
        return False
    with get_conn() as conn:
        row = conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    return row is not None


@router.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket, session: str | None = Cookie(default=None)):
    if not verify_session(session):
        await websocket.close(code=4401)
        return

    await websocket.accept()

    proc = PtyProcess.spawn(
        ["/bin/bash", "--login"],
        dimensions=(24, 80),
        env={**os.environ, "TERM": "xterm-256color"},
    )

    loop = asyncio.get_event_loop()

    async def pty_to_ws():
        while proc.isalive():
            try:
                data = await loop.run_in_executor(None, proc.read, 4096)
                await websocket.send_bytes(data)
            except EOFError:
                break
            except Exception:
                break
        try:
            await websocket.close()
        except Exception:
            pass

    reader_task = asyncio.create_task(pty_to_ws())

    try:
        while True:
            msg = await websocket.receive()
            if "bytes" in msg:
                proc.write(msg["bytes"])
            elif "text" in msg:
                data = json.loads(msg["text"])
                if data.get("type") == "resize":
                    proc.setwinsize(data["rows"], data["cols"])
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        if proc.isalive():
            proc.terminate(force=True)
