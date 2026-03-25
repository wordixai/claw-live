---
name: openclaw-live
description: Install, update, configure, and operate the OpenClaw Live Stream plugin — clone from GitHub, inject overlay, broadcast/view via WebRTC, send danmaku, manage streams via slash commands and API. Use when the user mentions "live", "直播", "开播", "弹幕", "danmaku", "overlay", "broadcast", "WebRTC signaling", "install live", "安装直播", "update live", "更新直播", "uninstall live", "卸载直播", or wants to set up or control live streaming in OpenClaw.
---

# OpenClaw Live Stream

Full lifecycle management for the `openclaw-live-stream` plugin: install, update, uninstall, deploy, and operate.

## Constants

```
REPO_URL = https://github.com/nicepkg/openclaw-live-stream.git
PLUGIN_DIR = ~/.openclaw/plugins/live-stream
PLUGIN_ID = live-stream
```

> If the repo is private or the URL has changed, ask the user for the correct URL before proceeding.

## Detect Environment

Before install/update/inject, detect where OpenClaw's Control UI lives. Run these probes and use the first hit:

```bash
# Probe 1: npm global
npm root -g 2>/dev/null | xargs -I{} test -f "{}/openclaw/dist/control-ui/index.html" && npm root -g | xargs -I{} echo "{}/openclaw/dist/control-ui"

# Probe 2: nvm (scan all node versions)
ls -d ~/.nvm/versions/node/*/lib/node_modules/openclaw/dist/control-ui 2>/dev/null | while read d; do test -f "$d/index.html" && echo "$d" && break; done

# Probe 3: ~/.openclaw
test -f ~/.openclaw/dist/control-ui/index.html && echo ~/.openclaw/dist/control-ui

# Probe 4: Fly.io container
test -f /app/dist/control-ui/index.html && echo /app/dist/control-ui
```

Store the result as `CONTROL_UI_DIR`. If none found, ask the user to provide the path manually.

---

## Install

Trigger: "install", "安装", "setup"

### Step 1 — Clone repo

```bash
if [ -d ~/.openclaw/plugins/live-stream/.git ]; then
  echo "Already cloned — switching to update flow"
else
  mkdir -p ~/.openclaw/plugins
  git clone https://github.com/nicepkg/openclaw-live-stream.git ~/.openclaw/plugins/live-stream
fi
```

If `git clone` fails, suggest: check network/VPN, or use a token URL.

### Step 2 — Install dependencies

```bash
cd ~/.openclaw/plugins/live-stream && npm install --production
```

### Step 3 — Register plugin

```bash
openclaw plugins install ~/.openclaw/plugins/live-stream
```

If `openclaw` CLI is not found:
```bash
which openclaw || npx openclaw plugins install ~/.openclaw/plugins/live-stream
```

### Step 4 — Inject overlay

```bash
bash ~/.openclaw/plugins/live-stream/scripts/inject.sh "$CONTROL_UI_DIR"
```

`inject.sh` is idempotent. It copies `live-stream-overlay.js`, `live-stream-overlay.css`, `sw.js` into Control UI dir and injects `<script>` tags into `index.html`.

### Step 5 — Verify

```bash
openclaw plugins list 2>/dev/null | grep -i live
ls -la "$CONTROL_UI_DIR"/live-stream-overlay.js "$CONTROL_UI_DIR"/live-stream-overlay.css "$CONTROL_UI_DIR"/sw.js
grep "live-stream-overlay" "$CONTROL_UI_DIR/index.html"
```

### Step 6 — Report

Tell the user to restart the gateway (`openclaw gateway`) and open Control UI.

---

## Update

Trigger: "update", "更新", "upgrade", "pull latest"

```bash
cd ~/.openclaw/plugins/live-stream && git stash && git pull origin main && git stash pop
cd ~/.openclaw/plugins/live-stream && npm install --production
bash ~/.openclaw/plugins/live-stream/scripts/inject.sh "$CONTROL_UI_DIR"
cd ~/.openclaw/plugins/live-stream && git log --oneline -10
```

Tell the user what changed and remind them to restart the gateway.

---

## Uninstall

Trigger: "uninstall", "卸载", "remove live stream"

### Remove overlay from Control UI

```bash
rm -f "$CONTROL_UI_DIR"/live-stream-overlay.js \
      "$CONTROL_UI_DIR"/live-stream-overlay.css \
      "$CONTROL_UI_DIR"/sw.js
```

Remove injected tags from `index.html`:
```bash
node -e "
const fs = require('fs');
const p = process.argv[1] + '/index.html';
let h = fs.readFileSync(p,'utf-8');
h = h.replace(/.*__ocWsOk.*\n?/g, '');
h = h.replace(/.*live-stream-overlay.*\n?/g, '');
fs.writeFileSync(p, h);
" "$CONTROL_UI_DIR"
```

### Unregister & remove

```bash
openclaw plugins uninstall live-stream 2>/dev/null || true
```

Ask user before deleting:
```bash
rm -rf ~/.openclaw/plugins/live-stream
```

---

## Diagnose

Trigger: "check live", "直播状态", "is live installed", "diagnose"

```bash
echo "=== Plugin directory ==="
ls -la ~/.openclaw/plugins/live-stream/package.json 2>/dev/null && echo "OK" || echo "NOT FOUND"

echo "=== Plugin registered ==="
openclaw plugins list 2>/dev/null | grep -i live || echo "NOT REGISTERED"

echo "=== Overlay files ==="
for f in live-stream-overlay.js live-stream-overlay.css sw.js; do
  test -f "$CONTROL_UI_DIR/$f" && echo "$f: OK" || echo "$f: MISSING"
done

echo "=== index.html injection ==="
grep -c "live-stream-overlay" "$CONTROL_UI_DIR/index.html" 2>/dev/null && echo "INJECTED" || echo "NOT INJECTED"

echo "=== Version ==="
node -e "console.log(require('$HOME/.openclaw/plugins/live-stream/package.json').version)" 2>/dev/null || echo "unknown"

echo "=== Git status ==="
cd ~/.openclaw/plugins/live-stream 2>/dev/null && git log --oneline -1 && git status --short
```

