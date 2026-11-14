"""
App Builder — the AI chat that writes a person's app.

It uses the provider and model already set for the AI chat (the mvmAI app), but it never
gives the model the chat's server tools. The model gets exactly the tools below, which
read and write the files of ONE project folder (path-checked in builder.py), validate it,
describe the person's own Apps Hub integrations and read the builder guides. There is no
way to run a command, read another folder, reach another app or the network from here.
"""

import asyncio
import json
import os
import re
import sys
import time
import uuid
from collections import deque

import httpx
from fastapi import HTTPException

from . import builder as B
from . import builder_check as chk

LANG_NAMES = {"bg": "Bulgarian", "de": "German", "en": "English", "es": "Spanish", "fr": "French",
              "ja": "Japanese", "pt-BR": "Brazilian Portuguese", "ru": "Russian", "zh-CN": "Simplified Chinese"}
MAX_ROUNDS = 28
MAX_CALLS_PER_ROUND = 8
TURN_SECONDS = 25 * 60
MAX_REPAIRS = 2
HISTORY_MESSAGES = 16
_TURNS: dict = {}
_RUNNING: dict = {}
_ERRORS: dict = {}


# ── The model ─────────────────────────────────────────────────────────────────

def _desk():
    return sys.modules.get("app_backend_mvmai")


def _cfg(desk) -> dict:
    """The provider and model chosen for the AI chat's public page, when there is one."""
    cfg = desk._read_cfg()
    prem = sys.modules.get("backend.premium")
    try:
        pb = prem.load_premium_backend("mvmai") if prem else None
        if pb and pb.is_available():
            cfg = pb.resolve_pub_cfg(cfg)
    except Exception:
        pass
    return cfg


def status() -> dict:
    desk = _desk()
    if desk is None:
        return {"available": False, "reason": "mvmai_missing"}
    cfg = _cfg(desk)
    pid = cfg.get("provider") or "gemini"
    cli = next((p for p in desk.CLI_PROVIDERS if p["id"] == pid), None)
    if cli:
        return {"available": True, "kind": "cli", "provider": cli["name"], "model": cfg.get("model") or ""}
    meta = desk.PROVIDERS.get(pid)
    if not meta:
        return {"available": False, "reason": "not_configured"}
    _pid, base, key, model = desk._resolve_provider(cfg)
    ok = bool(base) and (bool(key) or not meta.get("needs_key", True))
    return {"available": ok, "reason": None if ok else "not_configured", "kind": "api", "provider": meta["name"], "model": model}


# ── Tools ─────────────────────────────────────────────────────────────────────

def _obj(props: dict, required=()):
    return {"type": "object", "properties": props, "required": list(required)}


_I18N_OBJ = {"type": "object", "description": "Texts keyed by language code, for the app's languages (" + ", ".join(chk.LANGS) + " are possible)"}
TOOLS = [
    {"type": "function", "function": {"name": "list_files", "description": "List the files of the app with their sizes.", "parameters": _obj({})}},
    {"type": "function", "function": {"name": "read_file", "description": "Read a text file of the app. Long files are cut; pass offset to continue.",
                                       "parameters": _obj({"path": {"type": "string"}, "offset": {"type": "integer"}}, ["path"])}},
    {"type": "function", "function": {"name": "write_file", "description": "Create or completely replace one text file (html, css, js, json, svg, txt, md). Keep each file under about 250 lines; split code over several files.",
                                       "parameters": _obj({"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"])}},
    {"type": "function", "function": {"name": "edit_file", "description": "Replace an exact piece of text in an existing file. 'old' must appear exactly once unless replace_all is true.",
                                       "parameters": _obj({"path": {"type": "string"}, "old": {"type": "string"}, "new": {"type": "string"}, "replace_all": {"type": "boolean"}}, ["path", "old", "new"])}},
    {"type": "function", "function": {"name": "delete_file", "description": "Delete a file of the app.", "parameters": _obj({"path": {"type": "string"}}, ["path"])}},
    {"type": "function", "function": {"name": "validate", "description": "Check the whole app against the rules and syntax. Run it when the app is complete and fix every error.", "parameters": _obj({})}},
    {"type": "function", "function": {"name": "set_app_info", "description": "Set the app's name and a one-sentence description in each of the app's languages, a fitting emoji (fallback icon), up to 5 lowercase tags, and for a game the statistics to measure: game_metrics = {key: {label, type, better}}, and whether it is multiplayer with max_players (2-8).",
                                       "parameters": _obj({"name_i18n": _I18N_OBJ, "description_i18n": _I18N_OBJ, "emoji": {"type": "string"}, "tags": {"type": "array"}, "game_metrics": {"type": "object"}, "multiplayer": {"type": "boolean"}, "max_players": {"type": "integer"}})}},
    {"type": "function", "function": {"name": "list_integrations", "description": "List the person's own other apps (with their app-to-app API switched on) and their functions, which this app may use.", "parameters": _obj({})}},
    {"type": "function", "function": {"name": "set_integrations", "description": "Declare which other apps this app uses, by app id, from list_integrations only.",
                                       "parameters": _obj({"app_ids": {"type": "array"}}, ["app_ids"])}},
    {"type": "function", "function": {"name": "read_guide", "description": "Read a builder guide: 'design' (look, theme, layout) or 'games' (Game Hub, scores, controls).", "parameters": _obj({"topic": {"type": "string"}}, ["topic"])}},
    {"type": "function", "function": {"name": "get_runtime_errors", "description": "Errors the running preview of the app reported (script errors and console errors).", "parameters": _obj({})}},
]


