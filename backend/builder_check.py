"""
App Builder — what a generated app may contain, and the checks that enforce it.

These checks are a net for mistakes and for apps that arrive from someone else.
The real confinement is the sandbox the app runs in (see frontend/builder-runtime.js):
no network, no storage, no cookies, no desktop objects. What the checks add is
a clear, early message the AI (or a person) can act on, and a refusal to install
anything that is not a plain, self-contained web page.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
from xml.etree import ElementTree

SERVER_FILES = ("server.py", "app_api.py", "mp_game.py")

LANGS = ("bg", "de", "en", "es", "fr", "ja", "pt-BR", "ru", "zh-CN")

CATEGORIES = (
    "Productivity", "Finance", "Communication", "Media", "Creative", "Business", "AI",
    "Developer Tools", "System & Administration", "Security & Privacy", "Health & Fitness",
    "Utilities", "Games",
)

TEXT_EXT = {".html", ".css", ".js", ".json", ".svg", ".txt", ".md", ".py"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".ogg", ".woff2"}
MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".woff2": "font/woff2", ".svg": "image/svg+xml",
}

MAX_FILES = 80
MAX_TEXT_BYTES = 400 * 1024
MAX_BINARY_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 5 * 1024 * 1024
MAX_ICON_BYTES = 100 * 1024

_PATH_RE = re.compile(r"^[a-z0-9_][a-z0-9_.-]*(/[a-z0-9_][a-z0-9_.-]*){0,3}$")
_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,60}$")


def safe_rel(path) -> str:
    """A normalised relative path inside the app, or ValueError."""
    p = str(path or "").replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    if not p or len(p) > 100 or not _PATH_RE.match(p) or ".." in p.split("/") or p.endswith("."):
        raise ValueError("Invalid file name. Use lowercase letters, digits, '-', '_' and '.', at most 4 folders deep.")
    ext = os.path.splitext(p)[1].lower()
    if ext == ".py" and p not in SERVER_FILES:
        raise ValueError("Server code goes only in " + ", ".join(SERVER_FILES) + ".")
    if ext not in TEXT_EXT and ext not in BINARY_EXT:
        raise ValueError("This file type is not allowed. Allowed: " + ", ".join(sorted(TEXT_EXT | BINARY_EXT)))
    return p


def is_text(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in TEXT_EXT


# Things a plain, offline web page never needs. The sandbox blocks them anyway; these say so early.
_FORBIDDEN = [
    (r"\bfetch\s*\(", "fetch() — the app has no network. Keep data with mvm.kv."),
    (r"\bXMLHttpRequest\b", "XMLHttpRequest — the app has no network. Keep data with mvm.kv."),
    (r"\bWebSocket\b", "WebSocket — the app has no network."),
    (r"\bEventSource\b", "EventSource — the app has no network."),
    (r"\bsendBeacon\b", "sendBeacon — the app has no network."),
    (r"\bimportScripts\b", "importScripts — workers and external code are not available."),
    (r"\bnew\s+Worker\b", "Web Workers are not available."),
    (r"\beval\s*\(", "eval() — not allowed."),
    (r"\bnew\s+Function\b", "new Function — not allowed."),
    (r"\bdocument\s*\.\s*cookie\b", "document.cookie — not available. Keep data with mvm.kv."),
    (r"\b(localStorage|sessionStorage|indexedDB)\b", "browser storage is not available in the sandbox. Use mvm.kv instead."),
    (r"\bwindow\s*\.\s*(parent|top|opener)\b", "window.parent/top/opener — the app cannot reach outside itself."),
    (r"\b(parent|top)\s*\.\s*(postMessage|document|location|window)\b", "talking to the parent window directly — use the mvm object."),
    (r"\bwindow\s*\.\s*open\s*\(", "window.open — the app cannot open other pages."),
    (r"\b(window\s*\.\s*)?location\s*(\.\s*(href|assign|replace))?\s*=[^=]", "changing the page address — not allowed."),
    (r"\blocation\s*\.\s*(assign|replace)\s*\(", "changing the page address — not allowed."),
    (r"\bimport\s*\(", "dynamic import() — put everything in plain script files."),
    (r"\bmvmOS\b", "mvmOS is the system's own object and is not available here. The app's object is mvm."),
    (r"""['"`]/(api|pub|apps)/""", "paths into the system (/api, /pub, /apps) — the app cannot call them. Use the mvm object."),
]
_FORBIDDEN_HTML = [
    (r"<\s*iframe\b", "<iframe> — not allowed."),
    (r"<\s*(object|embed)\b", "<object>/<embed> — not allowed."),
    (r"<\s*form\b[^>]*\baction\s*=", "form action — not allowed; handle submit in JavaScript."),
    (r"<\s*script\b[^>]*\bsrc\s*=\s*['\"]?(https?:)?//", "an external script — the app must be self-contained."),
    (r"<\s*script\b[^>]*\btype\s*=\s*['\"]module", "ES modules — use plain script files."),
    (r"<\s*link\b[^>]*\bhref\s*=\s*['\"]?(https?:)?//", "an external stylesheet or font — the app must be self-contained."),
    (r"<\s*(img|source|audio|video)\b[^>]*\bsrc\s*=\s*['\"]?(https?:)?//", "an external picture or media file — the app must be self-contained."),
    (r"<\s*meta\b[^>]*http-equiv", "meta http-equiv — not allowed."),
    (r"<\s*base\b", "<base> — not allowed."),
]
_FORBIDDEN_CSS = [
    (r"@import\b", "@import — put the rules in the stylesheet itself."),
    (r"url\(\s*['\"]?(https?:)?//", "an external url() — the app must be self-contained."),
]
_FORBIDDEN_MODULE = re.compile(r"^\s*(import\s+[^(]|export\s+)", re.M)


