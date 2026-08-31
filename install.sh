#!/usr/bin/env bash
set -e
# ==============================================================================
# ServerPanel Universal Installer — like aaPanel (one comando installs anywhere)
#  curl -fsSL https://raw.githubusercontent.com/<you>/server-panel/main/install.sh | bash
#  or: git clone ... && cd server-panel && sudo bash install.sh
#
# Supports: Ubuntu 20.04+/22.04/24.04, Debian 11/12, RHEL 8/9, Rocky/Alma 8/9, CentOS 7
# Installs to /opt/server-panel (overridable via PANEL_DIR) and exposes:
#   http://<IP>:5180 (frontend) + http://<IP>:3500/api (backend) behind nginx if available
# ==============================================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info(){ echo -e "${CYAN}[INFO]${NC} $*"; }
ok(){ echo -e "${GREEN}[OK]${NC} $*"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $*"; }
err(){ echo -e "${RED}[ERR]${NC} $*" >&2; }

# --- 0. must be root / sudo ---
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    exec sudo -E bash "$0" "$@"
  fi
  err "Run as root: sudo bash install.sh"
  exit 1
fi

# --- 1. detect OS ---
OS=""; VER=""; PM=""; DISTRO=""
if [[ -f /etc/os-release ]]; then . /etc/os-release; OS=$ID; VER=$VERSION_ID; fi
case "$OS" in
  ubuntu|debian) PM=apt ;;
  rhel|centos|rocky|almalinux|fedora) PM=yum ;;
  *) PM=apt; warn "Unknown OS $OS, trying apt" ;;
esac
info "Detected OS: $OS $VER (pm=$PM)"

PANEL_DIR="${PANEL_DIR:-/opt/server-panel}"
PANEL_USER="${PANEL_USER:-panel}"
PANEL_PORT="${PANEL_PORT:-3500}"
PANEL_WEB_PORT="${PANEL_WEB_PORT:-5180}"
PANEL_ADMIN_USER="${PANEL_ADMIN_USER:-admin}"
PANEL_ADMIN_PASS="${PANEL_ADMIN_PASS:-}" # generated if empty
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/anomalyco/opencode.git}" # override if you host panel separately
# if script lives inside a checkout, use that as source instead of cloning
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/backend/package.json" && -f "$SCRIPT_DIR/frontend/package.json" ]]; then
  SRC_DIR="$SCRIPT_DIR"
else
  SRC_DIR="/tmp/server-panel-src"
fi

