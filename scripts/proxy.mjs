/**
 * OpenClaw Live-Stream HTTPS Proxy + WebRTC Signaling Server
 *
 * 1. HTTPS reverse proxy: enables secure context for camera/mic on LAN
 * 2. Overrides Permissions-Policy headers
 * 3. WebRTC signaling: relays SDP offers/answers/ICE between
 *    broadcaster and viewers so they can establish P2P video streams
 *
 * Usage:
 *   node scripts/proxy.mjs [host] [listen-port] [gateway-port]
 *   node scripts/proxy.mjs 0.0.0.0 8443 18789
 *
 * Then open https://192.168.1.x:8443 (accept cert warning once)
 */

import http from "node:http";
import https from "node:https";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const LISTEN_HOST = process.argv[2] || "0.0.0.0";
const LISTEN_PORT = parseInt(process.argv[3] || "8443", 10);
const GATEWAY_PORT = parseInt(process.argv[4] || "18789", 10);
const GATEWAY_HOST = process.argv[5] || "127.0.0.1";

// ── Auto-generate self-signed TLS cert ──

const CERT_DIR = join(import.meta.dirname || ".", ".certs");
const CERT_KEY = join(CERT_DIR, "key.pem");
const CERT_FILE = join(CERT_DIR, "cert.pem");

function ensureCert() {
  if (existsSync(CERT_KEY) && existsSync(CERT_FILE)) return;
  mkdirSync(CERT_DIR, { recursive: true });
  console.log("  🔐 Generating self-signed TLS certificate...");
  execSync(
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
    `-keyout "${CERT_KEY}" -out "${CERT_FILE}" -days 365 -nodes ` +
    `-subj "/CN=OpenClaw Live Proxy" ` +
    `-addext "subjectAltName=IP:127.0.0.1,IP:192.168.1.6,DNS:localhost"`,
    { stdio: "pipe" }
  );
  console.log("  ✅ Certificate saved to", CERT_DIR);
}

ensureCert();
const tlsOptions = {
  key: readFileSync(CERT_KEY),
  cert: readFileSync(CERT_FILE),
};

// ── WebRTC Signaling State ──

let broadcaster = null;          // WebSocket of the current broadcaster
const viewers = new Map();       // viewerId -> WebSocket
let viewerIdCounter = 0;
let streamInfo = { live: false, title: "OpenClaw Live", startedAt: null };