def _strip_comments(js: str) -> str:
    js = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    return re.sub(r"(^|[^:\\'\"`])//[^\n]*", r"\1", js)


def _node_check(source: str, label: str) -> str:
    """Syntax error text from `node --check`, or ''. The code is only parsed, never run."""
    node = shutil.which("node")
    if not node:
        return ""
    with tempfile.TemporaryDirectory(prefix="builder-check-") as d:
        path = os.path.join(d, "check.js")
        with open(path, "w", encoding="utf-8") as f:
            f.write(source)
        try:
            r = subprocess.run([node, "--check", path], capture_output=True, text=True, timeout=15, cwd=d)
        except Exception:
            return ""
    if r.returncode == 0:
        return ""
    lines = [ln for ln in (r.stderr or "").splitlines() if ln.strip()]
    # "<path>:LINE" then the offending code, a caret line and the message.
    where = ""
    for ln in lines:
        m = re.match(r".*check\.js:(\d+)", ln)
        if m:
            where = f"line {m.group(1)}"
            break
    msg = next((ln for ln in reversed(lines) if "Error" in ln), lines[-1] if lines else "syntax error")
    return f"{label}: {msg.strip()} ({where})" if where else f"{label}: {msg.strip()}"


def _inline_scripts(html: str):
    for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", html, re.S | re.I):
        attrs = m.group(1)
        if "src=" in attrs.lower() or re.search(r"type\s*=\s*['\"](?!text/javascript)", attrs, re.I):
            continue
        yield m.group(2)


def check_icon(svg: str):
    errors = []
    if len(svg.encode("utf-8")) > MAX_ICON_BYTES:
        errors.append("icon.svg is larger than 100 KB.")
    try:
        root = ElementTree.fromstring(svg)
    except ElementTree.ParseError as e:
        return [f"icon.svg is not valid SVG: {e}"]
    if not root.tag.endswith("svg"):
        errors.append("icon.svg must be an <svg> document.")
    if "viewBox" not in root.attrib:
        errors.append('icon.svg needs a viewBox, for example viewBox="0 0 128 128".')
    low = svg.lower()
    for bad, why in (("<script", "scripts"), ("<foreignobject", "foreignObject"), ("<image", "embedded images"), ("<use", "<use> references"),
                     ("javascript:", "javascript: addresses"), ("<style", "<style> blocks (use attributes)")):
        if bad in low:
            errors.append(f"icon.svg must not contain {why}.")
    if re.search(r"\son\w+\s*=", low):
        errors.append("icon.svg must not contain event handlers.")
    if re.search(r"(href|url\()\s*=?\s*['\"(]?\s*(https?:)?//", low):
        errors.append("icon.svg must not reference outside addresses.")
    return errors


