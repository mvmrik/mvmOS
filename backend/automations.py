"""
Automations — rules that react to what happens in apps.

A rule belongs to an Apps Hub profile and reads: when something is done in an
app (or every day at a time), if some values compare the right way, do
something. It sees and changes only its owner's data, because every app
function it calls is called as that profile — the same user_id the app's own
API takes.

Nothing is declared by the apps. What a rule can react to, read and do is
taken from what every app already has:

  events      the app's own write routes (/pub/<app>/..., POST/PUT/PATCH/
              DELETE, named by their handler) and the write functions of its
              app_api.py, which the External API calls. The two are merged by
              name, so "add_entry" fires whether the drink was logged on the
              app's screen or through the External API. An event carries
              the plain values it was done with (the ids in the address and
              the JSON body, or the function's parameters), which a condition
              can compare: which task was completed.
  values      numbers returned by the app_api.py read functions that need no
              argument (get_day, get_target, ...), addressed by their path in
              the result, or the length of a returned list.
  actions     the app_api.py write functions, with their own parameters.

How it stays cheap. Nothing polls. A finished write request and a finished
External API call each pass (app, event) to notice(), which answers from a
small in-memory set of the pairs some rule listens for, so an event nobody
listens for costs one set lookup. When a rule does listen, the work is queued
for a worker thread: the request that logged the drink never waits for a
Budget reward. Rules that start at a time of day are looked up by that minute
from the scheduler's own tick. An action calls the app function directly — not
through a route or the External API — so it never raises a new event and one
rule cannot start another: there is no chain to run away. A rule also runs at
most MAX_RUNS_PER_HOUR times an hour.

Free and Premium. A rule that stays inside one app — its event or time, its
values, its actions — and a notification to its owner is free and runs here.
Reading or changing a second app and sending a request out of the server is
Premium and is done by backend/premium/automations/, which only a licensed
installation ever downloads, and only while the owner has switched it on in
Settings. This file has no code that reads another app's value or calls
another app's function from a rule: such a step is handed to that module, and
without it the step fails with "premium" in the journal.

Everything is served under /pub/automations/ so it stays reachable on a
public-only server, like the Clipboard.
"""

import asyncio
import inspect
import json
import os
import re
import sys
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

from .auth import get_current_session, get_current_session_optional, user_can_sudo
from .db import get_conn

_PUB_DIR = os.path.join(os.path.dirname(__file__), "automations_pub")

APP_ID = "automations"
MAX_RULES = 50
MAX_CONDITIONS = 10
MAX_ACTIONS = 10
MAX_NAME = 80
MAX_TEXT = 500
MAX_RULE_BYTES = 30_000
JOURNAL_KEEP = 30
MAX_RUNS_PER_HOUR = 30
MAX_BACKLOG = 500
REFRESH_SECONDS = 5
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PARAMS = {"idempotency_key"}

OPS = {
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}
LIMITS = ("none", "day")
MATCHES = ("all", "any")

router = APIRouter()
desktop_router = APIRouter(prefix="/api/automations", tags=["automations"])


def _open(fn):
    """Reachable without a desktop session — the page's own identity check is
    the Apps Hub profile, as with the Clipboard."""
    fn.no_session_auth = True
    return fn


class Premium(Exception):
    """A step that only the Premium module can do, and it is not there."""


class RuleError(Exception):
    """A rule that cannot run as written (an app or value that is gone)."""


def _hub():
    return sys.modules.get("backend.apphub")


def _extapi():
    return sys.modules.get("backend.extapi")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Premium ───────────────────────────────────────────────────────

def _premium_module():
    prem = sys.modules.get("backend.premium")
    mod = prem.load_core_premium("automations") if prem else None
    if mod and getattr(mod, "is_available", lambda: False)():
        return mod
    return None


_GLOBAL = "*"


def _cross_setting() -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT cross FROM automation_settings WHERE user_id=?", (_GLOBAL,)).fetchone()
    return bool(row and row["cross"])


def premium():
    """The Premium module when it is here, licensed and switched on by the
    owner — the only state in which a rule may go beyond one app. Asked per
    call: a licence makes the folder appear in a running process and removing
    one deletes it."""
    mod = _premium_module()
    return mod if mod and _cross_setting() else None


# ── What the apps already have ────────────────────────────────────

def _pretty(name: str) -> str:
    words = [w for w in name.replace("-", "_").split("_") if w]
    # Route handlers are often named after the HTTP method (put_settings).
    if len(words) > 1 and words[0].lower() in ("put", "post", "patch"):
        words[0] = "update"
    return " ".join(words).capitalize()


def api_functions(app_id: str) -> dict:
    """name -> function of the app's app_api.py, as the External API sees it."""
    ext, hub = _extapi(), _hub()
    if not ext or not hub:
        return {}
    return ext._functions(hub._load_app_api(app_id))


def _kind(ann) -> Optional[str]:
    """number or text for a value an event can carry; None for anything else
    (bools, lists, nested objects), which a condition cannot compare."""
    import typing
    args = [a for a in typing.get_args(ann) if a is not type(None)]
    if typing.get_origin(ann) is typing.Union or type(ann).__name__ == "UnionType":
        return _kind(args[0]) if len(args) == 1 else None
    if ann is bool:
        return None
    if ann in (int, float):
        return "number"
    if ann is str:
        return "text"
    return None