def _guide(name: str) -> str:
    with open(os.path.join(B.DATA_DIR, name), encoding="utf-8") as f:
        return f.read()


def _cut(text: str, limit: int = 24000, offset: int = 0) -> str:
    chunk = text[offset:offset + limit]
    more = len(text) - offset - len(chunk)
    return chunk + (f"\n[... {more} more characters; call read_file with offset={offset + limit}]" if more > 0 else "")


def run_tool(turn: dict, name: str, args: dict) -> str:
    pid = turn["pid"]
    p = B.load_project(pid)
    try:
        if name == "list_files":
            files = B.read_files(pid)
            return json.dumps([{"path": k, "bytes": len(v.encode("utf-8")) if isinstance(v, str) else len(v)} for k, v in sorted(files.items())]) or "[]"
        if name == "read_file":
            path = chk.safe_rel(args.get("path"))
            files = B.read_files(pid)
            if path not in files:
                return f"Error: {path} does not exist."
            if not isinstance(files[path], str):
                return f"{path} is a binary file ({len(files[path])} bytes)."
            return _cut(files[path], offset=max(0, int(args.get("offset") or 0)))
        if name == "write_file":
            path = B.write_text_file(pid, args.get("path"), args.get("content"))
            turn["changed"].add(path)
            msg = f"ok: {path} written ({len(args.get('content') or '')} characters)."
            if path == "icon.svg":
                bad = chk.check_icon(args.get("content") or "")
                if bad:
                    msg += " Problems: " + " ".join(bad)
            return msg
        if name == "edit_file":
            path = chk.safe_rel(args.get("path"))
            files = B.read_files(pid)
            if path not in files or not isinstance(files[path], str):
                return f"Error: {path} is not an existing text file."
            old, new = args.get("old"), args.get("new")
            if not isinstance(old, str) or not old or not isinstance(new, str):
                return "Error: 'old' and 'new' must be text and 'old' must not be empty."
            count = files[path].count(old)
            if count == 0:
                return "Error: the text to replace was not found. Read the file again and copy the text exactly."
            if count > 1 and not args.get("replace_all"):
                return f"Error: the text appears {count} times. Include more surrounding text, or set replace_all."
            B.write_text_file(pid, path, files[path].replace(old, new))
            turn["changed"].add(path)
            return f"ok: {path} edited."
        if name == "delete_file":
            path = chk.safe_rel(args.get("path"))
            ok = B.delete_file(pid, path)
            turn["changed"].add(path)
            return "ok: deleted." if ok else "Error: no such file."
        if name == "validate":
            res = B.validate(pid)
            lines = ["The app has no errors." if not res["errors"] else f"{len(res['errors'])} error(s):"]
            lines += ["- " + e for e in res["errors"]]
            if res["warnings"]:
                lines.append("Warnings:")
                lines += ["- " + w for w in res["warnings"]]
            return "\n".join(lines)
        if name == "set_app_info":
            if isinstance(args.get("name_i18n"), dict):
                names = B._clean_i18n(args["name_i18n"], 40)
                if names:
                    p["name_i18n"] = {**(p.get("name_i18n") or {}), **names}
            if isinstance(args.get("description_i18n"), dict):
                desc = B._clean_i18n(args["description_i18n"], 300)
                if desc:
                    p["description_i18n"] = {**(p.get("description_i18n") or {}), **desc}
                    p["description"] = desc.get("en") or p.get("description") or next(iter(desc.values()))
            if args.get("emoji"):
                p["emoji"] = B._clean_text(args["emoji"], 8) or p.get("emoji")
            if isinstance(args.get("tags"), list):
                p["tags"] = [t for t in (re.sub(r"[^a-z0-9-]", "", str(x).lower())[:20] for x in args["tags"][:5]) if t]
            if "multiplayer" in args:
                p["multiplayer"] = bool(args.get("multiplayer"))
            if args.get("max_players") is not None:
                try:
                    p["max_players"] = max(1, min(8, int(args["max_players"])))
                except (TypeError, ValueError):
                    pass
            if isinstance(args.get("game_metrics"), dict):
                metrics = {}
                for k, m in list(args["game_metrics"].items())[:20]:
                    if re.match(r"^[a-z][a-z0-9_]{0,31}$", str(k)) and isinstance(m, dict):
                        metrics[k] = {"label": B._clean_text(m.get("label"), 40), "type": m.get("type"), "better": m.get("better")}
                p["game"] = {"metrics": metrics}
            B.save_project(p)
            return "ok: app information saved."
        if name == "list_integrations":
            if not turn.get("profile"):
                return "The person is not signed in to Apps Hub in this browser, so their other apps cannot be listed. Tell them to sign in to Apps Hub (profile menu) and ask again."
            apps = B.describe_integrations(turn["profile"])
            if not apps:
                return "No other apps are available. The person must add the app to their Apps Hub shelf and switch on its app-to-app API in Apps Hub settings."
            out = []
            for a in apps:
                out.append(f"{a['id']} ({a['name']}):")
                for f in a["functions"]:
                    params = ", ".join(x["name"] + ("?" if x.get("optional") else "") + (":" + x["type"] if x.get("type") else "") for x in f["params"])
                    out.append(f"  - {f['name']}({params}) [{f['access']}] {f['summary']}")
            return _cut("\n".join(out), 12000)
        if name == "set_integrations":
            ids = B._clean_integrations(args.get("app_ids"))
            if ids and not turn.get("profile"):
                return "Error: sign in to Apps Hub first."
            ok = set(B.eligible_apps(turn["profile"])) if turn.get("profile") else set()
            bad = [i for i in ids if i not in ok]
            if bad:
                return "Error: not available for this person: " + ", ".join(bad)
            p["integrations"] = ids
            B.save_project(p)
            return "ok: the app now uses: " + (", ".join(ids) or "no other apps") + "."
        if name == "read_guide":
            topic = str(args.get("topic") or "")
            if topic in ("design", "games"):
                return _guide(f"guide_{topic}.md")
            return "Error: topics are 'design' and 'games'."
        if name == "get_runtime_errors":
            errs = list(_ERRORS.get(pid, []))
            return "\n".join(f"- {e['message']} {e['stack']}".strip() for e in errs) if errs else "The preview reported no errors."
    except ValueError as e:
        return f"Error: {e}"
    except HTTPException as e:
        return f"Error: {e.detail}"
    except Exception as e:  # a tool must never end the turn
        return f"Error: {str(e)[:200]}"
    return "Error: unknown tool."


