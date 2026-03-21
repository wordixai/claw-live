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

if grep -q "live-stream-overlay" "$INDEX_HTML" 2>/dev/null; then
  echo "⚠️  Already injected. Re-injecting (updating files)..."
  # Remove old tags so we can re-inject cleanly
  sed -i.bak '/__ocWsOk/d; /live-stream-overlay/d' "$INDEX_HTML"
  rm -f "${INDEX_HTML}.bak"
fi

# ── Copy overlay files to Control UI static dir ──

echo "📦 Copying overlay files..."
cp "$OVERLAY_JS" "${CONTROL_UI_DIR}/live-stream-overlay.js"
cp "$OVERLAY_CSS" "${CONTROL_UI_DIR}/live-stream-overlay.css"
cp "$OVERLAY_SW" "${CONTROL_UI_DIR}/sw.js"

# ── WebSocket auth interceptor (must load BEFORE the Control UI module script) ──
# Gateway auth is message-level: WS opens for everyone, then server sends
# connect.challenge, client sends connect, server replies {type:"res",ok:true/false}.
# We intercept the first non-live WS and listen for the auth success message.
WS_HOOK='<script>(function(){var W=WebSocket,d=false;window.__ocWsOk=false;window.WebSocket=function(u,p){var s=p!==void 0?new W(u,p):new W(u);if(!d&&u&&String(u).indexOf("/live/")<0){d=true;s.addEventListener("message",function h(e){try{var m=JSON.parse(e.data);if(m.type==="res"&&m.ok===true){window.__ocWsOk=true;s.removeEventListener("message",h)}}catch(x){}})}return s};window.WebSocket.prototype=W.prototype;window.WebSocket.CONNECTING=W.CONNECTING;window.WebSocket.OPEN=W.OPEN;window.WebSocket.CLOSING=W.CLOSING;window.WebSocket.CLOSED=W.CLOSED})()</script>'

OVERLAY_TAG='<script src="./live-stream-overlay.js" defer></script>'

echo "💉 Injecting into index.html..."

# Use Node.js for injection to avoid sed special-character issues (& on macOS)
node -e "
const fs = require('fs');
let html = fs.readFileSync(process.argv[1], 'utf-8');
const wsHook = process.argv[2];
const overlayTag = process.argv[3];

// 1) Insert WS hook before the first <script type=\"module\">
if (html.includes('<script type=\"module\"')) {
  html = html.replace('<script type=\"module\"', wsHook + '\n<script type=\"module\"');
} else {
  html = html.replace('<head>', '<head>\n' + wsHook);
}

// 2) Insert overlay script before </body>
if (html.includes('</body>')) {
  html = html.replace('</body>', overlayTag + '\n</body>');
} else if (html.includes('</html>')) {
  html = html.replace('</html>', overlayTag + '\n</html>');
} else {
  html += '\n' + overlayTag;
}

fs.writeFileSync(process.argv[1], html);
" "$INDEX_HTML" "$WS_HOOK" "$OVERLAY_TAG"

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
