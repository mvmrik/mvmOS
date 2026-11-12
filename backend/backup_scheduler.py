from datetime import datetime
import os

LOCK_FILE = "/tmp/mvmos-backup.lock"


def _due(schedule: str, now: datetime) -> bool:
    if now.hour != 3 or now.minute != 0:
        return False
    return (schedule == "daily"
            or (schedule == "weekly" and now.weekday() == 6)
            or (schedule == "monthly" and now.day == 1))


def run(now: datetime, db_path: str, config: dict):
    """Each backup place has its own schedule; only the places that are due receive a backup."""
    from .backup import get_locations, _loc_id, perform_backup
    ids = {_loc_id(l) for l in get_locations() if _due(l["schedule"], now)}
    if not ids:
        return

    if os.path.exists(LOCK_FILE):
        return

    open(LOCK_FILE, "w").close()
    try:
        perform_backup(ids)
    except Exception:
        pass
    finally:
        try:
            os.unlink(LOCK_FILE)
        except OSError:
            pass