def clean_languages(value) -> list:
    """The languages a person chose, in the fixed order of LANGS; English alone when nothing valid is given."""
    chosen = [l for l in LANGS if isinstance(value, (list, tuple)) and l in value]
    return chosen or ["en"]


def check_i18n(raw: str, files: dict, langs=LANGS):
    errors, keys = [], set()
    langs = clean_languages(langs)
    try:
        data = json.loads(raw)
    except ValueError as e:
        return [f"i18n.json is not valid JSON: {e}"], keys
    if not isinstance(data, dict):
        return ["i18n.json must be an object with one table per language."], keys
    missing = [l for l in langs if l not in data or not isinstance(data[l], dict)]
    if missing:
        errors.append("i18n.json is missing languages: " + ", ".join(missing) + ". This app's languages are: " + ", ".join(langs) + ".")
    ref_lang = "en" if "en" in langs else langs[0]
    en = data.get(ref_lang) if isinstance(data.get(ref_lang), dict) else {}
    keys = set(en)
    for k, v in en.items():
        if not _KEY_RE.match(k) or not isinstance(v, str):
            errors.append(f'i18n.json: key "{k}" must be a simple name with a text value.')
    for l in langs:
        t = data.get(l)
        if not isinstance(t, dict) or l == ref_lang:
            continue
        gone = [k for k in en if k not in t]
        extra = [k for k in t if k not in en]
        if gone:
            errors.append(f"i18n.json: {l} lacks {len(gone)} key(s), for example: " + ", ".join(gone[:6]))
        if extra:
            errors.append(f"i18n.json: {l} has keys that {ref_lang} lacks, for example: " + ", ".join(extra[:6]))
        for k, v in t.items():
            if not isinstance(v, str):
                errors.append(f'i18n.json: {l}.{k} must be text.')
                break
    # Keys the code asks for must exist.
    used = set()
    for path, text in files.items():
        if path.endswith((".html", ".js")):
            used |= set(re.findall(r"data-i18n(?:-placeholder|-title|-aria)?\s*=\s*[\"']([^\"']+)[\"']", text))
            used |= set(re.findall(r"\bmvm\s*\.\s*t\s*\(\s*['\"]([^'\"]+)['\"]", text))
    absent = sorted(k for k in used if k not in keys)
    if absent:
        errors.append("These texts are used in the code but missing from i18n.json: " + ", ".join(absent[:10]))
    return errors, keys


