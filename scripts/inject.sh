#!/usr/bin/env bash
# ───────────────────────────────────────────────
# inject.sh — Inject live-stream overlay into
# OpenClaw Control UI (the dist/ dir containing
# index.html served by the Gateway)
# ───────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

OVERLAY_JS="${PLUGIN_ROOT}/overlay/live-stream-overlay.js"
OVERLAY_CSS="${PLUGIN_ROOT}/overlay/live-stream-overlay.css"
OVERLAY_SW="${PLUGIN_ROOT}/overlay/sw.js"

# ── Auto-detect Control UI directory ──

find_control_ui() {
  # 1. User-supplied path
  if [ -n "${1:-}" ] && [ -f "${1}/index.html" ]; then
    echo "$1"; return
  fi

  # 2. npm global install — dist/control-ui/
  local npm_root
  npm_root="$(npm root -g 2>/dev/null || true)"
  if [ -n "$npm_root" ] && [ -f "$npm_root/openclaw/dist/control-ui/index.html" ]; then
    echo "$npm_root/openclaw/dist/control-ui"; return
  fi

  # 3. nvm paths — scan all node versions
  for cui in "$HOME"/.nvm/versions/node/*/lib/node_modules/openclaw/dist/control-ui; do
    if [ -f "$cui/index.html" ]; then
      echo "$cui"; return
    fi
  done

  # 4. ~/.openclaw/dist/control-ui/
  if [ -f "$HOME/.openclaw/dist/control-ui/index.html" ]; then
    echo "$HOME/.openclaw/dist/control-ui"; return
  fi

  # 5. /app/dist/control-ui/ (Fly.io container)
  if [ -f "/app/dist/control-ui/index.html" ]; then
    echo "/app/dist/control-ui"; return
  fi

  return 1
}

CONTROL_UI_DIR="$(find_control_ui "${1:-}")" || {
  echo "❌ Control UI not found."
  echo ""
  echo "Searched:"
  echo "  - \$(npm root -g)/openclaw/dist/"
  echo "  - ~/.nvm/versions/node/*/lib/node_modules/openclaw/dist/"
  echo "  - ~/.openclaw/dist/control-ui/"
  echo "  - /app/dist/"
  echo ""
  echo "Usage:"
  echo "  $0 [path-to-control-ui-dir]"
  echo ""
  echo "Examples:"
  echo "  $0                                                           # Auto-detect"
  echo "  $0 /Users/you/.nvm/versions/node/v25.5.0/lib/node_modules/openclaw/dist"
  echo "  $0 /app/dist                                                 # Fly.io container"
  exit 1
}

INDEX_HTML="${CONTROL_UI_DIR}/index.html"

# ── Validate ──

if [ ! -f "$INDEX_HTML" ]; then
  echo "❌ index.html not found at: $INDEX_HTML"
  exit 1
fi

if [ ! -f "$OVERLAY_JS" ]; then
  echo "❌ Overlay JS not found: $OVERLAY_JS"
  exit 1
fi

# ── Check if already injected ──

if grep -q "oc-live-overlay" "$INDEX_HTML" 2>/dev/null; then
  echo "⚠️  Already injected. Skipping."
  echo "   To re-inject, remove the existing script tag first."
  exit 0
fi

# ── Copy overlay files to Control UI static dir ──

echo "📦 Copying overlay files..."
cp "$OVERLAY_JS" "${CONTROL_UI_DIR}/live-stream-overlay.js"
cp "$OVERLAY_CSS" "${CONTROL_UI_DIR}/live-stream-overlay.css"
cp "$OVERLAY_SW" "${CONTROL_UI_DIR}/sw.js"

# ── Inject script tag before </body> ──

echo "💉 Injecting into index.html..."

if grep -q "</body>" "$INDEX_HTML"; then
  # Insert before </body>
  sed -i.bak 's|</body>|<script src="./live-stream-overlay.js" defer></script>\n</body>|' "$INDEX_HTML"
  rm -f "${INDEX_HTML}.bak"
elif grep -q "</html>" "$INDEX_HTML"; then
  # Fallback: insert before </html>
  sed -i.bak 's|</html>|<script src="./live-stream-overlay.js" defer></script>\n</html>|' "$INDEX_HTML"
  rm -f "${INDEX_HTML}.bak"
else
  # Last resort: append
  echo '<script src="./live-stream-overlay.js" defer></script>' >> "$INDEX_HTML"
fi

echo ""
echo "✅ Live stream overlay injected!"
echo ""
echo "   Control UI:  $CONTROL_UI_DIR"
echo "   Files added:"
echo "     - live-stream-overlay.js"
echo "     - live-stream-overlay.css"
echo "     - sw.js (Service Worker)"
echo "   Script tag added to index.html"
echo ""
echo "   Restart the Gateway to see the overlay:"
echo "     openclaw gateway"
echo ""
echo "   Control the stream:"
echo "     /live start [hls-url]"
echo "     /live stop"
echo "     /live status"
echo "     /live title <name>"
echo "     /live dm <message>"