function broadcastToAll(msg) {
  const data = JSON.stringify(msg);
  if (broadcaster?.readyState === WebSocket.OPEN) broadcaster.send(data);
  for (const ws of viewers.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendTo(ws, msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── HTTP Reverse Proxy ──

const server = https.createServer(tlsOptions, (clientReq, clientRes) => {
  const options = {
    hostname: GATEWAY_HOST,
    port: GATEWAY_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: `${GATEWAY_HOST}:${GATEWAY_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };

    headers["permissions-policy"] =
      "camera=(self), microphone=(self), display-capture=(self), geolocation=()";

    if (headers["content-security-policy"]) {
      headers["content-security-policy"] = headers["content-security-policy"]
        .replace(
          "connect-src 'self' ws: wss:",
          "connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://esm.sh blob:"
        )
        .replace(
          "script-src 'self'",
          "script-src 'self' https://cdn.jsdelivr.net https://esm.sh 'unsafe-eval'"
        );
    }

    delete headers["x-frame-options"];

    clientRes.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502);
    clientRes.end(`Proxy error: ${err.message}`);
  });

  clientReq.pipe(proxyReq, { end: true });
});

// ── WebSocket Handling ──

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, req) => {
  const url = new URL(req.url, `https://localhost`);

  // ── /live/signal → Local signaling (avoids gateway device-nonce check) ──
  if (url.pathname === "/live/signal") {
    handleSignaling(clientWs, url);
    return;
  }

  // ── Everything else → Proxy to Gateway WS ──
  const gatewayUrl = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}${req.url}`;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!["host", "upgrade", "connection", "sec-websocket-key",
          "sec-websocket-version", "sec-websocket-extensions"].includes(k)) {
      headers[k] = v;
    }
  }

  const gatewayWs = new WebSocket(gatewayUrl, { headers });

  gatewayWs.on("open", () => {
    clientWs.on("message", (data) => {
      if (gatewayWs.readyState === WebSocket.OPEN) gatewayWs.send(data);
    });
  });

  gatewayWs.on("message", (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  gatewayWs.on("close", (code, reason) => clientWs.close(code, reason));
  clientWs.on("close", (code, reason) => gatewayWs.close(code, reason));
  gatewayWs.on("error", () => clientWs.close());
  clientWs.on("error", () => gatewayWs.close());
});

// ── WebRTC Signaling Logic ──

function handleSignaling(ws, url) {
  const role = url.searchParams.get("role"); // "broadcaster" or "viewer"

  if (role === "broadcaster") {
    if (broadcaster && broadcaster.readyState === WebSocket.OPEN) {
      sendTo(ws, { type: "error", message: "已有主播在线" });
      ws.close();
      return;
    }

    broadcaster = ws;
    streamInfo = { live: true, title: "OpenClaw Live", startedAt: Date.now() };
    console.log("[signal] Broadcaster connected");

    sendTo(ws, { type: "role", role: "broadcaster", viewerCount: viewers.size });

    // Notify existing viewers and tell broadcaster about them
    for (const [vid, vws] of viewers.entries()) {
      sendTo(vws, { type: "broadcaster-ready" });
      sendTo(ws, { type: "viewer-joined", viewerId: vid });
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === "offer" && msg.viewerId) {
          const vws = viewers.get(msg.viewerId);
          sendTo(vws, { type: "offer", sdp: msg.sdp });
        }

        if (msg.type === "ice-candidate" && msg.viewerId) {
          const vws = viewers.get(msg.viewerId);
          sendTo(vws, { type: "ice-candidate", candidate: msg.candidate });
        }

        if (msg.type === "stream-info") {
          streamInfo.title = msg.title || streamInfo.title;
          broadcastToAll({ type: "stream-info", ...streamInfo, viewerCount: viewers.size });
        }

        if (msg.type === "danmaku" && msg.text) {
          broadcastToAll({ type: "danmaku", text: msg.text, sender: msg.sender || "主播", color: msg.color });
        }
      } catch {}
    });

    ws.on("close", () => {
      console.log("[signal] Broadcaster disconnected");
      broadcaster = null;
      streamInfo.live = false;
      streamInfo.startedAt = null;
      for (const [vid, vws] of viewers.entries()) {
        sendTo(vws, { type: "broadcaster-left" });
      }
    });

    return;
  }

  // ── Viewer ──
  const viewerId = `v-${++viewerIdCounter}`;
  viewers.set(viewerId, ws);
  console.log(`[signal] Viewer ${viewerId} connected (total: ${viewers.size})`);

  sendTo(ws, {
    type: "role",
    role: "viewer",
    viewerId,
    streamInfo: { ...streamInfo, viewerCount: viewers.size },
  });

  if (broadcaster) {
    sendTo(broadcaster, { type: "viewer-joined", viewerId });
  }

  // Update viewer counts
  broadcastToAll({ type: "viewer-count", count: viewers.size });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === "answer") {
        sendTo(broadcaster, { type: "answer", viewerId, sdp: msg.sdp });
      }

      if (msg.type === "ice-candidate") {
        sendTo(broadcaster, { type: "ice-candidate", viewerId, candidate: msg.candidate });
      }

      if (msg.type === "danmaku" && msg.text) {
        broadcastToAll({ type: "danmaku", text: msg.text, sender: msg.sender || viewerId, color: msg.color });
      }
    } catch {}
  });

  ws.on("close", () => {
    viewers.delete(viewerId);
    console.log(`[signal] Viewer ${viewerId} disconnected (total: ${viewers.size})`);
    if (broadcaster) {
      sendTo(broadcaster, { type: "viewer-left", viewerId });
    }
    broadcastToAll({ type: "viewer-count", count: viewers.size });
  });
}

// ── Start ──

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log("");
  console.log("  🎥 OpenClaw Live-Stream HTTPS Proxy + Signaling");
  console.log("");
  console.log(`  Listen:   https://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`  Proxy:    → Gateway ${GATEWAY_HOST}:${GATEWAY_PORT}`);
  console.log(`  Signal:   wss://${LISTEN_HOST}:${LISTEN_PORT}/live/signal`);
  console.log("");
  console.log("  ⚠️  首次访问请在浏览器接受证书警告（自签名证书）");
  console.log("  接受后摄像头/麦克风即可正常使用");
  console.log("");
  console.log("  主播: 点「📷 视频直播」或「🖥 屏幕直播」开始");
  console.log("  观众: 打开同一地址即可观看");
  console.log("");
});