# ── Runtime errors reported by the preview ────────────────────────────────────

def add_runtime_error(pid: str, message: str, stack: str) -> None:
    q = _ERRORS.setdefault(pid, deque(maxlen=20))
    message = message[:400]
    if not any(e["message"] == message for e in q):
        q.append({"message": message, "stack": stack[:600], "ts": time.time()})


def runtime_errors(pid: str) -> list:
    return list(_ERRORS.get(pid, []))


def clear_runtime_errors(pid: str) -> None:
    _ERRORS.pop(pid, None)


# ── Chat history ──────────────────────────────────────────────────────────────

def _hist_path(pid: str) -> str:
    return os.path.join(B._pdir(pid), "chat.json")


def history(pid: str) -> list:
    try:
        with open(_hist_path(pid), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def _save_history(pid: str, msgs: list) -> None:
    with open(_hist_path(pid), "w", encoding="utf-8") as f:
        json.dump(msgs[-60:], f, ensure_ascii=False)


def clear_history(pid: str) -> None:
    try:
        os.remove(_hist_path(pid))
    except OSError:
        pass


# ── A turn ────────────────────────────────────────────────────────────────────

def running_turn(pid: str):
    tid = _RUNNING.get(pid)
    t = _TURNS.get(tid) if tid else None
    return tid if t and not t["done"] else None


def _system_prompt(p: dict, lang: str, files: dict) -> str:
    listing = ", ".join(f"{k} ({(len(v.encode('utf-8')) if isinstance(v, str) else len(v)) // 1024 or 1} KB)" for k, v in sorted(files.items())) or "none yet; start from scratch"
    return (
        _guide("guide.md")
        + "\n\n## This project\n"
        + f"App name: {p['name']}\nCategory: {p['category']}" + (" (a game: read_guide('games') first)" if p["category"] == "Games" else "") + "\n"
        + f"Opened by: {'a signed-in Apps Hub profile' if p.get('profiles') else 'the person at the desktop'}; "
        + f"public web page: {'yes' if p.get('public') else 'no'}.\n"
        + f"Declared integrations: {', '.join(p.get('integrations') or []) or 'none'}\n"
        + f"The app's languages: {', '.join(B.project_languages(p))} (every text in i18n.json, the app name and the description must exist in exactly these languages, no others needed)\n"
        + f"Files now: {listing}\n"
        + f"The person writes in {LANG_NAMES.get(lang, 'English')} ({lang}); answer in that language. Use English for file contents' keys and code, and write the texts in the app's languages in i18n.json."
    )


def _event(turn: dict, **ev) -> None:
    ev["n"] = len(turn["events"])
    turn["events"].append(ev)


async def start_turn(pid: str, owner: str, session: dict, message: str, lang: str, profile: str) -> dict:
    message = (message or "").strip()[:4000]
    if not message:
        raise HTTPException(400, "Write a message first.")
    if running_turn(pid):
        raise HTTPException(409, "The assistant is still working on the previous message.")
    st = status()
    if not st.get("available"):
        raise HTTPException(409, "ai_unavailable")
    for old_id, old in list(_TURNS.items()):
        if old["done"] and time.time() - old["finished"] > 3600:
            _TURNS.pop(old_id, None)
    tid = uuid.uuid4().hex[:16]
    turn = {"id": tid, "pid": pid, "events": [], "done": False, "error": None, "stopped": False, "changed": set(),
            "profile": profile, "started": time.time(), "finished": 0}
    _TURNS[tid] = turn
    _RUNNING[pid] = tid
    B.snapshot(pid, "before: " + message[:60])
    hist = history(pid)
    hist.append({"role": "user", "content": message, "ts": time.time()})
    _save_history(pid, hist)
    turn["task"] = asyncio.ensure_future(_run(turn, session, hist, lang if lang in LANG_NAMES else "en"))
    return {"turn_id": tid}


def turn_state(pid: str, tid: str, after: int) -> dict:
    t = _TURNS.get(tid)
    if not t or t["pid"] != pid:
        raise HTTPException(404, "Unknown turn")
    return {"events": t["events"][max(0, after):], "next": len(t["events"]), "done": t["done"], "error": t["error"],
            "changed": sorted(t["changed"])}


def stop_turn(pid: str, tid: str) -> None:
    t = _TURNS.get(tid)
    if t and t["pid"] == pid:
        t["stopped"] = True


def _model_messages(hist: list) -> list:
    out = []
    for m in hist[-HISTORY_MESSAGES:]:
        text = m["content"]
        if m["role"] == "assistant" and m.get("changed"):
            text += "\n(files changed in that turn: " + ", ".join(m["changed"][:12]) + ")"
        out.append({"role": m["role"], "content": text})
    return out


_JUNK = re.compile(r"</?(antml:)?(invoke|function_calls|parameter)\b[^>]*>", re.I)


def _clean_text(text: str) -> str:
    """Models sometimes leave the markers of a tool call in their text."""
    return _JUNK.sub("", text or "").strip()


def _echo_call(call: dict) -> str:
    """How the model's own call is shown back to it on the next round (file bodies are not repeated)."""
    fn = call["function"]
    try:
        args = json.loads(fn.get("arguments") or "{}")
    except ValueError:
        args = {}
    if fn["name"] == "write_file" and isinstance(args.get("content"), str):
        args["content"] = f"<{len(args['content'])} characters>"
    if fn["name"] == "edit_file":
        args = {k: (f"<{len(v)} characters>" if isinstance(v, str) and len(v) > 200 else v) for k, v in args.items()}
    return "```mvmai_tool_call\n" + json.dumps({"name": fn["name"], "arguments": args}, ensure_ascii=False) + "\n```"


async def _ask_cli(desk, cfg, session, system: str, flat: list):
    pid = cfg.get("provider")
    r = await desk._run_cli_chat(
        desk.CliChatRequest(provider_id=pid, messages=flat, model=cfg.get("model") or ""),
        tools=TOOLS, is_admin=False, exec_enabled=False, session=session, extra_prompt=system,
    )
    data = json.loads(r.body)
    if r.status_code >= 400:
        raise RuntimeError(data.get("error") or "The AI provider failed.")
    calls = []
    for c in data.get("tool_calls") or []:
        calls.append(c)
    return data.get("content") or "", calls


async def _ask_api(desk, cfg, system: str, messages: list):
    _pid, base, key, model = desk._resolve_provider(cfg)
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload = {"model": model, "messages": [{"role": "system", "content": system}] + messages, "tools": TOOLS, "tool_choice": "auto"}
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(base + "chat/completions", headers=headers, json=payload)
    if r.status_code >= 400:
        detail = r.text[:300]
        try:
            j = r.json()
            detail = (j.get("error") or {}).get("message") or j.get("error") or detail
        except Exception:
            pass
        raise RuntimeError(f"Provider error ({r.status_code}): {detail}")
    msg = r.json()["choices"][0]["message"]
    return msg.get("content") or "", msg.get("tool_calls") or [], msg


async def _run(turn: dict, session: dict, hist: list, lang: str) -> None:
    pid = turn["pid"]
    final = ""
    try:
        desk = _desk()
        cfg = _cfg(desk)
        cli = next((c for c in desk.CLI_PROVIDERS if c["id"] == cfg.get("provider")), None)
        convo = _model_messages(hist)
        repairs = 0
        for _round in range(MAX_ROUNDS):
            if turn["stopped"]:
                final = final or "(stopped)"
                break
            if time.time() - turn["started"] > TURN_SECONDS:
                raise RuntimeError("This is taking too long; the work done so far is kept.")
            p = B.load_project(pid)
            system = _system_prompt(p, lang, B.read_files(pid))
            _event(turn, type="thinking")
            if cli:
                text, calls = await _ask_cli(desk, cfg, session, system, convo)
                raw_msg = None
            else:
                text, calls, raw_msg = await _ask_api(desk, cfg, system, convo)
            calls = calls[:MAX_CALLS_PER_ROUND]
            if not calls:
                final = _clean_text(text)
                # A last check: the person gets an app that passes, or hears what is left.
                if turn["changed"] and repairs < MAX_REPAIRS:
                    res = B.validate(pid)
                    if res["errors"]:
                        repairs += 1
                        _event(turn, type="tool", name="validate", ok=False, detail=f"{len(res['errors'])} problem(s), fixing")
                        convo.append({"role": "assistant", "content": final or "(done)"})
                        convo.append({"role": "user", "content": "[automatic check] The app still has errors. Fix them and run validate again:\n" + "\n".join("- " + e for e in res["errors"])})
                        final = ""
                        continue
                break
            text = _clean_text(text)
            if text:
                _event(turn, type="text", text=text[:1200])
            results = []
            if cli:
                convo.append({"role": "assistant", "content": (text.strip() + "\n" if text.strip() else "") + "\n".join(_echo_call(c) for c in calls)})
            else:
                convo.append({"role": "assistant", "content": raw_msg.get("content"), "tool_calls": calls})
            for c in calls:
                fn = c["function"]
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                    if not isinstance(args, dict):
                        args = {}
                except ValueError:
                    args = {}
                result = await asyncio.to_thread(run_tool, turn, fn["name"], args)
                ok = not result.startswith("Error")
                _event(turn, type="tool", name=fn["name"], path=str(args.get("path") or ""), ok=ok,
                       detail="" if ok else result[:160])
                results.append((c, fn["name"], result))
            if cli:
                convo.append({"role": "tool", "content": "\n\n".join(f"[Result of {n}] {r}" for _c, n, r in results)})
            else:
                for c, _n, r in results:
                    convo.append({"role": "tool", "tool_call_id": c["id"], "content": r})
        else:
            final = final or "I reached the limit of steps for one message. The work so far is saved; tell me to continue."
    except asyncio.CancelledError:
        raise
    except Exception as e:
        turn["error"] = str(e)[:400] or "The assistant failed."
    finally:
        changed = sorted(turn["changed"])
        if final or changed:
            h = history(pid)
            h.append({"role": "assistant", "content": final or "…", "ts": time.time(), "changed": changed})
            _save_history(pid, h)
        _event(turn, type="done", text=final)
        turn["done"] = True
        turn["finished"] = time.time()
        if _RUNNING.get(pid) == turn["id"]:
            _RUNNING.pop(pid, None)
