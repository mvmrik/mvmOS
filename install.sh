#!/bin/bash
set -eu

TARBALL_URL="https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz"

# ── Options ───────────────────────────────────────────────────────────────────
# Without options the script asks its questions and installs the single
# default installation in /opt/mvmos, exactly as it always has. The options let
# a second installation sit next to it, and let a program such as mvmOS Desktop
# install and remove one without a terminal.
#
#   install.sh [--name NAME] [--port PORT] [--host ADDRESS] [--yes]
#   install.sh --uninstall --name NAME [--yes]
#
# NAME is "mvmos" or "mvmos-<letters, digits, dashes>". It names both the
# folder /opt/NAME and the service NAME.service, so every installation keeps
# its own files, data and port. --yes accepts the terms (or confirms the
# removal) without asking. --host 127.0.0.1 makes the installation reachable
# from this computer only.
usage() {
    echo "Usage: $0 [--name NAME] [--port PORT] [--host ADDRESS] [--yes]"
    echo "       $0 --uninstall --name NAME [--yes]"
}

SERVICE_NAME="mvmos"
PORT=""
BIND_HOST="0.0.0.0"
ASSUME_YES=0
UNINSTALL=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --name) SERVICE_NAME="${2:-}"; shift 2 ;;
        --port) PORT="${2:-}"; shift 2 ;;
        --host) BIND_HOST="${2:-}"; shift 2 ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "  ERROR: unknown option $1"; usage; exit 2 ;;
    esac
done

# The name becomes a folder and a service that --uninstall deletes, so it must
# never be able to point at anything that is not an mvmOS installation.
if [[ ! "$SERVICE_NAME" =~ ^mvmos(-[a-z0-9][a-z0-9-]{0,39})?$ ]]; then
    echo "  ERROR: the name must be \"mvmos\" or \"mvmos-\" followed by lowercase letters, digits and dashes."
    exit 2
fi
# Services that an mvmOS installation creates for itself.
case "$SERVICE_NAME" in
    mvmos-public|mvmos-domains|mvmos-display)
        echo "  ERROR: $SERVICE_NAME is used by mvmOS itself. Choose another name."
        exit 2 ;;
esac
if [[ ! "$BIND_HOST" =~ ^[0-9a-fA-F.:]+$ ]]; then
    echo "  ERROR: --host must be an IP address such as 0.0.0.0 or 127.0.0.1."
    exit 2
fi
INSTALL_DIR="/opt/$SERVICE_NAME"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Run as root (for example through pkexec) there is nothing to sudo, and a
# minimal system may not have sudo at all.
if [[ $EUID -eq 0 ]]; then
    SUDO=""
else
    SUDO="sudo"
fi

# ── Uninstall ─────────────────────────────────────────────────────────────────
if [[ $UNINSTALL -eq 1 ]]; then
    if [[ ! -e "$SERVICE_FILE" && ! -e "$INSTALL_DIR" ]]; then
        echo "  Nothing to remove: $SERVICE_NAME is not installed."
        exit 0
    fi
    # Only what this script created is removed: a service that runs from the
    # installation's own folder, and a folder that holds mvmOS.
    if [[ -e "$SERVICE_FILE" ]] && ! grep -qx "WorkingDirectory=$INSTALL_DIR" "$SERVICE_FILE"; then
        echo "  ERROR: $SERVICE_FILE does not belong to the mvmOS installation in $INSTALL_DIR. Nothing was removed."
        exit 1
    fi
    if [[ -e "$INSTALL_DIR" && ! ( -f "$INSTALL_DIR/backend/main.py" && -f "$INSTALL_DIR/version.txt" ) ]]; then
        echo "  ERROR: $INSTALL_DIR is not an mvmOS installation. Nothing was removed."
        exit 1
    fi
    if [[ $ASSUME_YES -ne 1 ]]; then
        echo "  This stops and removes the service $SERVICE_NAME and deletes $INSTALL_DIR"
        echo "  with all of its data. This cannot be undone."
        read -rp "  Remove it? [y/N]: " CONFIRM
        if [[ "${CONFIRM:-N}" != "y" && "${CONFIRM:-N}" != "Y" ]]; then
            echo "  Nothing was removed."
            exit 0
        fi
    fi
    if [[ -e "$SERVICE_FILE" ]]; then
        echo "  Stopping and removing the service $SERVICE_NAME..."
        $SUDO systemctl disable --now "${SERVICE_NAME}.service" 2>/dev/null || true
        $SUDO rm -f "$SERVICE_FILE"
        $SUDO systemctl daemon-reload
        $SUDO systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if [[ -e "$INSTALL_DIR" ]]; then
        echo "  Deleting $INSTALL_DIR..."
        cd /
        $SUDO rm -rf "$INSTALL_DIR"
    fi
    echo "  ✓ $SERVICE_NAME was removed."
    exit 0
fi

# Another installation is never written over. Only the default one may be
# installed again on top of itself, as before, which keeps its data.
if [[ "$SERVICE_NAME" != "mvmos" && ( -e "$INSTALL_DIR" || -e "$SERVICE_FILE" ) ]]; then
    echo "  ERROR: an installation named $SERVICE_NAME already exists. Choose another name."
    exit 1
fi

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
if [[ $ASSUME_YES -eq 1 ]]; then
    AGREE="y"
else
    read -rp "  Do you agree to the terms? [y/N]: " AGREE
    AGREE="${AGREE:-N}"
fi
if [[ "$AGREE" != "y" && "$AGREE" != "Y" ]]; then
    echo "  Installation cancelled."
    exit 0
