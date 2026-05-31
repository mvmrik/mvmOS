"""
mvmOS Multiplayer — generic WebSocket relay.
No game logic. Server only tracks connections and relays messages.
Games handle all logic themselves.
"""
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
    player_index = len(room["players"])
    room["players"].append(websocket)

    # Tell this player who they are
    await _send(websocket, {
        "type": "joined",
        "player": player_index,
        "game_id": room["game_id"],
        "players": len(room["players"]),
        "max_players": room["max_players"],
    })

    # Tell all others a new player joined
    await _broadcast(room, exclude=player_index, data={
        "type": "player_joined",
        "player": player_index,
        "players": len(room["players"]),
        "max_players": room["max_players"],
    })

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            # Relay to all other players, add sender index
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
