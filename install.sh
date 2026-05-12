#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="virtualos"
VENV_DIR="$SCRIPT_DIR/venv"
CURRENT_USER="$(whoami)"

echo ""
echo "  ███╗   ███╗██╗   ██╗███╗   ███╗ ██████╗ ███████╗"
echo "  ████╗ ████║██║   ██║████╗ ████║██╔═══██╗██╔════╝"
echo "  ██╔████╔██║██║   ██║██╔████╔██║██║   ██║███████╗"
echo "  ██║╚██╔╝██║╚██╗ ██╔╝██║╚██╔╝██║██║   ██║╚════██║"
echo "  ██║ ╚═╝ ██║ ╚████╔╝ ██║ ╚═╝ ██║╚██████╔╝███████║"
echo "  ╚═╝     ╚═╝  ╚═══╝  ╚═╝     ╚═╝ ╚═════╝ ╚══════╝"
echo ""
echo "  Web Desktop for Linux Servers — Installer"
echo "  ──────────────────────────────────────────"
echo ""

# ── Port ──────────────────────────────────────────────────────────────────────
read -rp "  Port [8080]: " PORT
PORT="${PORT:-8080}"

# ── Username ──────────────────────────────────────────────────────────────────
read -rp "  Admin username [admin]: " USERNAME
USERNAME="${USERNAME:-admin}"

# ── Password ──────────────────────────────────────────────────────────────────
read -rsp "  Admin password (leave blank to auto-generate): " PASSWORD
echo ""
if [[ -z "$PASSWORD" ]]; then
    PASSWORD="$(tr -dc 'A-Za-z0-9!@#%^&*' < /dev/urandom | head -c 18)"
    echo ""
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │  Generated password: $PASSWORD"
    echo "  │  SAVE THIS — it will not be shown again.    │"
    echo "  └─────────────────────────────────────────────┘"
    echo ""
fi

# ── Python check ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "  ERROR: python3 not found. Please install Python 3.10+."
    exit 1
fi
PY_VER=$(python3 -c "import sys; print(sys.version_info >= (3,10))")
if [[ "$PY_VER" != "True" ]]; then
    echo "  ERROR: Python 3.10+ required."
    exit 1
fi

# ── Ensure python3-venv is available ──────────────────────────────────────────
if ! python3 -m venv --help &>/dev/null; then
    echo "  Installing python3-venv..."
    sudo apt-get install -y python3-venv
fi

# ── Virtualenv ────────────────────────────────────────────────────────────────
echo "  [1/5] Creating virtualenv..."
python3 -m venv "$VENV_DIR"

# ── Pip packages ─────────────────────────────────────────────────────────────
echo "  [2/5] Installing Python packages..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet \
    "fastapi>=0.110.0" \
    "uvicorn[standard]>=0.29.0" \
    "ptyprocess>=0.7.0" \
    "passlib[bcrypt]>=1.7.4" \
    "python-multipart>=0.0.9" \
    "bcrypt==4.0.1"

# ── Hash password ─────────────────────────────────────────────────────────────
echo "  [3/5] Hashing password..."
HASH=$("$VENV_DIR/bin/python3" -c "from passlib.hash import bcrypt; print(bcrypt.hash('$PASSWORD'))")

# ── config.ini ────────────────────────────────────────────────────────────────
echo "  [4/5] Writing config.ini..."
cat > "$SCRIPT_DIR/config.ini" <<EOF
[server]
port = $PORT

[auth]
username = $USERNAME
password_hash = $HASH
EOF
chmod 600 "$SCRIPT_DIR/config.ini"

# ── systemd service ───────────────────────────────────────────────────────────
echo "  [5/5] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=mvmOS Web Desktop
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/uvicorn backend.main:app --host 0.0.0.0 --port $PORT
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}.service"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ mvmOS is running!"
echo ""

# Try to detect the server's IP
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ -n "$SERVER_IP" ]]; then
    echo "  Access it at:  http://$SERVER_IP:$PORT"
else
    echo "  Access it at:  http://<your-server-ip>:$PORT"
fi

echo ""
echo "  Username : $USERNAME"
if [[ -n "${PASSWORD:-}" ]]; then
    echo "  Password : (shown above)"
fi
echo ""
echo "  Service commands:"
echo "    sudo systemctl status  $SERVICE_NAME"
echo "    sudo systemctl restart $SERVICE_NAME"
echo "    sudo systemctl stop    $SERVICE_NAME"
echo "    journalctl -u $SERVICE_NAME -f"
echo ""
