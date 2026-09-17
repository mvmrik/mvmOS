"""First-run wizard state.

The wizard is not a one-shot "has this box been set up" flag. It is versioned:
each step records the revision it first appeared in, and the installation
records the revision it last finished. An update that adds a step raises
REVISION, which puts the wizard back into the pending state and marks only the
steps the owner has not seen yet. Finishing it clears both at once, so a release
that changes nothing here never nags anyone.

Revision 0 means the wizard has never been completed — a fresh installation.
Nothing is marked "new" in that case, because everything is.
"""

import json
import os
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from .auth import get_current_session
from .db import get_conn

router = APIRouter(prefix="/api/wizard", tags=["wizard"])

_SETTINGS_KEY = "wizard"

# Order is the order the screens are shown in. "added_in" is the wizard
# revision a step first shipped in; raise REVISION below whenever a step is
# added or an existing one gains something worth coming back for.
STEPS = [
    {"id": "welcome", "added_in": 1},
    {"id": "regional", "added_in": 1},
    {"id": "privacy", "added_in": 1},
    {"id": "apps", "added_in": 1},
    {"id": "premium", "added_in": 1},
]

REVISION = max(step["added_in"] for step in STEPS)

_VERSION_FILE = os.path.join(os.path.dirname(__file__), "..", "version.txt")


def _version() -> str:
    """The welcome screen names the release it is introducing.

    It is read here rather than from /api/system/info because that endpoint
    shells out to df, free and uptime for a dashboard, and a welcome screen has
    no business paying for three subprocesses to print one string.
    """
    try:
        with open(_VERSION_FILE) as handle:
            return handle.read().strip() or ""
    except OSError:
        return ""


def _load() -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (_SETTINGS_KEY,)).fetchone()
    if not row:
        return {"completed_revision": 0, "completed_at": None}
    try:
        saved = json.loads(row["value"])
    except (TypeError, ValueError):
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    return {"completed_revision": 0, "completed_at": None, **saved}


def _save(state: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (_SETTINGS_KEY, json.dumps(state)),
        )


def _state_payload() -> dict:
    state = _load()
    done = int(state.get("completed_revision") or 0)
    return {
        "revision": REVISION,
        "version": _version(),
        "completed_revision": done,
        "completed_at": state.get("completed_at"),
        # Pending drives both the automatic launch on a fresh install and the
        # blue dot in Settings. It is the same condition, so there is only one.
        "pending": done < REVISION,
        "first_run": done == 0,
        "steps": [
            {
                "id": step["id"],
                "added_in": step["added_in"],
                # On a fresh install nothing is singled out as new.
                "is_new": done > 0 and step["added_in"] > done,
            }
            for step in STEPS
        ],
    }


@router.get("")
async def get_state(_session=Depends(get_current_session)):
    return JSONResponse(_state_payload())


@router.post("/complete")
async def complete(_session=Depends(get_current_session)):
    """Mark every current step as seen. Clears the blue dot and the new markers."""
    from datetime import datetime, timezone
    _save({
        "completed_revision": REVISION,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })
    return JSONResponse(_state_payload())


@router.post("/reset")
async def reset(_session=Depends(get_current_session)):
    """Run the wizard again from Settings, as if this were a fresh installation."""
    _save({"completed_revision": 0, "completed_at": None})
    return JSONResponse(_state_payload())
