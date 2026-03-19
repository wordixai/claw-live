# @openclaw/live-stream

Live stream overlay plugin for OpenClaw — adds a floating video player with danmaku directly into the Control UI.

## Features

- Floating, draggable, resizable live stream panel on Control UI
- HLS video playback (via hls.js)
- Real-time danmaku (bullet comments) overlay
- Stream controls via `/live` slash commands
- SSE-based real-time state sync
- Minimize / fullscreen / hide toggle

## Quick Start

### 1. Install the plugin

```bash
# 用绝对路径安装（复制到 ~/.openclaw/extensions/）
openclaw plugins install /Users/haitaowu/work/live-openclaw

# 或用软链接安装（开发模式，改代码立即生效）
openclaw plugins install -l /Users/haitaowu/work/live-openclaw
```

### 2. Inject overlay into Control UI

```bash
# 自动检测 Control UI 位置（~/.openclaw/dist/control-ui/）
bash /Users/haitaowu/work/live-openclaw/scripts/inject.sh

# 或手动指定 Control UI 目录
bash /Users/haitaowu/work/live-openclaw/scripts/inject.sh /path/to/dist/control-ui
```

### 3. Restart Gateway

```bash
openclaw gateway
```

### 4. Use it

Open Control UI — you'll see a floating live panel in the bottom-right corner.

**Slash commands (in chat):**

| Command | Action |
|---------|--------|
| `/live` | Show stream status |
| `/live start [url]` | Start stream (optional HLS URL) |
| `/live stop` | Stop stream |
| `/live title <name>` | Set stream title |
| `/live dm <text>` | Send a danmaku message |

**API endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/live/api/state` | GET | Current stream state |
| `/live/api/control` | POST | Control stream (start/stop/config/status) |
| `/live/api/danmaku` | GET | Danmaku history |
| `/live/api/danmaku/send` | POST | Send danmaku |
| `/live/api/events` | GET (SSE) | Real-time state + danmaku stream |
| `/live/signal/events` | GET (SSE) | WebRTC signaling channel (broadcaster/viewer) |
| `/live/signal/send` | POST | Send signaling message (offer/answer/ICE) |

## Deploy to Fly.io

以下记录将此插件部署到 Fly.io 上已运行的 OpenClaw 实例的完整过程。

### 前提条件

- 已有一个运行中的 Fly.io app（如 `openclaw-cd4ad779-mmwv8owz`）
- 本地已安装 `flyctl` 并登录（`flyctl auth login`）

### 部署步骤

**1. 打包插件文件**

```bash
tar czf /tmp/live-openclaw-plugin.tar.gz src/ overlay/ openclaw.plugin.json package.json scripts/inject.sh
```

**2. 上传到持久卷 `/data/`**

```bash
# 先删除旧文件
flyctl ssh console -a <app-name> -C "rm -f /data/live-openclaw-plugin.tar.gz"

# SFTP 上传
echo "put /tmp/live-openclaw-plugin.tar.gz /data/live-openclaw-plugin.tar.gz" | flyctl ssh sftp shell -a <app-name>

# SSH 解压
flyctl ssh console -a <app-name> -C "sh -c 'rm -rf /data/live-stream-plugin && mkdir -p /data/live-stream-plugin && tar xzf /data/live-openclaw-plugin.tar.gz -C /data/live-stream-plugin'"
```

**3. 安装插件到 Gateway**

```bash
flyctl ssh console -a <app-name> -C "sh -c 'openclaw plugins install /data/live-stream-plugin'"

# 修复所有权（避免 Gateway 安全检查告警）
flyctl ssh console -a <app-name> -C "sh -c 'chown -R root:root /data/extensions/live-stream'"
```

安装后插件代码会持久保存在 `/data/extensions/live-stream/`。

**4. 创建启动脚本（每次重启自动注入 overlay）**

Fly.io 机器重启时会从镜像恢复 `/app/` 文件系统，overlay 注入会丢失。需要在 `/data/`（持久卷）创建启动脚本：

```bash
flyctl ssh console -a <app-name> -C "sh -c 'cat > /data/setup-live-stream.sh << '\''EOF'\''
#!/bin/sh
set -e
SRC=/data/live-stream-plugin
UI=/app/dist/control-ui

