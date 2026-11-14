Games built here are played on the Game Hub page. A game can be single-player (against the computer, puzzles, arcade, hot-seat on one device) or multiplayer with 2 to 8 people on different devices, each in a browser.

Multiplayer needs mp_game.py (see Server code in the main guide) and `set_app_info({multiplayer: true, max_players: N})`. Design it like this: the server decides everything that matters (whose turn it is, whether a move is legal, the board, scores, hidden cards or words) and sends each player only what they may see; the page draws what the server sends and sends the player's intent (a move, a click) with mvm.room.send. Send the whole current state to a player who joins or reconnects (in on_join) so a reload resumes the game. Finish with ctx.finish(records) when the game is over; the page then shows the result with a "Play again" hint pointing to Game Hub (a finished room cannot be restarted). Test with the preview only for drawing: multiplayer works after installation, in Game Hub, with two browsers.

Single-player results: when a run ends call `await mvm.game.finish({score: 1234, seconds: 95, stats: {moves: 31, level: 4}})`. score is a number (higher is better; for "fewer moves is better" games compute a score such as 1000 - moves*10). stats keys: lowercase letters, digits and _ , up to 32 characters, values are finite numbers. Call it once per finished run, then show a result screen with a "Play again" button that starts a fresh run in the same page (do not reload). Do not call finish for abandoned runs.

Show the player: mvm.game.player() returns {name, avatar_svg, avatar_color}; mvm.game.avatar(32) returns HTML of the avatar.

Use mvm.kv for best score and settings. Sounds: you may use the Web Audio API (oscillators) for short effects; add a mute toggle and start audio only after the first click or key press. Keyboard play: listen on `window` keydown, call preventDefault for the arrow keys and space, and support touch (pointer events) so the game works on a phone as well. Use requestAnimationFrame for animation and pause when the page is hidden (document.hidden). Computer opponents should feel fair, with an easy/normal/hard choice when it makes sense.

In a multiplayer game the server reports results through ctx.finish and the page does not call mvm.game.finish.

Declare what Game Hub should measure with set_app_info({game_metrics: {moves: {label: "Moves", type: "number", better: "low"}}}) for the stats keys you report; type is number, decimal, duration (seconds) or percent. Metric labels are in English.
