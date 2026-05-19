import os
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import Optional
from .db import get_conn

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")

router = APIRouter(prefix="/api/domains", tags=["domains"])


class SiteBody(BaseModel):
    app_id: str
    domain: Optional[str] = None   # e.g. test.mvmrik.com
    path: Optional[str] = None     # e.g. /site/my-blog


@router.get("")
def list_sites():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT d.id, d.domain, d.path, d.app_id, p.name, p.icon FROM domains d "
            "LEFT JOIN plugins p ON p.id = d.app_id ORDER BY d.created_at"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["files_path"] = os.path.join(BACKENDS_DIR, d["app_id"])
        result.append(d)
    return result


@router.post("")
def add_site(body: SiteBody):
    if not body.domain and not body.path:
        raise HTTPException(400, "Provide domain or path")

    domain = None
    path = None

    if body.domain:
        domain = body.domain.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")

    if body.path:
        path = "/" + body.path.strip().strip("/")

    with get_conn() as conn:
        app = conn.execute("SELECT id FROM plugins WHERE id = ?", (body.app_id,)).fetchone()
        if not app:
            raise HTTPException(404, "App not found")
        if domain:
            if conn.execute("SELECT id FROM domains WHERE domain = ?", (domain,)).fetchone():
                raise HTTPException(409, "Domain already mapped")
        if path:
            if conn.execute("SELECT id FROM domains WHERE path = ?", (path,)).fetchone():
                raise HTTPException(409, "Path already mapped")
        conn.execute(
            "INSERT INTO domains (domain, path, app_id) VALUES (?, ?, ?)",
            (domain, path, body.app_id)
        )
    return {"ok": True}


@router.delete("/{site_id}")
def delete_site(site_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM domains WHERE id = ?", (site_id,))
    return {"ok": True}