# --- 2. install OS deps ---
info "Installing system dependencies..."
if [[ "$PM" == "apt" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl wget git nginx ca-certificates gnupg lsb-release sqlite3 cron sudo ufw 2>&1 | tail -5
  # Node 20 via Nodesource if node missing or <18
  NEED_NODE=0
  if ! command -v node >/dev/null 2>&1; then NEED_NODE=1
  else
    NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/v([0-9]+).*/\1/'); [[ ${NODE_MAJOR:-0} -lt 18 ]] && NEED_NODE=1 || true
  fi
  if [[ $NEED_NODE -eq 1 ]]; then
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
  fi
else
  yum install -y epel-release 2>&1 | tail -2 || true
  yum install -y curl wget git nginx ca-certificates cronie sudo firewalld 2>&1 | tail -5
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    yum install -y nodejs
  fi
fi
ok "System deps ready: node $(node -v 2>/dev/null || echo '?') npm $(npm -v 2>/dev/null || echo '?')"

# --- 3. panel user ---
if ! id "$PANEL_USER" >/dev/null 2>&1; then
  info "Creating panel user $PANEL_USER..."
  useradd -m -s /bin/bash "$PANEL_USER" || true
  usermod -aG sudo "$PANEL_USER" 2>/dev/null || true
  usermod -aG docker "$PANEL_USER" 2>/dev/null || true
else
  info "Panel user $PANEL_USER exists"
fi
PANEL_HOME=$(getent passwd "$PANEL_USER" | cut -d: -f6); [[ -z "$PANEL_HOME" ]] && PANEL_HOME="/home/$PANEL_USER"

# --- 4. fetch panel source ---
if [[ "$SRC_DIR" == "/tmp/server-panel-src" ]]; then
  if [[ -d "$SRC_DIR/.git" ]]; then info "Updating $SRC_DIR..."; git -C "$SRC_DIR" pull --ff-only 2>&1 | tail -3 || true
  else info "Cloning panel to $SRC_DIR..."; rm -rf "$SRC_DIR"; git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR" 2>&1 | tail -3 || { err "git clone failed — set REPO_URL or copy panel to $PANEL_DIR manually"; exit 1; }
  fi
  # if repo is monorepo, panel is in subdir server-panel
  if [[ -f "$SRC_DIR/server-panel/backend/package.json" ]]; then SRC_DIR="$SRC_DIR/server-panel"; fi
fi
info "Source: $SRC_DIR"

# --- 5. install to PANEL_DIR ---
info "Installing panel to $PANEL_DIR..."
mkdir -p "$PANEL_DIR"
# rsync if available else cp
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude logs --exclude data "$SRC_DIR"/ "$PANEL_DIR"/
else
  cp -a "$SRC_DIR"/. "$PANEL_DIR"/ 2>&1 | tail -3
fi
chown -R "$PANEL_USER":"$PANEL_USER" "$PANEL_DIR" 2>&1 | tail -2 || true
ok "Panel files → $PANEL_DIR"

# --- 6. .env ---
ENV_FILE="$PANEL_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Generating $ENV_FILE..."
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if [[ -z "$PANEL_ADMIN_PASS" ]]; then PANEL_ADMIN_PASS=$(openssl rand -base64 12 2>/dev/null | tr -dc 'A-Za-z0-9' | head -c 12); GEN_PASS=1; else GEN_PASS=0; fi
  # try to capture host sudo password: if installer run with password, ask
  SUDO_PASS=""
  # we store SUDO_PASSWORD only if panel user needs sudo for nginx/pg — installer will set NOPASSWD instead (better)
  cat > "$ENV_FILE" <<EOF
# Generated by install.sh on $(date -u +%FT%TZ)
PORT=$PANEL_PORT
PANEL_USER=$PANEL_USER
PANEL_HOME=$PANEL_HOME
PANEL_APPS_DIR=$PANEL_HOME/apps
PANEL_BACKUP_DIR=$PANEL_HOME/backups
PANEL_COMPOSE_DIR=$PANEL_HOME/compose
PANEL_DATA_DIR=data
JWT_SECRET=$JWT_SECRET
PANEL_ADMIN_USER=$PANEL_ADMIN_USER
PANEL_ADMIN_PASS=$PANEL_ADMIN_PASS
BACKUP_RETENTION_DAYS=14
BACKUP_MAX_COUNT=50
AUTH_DISABLED=false
ALLOWED_ORIGINS=http://localhost:$PANEL_WEB_PORT,http://127.0.0.1:$PANEL_WEB_PORT
EOF
  chown "$PANEL_USER":"$PANEL_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  ok "Env created (admin: $PANEL_ADMIN_USER / ${PANEL_ADMIN_PASS:0:3}***)"
  if [[ $GEN_PASS -eq 1 ]]; then echo -e "${YELLOW}Generated admin password: $PANEL_ADMIN_PASS${NC} — save it!"; fi
else
  info "$ENV_FILE exists — keeping (delete to regenerate)"
fi

# --- 7. passwordless sudo for panel user (aaPanel style) ---
SUDOERS_FILE="/etc/sudoers.d/panel-$PANEL_USER"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  info "Granting passwordless sudo for $PANEL_USER (nginx/systemctl/docker/pg)..."
  cat > "$SUDOERS_FILE" <<EOF
# ServerPanel — NOPASSWD for panel user (installer)
$PANEL_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/sbin/nginx, /bin/systemctl, /usr/bin/docker, /usr/bin/pg_dump, /usr/bin/pg_restore, /usr/bin/psql, /bin/chown, /bin/cp, /bin/rm, /usr/bin/tee
$PANEL_USER ALL=(ALL) NOPASSWD:ALL
EOF
  chmod 440 "$SUDOERS_FILE"; visudo -c 2>&1 | tail -2 || true
  ok "Sudoers → $SUDOERS_FILE"
fi

# --- 8. npm install + build ---
info "Installing backend deps..."
sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/backend && npm ci --omit=dev 2>&1 | tail -5" || sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/backend && npm install --omit=dev 2>&1 | tail -5"
info "Installing frontend deps & building..."
sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/frontend && npm ci 2>&1 | tail -5" || sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/frontend && npm install 2>&1 | tail -5"
sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/frontend && npm run build 2>&1 | tail -10"
ok "Frontend built to $PANEL_DIR/frontend/dist"

# --- 9. systemd service ---
SERVICE_FILE="/etc/systemd/system/panel-api.service"
info "Creating systemd service $SERVICE_FILE..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ServerPanel API
After=network.target nginx.service docker.service postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$PANEL_USER
WorkingDirectory=$PANEL_DIR/backend
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now panel-api 2>&1 | tail -3 || systemctl restart panel-api 2>&1 | tail -3
ok "panel-api running"

# --- 10. frontend service (vite preview or nginx) ---
# Prefer nginx reverse proxy; also run vite preview as fallback via pm2/systemd
# Nginx vhost for panel
VHOST="/etc/nginx/sites-available/panel"
if [[ -f /etc/nginx/nginx.conf ]]; then
  info "Configuring nginx vhost..."
  cat > "$VHOST" <<EOF
# ServerPanel — managed by installer
server {
    listen $PANEL_WEB_PORT;
    server_name _;
    root $PANEL_DIR/frontend/dist;
    index index.html;

    # API proxy — handles /api and /api/v1 + auth
    location /api/ {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Static assets cached
    location /assets/ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
EOF
  mkdir -p /etc/nginx/sites-enabled
  ln -sf "$VHOST" /etc/nginx/sites-enabled/panel 2>/dev/null || true
  nginx -t 2>&1 | tail -3 && systemctl reload nginx 2>&1 | tail -2 || warn "nginx reload failed — panel still serves via :$PANEL_WEB_PORT directly"
  ok "Nginx vhost → :$PANEL_WEB_PORT"
fi

# Also ensure frontend is served even without nginx: simple pm2/ systemd preview fallback
# We use vite preview on :$PANEL_WEB_PORT if nginx not serving dist; panel-api's nginx vhost above is preferred, so this is optional
if ! ss -tln 2>/dev/null | grep -q ":$PANEL_WEB_PORT "; then
  info "No listener on :$PANEL_WEB_PORT — frontend will be served by nginx vhost above"
fi

# --- 11. firewall ---
if command -v ufw >/dev/null 2>&1 && ufw status 2>&1 | grep -qi active; then
  info "Opening UFW $PANEL_PORT,$PANEL_WEB_PORT..."
  ufw allow "$PANEL_PORT"/tcp 2>&1 | tail -1 || true
  ufw allow "$PANEL_WEB_PORT"/tcp 2>&1 | tail -1 || true
fi
if systemctl is-active firewalld >/dev/null 2>&1; then
  info "Opening firewalld..."
  firewall-cmd --permanent --add-port="$PANEL_PORT/tcp" 2>&1 | tail -1 || true
  firewall-cmd --permanent --add-port="$PANEL_WEB_PORT/tcp" 2>&1 | tail -1 || true
  firewall-cmd --reload 2>&1 | tail -1 || true
fi

# --- 12. dirs for panel user ---
sudo -u "$PANEL_USER" mkdir -p "$PANEL_HOME/apps" "$PANEL_HOME/backups" "$PANEL_HOME/compose" 2>/dev/null || true

# --- 13. done ---
IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'); [[ -z "$IP" ]] && IP="<server-ip>"
ADMIN_PASS_SHOW=$(grep PANEL_ADMIN_PASS "$ENV_FILE" | cut -d= -f2)
cat <<EOF

${GREEN}========================================${NC}
 ServerPanel installed ✓  — like aaPanel
${GREEN}========================================${NC}
 Panel:      http://${IP}:${PANEL_WEB_PORT}
 API:        http://${IP}:${PANEL_PORT}/api/health
 Docs:       ${PANEL_DIR}/ENTERPRISE.md
 Service:    systemctl status panel-api
 Logs:       journalctl -u panel-api -f
 Vhost:      /etc/nginx/sites-available/panel

 Admin user:  ${PANEL_ADMIN_USER}
 Admin pass:  ${ADMIN_PASS_SHOW}
   (change after first login: Marketplace → Users)

 Dir:         ${PANEL_DIR}
 User:        ${PANEL_USER} (home ${PANEL_HOME})
 Env:         ${ENV_FILE} (600)

 Next:
   1) open http://${IP}:${PANEL_WEB_PORT} → login
   2) sudo ufw allow 5180,3500 if remote fails
   3) ee cert: sudo certbot --nginx -d your.domain

 Uninstall:   sudo bash ${PANEL_DIR}/uninstall.sh
 Update:      sudo bash ${PANEL_DIR}/update.sh
${GREEN}========================================${NC}
EOF
