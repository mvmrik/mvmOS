"""
mvmOS Multiplayer — generic WebSocket relay.
No game logic. Server only tracks connections and relays messages.
Games handle all logic themselves.
"""
import asyncio
import json
import random
import string
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter(prefix="/api/multiplayer")

_rooms: dict[str, dict] = {}
_ROOM_TTL = 3600


def _make_id(n=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _cleanup():
    now = time.time()
    dead = [rid for rid, r in _rooms.items() if now - r['created_at'] > _ROOM_TTL]
    for rid in dead:
        del _rooms[rid]


@router.post("/room")
async def create_room(request: Request, body: dict):
    from .db import get_conn
    token = request.cookies.get("session")
    if not token:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with get_conn() as conn:
        row = conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    _cleanup()
    game_id = body.get("game_id", "unknown")
    max_players = int(body.get("max_players", 2))
    room_id = _make_id()
    _rooms[room_id] = {
        "id": room_id,
        "game_id": game_id,
        "max_players": max_players,
        "created_at": time.time(),
        "players": [],
        "reconnect_tokens": {},   # token → player_index
        "state": "waiting",
    }
    return {"room_id": room_id, "game_id": game_id}


@router.websocket("/room/{room_id}/ws")
async def room_ws(websocket: WebSocket, room_id: str):
    room = _rooms.get(room_id)
    if not room:
        await websocket.close(code=4004)
        return
    if len(room["players"]) >= room["max_players"]:
        await websocket.close(code=4003)
        return

    await websocket.accept()

    # Wait briefly for a reconnect claim before assigning a new slot
    try:
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=0.6)
        first_msg = json.loads(first_raw)
    except asyncio.TimeoutError:
        first_msg = None
    except Exception:
        return

    # Check if this is a reconnect attempt
    claimed_index = None
    if first_msg and first_msg.get("type") == "reconnect":
        old_token = first_msg.get("token", "")
        old_idx = room.get("reconnect_tokens", {}).get(old_token)
        if old_idx is not None and old_idx < len(room["players"]) and room["players"][old_idx] is None:
            claimed_index = old_idx

    if claimed_index is not None:
        # Reconnect: restore to original slot
        player_index = claimed_index
        token = next((t for t, i in room["reconnect_tokens"].items() if i == claimed_index), _make_id(16))
        room["players"][player_index] = websocket
        active = sum(1 for p in room["players"] if p is not None)
        await _send(websocket, {
            "type": "joined",
            "player": player_index,
            "reconnect": True,
            "reconnect_token": token,
            "game_id": room["game_id"],
            "players": active,
            "max_players": room["max_players"],
        })
        await _broadcast(room, exclude=player_index, data={
            "type": "player_rejoined",
            "player": player_index,
            "players": active,
        })
    else:
        # New player
        player_index = len(room["players"])
        token = _make_id(16)
        room["reconnect_tokens"][token] = player_index
        room["players"].append(websocket)
        active = sum(1 for p in room["players"] if p is not None)
        await _send(websocket, {
            "type": "joined",
            "player": player_index,
            "reconnect": False,
            "reconnect_token": token,
            "game_id": room["game_id"],
            "players": active,
            "max_players": room["max_players"],
        })
        await _broadcast(room, exclude=player_index, data={
            "type": "player_joined",
            "player": player_index,
            "players": active,
            "max_players": room["max_players"],
        })
        # Relay the first non-reconnect message (e.g., guest's hello)
        if first_msg:
            await _broadcast(room, exclude=player_index, data={**first_msg, "from": player_index})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            msg_type = msg.get("type")

            # Heartbeat — respond directly, don't relay
            if msg_type == "ping":
                await _send(websocket, {"type": "pong"})
                continue

            # Reconnect mid-loop: move from ghost slot to original slot
            if msg_type == "reconnect":
                old_token = msg.get("token", "")
                old_idx = room.get("reconnect_tokens", {}).get(old_token)
                if old_idx is not None and old_idx != player_index and old_idx < len(room["players"]) and room["players"][old_idx] is None:
                    # Free current ghost slot
                    room["players"][player_index] = None
                    ghost_idx = player_index
                    # Restore to original slot
                    room["players"][old_idx] = websocket
                    player_index = old_idx
                    active = sum(1 for p in room["players"] if p is not None)
                    await _send(websocket, {
                        "type": "joined",
                        "player": player_index,
                        "reconnect": True,
                        "reconnect_token": old_token,
                        "game_id": room["game_id"],
                        "players": active,
                    })
                    # Clean up ghost slot visibility
                    await _broadcast(room, exclude=player_index, data={
                        "type": "player_left",
                        "player": ghost_idx,
                        "players": active,
                    })
                    await _broadcast(room, exclude=player_index, data={
                        "type": "player_rejoined",
                        "player": player_index,
                        "players": active,
                    })
                continue

            # Regular message — relay to all other players
            await _broadcast(room, exclude=player_index, data={**msg, "from": player_index})

    except (WebSocketDisconnect, Exception):
        room["players"][player_index] = None
        active = sum(1 for p in room["players"] if p is not None)
        await _broadcast(room, exclude=player_index, data={
            "type": "player_left",
            "player": player_index,
            "players": active,
        })
        if active == 0:
            _rooms.pop(room_id, None)


