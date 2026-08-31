#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Starting ServerPanel..."

if ! ss -tlnp 2>/dev/null | grep -q :3500; then
  echo "  Starting backend API on :3500..."
  (cd backend && setsid nohup node src/index.js > /tmp/server-panel-api.log 2>&1 < /dev/null &)
else
  echo "  Backend already running on :3500"
fi

if ! ss -tlnp 2>/dev/null | grep -q :5180; then
  echo "  Starting frontend on :5180..."
  (cd frontend && setsid nohup npm run dev > /tmp/server-panel-ui.log 2>&1 < /dev/null &)
else
  echo "  Frontend already running on :5180"
fi

sleep 2
echo ""
echo "✅ ServerPanel is running:"
echo "   Frontend →  http://localhost:5180"
echo "   API      →  http://localhost:3500/api"
echo "   API docs →  http://localhost:3500/api/health"
