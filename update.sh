#!/usr/bin/env bash
set -e
CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
info(){ echo -e "${CYAN}[INFO]${NC} $*"; }

if [[ $EUID -ne 0 ]]; then exec sudo -E bash "$0" "$@"; fi

PANEL_DIR="${PANEL_DIR:-/opt/server-panel}"
PANEL_USER="${PANEL_USER:-panel}"
REPO_URL="${REPO_URL:-https://github.com/anomalyco/opencode.git}"
BRANCH="${BRANCH:-main}"
SRC_TMP="/tmp/server-panel-update-$$"

# detect src: if we run from checkout, use it; else clone
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/backend/package.json" ]]; then
  SRC_DIR="$SCRIPT_DIR"
else
  info "Cloning $REPO_URL ($BRANCH) to $SRC_TMP..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_TMP"
  [[ -f "$SRC_TMP/server-panel/backend/package.json" ]] && SRC_DIR="$SRC_TMP/server-panel" || SRC_DIR="$SRC_TMP"
fi
info "Updating $PANEL_DIR from $SRC_DIR..."
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude logs --exclude data --exclude backend/.env "$SRC_DIR"/ "$PANEL_DIR"/ 2>/dev/null || cp -a "$SRC_DIR"/. "$PANEL_DIR"/
chown -R "$PANEL_USER":"$PANEL_USER" "$PANEL_DIR" 2>/dev/null || true

info "Rebuilding..."
sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/backend && npm ci --omit=dev 2>&1 | tail -3" || true
sudo -u "$PANEL_USER" bash -c "cd $PANEL_DIR/frontend && npm ci 2>&1 | tail -3 && npm run build 2>&1 | tail -5" || true

info "Restarting panel-api..."
systemctl restart panel-api 2>&1 | tail -3 || true
nginx -t 2>&1 | tail -2 && systemctl reload nginx 2>&1 | tail -2 || true

rm -rf "$SRC_TMP" 2>/dev/null || true
echo -e "${GREEN}Updated ✓${NC} — systemctl status panel-api"
