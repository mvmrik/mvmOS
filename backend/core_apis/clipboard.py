"""
Clipboard's API — what a script, a program or another part of mvmOS may do
with the clipboard of one mvmOS login.

user_id is always the Linux username of an mvmOS desktop login: an owner's
External API token acts as that login, and core code calling in-process passes
the username it already knows. The items are the same ones the Clipboard window
shows for that login.
"""

import os

from fastapi import HTTPException, UploadFile

from .. import clipboard as clip
from ..db import get_conn

AUDIENCE = "os"


def _ids(user_id: str) -> list:
    return [(AUDIENCE, user_id)]


def _file_result(row):
    from ..extapi import ApiFile
    path = clip._file_path(row["stored"])
    if not os.path.isfile(path):
        raise HTTPException(404, "The file is no longer there")
    return ApiFile(path=path, name=row["name"] or "file")


def list_items(user_id: str):
    """Every item in the clipboard, newest first. Text items carry their text;
    file items carry name, type and size (use download_file for the content)."""
    clip.purge_expired()
    where, params = clip._where(_ids(user_id))
    with get_conn() as conn:
        rows = conn.execute(f"SELECT * FROM clipboard_items WHERE {where} ORDER BY id DESC", params).fetchall()
    return [clip._public_row(r) for r in rows]


def get_item(user_id: str, item_id: int):
    """One item by its id."""
    with get_conn() as conn:
        return clip._public_row(clip._owned(conn, int(item_id), _ids(user_id)))


def download_file(user_id: str, item_id: int):
    """The content of a file item, sent back as the file itself."""
    with get_conn() as conn:
        row = clip._owned(conn, int(item_id), _ids(user_id))
    if row["kind"] != "file" or not row["stored"]:
        raise HTTPException(400, "This item is text, not a file")
    return _file_result(row)


def add_text(user_id: str, text: str):
    """Add a text item. It is removed after 24 hours unless it is pinned."""
    return clip._add_text(AUDIENCE, user_id, str(text))


async def add_file(user_id: str, file: UploadFile):
    """Add a file, such as a screenshot, sent as multipart form data in the
    field "file". It is removed after 24 hours unless it is pinned."""
    return await clip._add_file(file, AUDIENCE, user_id)


def pin_item(user_id: str, item_id: int, pinned: bool = True):
    """Pin an item so it is kept until it is deleted, or unpin it so it expires
    24 hours from now."""
    with get_conn() as conn:
        clip._owned(conn, int(item_id), _ids(user_id))
        conn.execute(
            "UPDATE clipboard_items SET pinned = ?, expires_at = ? WHERE id = ?",
            (1 if pinned else 0, None if pinned else clip._expiry(), int(item_id)),
        )
        conn.commit()
    return {"ok": True}


def delete_item(user_id: str, item_id: int):
    """Delete one item, and its file if it has one."""
    with get_conn() as conn:
        row = clip._owned(conn, int(item_id), _ids(user_id))
        clip._remove_file(row["stored"])
        conn.execute("DELETE FROM clipboard_items WHERE id = ?", (int(item_id),))
        conn.commit()
    return {"ok": True}