def _route_events(app_id: str) -> dict:
    """Handler name -> {field: kind} of the app's own write routes at
    /pub/<app>/: what the address and the JSON body of the request carry."""
    loader = sys.modules.get("backend.public_loader")
    r = loader.get_router(app_id) if loader else None
    out = {}
    for route in getattr(r, "routes", []) or []:
        methods = getattr(route, "methods", None) or set()
        name = getattr(route, "name", "")
        if not (methods & WRITE_METHODS and name and not name.startswith("_")) or name in out:
            continue
        fields = {}
        dep = getattr(route, "dependant", None)
        for f in getattr(dep, "path_params", []) or []:
            fields[f.name] = _kind(f.field_info.annotation) or "text"
        for f in getattr(dep, "body_params", []) or []:
            ann = f.field_info.annotation
            model = getattr(ann, "model_fields", None)
            for fname, mf in (model.items() if isinstance(model, dict) else [(f.name, f)]):
                k = _kind(getattr(mf, "annotation", None) or getattr(getattr(mf, "field_info", None), "annotation", None))
                if k and fname not in fields:
                    fields[fname] = k
        out[name] = fields
    return out


def _function_fields(fn) -> dict:
    """{param: kind} that a call of an app_api function carries."""
    ext = _extapi()
    out = {}
    for pname, p in list(inspect.signature(fn).parameters.items())[1:]:
        if pname in ext.CALLER_PARAMS or pname in SKIP_PARAMS or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if ext._is_file_param(p):
            continue
        kind = _param_type(p)
        if kind in ("number", "text"):
            out[pname] = kind
    return out


def _summary(fn) -> str:
    doc = inspect.getdoc(fn) or ""
    return doc.split("\n\n", 1)[0].replace("\n", " ").strip()


def _param_type(p) -> str:
    ann = p.annotation
    if ann in (int, float):
        return "number"
    if ann is bool:
        return "bool"
    if ann in (list, dict):
        return "list"
    if p.default is not p.empty and isinstance(p.default, bool):
        return "bool"
    if p.default is not p.empty and isinstance(p.default, (int, float)):
        return "number"
    return "text"


def _lister(fns: dict, param: str) -> Optional[str]:
    """The read function that lists the choices for a parameter, guessed from
    the names alone: category_id -> list_categories, drink -> list_drinks."""
    base = param[:-3] if param.endswith("_id") else param
    for cand in (f"list_{base}s", f"list_{base[:-1]}ies" if base.endswith("y") else None,
                 f"list_{base}es", f"list_{base}"):
        if cand and cand in fns and _no_arguments(fns[cand]):
            return cand
    return None


def _no_arguments(fn) -> bool:
    params = list(inspect.signature(fn).parameters.values())[1:]
    return all(p.default is not p.empty or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD) for p in params)


def _action_params(fn, fns: dict) -> Optional[list]:
    """The parameters a rule fills for a function, or None when one it would
    need cannot be given from a form (a file, a required list)."""
    ext = _extapi()
    out = []
    for pname, p in list(inspect.signature(fn).parameters.items())[1:]:
        if pname in ext.CALLER_PARAMS or pname in SKIP_PARAMS or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        required = p.default is p.empty
        kind = _param_type(p)
        if ext._is_file_param(p) or kind == "list":
            if required:
                return None
            continue
        out.append({"id": pname, "label": _pretty(pname), "type": kind, "required": required,
                    "pick": _lister(fns, pname) or "",
                    "default": None if required or p.default is None else p.default})
    return out


def _is_read(name: str) -> bool:
    return name.startswith(_extapi()._READ_PREFIXES)


def describe(app_id: str) -> Optional[dict]:
    """Everything a rule can use from one app."""
    fns = api_functions(app_id)
    if not fns:
        return None
    m = _extapi()._manifest(app_id)
    events, actions, reads = [], [], []
    routes = _route_events(app_id)
    by_name = {}
    for name in list(routes) + sorted(n for n in fns if not _is_read(n)):
        if name in by_name:
            continue
        # The same event may come from the app's screen or from the External
        # API; its values are what either of them carries.
        kinds = dict(routes.get(name) or {})
        for k, v in (_function_fields(fns[name]) if name in fns else {}).items():
            kinds.setdefault(k, v)
        ev = {"id": name, "label": _pretty(name), "summary": _summary(fns[name]) if name in fns else "",
              "fields": [{"id": k, "label": _pretty(k), "type": v, "pick": _lister(fns, k) or ""}
                         for k, v in kinds.items()]}
        by_name[name] = ev
        events.append(ev)
    for name, fn in sorted(fns.items()):
        if _is_read(name):
            if _no_arguments(fn):
                reads.append({"id": name, "label": _pretty(name), "summary": _summary(fn)})
            continue
        ps = _action_params(fn, fns)
        if ps is not None:
            actions.append({"id": name, "label": _pretty(name), "summary": _summary(fn), "params": ps})
    return {"id": app_id, "name": m.get("name") or app_id, "name_i18n": m.get("name_i18n"),
            "icon": m.get("icon") or "📦",
            "events": events, "reads": reads, "actions": actions}


