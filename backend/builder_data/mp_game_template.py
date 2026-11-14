"""
Written by mvmOS App Builder from a platform template, identical for every game made with the
builder. It contains nothing from the game's author or from the AI. A game made here is a
single-player run: the page reports one result at the end and the server records it in Game Hub.
The score comes from the player's own browser, so it is a fun score, not a protected one.
"""

import math
import re
import time

_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.done = False
        self.t0 = 0.0

    async def on_start(self, settings):
        self.started = True
        self.t0 = time.time()
        await self.ctx.broadcast({"type": "bld_start"})

    async def on_join(self, player):
        if self.started and not self.done:
            await self.ctx.send(player["id"], {"type": "bld_start"})

    async def on_leave(self, player):
        return None

    async def on_message(self, player, msg):
        if self.done or not self.started or not isinstance(msg, dict) or msg.get("type") != "bld_over":
            return
        try:
            score = float(msg.get("score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        if not math.isfinite(score):
            score = 0.0
        score = max(-1e9, min(1e9, score))
        stats = {}
        raw = msg.get("stats")
        if isinstance(raw, dict):
            for k, v in list(raw.items())[:40]:
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                if isinstance(k, str) and _KEY.match(k) and math.isfinite(v):
                    stats[k] = v
        self.done = True
        duration = max(0.0, min(time.time() - self.t0, 86400.0))
        await self.ctx.finish(
            [{"player_id": player["id"], "score": score, "rank": 1, "is_winner": False, "stats": stats}],
            duration=duration,
        )
