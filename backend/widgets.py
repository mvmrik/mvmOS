import httpx
import json
import os
import shutil
import time
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .auth import get_current_session
from .db import get_conn, WIDGETS_DIR

router = APIRouter(prefix="/api/widgets", tags=["widgets"])

_cache: dict = {}
_CACHE_TTL = 120


async def _fetch_json(url: str) -> dict:
    cached = _cache.get(url)
    if cached and time.time() - cached[1] < _CACHE_TTL:
        return cached[0]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    _cache[url] = (data, time.time())
    return data


def _installed_map() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM widgets").fetchall()
    return {r["id"]: dict(r) for r in rows}


def _annotate(widgets: list, installed: dict) -> list:
    result = []
    for w in widgets:
        inst = installed.get(w["id"])
        result.append({
            **w,
            "installed": inst is not None,
            "update_available": inst is not None and inst["version"] != w.get("version", ""),
        })
    return result


def _widget_dir(widget_id: str) -> str:
    return os.path.join(WIDGETS_DIR, widget_id)


# ── Widget stores ─────────────────────────────────────────────────────────────

@router.get("/stores")
async def list_stores(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM widget_stores ORDER BY official DESC, added_at").fetchall()
    return JSONResponse([dict(r) for r in rows])


class StoreRequest(BaseModel):
    name: str
    manifest_url: str


@router.post("/stores")
async def add_store(body: StoreRequest, session=Depends(get_current_session)):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(body.manifest_url)
            r.raise_for_status()
            data = r.json()
        if "categories" not in data and "widgets" not in data:
            return JSONResponse({"error": "Invalid manifest: must have 'categories' or 'widgets'"}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": f"Cannot reach manifest: {e}"}, status_code=400)
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO widget_stores (name, manifest_url, official) VALUES (?, ?, 0)",
                (body.name, body.manifest_url),
            )
        except Exception:
            return JSONResponse({"error": "Store already exists"}, status_code=409)
    return JSONResponse({"ok": True})


@router.delete("/stores/{store_id}")
async def remove_store(store_id: int, session=Depends(get_current_session)):
    with get_conn() as conn:
        row = conn.execute("SELECT official FROM widget_stores WHERE id=?", (store_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "Not found"}, status_code=404)
        if row["official"]:
            return JSONResponse({"error": "Cannot remove the official store"}, status_code=403)
        conn.execute("DELETE FROM widget_stores WHERE id=?", (store_id,))
    return JSONResponse({"ok": True})


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories")
async def get_categories(store_id: int = 0, widget_type: str = "",
                         session=Depends(get_current_session)):
    with get_conn() as conn:
        if store_id:
            row = conn.execute("SELECT manifest_url FROM widget_stores WHERE id=?", (store_id,)).fetchone()
        else:
            row = conn.execute("SELECT manifest_url FROM widget_stores WHERE official=1").fetchone()
    if not row:
        return JSONResponse({"error": "Store not found"}, status_code=404)
    try:
        data = await _fetch_json(row["manifest_url"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    cats = data.get("categories", [])
    # filter by widget_type if requested (taskbar/desktop)
    if widget_type:
        cats = [c for c in cats if not c.get("widget_type") or c.get("widget_type") == widget_type]
    return JSONResponse({"version": 2, "categories": cats})


@router.get("/category-widgets")
async def get_category_widgets(store_id: int = 0, category_url: str = "",
                                category_id: str = "", widget_type: str = "",
                                session=Depends(get_current_session)):
    if category_url:
        try:
            data = await _fetch_json(category_url)
            widgets = data.get("widgets", [])
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=502)
    else:
        with get_conn() as conn:
            if store_id:
                row = conn.execute("SELECT manifest_url FROM widget_stores WHERE id=?", (store_id,)).fetchone()
            else:
                row = conn.execute("SELECT manifest_url FROM widget_stores WHERE official=1").fetchone()
        if not row:
            return JSONResponse({"error": "Store not found"}, status_code=404)
        try:
            data = await _fetch_json(row["manifest_url"])
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=502)
        all_widgets = data.get("widgets", [])
        widgets = [w for w in all_widgets if w.get("category", "").lower() == category_id.lower()]

    if widget_type:
        widgets = [w for w in widgets if w.get("widget_type") == widget_type]

    installed = _installed_map()
    return JSONResponse(_annotate(widgets, installed))


# ── Installed widgets ─────────────────────────────────────────────────────────

@router.get("")
async def list_widgets(session=Depends(get_current_session)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT w.*, s.name as store_name, s.official "
            "FROM widgets w LEFT JOIN widget_stores s ON w.store_id = s.id "
            "ORDER BY w.taskbar_order, w.installed_at"
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


# ── Install ───────────────────────────────────────────────────────────────────

class InstallRequest(BaseModel):
    id: str
    name: str
    icon: str = "🔲"
    category: str = "System"
    version: str = "1.0.0"
    description: str = ""
    widget_type: str = "taskbar"
    base_url: str = ""
    js_url: str = ""
    store_id: int = 0


@router.post("/install")
async def install_widget(body: InstallRequest, session=Depends(get_current_session)):
    wdir = _widget_dir(body.id)
    os.makedirs(wdir, exist_ok=True)

    async with httpx.AsyncClient(timeout=15) as client:
        if body.base_url:
            try:
                mf_r = await client.get(body.base_url.rstrip("/") + "/manifest.json")
                mf_r.raise_for_status()
                mf = mf_r.json()
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch widget manifest: {e}"}, status_code=502)
            with open(os.path.join(wdir, "manifest.json"), "w") as f:
                json.dump(mf, f)
            entry = mf.get("entry", "main.js")
            try:
                js_r = await client.get(body.base_url.rstrip("/") + "/" + entry)
                js_r.raise_for_status()
                with open(os.path.join(wdir, entry), "w") as f:
                    f.write(js_r.text)
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch widget JS: {e}"}, status_code=502)
            css_file = mf.get("css")
            if css_file:
                try:
                    css_r = await client.get(body.base_url.rstrip("/") + "/" + css_file)
                    if css_r.status_code == 200:
                        with open(os.path.join(wdir, css_file), "w") as f:
                            f.write(css_r.text)
                except Exception:
                    pass
        else:
            try:
                js_r = await client.get(body.js_url)
                js_r.raise_for_status()
            except Exception as e:
                return JSONResponse({"error": f"Cannot fetch widget: {e}"}, status_code=502)
            with open(os.path.join(wdir, "main.js"), "w") as f:
                f.write(js_r.text)
            mf = {"id": body.id, "name": body.name, "icon": body.icon,
                  "widget_type": body.widget_type, "entry": "main.js"}
            with open(os.path.join(wdir, "manifest.json"), "w") as f:
                json.dump(mf, f)

    with get_conn() as conn:
        # taskbar_order = max + 1
        max_order = conn.execute("SELECT COALESCE(MAX(taskbar_order),0) FROM widgets").fetchone()[0]
        conn.execute(
            """INSERT OR REPLACE INTO widgets
               (id, name, icon, category, version, description, widget_type, store_id, installed_at, taskbar_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), ?)""",
            (body.id, body.name, body.icon, body.category, body.version,
             body.description, body.widget_type, body.store_id or None, max_order + 1),
        )
    return JSONResponse({"ok": True})


# ── Uninstall ─────────────────────────────────────────────────────────────────

@router.delete("/{widget_id}")
async def uninstall_widget(widget_id: str, session=Depends(get_current_session)):
    wdir = _widget_dir(widget_id)
    if os.path.isdir(wdir):
        shutil.rmtree(wdir)
    with get_conn() as conn:
        conn.execute("DELETE FROM widgets WHERE id=?", (widget_id,))
    return JSONResponse({"ok": True})


# ── Reorder taskbar widgets ───────────────────────────────────────────────────

class ReorderRequest(BaseModel):
    order: list  # list of widget ids in new order


@router.post("/reorder")
async def reorder_widgets(body: ReorderRequest, session=Depends(get_current_session)):
    with get_conn() as conn:
        for i, wid in enumerate(body.order):
            conn.execute("UPDATE widgets SET taskbar_order=? WHERE id=?", (i, wid))
    return JSONResponse({"ok": True})


# ── Save desktop position ─────────────────────────────────────────────────────

class PositionRequest(BaseModel):
    x: int
    y: int


@router.post("/{widget_id}/position")
async def save_position(widget_id: str, body: PositionRequest, session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute("UPDATE widgets SET desktop_x=?, desktop_y=? WHERE id=?",
                     (body.x, body.y, widget_id))
    return JSONResponse({"ok": True})


# ── Save widget size ──────────────────────────────────────────────────────────

class SizeRequest(BaseModel):
    size: str

@router.post("/{widget_id}/size")
async def save_size(widget_id: str, body: SizeRequest, session=Depends(get_current_session)):
    with get_conn() as conn:
        conn.execute("UPDATE widgets SET size=? WHERE id=?", (body.size, widget_id))
    return JSONResponse({"ok": True})


# ── Per-widget SQLite db ──────────────────────────────────────────────────────

class DbRequest(BaseModel):
    sql: str
    params: list = []

@router.post("/{widget_id}/db")
async def widget_db(widget_id: str, body: DbRequest, session=Depends(get_current_session)):
    widget_dir = os.path.join(WIDGETS_DIR, widget_id)
    if not os.path.isdir(widget_dir):
        return JSONResponse({"error": "Widget not installed"}, status_code=404)
    db_path = os.path.join(widget_dir, "data.db")
    try:
        import sqlite3 as _sqlite3
        conn = _sqlite3.connect(db_path)
        conn.row_factory = _sqlite3.Row
        cur = conn.execute(body.sql, body.params)
        conn.commit()
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        conn.close()
        return JSONResponse({"rows": rows, "rowcount": cur.rowcount})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