def catalog() -> dict:
    hub = _hub()
    out = {}
    for app_id in (hub._detect_app_apis() if hub else []):
        try:
            d = describe(app_id)
        except Exception:
            d = None
        if d:
            out[app_id] = d
    return dict(sorted(out.items(), key=lambda kv: kv[1]["name"].lower()))


def run_function(app_id: str, fname: str, user_id: str, kwargs: dict):
    """Call one app_api function as user_id, confined to the app's folder."""
    fn = api_functions(app_id).get(fname)
    if fn is None:
        raise RuleError(f"{app_id}.{fname} is not available")
    with _hub()._confine_app(app_id):
        result = fn(user_id, **kwargs)
        if inspect.isawaitable(result):
            result = asyncio.run(_await(result))
    return result


async def _await(aw):
    return await aw


def flatten(value, prefix: str = "", out: Optional[dict] = None, depth: int = 0) -> dict:
    """path -> number for every number in a result; a list gives its length."""
    out = {} if out is None else out
    if depth > 4 or len(out) > 200:
        return out
    if isinstance(value, bool):
        return out
    if isinstance(value, (int, float)):
        out[prefix or "value"] = value
    elif isinstance(value, list):
        out[(prefix + "." if prefix else "") + "count"] = len(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            flatten(v, (prefix + "." if prefix else "") + str(k), out, depth + 1)
    return out


def own_value(app_id: str, fname: str, field: str, user_id: str):
    if fname not in {r["id"] for r in (describe(app_id) or {}).get("reads", [])}:
        raise RuleError(f"{app_id}.{fname} is not available")
    found = flatten(run_function(app_id, fname, user_id, {})).get(field)
    if found is None:
        raise RuleError(f"{fname}: no value '{field}'")
    return found


def own_options(app_id: str, fname: str, param: str, user_id: str) -> list:
    """Choices for an action's parameter, from the app's own list function."""
    spec = next((a for a in (describe(app_id) or {}).get("actions", []) if a["id"] == fname), None)
    p = next((p for p in (spec or {}).get("params", []) if p["id"] == param), None)
    return _pick(app_id, p, user_id)


def event_options(app_id: str, event: str, param: str, user_id: str) -> list:
    """Choices for a value an event carries, such as which task."""
    spec = next((e for e in (describe(app_id) or {}).get("events", []) if e["id"] == event), None)
    p = next((p for p in (spec or {}).get("fields", []) if p["id"] == param), None)
    return _pick(app_id, p, user_id)


def _pick(app_id: str, p: Optional[dict], user_id: str) -> list:
    if not p or not p["pick"]:
        return []
    items = run_function(app_id, p["pick"], user_id, {})
    if isinstance(items, dict):
        items = next((v for v in items.values() if isinstance(v, list)), [])
    out = []
    for i in items or []:
        if isinstance(i, dict) and i.get("id") not in (None, ""):
            label = i.get("name") or i.get("title") or i.get("label") or str(i["id"])
            out.append({"value": i["id"], "label": str(label)})
        elif isinstance(i, (str, int)):
            out.append({"value": i, "label": str(i)})
    return out[:300]


def own_fields(app_id: str, fname: str, user_id: str) -> list:
    if fname not in {r["id"] for r in (describe(app_id) or {}).get("reads", [])}:
        raise RuleError(f"{app_id}.{fname} is not available")
    values = flatten(run_function(app_id, fname, user_id, {}))
    return [{"id": k, "label": k.replace("_", " ").replace(".", " › "), "value": v} for k, v in values.items()]


def call_kwargs(spec: dict, given: dict, fn) -> dict:
    """Parameters for one action, typed as the function expects them."""
    kwargs = {}
    for p in spec["params"]:
        v = given.get(p["id"])
        if v in (None, ""):
            if p["required"]:
                raise RuleError(f"'{p['id']}' is missing")
            continue
        if p["type"] == "number":
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise RuleError(f"'{p['id']}' is not a number")
            if v == int(v) and inspect.signature(fn).parameters[p["id"]].annotation is int:
                v = int(v)
        elif p["type"] == "bool":
            v = v in (True, "true", "1", 1)
        else:
            v = str(v)[:MAX_TEXT]
        kwargs[p["id"]] = v
    return kwargs


# ── Running a rule ────────────────────────────────────────────────

class Ctx:
    """What one run of one rule knows. The Premium module receives the same
    object for the steps it takes over."""

    def __init__(self, row: dict, event: str, data: Optional[dict] = None):
        self.rule_id = row["id"]
        self.name = row["name"]
        self.uid = row["user_id"]
        self.app = row["app"]
        self.event = event
        self.data = data or {}   # what the event itself carried (task_id, amount_ml, ...)
        self.day = datetime.now().strftime("%Y-%m-%d")
        self.once = False


def _number(v):
    if isinstance(v, bool) or v is None:
        raise RuleError("not a number")
    try:
        return float(v)
    except (TypeError, ValueError):
        raise RuleError("not a number")


def _fmt(v) -> str:
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(round(v, 2)) if isinstance(v, float) else str(v)


def _value(ctx: Ctx, c: dict):
    if c["app"] == ctx.app:
        return own_value(c["app"], c["fn"], c["field"], ctx.uid)
    prem = premium()
    if not prem:
        raise Premium()
    return prem.value(sys.modules[__name__], ctx, c)


def _same(a, b) -> bool:
    a, b = str(a).strip(), str(b).strip()
    if a == b:
        return True
    try:
        return float(a) == float(b)
    except ValueError:
        return False


def _event_condition(ctx: Ctx, c: dict) -> tuple:
    """A value the event carried. Missing — Run now, a time of day, a request
    without it — means the condition does not hold."""
    v = ctx.data.get(c["param"])
    if v is None:
        return False, f"{c['param']} —"
    if c.get("type") == "number":
        try:
            left = _number(v)
        except RuleError:
            return False, f"{c['param']} {v}"
        return OPS[c["op"]](left, _number(c["value"])), f"{c['param']} {_fmt(left)} {c['op']} {_fmt(c['value'])}"
    ok = _same(v, c["value"]) == (c["op"] == "==")
    return ok, f"{c['param']} {v} {c['op']} {c['value']}"


def _evaluate(ctx: Ctx, conditions: list, match: str = "all") -> tuple:
    """(holds, journal note). all: every condition must hold, stopping at the
    first that does not; any: one is enough, stopping at the first that does."""
    if not conditions:
        return True, ""
    want_any = match == "any"
    notes = []
    # What the event carried costs nothing to check; values are read after.
    for c in sorted(conditions, key=lambda c: c.get("source") != "event"):
        if c.get("source") == "event":
            ok, note = _event_condition(ctx, c)
            notes.append(note + ("" if ok else " ✗"))
            if ok == want_any:
                return ok, "; ".join(notes)
            continue
        left = _number(_value(ctx, c))
        right = _number(c["value"])
        ok = OPS[c["op"]](left, right)
        notes.append(f"{c['app']}.{c['field']} {_fmt(left)} {c['op']} {_fmt(right)}" + ("" if ok else " ✗"))
        if ok == want_any:
            return ok, "; ".join(notes)
    return not want_any, "; ".join(notes)


def _fill(text: str, ctx: Ctx) -> str:
    return str(text or "").replace("{day}", ctx.day).replace("{rule}", ctx.name)


def _act_notify(ctx: Ctx, action: dict) -> str:
    from . import notifications
    notifications.notify_hub_user(APP_ID, user_id=ctx.uid,
                                  title=_fill(action.get("title"), ctx)[:120] or ctx.name,
                                  body=_fill(action.get("body"), ctx)[:MAX_TEXT])
    return "notify"


def _act_call(ctx: Ctx, action: dict) -> str:
    """A function of the trigger's own app, as the profile that owns the rule."""
    spec = next((a for a in (describe(ctx.app) or {}).get("actions", []) if a["id"] == action["fn"]), None)
    if spec is None:
        raise RuleError(f"{ctx.app}.{action['fn']} is not available")
    fn = api_functions(ctx.app)[action["fn"]]
    kwargs = call_kwargs(spec, action.get("params") or {}, fn)
    sig = inspect.signature(fn).parameters
    if "source_app" in sig:
        kwargs["source_app"] = APP_ID
    if "source_app_name" in sig:
        kwargs["source_app_name"] = "Automations"
    if "idempotency_key" in sig and ctx.once:
        kwargs["idempotency_key"] = f"automation:{ctx.rule_id}:{ctx.day}"
    run_function(ctx.app, action["fn"], ctx.uid, kwargs)
    return f"{ctx.app}.{action['fn']}"


def _do(ctx: Ctx, action: dict) -> str:
    kind = action.get("type")
    if kind == "notify":
        return _act_notify(ctx, action)
    if kind == "call" and action.get("app") == ctx.app:
        return _act_call(ctx, action)
    prem = premium()
    if not prem:
        raise Premium()
    return str(prem.action(sys.modules[__name__], ctx, action))


_runs: dict = {}
_limited: set = set()


def _rate_ok(rule_id: int) -> bool:
    now = time.time()
    q = _runs.setdefault(rule_id, deque())
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= MAX_RUNS_PER_HOUR:
        return False
    q.append(now)
    _limited.discard(rule_id)
    return True


def _journal(rule_id: int, status: str, detail: str = ""):
    with get_conn() as conn:
        conn.execute("INSERT INTO automation_runs(automation_id,ran_at,status,detail) VALUES(?,?,?,?)",
                     (rule_id, _now(), status, detail[:600]))
        conn.execute(
            "DELETE FROM automation_runs WHERE automation_id=? AND id NOT IN "
            "(SELECT id FROM automation_runs WHERE automation_id=? ORDER BY id DESC LIMIT ?)",
            (rule_id, rule_id, JOURNAL_KEEP))
        conn.execute("UPDATE automations SET last_run=?, last_status=? WHERE id=?", (_now(), status, rule_id))
        conn.commit()


def _claim(rule_id: int, claim: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("INSERT OR IGNORE INTO automation_once(automation_id,claim) VALUES(?,?)",
                           (rule_id, claim))
        conn.commit()
        return bool(cur.rowcount)


def _release(rule_id: int, claim: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM automation_once WHERE automation_id=? AND claim=?", (rule_id, claim))
        conn.commit()


def execute(row: dict, event: str, data: Optional[dict] = None) -> dict:
    """Run one rule once and journal what happened."""
    rid = row["id"]
    if not _rate_ok(rid):
        if rid not in _limited:
            _limited.add(rid)
            _journal(rid, "limited", f"Paused: more than {MAX_RUNS_PER_HOUR} runs in an hour")
        return {"status": "limited"}
    claim = None
    try:
        spec = json.loads(row["rule"])
        ctx = Ctx(row, event, data)
        ok, detail = _evaluate(ctx, spec.get("conditions") or [], spec.get("match") or "all")
        if not ok:
            _journal(rid, "skipped", detail)
            return {"status": "skipped", "detail": detail}
        ctx.once = spec.get("limit") == "day"
        if ctx.once:
            claim = f"day:{ctx.day}"
            if not _claim(rid, claim):
                _journal(rid, "skipped", "Already ran today")
                return {"status": "skipped", "detail": "already ran today"}
        done = []
        try:
            for action in spec.get("actions") or []:
                done.append(_do(ctx, action))
        except Exception:
            if claim and not done:
                _release(rid, claim)
            raise
        _journal(rid, "ok", (detail + " " if detail else "") + "→ " + ", ".join(done))
        return {"status": "ok"}
    except Premium:
        _journal(rid, "premium", "Needs Premium")
        return {"status": "premium"}
    except Exception as e:
        msg = str(e)[:300] or e.__class__.__name__
        _journal(rid, "failed", msg)
        return {"status": "failed", "detail": msg}


# ── Events ────────────────────────────────────────────────────────

_listened = {"at": 0.0, "set": frozenset()}
_lock = threading.Lock()
_backlog = 0
_pool: Optional[ThreadPoolExecutor] = None


def invalidate():
    _listened["at"] = 0.0


def _listening(app_id: str, event: str) -> bool:
    now = time.monotonic()
    if now - _listened["at"] > REFRESH_SECONDS:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT app, event FROM automations WHERE enabled=1 AND event IS NOT NULL").fetchall()
        _listened["set"] = frozenset((r["app"], r["event"]) for r in rows)
        _listened["at"] = now
    return (app_id, event) in _listened["set"] if event else any(a == app_id for a, _ in _listened["set"])


MAX_EVENT_BODY = 64 * 1024
MAX_EVENT_VALUES = 50


def event_data(*sources) -> dict:
    """The plain values an event carried — numbers and short texts only."""
    out = {}
    for src in sources:
        for k, v in (src or {}).items() if isinstance(src, dict) else ():
            if len(out) >= MAX_EVENT_VALUES:
                return out
            if isinstance(v, bool) or v is None or not isinstance(v, (str, int, float)):
                continue
            out[str(k)[:60]] = v[:MAX_TEXT] if isinstance(v, str) else v
    return out


def _submit(fn, *args) -> None:
    global _backlog, _pool
    with _lock:
        if _backlog >= MAX_BACKLOG:
            return
        _backlog += 1
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="automations")

    def job():
        global _backlog
        try:
            fn(*args)
        except Exception:
            pass
        finally:
            with _lock:
                _backlog -= 1

    try:
        # A fresh context: the worker must not inherit the caller's
        # confinement to its app's folder.
        import contextvars
        _pool.submit(contextvars.Context().run, job)
    except Exception:
        with _lock:
            _backlog -= 1


def _run_event(app_id: str, event: str, user_id: Optional[str], token: Optional[str],
               data: Optional[dict] = None):
    if not user_id:
        hub = _hub()
        profile = hub.get_pub_session(token) if (hub and token) else None
        user_id = profile and profile["id"]
    if not user_id:
        return
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM automations WHERE user_id=? AND enabled=1 AND app=? AND event=? ORDER BY id",
            (str(user_id), app_id, event)).fetchall()
    for row in rows:
        execute(dict(row), event, data)


def notice(app_id: str, event: str, user_id: Optional[str] = None, token: Optional[str] = None,
           data: Optional[dict] = None) -> None:
    """Something was done in an app, by a profile given by id or by its Apps
    Hub token, carrying data (the values it was done with). Never raises and
    never waits."""
    try:
        if (user_id or token) and _listening(app_id, event):
            _submit(_run_event, app_id, event, user_id, token, event_data(data))
    except Exception:
        pass


async def _small_json(request) -> Optional[dict]:
    """The request's JSON body, read only when it is small JSON — never an
    upload. Starlette keeps it for the route that reads it next."""
    if not (request.headers.get("content-type") or "").startswith("application/json"):
        return None
    try:
        if int(request.headers.get("content-length") or 0) > MAX_EVENT_BODY:
            return None
        body = await request.body()
        return json.loads(body) if body else None
    except Exception:
        return None


async def watch_requests(request, call_next):
    """Middleware: a successful write request to an app's own routes is an
    event named by the route's handler, carrying the values in its address
    and its JSON body."""
    body, app_id, token = None, "", None
    try:
        path = request.url.path
        if request.method in WRITE_METHODS and path.startswith("/pub/"):
            app_id = path.split("/", 3)[2]
            token = request.headers.get("x-pub-token")
            # The body is read only when some rule listens to this app at all.
            if token and app_id != APP_ID and _listening(app_id, ""):
                body = await _small_json(request)
    except Exception:
        pass
    response = await call_next(request)
    try:
        if token and response.status_code < 400:
            endpoint = request.scope.get("endpoint")
            if (endpoint is not None and app_id != APP_ID
                    and getattr(endpoint, "__module__", "") == f"app_public_{app_id}"):
                notice(app_id, endpoint.__name__, token=token,
                       data=event_data(body, request.scope.get("path_params")))
    except Exception:
        pass
    return response


_last_tick = {"minute": ""}


def tick(now: datetime) -> None:
    """Called by the scheduler's one-minute tick: start the rules set for this
    minute. One indexed lookup, nothing when no rule is set for it."""
    stamp = now.strftime("%Y-%m-%d %H:%M")
    if _last_tick["minute"] == stamp:
        return
    _last_tick["minute"] = stamp
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM automations WHERE enabled=1 AND schedule=? ORDER BY id",
                            (now.strftime("%H:%M"),)).fetchall()
    for row in rows:
        _submit(execute, dict(row), "")