fi
echo ""

# ── Port ──────────────────────────────────────────────────────────────────────
if [[ -z "$PORT" ]]; then
    read -rp "  Port [2026]: " PORT
    PORT="${PORT:-2026}"
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "  ERROR: the port must be a number from 1 to 65535."
    exit 2
fi
# Every installation needs a port of its own. A reinstall of the default one
# over itself is the exception: its own service is the one listening there.
if command -v ss >/dev/null 2>&1 && ss -Hltn "sport = :$PORT" 2>/dev/null | grep -q .; then
    if [[ ! ( "$SERVICE_NAME" == "mvmos" && -e "$SERVICE_FILE" ) ]]; then
        echo "  ERROR: port $PORT is already in use. Choose another port."
        exit 1
    fi
fi

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

$SUDO mkdir -p "$INSTALL_DIR"
$SUDO cp -r "$EXTRACTED"/. "$INSTALL_DIR/"

SCRIPT_DIR="$INSTALL_DIR"
VENV_DIR="$SCRIPT_DIR/venv"

# ── Ensure python3-venv is available ──────────────────────────────────────────
echo "  Installing system dependencies..."
PY_MINOR=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get install -y -q "python${PY_MINOR}-venv" python3-venv 2>/dev/null || true
elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y -q python3-virtualenv 2>/dev/null || true
elif command -v zypper >/dev/null 2>&1; then
    $SUDO zypper install -y python3-virtualenv 2>/dev/null || true
elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm python 2>/dev/null || true
fi

# ── Virtualenv ────────────────────────────────────────────────────────────────
echo "  [1/3] Creating virtualenv..."
$SUDO python3 -m venv "$VENV_DIR"

# ── Pip packages ─────────────────────────────────────────────────────────────
echo "  [2/3] Installing Python packages..."
$SUDO "$VENV_DIR/bin/pip" install --quiet --upgrade pip
$SUDO "$VENV_DIR/bin/pip" install --quiet \
    "fastapi>=0.110.0" \
    "uvicorn[standard]>=0.29.0" \
    "ptyprocess>=0.7.0" \
    "python-multipart>=0.0.9" \
    "httpx>=0.27.0" \
    "watchdog>=4.0.0" \
    "python-pam>=2.0.0" \
    "six>=1.16.0"

# ── config.ini ────────────────────────────────────────────────────────────────
$SUDO tee "$SCRIPT_DIR/config.ini" > /dev/null <<EOF
[server]
port = $PORT
EOF

# ── Ownership ─────────────────────────────────────────────────────────────────
# mvmOS runs as root: it manages the host (services, packages, OS updates) and
# authenticates against /etc/shadow directly. Per-user actions (terminal, file
# operations) are dropped to the logged-in user via `runuser`, so a non-root
# session can never act as root. This is the same model used by Webmin/Cockpit.
$SUDO chown -R root:root "$SCRIPT_DIR"
$SUDO chmod 755 "$SCRIPT_DIR"

# ── systemd service ───────────────────────────────────────────────────────────
echo "  [3/3] Installing systemd service..."
$SUDO tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=mvmOS Web Desktop ($SERVICE_NAME)
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/uvicorn backend.main:app --host $BIND_HOST --port $PORT
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "${SERVICE_NAME}.service"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ mvmOS is running!"
echo ""

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "::1" ]]; then
    echo "  Access it on this computer at:  http://127.0.0.1:$PORT"
elif [[ -n "$SERVER_IP" ]]; then
    echo "  Access it at:  http://$SERVER_IP:$PORT"
else
    echo "  Access it at:  http://<your-server-ip>:$PORT"
fi

# Firewalls and proxies only matter when the installation is reachable from
# other machines.
if [[ "$BIND_HOST" != "127.0.0.1" && "$BIND_HOST" != "::1" ]]; then
    echo ""
    echo "  Accessing directly by IP? If it doesn't load, port $PORT may be closed"
    echo "  by a firewall (ufw/firewalld on this machine, or your VPS provider's"
    echo "  cloud firewall) — open port $PORT/tcp there."
    echo ""
    echo "  Using a domain (nginx, Cloudflare Tunnel, or similar in front of"
    echo "  mvmOS)? Keep port $PORT closed to the outside and point your proxy/"
    echo "  tunnel at 127.0.0.1:$PORT instead."
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
echo "  To remove this installation with all of its data:"
echo "    sudo bash $INSTALL_DIR/install.sh --uninstall --name $SERVICE_NAME"
echo ""

# ── Cleanup source directory ──────────────────────────────────────────────────
# Only a folder that is an extracted mvmOS release is removed. The script can
# also be run on its own — downloaded into a home directory, or piped through
# `bash <(curl …)` where $0 is /dev/fd/N — and then its parent is the user's
# folder or not a folder at all, which must never be deleted.
if [[ -f "$0" ]]; then
    SCRIPT_PARENT=$(dirname "$(realpath "$0")")
    if [[ "$SCRIPT_PARENT" != "$INSTALL_DIR" && "$SCRIPT_PARENT" != "/" \
          && "$SCRIPT_PARENT" != "/root" && "$SCRIPT_PARENT" != "${HOME:-/root}" \
          && ! "$SCRIPT_PARENT" =~ ^/home/[^/]+/?$ \
          && -f "$SCRIPT_PARENT/install.sh" && -f "$SCRIPT_PARENT/version.txt" \
          && -f "$SCRIPT_PARENT/backend/main.py" ]]; then
        cd "$INSTALL_DIR"
        rm -rf "$SCRIPT_PARENT"
    fi
fi
