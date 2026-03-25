#!/usr/bin/env bash
# ───────────────────────────────────────────────
# deploy-fly.sh — Deploy live-stream plugin to Fly.io
#
# Usage:
#   bash scripts/deploy-fly.sh <app-name>
#   bash scripts/deploy-fly.sh openclaw-cd4ad779-mn16io7r
# ───────────────────────────────────────────────
set -euo pipefail

APP="${1:?Usage: $0 <fly-app-name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
TARBALL="/tmp/live-openclaw-plugin.tar.gz"

echo ""
echo "  🚀 Deploying live-stream plugin to Fly.io: $APP"
echo ""

# ── 1. Package ──
echo "  📦 Packaging plugin..."
tar czf "$TARBALL" -C "$PLUGIN_ROOT" \
  src/ overlay/ package.json scripts/inject.sh 2>/dev/null || \
tar czf "$TARBALL" -C "$PLUGIN_ROOT" \
  src/ overlay/ package.json scripts/inject.sh

echo "     → $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# ── 2. Upload ──
echo "  ☁️  Uploading to Fly.io..."
fly ssh console -a "$APP" -C "rm -f /data/live-openclaw-plugin.tar.gz"
echo "put $TARBALL /data/live-openclaw-plugin.tar.gz" | fly ssh sftp shell -a "$APP"

# ── 3. Extract ──
echo "  📂 Extracting on server..."
fly ssh console -a "$APP" -C "sh -c 'rm -rf /data/live-stream-plugin && mkdir -p /data/live-stream-plugin && tar xzf /data/live-openclaw-plugin.tar.gz -C /data/live-stream-plugin && rm /data/live-openclaw-plugin.tar.gz'"

# ── 4. Run setup script (inject overlay + sync extension) ──
echo "  💉 Running setup script..."
fly ssh console -a "$APP" -C "sh -c 'test -x /data/setup-live-stream.sh && /data/setup-live-stream.sh || echo \"[warn] /data/setup-live-stream.sh not found, doing manual sync\" && cp /data/live-stream-plugin/overlay/* /app/dist/control-ui/ && cp -r /data/live-stream-plugin/src /data/extensions/live-stream/ && cp -r /data/live-stream-plugin/overlay /data/extensions/live-stream/ && chown -R root:root /data/extensions/live-stream'"

# ── 5. Restart ──
echo "  🔄 Restarting machine..."
MACHINE_ID=$(fly machines list -a "$APP" --json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || fly machines list -a "$APP" --json 2>/dev/null | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"id" *: *"//;s/"//')
if [ -n "$MACHINE_ID" ]; then
  fly machine restart "$MACHINE_ID" -a "$APP"
  echo "     → Machine $MACHINE_ID restarted"
else
  echo "     ⚠️  Could not detect machine ID, please restart manually:"
  echo "        fly machines restart <machine-id> -a $APP"
fi

echo ""
echo "  ✅ Deploy complete!"
echo "     https://$APP.fly.dev"
echo ""
