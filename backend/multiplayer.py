"""
mvmOS Multiplayer — generic WebSocket room system for games.
Games use: mvmOS.multiplayer.createRoom(gameId) → { roomId, link }
           mvmOS.multiplayer.joinRoom(roomId)
"""
import asyncio
import json
import random
import string
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter(prefix="/api/multiplayer")

# ── In-memory rooms ───────────────────────────────────────────────────────────
# room = {
#   id, game_id, created_at,
#   players: [ws, ws],  max 2
#   host: 0|1,          index of host player
#   state: 'waiting'|'playing'|'done'
#   data: {}            game-specific state (numbers queue etc.)
# }
_rooms: dict[str, dict] = {}
_ROOM_TTL = 3600  # 1 hour


def _make_id(n=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _cleanup():
    now = time.time()
    dead = [rid for rid, r in _rooms.items() if now - r['created_at'] > _ROOM_TTL]
    for rid in dead:
        del _rooms[rid]


# ── REST: create room ─────────────────────────────────────────────────────────
@router.post("/room")
async def create_room(request: Request, body: dict):
    # Only logged-in mvmOS users can create rooms
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
    room_id = _make_id()
    _rooms[room_id] = {
        "id": room_id,
        "game_id": game_id,
        "created_at": time.time(),
        "players": [],
        "state": "waiting",
        "data": {},
    }
    return {"room_id": room_id, "game_id": game_id}


# ── WebSocket: join room ──────────────────────────────────────────────────────
@router.websocket("/room/{room_id}/ws")
async def room_ws(websocket: WebSocket, room_id: str):
    room = _rooms.get(room_id)
    if not room:
        await websocket.close(code=4004)
        return

    if len(room["players"]) >= 2:
        await websocket.close(code=4003)
        return

    await websocket.accept()
    player_index = len(room["players"])
    room["players"].append(websocket)

    await _send(websocket, {"type": "joined", "player": player_index, "game_id": room["game_id"]})

    # Both players connected — start game
    if len(room["players"]) == 2:
        room["state"] = "playing"
        first = random.randint(0, 1)
        room["data"]["turn"] = first
        room["data"]["numbers"] = [random.randint(0, 9) for _ in range(500)]
        room["data"]["num_index"] = 0
        for i, ws in enumerate(room["players"]):
            await _send(ws, {
                "type": "start",
                "first": first,
                "your_turn": i == first,
                "numbers": room["data"]["numbers"][:10],  # preview first 10
            })
    else:
        await _send(websocket, {"type": "waiting"})

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            await _handle(room, player_index, websocket, msg)
    except (WebSocketDisconnect, Exception):
        room["players"][player_index] = None
        other = room["players"][1 - player_index]
        if other:
            await _send(other, {"type": "opponent_left"})
        if all(p is None for p in room["players"]):
            _rooms.pop(room_id, None)


async def _handle(room, player_index, ws, msg):
    t = msg.get("type")

    if t == "move":
        # Player made a move — forward to opponent, advance turn
        other_ws = room["players"][1 - player_index]
        room["data"]["turn"] = 1 - player_index

        # Next number
        room["data"]["num_index"] += 1
        idx = room["data"]["num_index"]
        next_num = room["data"]["numbers"][idx] if idx < len(room["data"]["numbers"]) else random.randint(1, 9)

        # Confirm to mover
        await _send(ws, {
            "type": "move_ok",
            "your_turn": False,
            "next_number": next_num,
        })
        # Tell opponent it's their turn + what the mover did
        if other_ws:
            await _send(other_ws, {
                "type": "opponent_move",
                "move": msg.get("move"),
                "your_turn": True,
                "next_number": next_num,
            })

    elif t == "game_over":
        # Player reports their grid is full
        other_ws = room["players"][1 - player_index]
        room["state"] = "done"
        if other_ws:
            await _send(other_ws, {
                "type": "opponent_game_over",
                "score": msg.get("score", 0),
            })

    elif t == "score_update":
        # Broadcast score to opponent for live display
        other_ws = room["players"][1 - player_index]
        if other_ws:
            await _send(other_ws, {"type": "opponent_score", "score": msg.get("score", 0)})

    elif t == "grid_update":
        # Send grid state to opponent so they can see it
        other_ws = room["players"][1 - player_index]
        if other_ws:
            await _send(other_ws, {"type": "opponent_grid", "grid": msg.get("grid")})


async def _send(ws, data):
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


# ── Public game page (no login required) ─────────────────────────────────────
@router.get("/play/{game_id}/{room_id}", response_class=HTMLResponse)
async def play_page(game_id: str, room_id: str):
    room = _rooms.get(room_id)
    if not room:
        return HTMLResponse("<h2>Room not found or expired.</h2>", status_code=404)
    return HTMLResponse(_game_page(game_id, room_id))


def _game_page(game_id: str, room_id: str) -> str:
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
    // Minimal mvmOS shim for standalone multiplayer page
    window.mvmOS = {{
      lang: navigator.language?.startsWith('bg') ? 'bg' : 'en',
      createWindow: function(opts) {{
        const body = document.getElementById('mp-app');
        body.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#1e1e2e;padding:0';
        if (opts.onMount) opts.onMount(body);
        return {{ id: opts.id }};
      }},
      registerApp: function(def) {{
        window._mpAppDef = def;
      }},
      multiplayer: {{
        _roomId: '{room_id}',
        _gameId: '{game_id}',
        createRoom: async function(gameId) {{
          const res = await fetch('/api/multiplayer/room', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{ game_id: gameId }}),
          }});
          const data = await res.json();
          return {{
            roomId: data.room_id,
            link: location.origin + '/api/multiplayer/play/' + gameId + '/' + data.room_id,
          }};
        }},
        connect: function(roomId, gameId) {{
          const proto = location.protocol === 'https:' ? 'wss' : 'ws';
          return new WebSocket(proto + '://' + location.host + '/api/multiplayer/room/' + roomId + '/ws');
        }},
      }},
    }};
  </script>

  <script src="/apps/{game_id}/main.js?v={int(time.time())}"></script>

  <script>
    // Launch the app
    if (window._mpAppDef) {{
      window._mpAppDef.launch({{ multiplayer: true, roomId: '{room_id}' }});
    }}
  </script>
</body>
</html>"""
