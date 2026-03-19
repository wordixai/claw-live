import type { ServerResponse } from "node:http";

interface StreamInfo {
  live: boolean;
  title: string;
  startedAt: number | null;
}

interface SseClient {
  id: string;
  role: string;
  res: ServerResponse;
}

export class SignalingService {
  private broadcaster: SseClient | null = null;
  private viewers = new Map<string, SseClient>();
  private viewerIdCounter = 0;
  private streamInfo: StreamInfo = { live: false, title: "OpenClaw Live", startedAt: null };

  private sendTo(client: SseClient | null | undefined, msg: Record<string, unknown>) {
    if (!client) return;
    try {
      client.res.write(`data: ${JSON.stringify(msg)}\n\n`);
    } catch {}
  }

  private broadcastToAll(msg: Record<string, unknown>) {
    this.sendTo(this.broadcaster, msg);
    for (const client of this.viewers.values()) {
      this.sendTo(client, msg);
    }
  }

  handleSseConnect(res: ServerResponse, role: string): string {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    if (role === "broadcaster") {
      return this.addBroadcaster(res);
    } else {
      return this.addViewer(res);
    }
  }

  handleMessage(clientId: string, msg: Record<string, unknown>) {
    if (this.broadcaster?.id === clientId) {
      this.handleBroadcasterMessage(msg);
    } else if (this.viewers.has(clientId)) {
      this.handleViewerMessage(clientId, msg);
    }
  }

  private addBroadcaster(res: ServerResponse): string {
    const clientId = `b-${Date.now()}`;

    if (this.broadcaster) {
      this.sendTo({ id: "tmp", role: "broadcaster", res }, { type: "error", message: "已有主播在线" });
      res.end();
      return "";
    }

    this.broadcaster = { id: clientId, role: "broadcaster", res };
    this.streamInfo = { live: true, title: "OpenClaw Live", startedAt: Date.now() };

    this.sendTo(this.broadcaster, { type: "role", role: "broadcaster", clientId, viewerCount: this.viewers.size });

    for (const vClient of this.viewers.values()) {
      this.sendTo(vClient, { type: "broadcaster-ready" });
    }

    res.on("close", () => {
      this.broadcaster = null;
      this.streamInfo.live = false;
      this.streamInfo.startedAt = null;
      for (const vClient of this.viewers.values()) {
        this.sendTo(vClient, { type: "broadcaster-left" });
      }
    });

    return clientId;
  }

  private addViewer(res: ServerResponse): string {
    const viewerId = `v-${++this.viewerIdCounter}`;
    const client: SseClient = { id: viewerId, role: "viewer", res };
    this.viewers.set(viewerId, client);

    this.sendTo(client, {
      type: "role",
      role: "viewer",
      clientId: viewerId,
      viewerId,
      streamInfo: { ...this.streamInfo, viewerCount: this.viewers.size },
    });

    if (this.broadcaster) {
      this.sendTo(this.broadcaster, { type: "viewer-joined", viewerId });
    }

    this.broadcastToAll({ type: "viewer-count", count: this.viewers.size });

    res.on("close", () => {
      this.viewers.delete(viewerId);
      if (this.broadcaster) {
        this.sendTo(this.broadcaster, { type: "viewer-left", viewerId });
      }
      this.broadcastToAll({ type: "viewer-count", count: this.viewers.size });
    });

    return viewerId;
  }

  private handleBroadcasterMessage(msg: Record<string, unknown>) {
    if (msg.type === "offer" && msg.viewerId) {
      this.sendTo(this.viewers.get(msg.viewerId as string), { type: "offer", sdp: msg.sdp });
    }
    if (msg.type === "ice-candidate" && msg.viewerId) {
      this.sendTo(this.viewers.get(msg.viewerId as string), { type: "ice-candidate", candidate: msg.candidate });
    }
    if (msg.type === "stream-info") {
      this.streamInfo.title = (msg.title as string) || this.streamInfo.title;
      this.broadcastToAll({ type: "stream-info", ...this.streamInfo, viewerCount: this.viewers.size });
    }
    if (msg.type === "danmaku" && msg.text) {
      this.broadcastToAll({ type: "danmaku", text: msg.text, sender: msg.sender || "主播", color: msg.color });
    }
  }

  private handleViewerMessage(viewerId: string, msg: Record<string, unknown>) {
    if (msg.type === "answer") {
      this.sendTo(this.broadcaster, { type: "answer", viewerId, sdp: msg.sdp });
    }
    if (msg.type === "ice-candidate") {
      this.sendTo(this.broadcaster, { type: "ice-candidate", viewerId, candidate: msg.candidate });
    }
    if (msg.type === "danmaku" && msg.text) {
      this.broadcastToAll({ type: "danmaku", text: msg.text, sender: msg.sender || viewerId, color: msg.color });
    }
  }

  destroy() {
    if (this.broadcaster) {
      try { this.broadcaster.res.end(); } catch {}
      this.broadcaster = null;
    }
    for (const client of this.viewers.values()) {
      try { client.res.end(); } catch {}
    }
    this.viewers.clear();
  }
}