async def _send(ws, data):
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def _broadcast(room, exclude, data):
    for i, ws in enumerate(room["players"]):
        if ws is not None and i != exclude:
            await _send(ws, data)


# ── Public game page (no login required) ─────────────────────────────────────
@router.get("/play/{game_id}/{room_id}", response_class=HTMLResponse)
async def play_page(game_id: str, room_id: str):
    room = _rooms.get(room_id)
    if not room:
        return HTMLResponse("<h2>Room not found or expired.</h2>", status_code=404)
    return HTMLResponse(_game_page(game_id, room_id))


def _game_page(game_id: str, room_id: str) -> str:
    import os, time as _time
    apps_dir = os.path.join(os.path.dirname(__file__), "..", "apps", game_id)
    mtime = int(os.path.getmtime(os.path.join(apps_dir, "main.js"))) if os.path.isdir(apps_dir) else int(_time.time())
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mvmOS — {game_id}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #1e1e2e; color: #cdd6f4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; flex-direction: column; height: 100dvh; overflow: hidden;
    }}
    #mp-app {{ flex: 1; min-height: 0; display: flex; flex-direction: column; }}
  </style>
</head>
<body>
  <div id="mp-app"></div>

  <script>
    window.mvmOS = {{
      lang: navigator.language?.startsWith('bg') ? 'bg' : 'en',
      createWindow: function(opts) {{
        const body = document.getElementById('mp-app');
        body.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#1e1e2e;padding:0';
        if (opts.onMount) opts.onMount(body);
        return {{ id: opts.id }};
      }},
      registerApp: function(def) {{ window._mpAppDef = def; }},
      multiplayer: {{
        createRoom: async function(gameId, opts) {{
          const res = await fetch('/api/multiplayer/room', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{ game_id: gameId, ...opts }}),
          }});
          const data = await res.json();
          return {{
            roomId: data.room_id,
            link: location.origin + '/api/multiplayer/play/' + gameId + '/' + data.room_id,
          }};
        }},
        connect: function(roomId) {{
          const proto = location.protocol === 'https:' ? 'wss' : 'ws';
          return new WebSocket(proto + '://' + location.host + '/api/multiplayer/room/' + roomId + '/ws');
        }},
      }},
    }};
  </script>

  <script src="/apps/{game_id}/main.js?v={mtime}"></script>

  <script>
    if (window._mpAppDef) {{
      window._mpAppDef.launch({{ multiplayer: true, roomId: '{room_id}' }});
    }}
  </script>
</body>
</html>"""
