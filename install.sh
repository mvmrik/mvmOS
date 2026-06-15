#!/bin/bash
set -eu

SERVICE_NAME="mvmos"
INSTALL_DIR="/opt/mvmos"
TARBALL_URL="https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz"

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

# ── Terms ─────────────────────────────────────────────────────────────────────
echo "  DISCLAIMER"
echo "  ──────────────────────────────────────────"
echo "  mvmOS is open-source software provided \"as-is\" without any warranty,"
echo "  express or implied. The authors are not liable for any damage to your"
echo "  system, data loss, security breaches, or any other issues that may"
echo "  arise from its use. You are solely responsible for securing your own"
echo "  server and data. Use at your own risk."
echo ""
read -rp "  Do you agree to the terms? [y/N]: " AGREE
AGREE="${AGREE:-N}"
if [[ "$AGREE" != "y" && "$AGREE" != "Y" ]]; then
    echo "  Installation cancelled."
    exit 0
fi
echo ""

# ── Port ──────────────────────────────────────────────────────────────────────
read -rp "  Port [2026]: " PORT
PORT="${PORT:-2026}"

# ── Python check ──────────────────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
    echo "  ERROR: python3 not found. Please install Python 3.10+."
    exit 1
fi
PY_VER=$(python3 -c "import sys; print(sys.version_info >= (3,10))")
if [[ "$PY_VER" != "True" ]]; then
    echo "  ERROR: Python 3.10+ required."
    exit 1
fi

# ── Download ──────────────────────────────────────────────────────────────────
echo "  Downloading mvmOS..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$TARBALL_URL" -o "$TMP_DIR/mvmos.tar.gz"
elif command -v wget >/dev/null 2>&1; then
    wget -q "$TARBALL_URL" -O "$TMP_DIR/mvmos.tar.gz"
else
    echo "  ERROR: curl or wget required."
    exit 1
fi

echo "  Extracting..."
tar -xzf "$TMP_DIR/mvmos.tar.gz" -C "$TMP_DIR"
EXTRACTED=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | grep -v "^$TMP_DIR$" | head -1)

sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$EXTRACTED"/. "$INSTALL_DIR/"

SCRIPT_DIR="$INSTALL_DIR"
VENV_DIR="$SCRIPT_DIR/venv"

# ── Ensure python3-venv is available ──────────────────────────────────────────
echo "  Installing system dependencies..."
PY_MINOR=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y -q "python${PY_MINOR}-venv" python3-venv 2>/dev/null || true
elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q python3-virtualenv 2>/dev/null || true
elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y python3-virtualenv 2>/dev/null || true
elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm python 2>/dev/null || true
fi

# ── Virtualenv ────────────────────────────────────────────────────────────────
echo "  [1/3] Creating virtualenv..."
sudo python3 -m venv "$VENV_DIR"

# ── Pip packages ─────────────────────────────────────────────────────────────
echo "  [2/3] Installing Python packages..."
sudo "$VENV_DIR/bin/pip" install --quiet --upgrade pip
sudo "$VENV_DIR/bin/pip" install --quiet \
    "fastapi>=0.110.0" \
    "uvicorn[standard]>=0.29.0" \
    "ptyprocess>=0.7.0" \
    "python-multipart>=0.0.9" \
    "httpx>=0.27.0" \
    "watchdog>=4.0.0" \
    "python-pam>=2.0.0"

# ── config.ini ────────────────────────────────────────────────────────────────
sudo tee "$SCRIPT_DIR/config.ini" > /dev/null <<EOF
[server]
port = $PORT
EOF

# ── Ownership ─────────────────────────────────────────────────────────────────
# mvmOS runs as root: it manages the host (services, packages, OS updates) and
# authenticates against /etc/shadow directly. Per-user actions (terminal, file
# operations) are dropped to the logged-in user via `runuser`, so a non-root
# session can never act as root. This is the same model used by Webmin/Cockpit.
sudo chown -R root:root "$SCRIPT_DIR"
sudo chmod 755 "$SCRIPT_DIR"

# ── systemd service ───────────────────────────────────────────────────────────
echo "  [3/3] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=mvmOS Web Desktop
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/uvicorn backend.main:app --host 0.0.0.0 --port $PORT
Restart=always
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

# ── Cleanup source directory ──────────────────────────────────────────────────
SCRIPT_REAL=$(realpath "$0")
SCRIPT_PARENT=$(dirname "$SCRIPT_REAL")
if [[ "$SCRIPT_PARENT" != "$INSTALL_DIR" && "$SCRIPT_PARENT" != "/" ]]; then
    cd "$INSTALL_DIR"
    rm -rf "$SCRIPT_PARENT"
fi
