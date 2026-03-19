---
name: openclaw-live
description: Install, configure, and operate the OpenClaw live-stream plugin — inject overlay, broadcast/view via WebRTC, send danmaku, and manage streams via slash commands and API. Use when the user mentions "live", "直播", "开播", "弹幕", "danmaku", "overlay", "broadcast", "WebRTC signaling", or wants to set up or control live streaming in OpenClaw.
---

# OpenClaw Live Stream

Manage the `@openclaw/live-stream` plugin: install, inject overlay, and control live streaming.

**Project root**: Use the workspace root (where `package.json` and `openclaw.plugin.json` live).

## Quick Reference

| Task | Command |
|------|---------|
| Install plugin | `openclaw plugins install -l .` |
| Inject overlay | `bash scripts/inject.sh` |
| Start gateway | `openclaw gateway` |
| (Optional) Start proxy | `node scripts/proxy.mjs 0.0.0.0 8080 18789` |

## Installation

### Step 1: Install plugin into OpenClaw

```bash
# Symlink install (dev mode — edits take effect immediately)
openclaw plugins install -l /Users/haitaowu/work/live-openclaw

# Or copy install (production)
openclaw plugins install /Users/haitaowu/work/live-openclaw
```

### Step 2: Inject overlay into Control UI

```bash
# Auto-detect Control UI location
bash scripts/inject.sh

# Or specify path manually
bash scripts/inject.sh /path/to/dist/control-ui
```

Detection order: npm global → nvm → `~/.openclaw/dist/control-ui` → `/app/dist/control-ui` (Fly.io).

The script copies `live-stream-overlay.js`, `live-stream-overlay.css`, `sw.js` and injects a `<script>` tag into `index.html`. Idempotent — safe to run multiple times.

### Step 3: Install dependencies

```bash
npm install
```

### Step 4: Start Gateway

```bash
openclaw gateway
```

Signaling is built into the gateway plugin. No extra processes needed.

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

Deploy behind an HTTPS reverse proxy (nginx, Caddy, etc.). The gateway handles signaling on the same port. Make sure the reverse proxy forwards WebSocket upgrades for `/live/signal`.

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

## WebRTC Mode (Camera / Screen Share)

The overlay appears at bottom-right. Three modes:

| Button | Role | Action |
|--------|------|--------|
| 开播 | Broadcaster (camera) | Captures camera+mic, streams via WebRTC |
| 共享屏幕 | Broadcaster (screen) | Captures screen, streams via WebRTC |
| 进入观看 | Viewer | Receives WebRTC stream from broadcaster |

Settings (gear icon): `signalHost`, `signalPort` (optional override), `roomTitle`, TURN config. Stored in `localStorage`.

By default the overlay connects to the same origin for signaling — no configuration needed.

**Bubble mode**: When live, the overlay auto-collapses to a circular camera window (130px) with a pulsing red live dot. Click to expand the full panel with controls; drag to reposition. Mouse-leave from the expanded panel collapses back to bubble after 600ms. Stopping the broadcast auto-collapses to the FAB toggle button.

**FAB toggle**: After closing the overlay via ×, a floating camera button appears at bottom-right. Click to reopen; drag to reposition.

**Light theme**: The overlay uses a clean white/light-grey palette that integrates with the Control UI.

## Slash Commands (Chat)

| Command | Action |
|---------|--------|
| `/live` | Show current stream status |
| `/live start [url]` | Start stream (optional HLS URL) |
| `/live stop` | Stop stream |
| `/live title <name>` | Set room title |
| `/live dm <text>` | Send danmaku message (alias: `/live danmaku <text>`) |

## API Endpoints

All under gateway base URL.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/state` | GET | Current stream state |
| `/live/api/control` | POST | Control: `{action: "start"|"stop"|"config"|"status"}` |
| `/live/api/danmaku` | GET | Danmaku history |
| `/live/api/danmaku/send` | POST | Send danmaku: `{text: "...", sender?: "..."}` |
| `/live/api/events` | GET (SSE) | Real-time state + danmaku event stream |
| `/live/signal` | WS | WebRTC signaling (built into gateway) |

### Examples

```bash
# Check stream status
curl http://localhost:18789/live/api/state

# Start stream with HLS URL
curl -X POST http://localhost:18789/live/api/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"start","url":"https://example.com/live.m3u8"}'

# Send danmaku
curl -X POST http://localhost:18789/live/api/danmaku/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello Live!","sender":"agent"}'

# Listen to SSE events
curl -N http://localhost:18789/live/api/events
```

## Plugin Config (`openclaw.plugin.json`)

| Field | Type | Description |
|-------|------|-------------|
| `streamUrl` | string | Default HLS stream URL (.m3u8) |
| `roomTitle` | string | Default room title |
| `autoStart` | boolean | Auto-start stream on gateway boot |

## Full Setup Workflow

```
Task Progress:
- [ ] Step 1: npm install
- [ ] Step 2: Install plugin (openclaw plugins install -l .)
- [ ] Step 3: Inject overlay (bash scripts/inject.sh)
- [ ] Step 4: Start gateway (openclaw gateway)
- [ ] Step 5: Open Control UI and verify overlay
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Camera/mic blocked on LAN IP | Use `proxy.mjs` or deploy behind HTTPS |
| Camera/mic blocked on remote | Ensure HTTPS is configured on reverse proxy |
| Overlay not showing | Re-run `bash scripts/inject.sh`, hard-refresh browser |
| Signal connection failed | Default uses same origin; check reverse proxy forwards WS upgrades |
| WebRTC fails across networks | Configure TURN server in overlay settings |
| "inject.sh: Control UI not found" | Pass path explicitly: `bash scripts/inject.sh /path/to/control-ui` |

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