# ── Saving a rule ─────────────────────────────────────────────────

class RuleBody(BaseModel):
    name: str
    enabled: bool = True
    trigger: dict
    conditions: list = []
    actions: list = []
    limit: str = "none"
    match: str = "all"


def _fail(code: str = "auto_error_rule"):
    raise HTTPException(400, code)


def _clean_condition(c, cat: dict, app_id: str, event: Optional[dict]) -> tuple:
    if not isinstance(c, dict) or c.get("op") not in OPS:
        _fail()
    if c.get("source") == "event":
        f = next((f for f in (event or {}).get("fields", []) if f["id"] == c.get("param")), None)
        if f is None:
            _fail()
        if f["type"] == "number":
            try:
                value = float(c.get("value"))
            except (TypeError, ValueError):
                _fail("auto_error_number")
        else:
            if c["op"] not in ("==", "!="):
                _fail()
            value = str(c.get("value") if c.get("value") is not None else "").strip()[:MAX_TEXT]
            if not value:
                _fail("auto_error_condition")
        return {"source": "event", "param": f["id"], "type": f["type"], "op": c["op"], "value": value}, False
    app = str(c.get("app") or app_id)
    decl = cat.get(app)
    if not decl or c.get("fn") not in {r["id"] for r in decl["reads"]} or not c.get("field"):
        _fail()
    try:
        value = float(c.get("value"))
    except (TypeError, ValueError):
        _fail("auto_error_number")
    return {"app": app, "fn": c["fn"], "field": str(c["field"])[:120], "op": c["op"], "value": value}, app != app_id