cp \$SRC/overlay/* \$UI/
cp -r \$SRC/src /data/extensions/live-stream/
cp -r \$SRC/overlay /data/extensions/live-stream/

if ! grep -q live-stream-overlay \$UI/index.html; then
  sed -i \"s|</body>|<script src=\\\"./live-stream-overlay.js\\\" defer></script>\\n</body>|\" \$UI/index.html
fi

chown -R root:root /data/extensions/live-stream 2>/dev/null || true
echo \"[setup] live-stream overlay injected\"
EOF
chmod +x /data/setup-live-stream.sh'"
```

**5. 修改机器启动命令**

让 Gateway 启动前先运行安装脚本：

```bash
flyctl machines update <machine-id> -a <app-name> \
  --command "sh -c '/data/setup-live-stream.sh && exec node openclaw.mjs gateway --allow-unconfigured --port 3000 --bind lan'" \
  --yes
```

**6. 重启验证**

```bash
flyctl machines restart <machine-id> -a <app-name>

# 检查日志
flyctl logs -a <app-name> --no-tail | grep live-stream

# 测试 API
curl -s https://<app-name>.fly.dev/live/api/state
# 应返回: {"ok":true,"state":{"status":"idle",...}}
```

### Fly.io 适配要点

| 问题 | 解决方案 |
|------|----------|
| 只暴露 3000 端口 | 信令从独立 WebSocket(18790) 改为 SSE+POST，全部走 Gateway 3000 端口 |
| 重启后 `/app/` 还原 | 插件文件存 `/data/`（持久卷），启动脚本每次重启自动注入 overlay |
| 路由 API 不同 | 使用 `api.registerHttpRoute()` 而非 `api.registerRoute()` |
| 认证拦截 | 路由设 `auth: "plugin"` 跳过 Gateway 认证（插件自行处理） |
| 文件权限告警 | `chown -R root:root` 修复 `/data/extensions/live-stream/` 所有权 |

### 文件分布（服务器端）

```
/data/                              ← 持久卷（重启不丢失）
├── live-stream-plugin/             ← 插件源文件（tar 解压）
│   ├── src/
│   ├── overlay/
│   ├── openclaw.plugin.json
│   └── package.json
├── extensions/live-stream/         ← Gateway 加载的插件（openclaw plugins install）
│   ├── src/
│   ├── overlay/
│   ├── openclaw.plugin.json
│   └── package.json
├── setup-live-stream.sh            ← 启动脚本
└── openclaw.json                   ← Gateway 配置（含 plugins 注册）

/app/dist/control-ui/               ← Control UI 静态文件（重启会还原，靠脚本重注入）
├── index.html                      ← 被注入 <script> 标签
├── live-stream-overlay.js          ← 直播面板前端
├── live-stream-overlay.css
└── sw.js
```

## Architecture

```
┌─────────────────────────────────┐
│       Control UI (browser)      │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Existing panels          │  │
│  │  (Chat, Skills, Config..) │  │
│  │                           │  │
│  │     ┌───────────────┐     │  │
│  │     │ Live Overlay   │     │  │
│  │     │ (injected JS)  │     │  │
│  │     │ Video + Danmaku│     │  │
│  │     └───────┬───────┘     │  │
│  │             │ SSE          │  │
│  └─────────────┼─────────────┘  │
│                │                │
├────────────────┼────────────────┤
│  Gateway       │                │
│  ├─ /live/api/* (Plugin routes) │
│  └─ StreamService (background)  │
└─────────────────────────────────┘
```

## Development

```bash
# Watch overlay changes (manual reload)
ls overlay/ | entr bash scripts/inject.sh ./test-control-ui

# Type check
npx tsc --noEmit
```

## License

MIT
