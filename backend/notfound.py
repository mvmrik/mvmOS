"""
Shared 404 page — same look as frontend/502.html (logo + dark box), used
anywhere in core or an app backend that needs to render a "not found" page
instead of a bare 404 status. Standalone HTML, no desktop/i18n.js context
(these pages render outside the desktop shell), so the message is picked
from the OS-wide language setting (backend/settings.py — a single-owner box
has one language for everyone, same as get_display_settings()) rather than
switched client-side via window.t().
"""

import json

from fastapi.responses import HTMLResponse

_PAGE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>mvmOS — 404</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ background: #1a1b26; color: #c0caf5; font-family: system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; }}
  .box {{ text-align: center; }}
  .logo {{ width: 96px; height: 96px; margin-bottom: 20px; }}
  h1 {{ font-size: 1.4rem; font-weight: 700; margin-bottom: 8px; }}
  p {{ font-size: .9rem; color: #565f89; }}
</style>
</head>
<body>
<div class="box">
  <img class="logo" src="/logo.png" alt="mvmOS">
  <h1>404</h1>
  <p>{message}</p>
</div>
</body>
</html>
"""

_DEFAULTS = {"en": "This page could not be found.", "bg": "Тази страница не е намерена."}


def _current_lang() -> str:
    try:
        from .db import get_conn
        with get_conn() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = 'main'").fetchone()
        if row and json.loads(row["value"]).get("language") == "bg":
            return "bg"
    except Exception:
        pass
    return "en"


def render_404_html(message_en: str = None, message_bg: str = None) -> str:
    lang = _current_lang()
    message = (message_bg if lang == "bg" else message_en) or _DEFAULTS[lang]
    return _PAGE.format(lang=lang, message=message)


def render_404(message_en: str = None, message_bg: str = None) -> HTMLResponse:
    return HTMLResponse(render_404_html(message_en, message_bg), status_code=404)
