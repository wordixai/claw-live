---
name: openclaw-live
description: Install, configure, and use the OpenClaw Live Stream plugin — broadcast camera/screen via WebRTC, watch streams, send danmaku, control via slash commands and API. Use when the user mentions "live", "直播", "开播", "弹幕", "danmaku", "broadcast", "install live", "安装直播", "update live", "更新直播", or wants to set up or use live streaming in OpenClaw.
---

# OpenClaw Live Stream

A plugin that adds live streaming to OpenClaw Control UI — floating video panel, WebRTC broadcast/view, danmaku, and slash command controls.

Repository: `https://github.com/wordixai/claw-live`

---

## Install

### 1. Clone the repo

```bash
mkdir -p ~/.openclaw/plugins
git clone https://github.com/wordixai/claw-live.git ~/.openclaw/plugins/live-stream
```

### 2. Install dependencies

```bash
cd ~/.openclaw/plugins/live-stream && npm install --production
```

### 3. Register the plugin

```bash
openclaw plugins install ~/.openclaw/plugins/live-stream
```

If `openclaw` is not found:

```bash
npx openclaw plugins install ~/.openclaw/plugins/live-stream
```

### 4. Inject overlay into Control UI

```bash
bash ~/.openclaw/plugins/live-stream/scripts/inject.sh
```

The script auto-detects the Control UI location. If detection fails, pass the path manually:

```bash
bash ~/.openclaw/plugins/live-stream/scripts/inject.sh /path/to/control-ui
```

### 5. Restart the Gateway

```bash
openclaw gateway
```

Open Control UI — the live stream panel appears in the bottom-right corner.

---

## Update

```bash
cd ~/.openclaw/plugins/live-stream
git pull origin main
npm install --production
bash scripts/inject.sh
```

Restart the Gateway after updating.

---

## Uninstall

```bash
openclaw plugins uninstall live-stream
rm -rf ~/.openclaw/plugins/live-stream
```

---

## Usage

### Slash Commands

Type in the chat input:

| Command | Description |
|---------|-------------|
| `/live` | Show current stream status |
| `/live start [url]` | Start streaming (optional HLS URL) |
| `/live stop` | Stop streaming |
| `/live title <name>` | Set room title |
| `/live dm <text>` | Send a danmaku message |

### API

All endpoints are served by the Gateway.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/state` | GET | Current stream state |
| `/live/api/control` | POST | Control: `{action: "start"\|"stop"\|"config"\|"status"}` |
| `/live/api/danmaku` | GET | Danmaku history (optional `?limit=50`) |
| `/live/api/danmaku/send` | POST | Send danmaku: `{text, sender?}` |
| `/live/api/events` | GET (SSE) | Real-time state + danmaku event stream |
| `/live/signal/events` | GET (SSE) | WebRTC signaling channel (`?role=broadcaster\|viewer`) |
| `/live/signal/send` | POST | Send signaling message: `{clientId, ...msg}` |

Examples:

```bash
curl http://localhost:18789/live/api/state

curl -X POST http://localhost:18789/live/api/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"start"}'

curl -X POST http://localhost:18789/live/api/danmaku/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello!","sender":"me"}'
```

### Plugin Config (`openclaw.plugin.json`)

| Field | Type | Description |
|-------|------|-------------|
| `streamUrl` | string | Default HLS stream URL |
| `roomTitle` | string | Default room title |
| `autoStart` | boolean | Auto-start stream on gateway boot |

---

## Common Issues

| Problem | Fix |
|---------|-----|
| Overlay not showing | Re-run `bash scripts/inject.sh`, then hard-refresh (Cmd+Shift+R) |
| Camera/mic blocked on LAN IP | Use `node scripts/proxy.mjs 0.0.0.0 8080 18789` or deploy behind HTTPS |
| `openclaw` command not found | Run `npm install -g openclaw` first |
