#!/usr/bin/env bash
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info(){ echo -e "${YELLOW}[INFO]${NC} $*"; }
err(){ echo -e "${RED}[ERR]${NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root: sudo bash uninstall.sh"; exit 1; fi

PANEL_DIR="${PANEL_DIR:-/opt/server-panel}"
PANEL_USER="${PANEL_USER:-panel}"
PANEL_PORT="${PANEL_PORT:-3500}"
PANEL_WEB_PORT="${PANEL_WEB_PORT:-5180}"

read -p "Uninstall ServerPanel at $PANEL_DIR? This stops panel-api and removes nginx vhost (data in $PANEL_USER home is kept). [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { echo "Abort."; exit 0; }

info "Stopping panel-api..."
systemctl disable --now panel-api 2>/dev/null || true
rm -f /etc/systemd/system/panel-api.service
systemctl daemon-reload 2>/dev/null || true

info "Removing nginx vhost..."
rm -f /etc/nginx/sites-enabled/panel /etc/nginx/sites-available/panel
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

info "Removing sudoers..."
rm -f /etc/sudoers.d/panel-"$PANEL_USER" 2>/dev/null || true

if [[ -d "$PANEL_DIR" ]]; then
  read -p "Delete $PANEL_DIR entirely? [y/N] " ans2
  if [[ "$ans2" =~ ^[Yy]$ ]]; then
    rm -rf "$PANEL_DIR"
    echo -e "${GREEN}Removed $PANEL_DIR${NC}"
  else
    info "Kept $PANEL_DIR (remove manually: sudo rm -rf $PANEL_DIR)"
  fi
fi

echo -e "${GREEN}Uninstalled.${NC} User $PANEL_USER and $PANEL_USER home data are kept. To fully remove: sudo userdel -r $PANEL_USER"
