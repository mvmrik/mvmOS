#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="mvmos"
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
echo "  Login uses your existing Linux system users."
echo "  No separate username/password needed."
echo ""

# ── Port ──────────────────────────────────────────────────────────────────────
read -rp "  Port [8080]: " PORT
PORT="${PORT:-8080}"

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
echo "  Installing system dependencies..."
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
sudo apt-get install -y -q "python${PY_VER}-venv" python3-venv 2>/dev/null || true

# ── Virtualenv ────────────────────────────────────────────────────────────────
echo "  [1/4] Creating virtualenv..."
python3 -m venv "$VENV_DIR"

# ── Pip packages ─────────────────────────────────────────────────────────────
echo "  [2/4] Installing Python packages..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet \
    "fastapi>=0.110.0" \
    "uvicorn[standard]>=0.29.0" \
    "ptyprocess>=0.7.0" \
    "python-multipart>=0.0.9" \
    "httpx>=0.27.0"

# ── config.ini ────────────────────────────────────────────────────────────────
echo "  [3/4] Writing config.ini..."
cat > "$SCRIPT_DIR/config.ini" <<EOF
[server]
port = $PORT
EOF
chmod 600 "$SCRIPT_DIR/config.ini"

# ── systemd service ───────────────────────────────────────────────────────────
echo "  [4/4] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo usermod -aG shadow "$CURRENT_USER" 2>/dev/null || true

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

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ -n "$SERVER_IP" ]]; then
    echo "  Access it at:  http://$SERVER_IP:$PORT"
else
    echo "  Access it at:  http://<your-server-ip>:$PORT"
fi

echo ""
echo "  Log in with any Linux system user on this machine."
echo ""
echo "  Service commands:"
echo "    sudo systemctl status  $SERVICE_NAME"
echo "    sudo systemctl restart $SERVICE_NAME"
echo "    sudo systemctl stop    $SERVICE_NAME"
echo "    journalctl -u $SERVICE_NAME -f"
echo ""
