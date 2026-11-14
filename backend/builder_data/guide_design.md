Design guide for apps built here.

Theme variables (always use them; the app is shown in dark and light themes and with different accent colours):
--bg page background; --surface cards and panels; --surface2 inputs, buttons, hover areas; --border lines; --text main text; --text-dim secondary text; --accent buttons, links, selections; --on-accent text on top of --accent; --danger errors and destructive actions. Never put a fixed colour on text or backgrounds. If you need extra colours for data (chart series, game pieces), derive them with color-mix(in srgb, var(--accent) 60%, var(--text)) or choose pairs that still have strong contrast on both a dark and a light --bg, and never rely on colour alone.

Ready-made: body, h1-h3, a, button, input, select, textarea are styled. Classes: .card (panel), .muted (secondary text), .primary (accent button), .danger (destructive button). Add your own CSS on top.

Layout: the app fills the window. Use `min-height:100vh` and flex/grid with wrapping, `gap` for spacing, rem units, max-width containers on wide windows, a single column below ~600 px. Touch targets at least 40 px. Keep line length readable. Use :focus-visible styles (already provided for form controls; add them for custom elements). Respect prefers-reduced-motion for animations.

Quality bar: a clear title area, one obvious primary action, an empty state with a hint ("Nothing here yet — add the first one"), confirm before destroying data (mvm.confirm), toasts for results (mvm.toast), tidy alignment, and consistent corner radius (8-12px). Keep state in memory and save it with mvm.kv after every change; load it at start; the app must work when nothing is saved yet and when a saved value is damaged (catch and fall back).

Canvas and games: draw using colours read from CSS variables (getComputedStyle(document.documentElement).getPropertyValue('--accent')) and re-read when the theme changes. A deliberately fixed dark board must define its own light text colours too.