def _clean_action(a, cat: dict, app_id: str) -> tuple:
    if not isinstance(a, dict):
        _fail()
    kind = a.get("type")
    if kind == "notify":
        return {"type": "notify", "title": str(a.get("title") or "")[:120],
                "body": str(a.get("body") or "")[:MAX_TEXT]}, False
    if kind == "webhook":
        url = str(a.get("url") or "").strip()
        if not re.match(r"^https?://[^\s/]+", url) or len(url) > 1000:
            _fail("auto_error_url")
        return {"type": "webhook", "url": url, "body": str(a.get("body") or "")[:MAX_TEXT]}, True
    if kind != "call":
        _fail()
    app = str(a.get("app") or app_id)
    decl = cat.get(app)
    spec = next((x for x in (decl or {}).get("actions", []) if x["id"] == a.get("fn")), None)
    if spec is None:
        _fail()
    allowed = {p["id"]: p for p in spec["params"]}
    params = {}
    for k, v in (a.get("params") or {}).items():
        if k not in allowed:
            _fail()
        if isinstance(v, (str, int, float, bool)) and v != "":
            params[k] = v[:MAX_TEXT] if isinstance(v, str) else v
    for p in spec["params"]:
        if p["required"] and params.get(p["id"]) in (None, ""):
            _fail("auto_error_missing")
        if p["type"] == "number" and p["id"] in params:
            try:
                float(params[p["id"]])
            except (TypeError, ValueError):
                _fail("auto_error_number")
    return {"type": "call", "app": app, "fn": spec["id"], "params": params}, app != app_id