def check_project(files: dict, meta: dict):
    """files: {path: str | bytes}. Returns {'errors': [...], 'warnings': [...]}."""
    errors, warnings = [], []
    texts = {p: v for p, v in files.items() if isinstance(v, str)}
    if len(files) > MAX_FILES:
        errors.append(f"Too many files ({len(files)}); the limit is {MAX_FILES}.")
    total = 0
    for p, v in files.items():
        size = len(v.encode("utf-8")) if isinstance(v, str) else len(v)
        total += size
        limit = MAX_TEXT_BYTES if isinstance(v, str) else MAX_BINARY_BYTES
        if size > limit:
            errors.append(f"{p} is too large ({size // 1024} KB; the limit is {limit // 1024} KB).")
    if total > MAX_TOTAL_BYTES:
        errors.append("The app is larger than 5 MB in total.")

    if "index.html" not in texts:
        errors.append("index.html is missing. It is the page the app opens.")
    if "icon.svg" not in texts:
        errors.append("icon.svg is missing. Draw a simple original 128x128 vector icon for the app.")
    else:
        errors += check_icon(texts["icon.svg"])
    if "i18n.json" not in texts:
        errors.append("i18n.json is missing. Every visible text needs a key in each of the app's languages.")
    else:
        e, _ = check_i18n(texts["i18n.json"], texts, meta.get("languages") or LANGS)
        errors += e

    from . import builder_sandbox
    for path, text in texts.items():
        ext = os.path.splitext(path)[1].lower()
        if ext == ".py":
            errors += builder_sandbox.check_source(text, path)
            if path == "mp_game.py" and meta.get("category") != "Games":
                errors.append("mp_game.py belongs to games only. Set the category to Games or remove the file.")
        elif ext == ".js":
            code = _strip_comments(text)
            for rx, why in _FORBIDDEN:
                if re.search(rx, code):
                    errors.append(f"{path}: {why}")
            if _FORBIDDEN_MODULE.search(code):
                errors.append(f"{path}: import/export statements — use plain script files, one global scope.")
            msg = _node_check(text, path)
            if msg:
                errors.append(msg)
        elif ext == ".html":
            for rx, why in _FORBIDDEN_HTML:
                if re.search(rx, text, re.I):
                    errors.append(f"{path}: {why}")
            for i, code in enumerate(_inline_scripts(text), 1):
                c = _strip_comments(code)
                for rx, why in _FORBIDDEN:
                    if re.search(rx, c):
                        errors.append(f"{path} (inline script {i}): {why}")
                msg = _node_check(code, f"{path} (inline script {i})")
                if msg:
                    errors.append(msg)
            for m in re.finditer(r"\son\w+\s*=\s*\"([^\"]*)\"", text):
                for rx, why in _FORBIDDEN:
                    if re.search(rx, m.group(1)):
                        errors.append(f"{path}: {why}")
            if re.search(r"<\s*input\b[^>]*\btype\s*=\s*['\"]?(date|time|datetime-local|month|week)\b", text, re.I):
                errors.append(f"{path}: native date/time inputs are not allowed. Use mvm.pickDateTime() and mvm.fmt for dates and times.")
            plain = re.sub(r"<(script|style)\b.*?</\1>", " ", text, flags=re.S | re.I)
            plain = re.sub(r"<[^>]+>", " ", plain)
            if re.search(r"[^\W\d_]{3,}\s+[^\W\d_]{3,}", plain):
                warnings.append(f"{path} seems to contain written-out text. Visible text should come from i18n.json (data-i18n or mvm.t).")
        elif ext == ".css":
            for rx, why in _FORBIDDEN_CSS:
                if re.search(rx, text, re.I):
                    errors.append(f"{path}: {why}")
            if len(re.findall(r"#[0-9a-fA-F]{6}\b", text)) > 20:
                warnings.append(f"{path}: many fixed colours. Use the theme variables (--bg, --surface, --text, --accent, ...) so light and dark themes both work.")
        elif ext == ".svg" and path != "icon.svg":
            low = text.lower()
            if "<script" in low or "<foreignobject" in low or re.search(r"\son\w+\s*=", low):
                errors.append(f"{path}: scripts and event handlers are not allowed in SVG files.")

    # Linked files must exist.
    html = texts.get("index.html", "")
    for m in re.finditer(r"""<(?:script|link|img|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']""", html, re.I):
        ref = m.group(1)
        if re.match(r"^(data:|#|https?:|//)", ref):
            continue
        rel = ref.split("?")[0].split("#")[0].lstrip("./").lstrip("/")
        if rel and rel not in files:
            errors.append(f"index.html refers to {ref}, but that file does not exist.")

    if meta.get("category") == "Games" and "icon.svg" in texts and "mp_game.py" not in texts and not any("mvm.game" in t for t in texts.values()):
        warnings.append("This is a game, but nothing calls mvm.game.finish(). Scores will not reach Game Hub.")
    return {"errors": errors[:40], "warnings": warnings[:20]}
