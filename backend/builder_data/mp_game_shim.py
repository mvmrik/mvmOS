"""
Written by mvmOS App Builder from a platform template. Game Hub loads this file as the game's server half.
The rules of the game are in builder/app/mp_game.py, which is run with the restricted loader; this file only
gives it a Game Hub context that carries its messages to the player's sandbox and nothing else.
"""

import inspect
import os
import sys

APP_ID = "__ID__"
_DIR = os.path.dirname(os.path.abspath(__file__))
_NS = {"__name__": "builtapp_game"}


def _declared():
    import json
    try:
        with open(os.path.join(_DIR, "public", "bundle.json"), encoding="utf-8") as f:
            return json.load(f).get("integrations") or []
    except (OSError, ValueError):
        return []


sys.modules["backend.builder_sandbox"].load(_NS, os.path.join(_DIR, "builder", "app", "mp_game.py"), APP_ID, _DIR, _declared())
_Inner = _NS["Game"]


async def _call(fn, *a, **kw):
    r = fn(*a, **kw)
    if inspect.isawaitable(r):
        r = await r
    return r


def _wrap(ctx):
    """What the game's own code sees as `ctx`. The Game Hub object is held only by these closures."""
    async def broadcast(self, data, exclude=None):
        await ctx.broadcast({"type": "bld_msg", "data": data}, exclude=exclude)

    async def send(self, player_id, data):
        await ctx.send(player_id, {"type": "bld_msg", "data": data})

    async def finish(self, records, duration=None, metadata=None, stats=None):
        return await ctx.finish(records, duration=duration, metadata=metadata or {}, stats=stats)

    async def record_stage(self, player_id, stage, score):
        return await ctx.record_stage(player_id, stage, score)

    members = {
        "broadcast": broadcast, "send": send, "finish": finish, "record_stage": record_stage,
        "players": lambda self: ctx.players(), "all_players": lambda self: ctx.all_players(),
        "schedule": lambda self, delay, factory: ctx.schedule(delay, factory),
        "settings": property(lambda self: ctx.settings), "room_id": property(lambda self: ctx.room_id),
        "host_id": property(lambda self: ctx.host_id),
    }
    return type("Ctx", (), members)()


class Game:
    def __init__(self, ctx):
        self._ctx = ctx
        self._inner = _Inner(_wrap(ctx))

    async def _roster(self):
        people = [{"id": p["id"], "name": p.get("display_name") or p.get("name") or "", "avatar_color": p.get("avatar_color"),
                   "avatar_svg": p.get("avatar_svg")} for p in self._ctx.players()]
        await self._ctx.broadcast({"type": "bld_roster", "players": people, "host": self._ctx.host_id})

    async def on_start(self, settings):
        await self._roster()
        await _call(self._inner.on_start, settings)

    async def on_join(self, player):
        await self._roster()
        fn = getattr(self._inner, "on_join", None)
        if fn:
            await _call(fn, player)

    async def on_leave(self, player):
        await self._roster()
        fn = getattr(self._inner, "on_leave", None)
        if fn:
            await _call(fn, player)

    async def on_message(self, player, msg):
        if isinstance(msg, dict) and msg.get("type") == "bld_msg":
            await _call(self._inner.on_message, player, msg.get("data"))