def _clean_rule(body: RuleBody) -> tuple:
    """(columns, rule json, goes beyond one app)"""
    cat = catalog()
    name = body.name.strip()
    if not name or len(name) > MAX_NAME:
        _fail("auto_error_name")
    trig = body.trigger or {}
    app_id = trig.get("app")
    decl = cat.get(app_id)
    if decl is None:
        _fail()
    event, schedule = trig.get("event") or None, trig.get("time") or None
    if event:
        if event not in {e["id"] for e in decl["events"]}:
            _fail()
        schedule = None
    elif schedule:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(schedule)):
            _fail("auto_error_time")
    else:
        _fail()
    if body.limit not in LIMITS or body.match not in MATCHES:
        _fail()
    if len(body.conditions) > MAX_CONDITIONS or len(body.actions) > MAX_ACTIONS:
        _fail()
    if not body.actions:
        _fail("auto_error_no_action")
    cross = False
    conditions, actions = [], []
    ev = next((e for e in decl["events"] if e["id"] == event), None) if event else None
    for c in body.conditions:
        clean, x = _clean_condition(c, cat, app_id, ev)
        cross = cross or x
        conditions.append(clean)
    for a in body.actions:
        clean, x = _clean_action(a, cat, app_id)
        cross = cross or x
        actions.append(clean)
    spec = {"conditions": conditions, "match": body.match, "actions": actions, "limit": body.limit}
    if len(json.dumps(spec)) > MAX_RULE_BYTES:
        _fail()
    return {"name": name, "enabled": 1 if body.enabled else 0, "app": app_id,
            "event": event, "schedule": schedule}, spec, cross


