/**
 * OpenClaw Live-Stream — WebRTC Signaling Server (standalone)
 *
 * Pure WebSocket server for relaying SDP offers/answers/ICE
 * between broadcaster and viewers. No HTTP proxy.
 *
 * Usage:
 *   node scripts/signal.mjs [host] [port]
 *   node scripts/signal.mjs 0.0.0.0 9090
 */

import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const HOST = process.argv[2] || "0.0.0.0";
const PORT = parseInt(process.argv[3] || "9090", 10);

let broadcaster = null;
const viewers = new Map();
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

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  res.end(`OpenClaw Signaling Server\nBroadcaster: ${broadcaster ? "online" : "offline"}\nViewers: ${viewers.size}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/live/signal") {
    ws.close(4000, "Unknown path");
    return;
  }
  handleSignaling(ws, url);
});

function handleSignaling(ws, url) {
  const role = url.searchParams.get("role");

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

    for (const [, vws] of viewers.entries()) {
      sendTo(vws, { type: "broadcaster-ready" });
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "offer" && msg.viewerId) {
          sendTo(viewers.get(msg.viewerId), { type: "offer", sdp: msg.sdp });
        }
        if (msg.type === "ice-candidate" && msg.viewerId) {
          sendTo(viewers.get(msg.viewerId), { type: "ice-candidate", candidate: msg.candidate });
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
      for (const [, vws] of viewers.entries()) {
        sendTo(vws, { type: "broadcaster-left" });
      }
    });

    return;
  }

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

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  📡 OpenClaw WebRTC Signaling Server");
  console.log("");
  console.log(`  Listen:  ${HOST}:${PORT}`);
  console.log(`  Signal:  ws://${HOST}:${PORT}/live/signal`);
  console.log("");
});