---

## Deployment Scenarios

### Local development

`openclaw gateway` then open `http://localhost:18789`. Camera/mic work on localhost without HTTPS.

### Local dev on LAN IP (e.g. 192.168.x.x)

Use `proxy.mjs` to override Permissions-Policy headers:

```bash
node scripts/proxy.mjs 0.0.0.0 8080 18789
```

Access via `http://192.168.x.x:8080`.

### Remote server

Deploy behind an HTTPS reverse proxy (nginx, Caddy, etc.). The gateway handles signaling on the same port. Forward WebSocket upgrades for `/live/signal`.

nginx example:
```nginx
location /live/signal {
    proxy_pass http://127.0.0.1:18789;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Remote + restrictive NAT

Configure a TURN server in the overlay settings (gear icon):
- TURN Server: `turn:your-server.com:3478`
- TURN Username / Password

---

## WebRTC Mode

The overlay appears at bottom-right. Three modes:

| Button | Role | Action |
|--------|------|--------|
| 视频直播 | Broadcaster (camera) | Captures camera+mic, streams via WebRTC |
| 屏幕直播 | Broadcaster (screen) | Captures screen, streams via WebRTC |
| 进入观看 | Viewer | Receives WebRTC stream from broadcaster |

Settings (gear icon): `signalHost`, `signalPort`, `roomTitle`, TURN config. Stored in `localStorage`. Default: same origin — no configuration needed.

**Bubble mode**: When live, auto-collapses to a circular camera window (130px) with pulsing red dot. Click to expand; drag to reposition.

**FAB toggle**: After closing via ×, a floating camera button appears at bottom-right.

---

## Slash Commands

| Command | Action |
|---------|--------|
| `/live` | Show current stream status |
| `/live start [url]` | Start stream (optional HLS URL) |
| `/live stop` | Stop stream |
| `/live title <name>` | Set room title |
| `/live dm <text>` | Send danmaku (alias: `/live danmaku <text>`) |

## API Endpoints

All under gateway base URL.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/state` | GET | Current stream state |
| `/live/api/control` | POST | Control: `{action: "start"|"stop"|"config"|"status"}` |
| `/live/api/danmaku` | GET | Danmaku history |
| `/live/api/danmaku/send` | POST | Send danmaku: `{text, sender?}` |
| `/live/api/events` | GET (SSE) | Real-time state + danmaku event stream |
| `/live/signal` | WS | WebRTC signaling (built into gateway) |

### Examples

```bash
curl http://localhost:18789/live/api/state

curl -X POST http://localhost:18789/live/api/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"start","url":"https://example.com/live.m3u8"}'

curl -X POST http://localhost:18789/live/api/danmaku/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello Live!","sender":"agent"}'

curl -N http://localhost:18789/live/api/events
```

## Plugin Config (`openclaw.plugin.json`)

| Field | Type | Description |
|-------|------|-------------|
| `streamUrl` | string | Default HLS stream URL (.m3u8) |
| `roomTitle` | string | Default room title |
| `autoStart` | boolean | Auto-start stream on gateway boot |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `git clone` fails | Check network; if private repo, use token URL |
| `openclaw: command not found` | `npm install -g openclaw` |
| `inject.sh: Control UI not found` | Pass path: `bash scripts/inject.sh /path/to/control-ui` |
| Overlay not showing | Re-run `inject.sh`, hard-refresh (Cmd+Shift+R) |
| Camera/mic blocked on LAN IP | Use `proxy.mjs` or deploy behind HTTPS |
| Camera/mic blocked on remote | Ensure HTTPS on reverse proxy |
| Signal connection failed | Check reverse proxy forwards WS upgrades |
| WebRTC fails across networks | Configure TURN server in overlay settings |

## Architecture

```
Browser (Control UI)
  └── Overlay (live-stream-overlay.js)
        ├── WebRTC P2P ←→ ws://same-origin/live/signal (gateway built-in)
        └── HLS / API  ←→ /live/api/*

Gateway (single port)
  ├── Plugin routes: /live/api/* (state, control, danmaku, events)
  ├── WebSocket: /live/signal (SignalingService — WebRTC signaling + danmaku)
  └── StreamService (HLS lifecycle)

Optional: proxy.mjs (local dev only, for Permissions-Policy override)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin entry: registers service, command, routes, WS upgrade |
| `src/api-routes.ts` | HTTP handler for `/live/*` + WS upgrade for `/live/signal` |
| `src/signaling-service.ts` | WebRTC signaling: broadcaster/viewer relay, danmaku broadcast |
| `src/stream-service.ts` | Stream state, danmaku, HLS lifecycle |
| `src/types.ts` | TypeScript types |
| `overlay/live-stream-overlay.js` | Browser overlay: WebRTC, UI, danmaku |
| `overlay/live-stream-overlay.css` | Overlay styles |
| `overlay/sw.js` | Service Worker for permissions |
| `scripts/proxy.mjs` | (Optional) HTTP proxy + signaling for local dev |
| `scripts/signal.mjs` | (Optional) Standalone signaling server |
| `scripts/inject.sh` | Inject overlay into Control UI |

## Distribute This Skill

Copy this folder into any OpenClaw instance's skills directory:

```bash
cp -r skills/openclaw-live ~/.openclaw/skills/openclaw-live
# Or project-level:
cp -r skills/openclaw-live /path/to/project/.agents/skills/openclaw-live
```