def _needs_premium(spec: dict, app_id: str) -> bool:
    return any(c.get("source") != "event" and c.get("app") != app_id
               for c in spec.get("conditions") or []) or any(
        a.get("type") == "webhook" or (a.get("type") == "call" and a.get("app") != app_id)
        for a in spec.get("actions") or [])


def _row_out(row) -> dict:
    spec = json.loads(row["rule"])
    return {
        "id": row["id"], "name": row["name"], "enabled": bool(row["enabled"]),
        "trigger": {"app": row["app"], "event": row["event"], "time": row["schedule"]},
        "conditions": spec.get("conditions") or [], "actions": spec.get("actions") or [],
        "limit": spec.get("limit") or "none",
        "match": spec.get("match") or "all",
        "premium": _needs_premium(spec, row["app"]),
        "last_run": row["last_run"], "last_status": row["last_status"],
    }


# ── Who is asking ─────────────────────────────────────────────────

def _who(session, x_pub_token: Optional[str], surface: Optional[str]) -> str:
    hub = _hub()
    profile = hub.get_pub_session(x_pub_token) if (hub and x_pub_token) else None
    if not profile:
        raise HTTPException(401, "auto_signin")
    # The public page exists only when the administrator turned it on; the API
    # behind it respects that, or switching it off would be cosmetic.
    if not (surface == "desktop" and session) and not hub.is_app_public(APP_ID):
        raise HTTPException(403, "auto_public_off")
    return profile["id"]


