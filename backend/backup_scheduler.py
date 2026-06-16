import os
import shutil
import subprocess
from datetime import datetime

INSTALL_DIR = "/var/www/mvmos.mvmrik.com"
BACKUP_DIR = "/var/backups/mvmos"
LOCK_FILE = "/tmp/mvmos-backup.lock"

_RESTORE_SH = r"""#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/var/www/mvmos.mvmrik.com"

echo "=== mvmOS Restore ==="
echo ""

if [ ! -f "$SCRIPT_DIR/backup.tar.gz" ]; then
  echo "ERROR: backup.tar.gz not found next to restore.sh"
  exit 1
fi

echo "Stopping mvmOS..."
systemctl stop mvmos 2>/dev/null || true
systemctl stop mvmos-public 2>/dev/null || true

echo "Restoring files to $INSTALL_DIR ..."
tar -xzf "$SCRIPT_DIR/backup.tar.gz" -C "$INSTALL_DIR"

echo "Starting mvmOS..."
systemctl start mvmos

echo ""
echo "Done. Open your browser to access mvmOS."
"""


def run(now: datetime, db_path: str, config: dict):
    schedule = config.get("schedule", "disabled")
    if schedule == "disabled":
        return

    h, m = now.hour, now.minute
    wd = now.weekday()  # 0=Mon … 6=Sun
    d = now.day

    if schedule == "daily" and not (h == 3 and m == 0):
        return
    if schedule == "weekly" and not (wd == 6 and h == 3 and m == 0):
        return
    if schedule == "monthly" and not (d == 1 and h == 3 and m == 0):
        return

    if os.path.exists(LOCK_FILE):
        return

    open(LOCK_FILE, "w").close()
    try:
        _do_backup(int(config.get("keep", 5)))
    finally:
        try:
            os.unlink(LOCK_FILE)
        except OSError:
            pass


def _do_backup(keep: int = 5):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    folder_path = os.path.join(BACKUP_DIR, f"mvmos-backup-{ts}")
    os.makedirs(folder_path)
    tar_path = os.path.join(folder_path, "backup.tar.gz")
    restore_path = os.path.join(folder_path, "restore.sh")

    r = subprocess.run(
        ["tar", "-czf", tar_path,
         "--exclude=./venv", "--exclude=*/__pycache__",
         "--exclude=*.pyc", "--exclude=*.pyo",
         "-C", INSTALL_DIR, "."],
        capture_output=True,
    )
    if r.returncode != 0:
        shutil.rmtree(folder_path, ignore_errors=True)
        return

    with open(restore_path, "w") as f:
        f.write(_RESTORE_SH)
    os.chmod(restore_path, 0o755)

    if keep > 0:
        folders = sorted(
            [n for n in os.listdir(BACKUP_DIR)
             if os.path.isdir(os.path.join(BACKUP_DIR, n))
             and os.path.isfile(os.path.join(BACKUP_DIR, n, "backup.tar.gz"))],
            reverse=True,
        )
        for old in folders[keep:]:
            shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)
