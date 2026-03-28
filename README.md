# openclaw-assist

Remote assist plugin for OpenClaw — one-click screen sharing (via Agora RTC) with text chat, directly inside Control UI.

## Features

- One-click "request help" — generates a 6-digit session code + link
- Helper opens the link — sees host's screen via Agora RTC SDK
- Built-in text chat for both sides
- Floating, draggable, resizable panel
- Works on the same port as Gateway (no extra server needed)

## Quick Start

### 1. Install the plugin

```bash
openclaw plugins install /path/to/claw-live

# or dev mode (symlink)
openclaw plugins install -l /path/to/claw-live
```

### 2. Inject overlay into Control UI

```bash
bash /path/to/claw-live/scripts/inject.sh
```

### 3. Restart Gateway

```bash
openclaw gateway
```

### 4. Use it

Open Control UI — you'll see the assist panel in the bottom-right corner.

**As host (needs help):**
1. Click "发起协助"
2. Share the 6-digit code or link with your helper
3. Click "共享屏幕给协助者"
4. Chat via the text panel

**As helper (providing help):**
1. Open the link (or enter the code)
2. See the host's screen automatically
3. Chat via the text panel

**Slash command (in chat):**

| Command | Action |
|---------|--------|
| `/assist` | Show session status |
| `/assist start` | Create assist session |
| `/assist stop` | End assist session |

**API endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/assist/create` | POST | Create assist session |
| `/live/api/assist/join` | POST | Join by code |
| `/live/api/assist/end` | POST | End session |
| `/live/api/assist/state` | GET | Current session state |
| `/live/api/chat/send` | POST | Send chat message |
| `/live/api/chat/history` | GET | Chat history |
| `/live/api/events` | GET (SSE) | Real-time session + chat stream |

## Configuration

The overlay uses **Agora RTC SDK** for screen sharing. A default App ID is built-in for testing. To use your own:

- Open the Settings panel (gear icon) in the overlay
- Enter your Agora App ID
- Click "保存"

The App ID is stored in `localStorage` and persists across sessions.

> For production use, enable Agora Token authentication in your Agora Console and implement server-side token generation.

## Architecture

```
┌─────────────────────────────────┐
│       Control UI (browser)      │
│                                 │
│     ┌───────────────────┐       │
│     │  Assist Overlay    │       │
│     │  (injected JS)     │       │
│     │  Screen (Agora)    │       │
│     │  + Text Chat       │       │
│     └────────┬──────────┘       │
│              │ SSE + POST       │
├──────────────┼──────────────────┤
│  Gateway     │                  │
│  ├─ /live/api/* (assist+chat)  │
│  └─ AssistService               │
└─────────────────────────────────┘

Screen sharing: Host ─→ Agora Cloud ─→ Helper
Text chat: Host ↔ Gateway REST/SSE ↔ Helper
```

## Development

```bash
# Type check
npx tsc --noEmit

# Watch overlay changes
ls overlay/ | entr bash scripts/inject.sh ./test-control-ui
```

## License

MIT