def _owned(conn, rule_id: int, user_id: str):
    row = conn.execute("SELECT * FROM automations WHERE id=? AND user_id=?", (rule_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "auto_error_gone")
    return row


async def _thread(fn, *args):
    from starlette.concurrency import run_in_threadpool
    try:
        return await run_in_threadpool(fn, *args)
    except RuleError as e:
        raise HTTPException(400, str(e))


def _premium_for(trigger: str, app: str):
    """None for the trigger's own app; the Premium module for another one, or
    404 — without it other apps simply do not exist here."""
    if app == trigger:
        return None
    prem = premium()
    if not prem:
        raise HTTPException(404, "auto_error_gone")
    return prem


# ── Routes ────────────────────────────────────────────────────────

@router.get("/api/meta")
@_open
async def meta(session=Depends(get_current_session_optional),
               x_pub_token: str = Header(default=None),
               x_mvm_surface: str = Header(default=None)):
    _who(session, x_pub_token, x_mvm_surface)
    cross = bool(premium())
    return JSONResponse({
        "cross": cross,
        "apps": list((await _thread(catalog)).values()),
        "limits": {"rules": MAX_RULES, "conditions": MAX_CONDITIONS, "actions": MAX_ACTIONS, "name": MAX_NAME},
    })


@router.get("/api/rules")
@_open
async def list_rules(session=Depends(get_current_session_optional),
                     x_pub_token: str = Header(default=None),
                     x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM automations WHERE user_id=? ORDER BY id", (uid,)).fetchall()
    return JSONResponse({"rules": [_row_out(r) for r in rows]})


def _save(uid: str, body: RuleBody, rule_id: Optional[int]) -> dict:
    cols, spec, cross = _clean_rule(body)
    if cross and not premium():
        raise HTTPException(402, "premium_required")
    now = _now()
    with get_conn() as conn:
        if rule_id is None:
            if conn.execute("SELECT COUNT(*) FROM automations WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_RULES:
                raise HTTPException(400, "auto_error_limit")
            cur = conn.execute(
                "INSERT INTO automations(user_id,name,enabled,app,event,schedule,rule,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (uid, cols["name"], cols["enabled"], cols["app"], cols["event"], cols["schedule"],
                 json.dumps(spec), now, now))
            rule_id = cur.lastrowid
        else:
            _owned(conn, rule_id, uid)
            conn.execute(
                "UPDATE automations SET name=?,enabled=?,app=?,event=?,schedule=?,rule=?,updated_at=? WHERE id=?",
                (cols["name"], cols["enabled"], cols["app"], cols["event"], cols["schedule"],
                 json.dumps(spec), now, rule_id))
            conn.execute("DELETE FROM automation_once WHERE automation_id=?", (rule_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM automations WHERE id=?", (rule_id,)).fetchone()
    invalidate()
    return _row_out(row)


@router.post("/api/rules")
@_open
async def create_rule(body: RuleBody, session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    return JSONResponse(await _thread(_save, uid, body, None))


@router.put("/api/rules/{rule_id}")
@_open
async def update_rule(rule_id: int, body: RuleBody, session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    return JSONResponse(await _thread(_save, uid, body, rule_id))


class EnabledBody(BaseModel):
    enabled: bool


@router.put("/api/rules/{rule_id}/enabled")
@_open
async def set_enabled(rule_id: int, body: EnabledBody, session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        row = _owned(conn, rule_id, uid)
        if body.enabled and _needs_premium(json.loads(row["rule"]), row["app"]) and not premium():
            raise HTTPException(402, "premium_required")
        conn.execute("UPDATE automations SET enabled=? WHERE id=?", (1 if body.enabled else 0, rule_id))
        conn.commit()
    invalidate()
    return JSONResponse({"ok": True})


@router.delete("/api/rules/{rule_id}")
@_open
async def delete_rule(rule_id: int, session=Depends(get_current_session_optional),
                      x_pub_token: str = Header(default=None),
                      x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        _owned(conn, rule_id, uid)
        for table, col in (("automation_runs", "automation_id"), ("automation_once", "automation_id"),
                           ("automations", "id")):
            conn.execute(f"DELETE FROM {table} WHERE {col}=?", (rule_id,))
        conn.commit()
    _runs.pop(rule_id, None)
    invalidate()
    return JSONResponse({"ok": True})


@router.get("/api/rules/{rule_id}/log")
@_open
async def rule_log(rule_id: int, session=Depends(get_current_session_optional),
                   x_pub_token: str = Header(default=None),
                   x_mvm_surface: str = Header(default=None)):
    uid = _who(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        _owned(conn, rule_id, uid)
        rows = conn.execute("SELECT ran_at,status,detail FROM automation_runs WHERE automation_id=? "
                            "ORDER BY id DESC", (rule_id,)).fetchall()
    return JSONResponse({"log": [dict(r) for r in rows]})


@router.post("/api/rules/{rule_id}/run")
@_open
async def run_now(rule_id: int, session=Depends(get_current_session_optional),
                  x_pub_token: str = Header(default=None),
                  x_mvm_surface: str = Header(default=None)):
    """Run a rule right now, as if its event had just happened."""
    uid = _who(session, x_pub_token, x_mvm_surface)
    with get_conn() as conn:
        row = dict(_owned(conn, rule_id, uid))
    return JSONResponse(await _thread(execute, row, row["event"] or ""))


@router.get("/api/fields")
@_open
async def fields(trigger: str, app: str, fn: str, session=Depends(get_current_session_optional),
                 x_pub_token: str = Header(default=None),
                 x_mvm_surface: str = Header(default=None)):
    """The numbers a read function returns right now, to compare in a rule."""
    uid = _who(session, x_pub_token, x_mvm_surface)
    prem = _premium_for(trigger, app)
    if prem:
        return JSONResponse({"fields": await _thread(prem.fields, sys.modules[__name__], app, fn, uid)})
    return JSONResponse({"fields": await _thread(own_fields, app, fn, uid)})


@router.get("/api/options")
@_open
async def options(trigger: str, app: str, fn: str, param: str,
                  session=Depends(get_current_session_optional),
                  x_pub_token: str = Header(default=None),
                  x_mvm_surface: str = Header(default=None)):
    """The choices for an action's parameter, from the app's own list."""
    uid = _who(session, x_pub_token, x_mvm_surface)
    prem = _premium_for(trigger, app)
    if prem:
        return JSONResponse({"options": await _thread(prem.options, sys.modules[__name__], app, fn, param, uid)})
    return JSONResponse({"options": await _thread(own_options, app, fn, param, uid)})


@router.get("/api/event-options")
@_open
async def event_choices(app: str, event: str, param: str, session=Depends(get_current_session_optional),
                        x_pub_token: str = Header(default=None),
                        x_mvm_surface: str = Header(default=None)):
    """The choices for a value an event carries — always the trigger's own
    app, so it needs nothing beyond it."""
    uid = _who(session, x_pub_token, x_mvm_surface)
    return JSONResponse({"options": await _thread(event_options, app, event, param, uid)})


@router.get("/ui.js")
@_open
async def ui_script():
    """The editor, shared by the desktop window and the public page."""
    return FileResponse(os.path.join(_PUB_DIR, "automations-ui.js"), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})


@router.get("/")
async def public_index():
    from .apphub import is_app_public, private_page
    if not is_app_public(APP_ID):
        return private_page("Automations", "⚡")
    from .assets import asset
    with open(os.path.join(_PUB_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(html.replace("'/pub/automations/ui.js'", repr(asset("/pub/automations/ui.js"))))


# ── Settings (desktop) ────────────────────────────────────────────

class SettingsBody(BaseModel):
    cross: bool


@desktop_router.get("/settings")
async def get_settings(session=Depends(get_current_session)):
    mod = _premium_module()
    return JSONResponse({"available": bool(mod), "cross": bool(mod) and _cross_setting(),
                         "owner": user_can_sudo(session["effective_user"])})


@desktop_router.put("/settings")
async def put_settings(body: SettingsBody, session=Depends(get_current_session)):
    """Rules between apps are the owner's switch for the whole server; it can
    be turned on only where the Premium module is."""
    if not user_can_sudo(session["effective_user"]):
        raise HTTPException(403, "auto_owner_only")
    if body.cross and not _premium_module():
        raise HTTPException(402, "premium_required")
    with get_conn() as conn:
        conn.execute("INSERT INTO automation_settings(user_id,cross) VALUES(?,?) "
                     "ON CONFLICT(user_id) DO UPDATE SET cross=excluded.cross", (_GLOBAL, 1 if body.cross else 0))
        conn.commit()
    return JSONResponse({"cross": body.cross})
