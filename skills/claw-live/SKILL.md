---
name: openclaw-assist
description: Install, configure, and use the OpenClaw Assist plugin — one-click screen sharing with text chat for remote troubleshooting. Use when the user mentions "assist", "协助", "远程协助", "screen share", "屏幕共享", "install assist", "安装协助", or wants to set up remote help in OpenClaw.
---

# OpenClaw Assist

A plugin that adds remote assist to OpenClaw Control UI — one-click screen sharing (via Agora RTC SDK) with text chat for troubleshooting and collaboration.

Repository: `https://github.com/wordixai/claw-live`

---

## Install

> **Important:** Before proceeding, locate the actual OpenClaw data directory on the host machine. All paths below use `~/.openclaw` as a placeholder — replace it with the real data directory path.

### 1. Clone the repo

```bash
mkdir -p ~/.openclaw/plugins
git clone https://github.com/wordixai/claw-live.git ~/.openclaw/plugins/assist
```

### 2. Install dependencies

```bash
cd ~/.openclaw/plugins/assist && npm install --production
```

### 3. Configure Agora credentials

Create a `.env` file in the plugin root with your Agora project credentials:

```bash
cat > ~/.openclaw/plugins/assist/.env << 'EOF'
AGORA_APP_ID=<your-agora-app-id>
AGORA_APP_CERTIFICATE=<your-agora-app-certificate>
EOF
```

Both values are available in the [Agora Console](https://console.agora.io) under your project settings. The App Certificate must be enabled for the project.

Alternatively, set them as environment variables (`AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`) before starting the Gateway.

### 4. Register the plugin

```bash
openclaw plugins install ~/.openclaw/plugins/assist
```

If `openclaw` is not found:

```bash
npx openclaw plugins install ~/.openclaw/plugins/assist
```

### 5. Inject overlay into Control UI

```bash
bash ~/.openclaw/plugins/assist/scripts/inject.sh
```

The script auto-detects the Control UI location. If detection fails, pass the path manually:

```bash
bash ~/.openclaw/plugins/assist/scripts/inject.sh /path/to/control-ui
```

> **Do NOT restart any service after injection.** The overlay takes effect immediately; restarting will undo the injection.

### 6. Restart the Gateway

```bash
openclaw gateway
```

Open Control UI — the assist panel appears in the bottom-right corner.

---

## Deploy to Fly.io

For remote instances running on Fly.io, set Agora credentials as secrets and deploy using the included script:

```bash
fly secrets set AGORA_APP_ID=<your-agora-app-id> -a <fly-app-name>
fly secrets set AGORA_APP_CERTIFICATE=<your-agora-app-certificate> -a <fly-app-name>
bash scripts/deploy-fly.sh <fly-app-name>
```

The deploy script packages, uploads, extracts, and injects the plugin on the remote machine (no restart needed).

---

## Update

```bash
cd ~/.openclaw/plugins/assist
git pull origin main
npm install --production
bash scripts/inject.sh
```

Restart the Gateway after updating.

---

## Uninstall

```bash
openclaw plugins uninstall live-stream
rm -rf ~/.openclaw/plugins/assist
```

---

## Usage

### As Host (needs help)

1. Click **"发起协助"** in the assist panel
2. Share the 6-digit code or link with your helper
3. Click **"共享屏幕给协助者"** to start screen sharing
4. Use the chat panel to communicate

### As Helper (providing help)

1. Open the shared link (auto-joins), or enter the 6-digit code
2. The host's screen appears automatically via Agora RTC
3. Use the chat panel to communicate

### Slash Commands

Type in the chat input:

| Command | Description |
|---------|-------------|
| `/assist` | Show current session status |
| `/assist start` | Create a new assist session |
| `/assist stop` | End the current session |

### API

All endpoints are served by the Gateway. The `/create` and `/join` endpoints return Agora credentials (`agora.appId`, `agora.token`, `agora.channel`) generated server-side — the frontend never stores static credentials.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/assist/create` | POST | Create assist session (returns Agora token) |
| `/live/api/assist/join` | POST | Join session: `{code}` (returns Agora token) |
| `/live/api/assist/end` | POST | End session |
| `/live/api/assist/state` | GET | Current session state |
| `/live/api/chat/send` | POST | Send chat: `{text, sender?}` |
| `/live/api/chat/history` | GET | Chat history (optional `?limit=50`) |
| `/live/api/events` | GET (SSE) | Real-time session + chat event stream |

Examples:

```bash
curl http://localhost:18789/live/api/assist/state

curl -X POST http://localhost:18789/live/api/assist/create \
  -H 'Content-Type: application/json' \
  -d '{}'

curl -X POST http://localhost:18789/live/api/chat/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello!","sender":"me"}'
```

---

## Architecture

Agora credentials are managed server-side:

1. `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` are read from environment variables or `.env` file
2. When a session is created/joined, the server generates a short-lived RTC token (24h) for that specific channel
3. The frontend receives `appId`, `token`, and `channel` from the API response — no credentials are hardcoded in client code

---

## Common Issues

| Problem | Fix |
|---------|-----|
| Overlay not showing | Re-run `bash scripts/inject.sh`, then hard-refresh (Cmd+Shift+R) |
| "Agora 未配置" error | Create `.env` with `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE`, restart Gateway |
| Screen share fails with token error | Verify App Certificate is enabled in Agora Console and matches `.env` |
| `openclaw` command not found | Run `npm install -g openclaw` first |
