import { StreamService } from "./stream-service.js";
import { SignalingService } from "./signaling-service.js";
import { StreamControlRequest } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

export function createApiHandler(stream: StreamService, signaling: SignalingService) {
  const overlayDir = path.resolve(__dirname, "..", "overlay");

  const handler = async (req: any, res: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- Static overlay files ---
    if (pathname === "/live/overlay.js") {
      return serveFile(res, path.join(overlayDir, "live-stream-overlay.js"), "application/javascript");
    }
    if (pathname === "/live/overlay.css") {
      return serveFile(res, path.join(overlayDir, "live-stream-overlay.css"), "text/css");
    }

    // --- Signaling SSE: client connects here to receive messages ---
    if (pathname === "/live/signal/events") {
      const role = url.searchParams.get("role") || "viewer";
      signaling.handleSseConnect(res, role);
      return;
    }

    // --- Signaling POST: client sends messages here ---
    if (pathname === "/live/signal/send" && req.method === "POST") {
      const body = await readBody(req);
      const { clientId, ...msg } = body as { clientId: string } & Record<string, unknown>;
      if (!clientId) {
        return json(res, { ok: false, message: "clientId is required" }, 400);
      }
      signaling.handleMessage(clientId, msg);
      return json(res, { ok: true });
    }

    // --- Stream control API ---
    if (pathname === "/live/api/control" && req.method === "POST") {
      return handleControl(req, res, stream);
    }

    // --- Auth check: execute `openclaw health` to verify device authorization ---
    if (pathname === "/live/api/auth-check") {
      const port = String(req.socket?.localPort || process.env.PORT || "3000");
      const result = await checkGatewayHealth(port);
      return json(res, result);
    }

    // --- Stream state (GET) ---
    if (pathname === "/live/api/state") {
      return json(res, { ok: true, state: stream.getState(), broadcasting: signaling.hasBroadcaster() });
    }

    // --- Danmaku history ---
    if (pathname === "/live/api/danmaku") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      return json(res, { ok: true, messages: stream.getDanmakuHistory(limit) });
    }

    // --- Send danmaku ---
    if (pathname === "/live/api/danmaku/send" && req.method === "POST") {
      return handleSendDanmaku(req, res, stream);
    }

    // --- SSE: real-time state + danmaku ---
    if (pathname === "/live/api/events") {
      return handleSSE(req, res, stream);
    }

    // --- Assist session: create ---
    if (pathname === "/live/api/assist/create" && req.method === "POST") {
      const session = stream.createAssistSession();
      const host = req.headers.host || "localhost";
      const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
      const joinUrl = `${proto}://${host}?assist=${session.code}`;
      return json(res, { ok: true, session, joinUrl });
    }

    // --- Assist session: join by code ---
    if (pathname === "/live/api/assist/join" && req.method === "POST") {
      const body = await readBody(req);
      const { code } = body as { code: string };
      if (!code) return json(res, { ok: false, message: "code is required" }, 400);
      const session = stream.joinAssistSession(code.toUpperCase());
      if (!session) return json(res, { ok: false, message: "Invalid or expired session code" }, 404);
      return json(res, { ok: true, session });
    }

    // --- Assist session: end ---
    if (pathname === "/live/api/assist/end" && req.method === "POST") {
      const session = stream.endAssistSession();
      if (!session) return json(res, { ok: false, message: "No active assist session" }, 404);
      return json(res, { ok: true, session });
    }

    // --- Assist session: current state ---
    if (pathname === "/live/api/assist/state") {
      const session = stream.getAssistSession();
      return json(res, { ok: true, session });
    }

    res.writeHead(404);
    res.end("Not Found");
  };

  return handler;
}

async function handleControl(req: any, res: any, stream: StreamService) {
  const body = await readBody(req);
  const { action, streamUrl, roomTitle } = body as StreamControlRequest;

  switch (action) {
    case "start":
      stream.start({ streamUrl, roomTitle });
      return json(res, { ok: true, state: stream.getState(), message: "Stream started" });
    case "stop":
      stream.stop();
      return json(res, { ok: true, state: stream.getState(), message: "Stream stopped" });
    case "config":
      stream.updateConfig({ streamUrl, roomTitle });
      return json(res, { ok: true, state: stream.getState(), message: "Config updated" });
    case "status":
      return json(res, { ok: true, state: stream.getState() });
    default:
      return json(res, { ok: false, state: stream.getState(), message: `Unknown action: ${action}` }, 400);
  }
}

async function handleSendDanmaku(req: any, res: any, stream: StreamService) {
  const body = await readBody(req);
  const { text, sender } = body as { text: string; sender?: string };
  if (!text) {
    return json(res, { ok: false, message: "text is required" }, 400);
  }
  const msg = stream.pushDanmaku(text, sender || "anonymous");
  return json(res, { ok: true, message: msg });
}

function handleSSE(req: any, res: any, stream: StreamService) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("state", stream.getState());

  const unsubState = stream.onStateChange((state) => {
    sendEvent("state", state);
  });

  const unsubDanmaku = stream.onDanmaku((msg) => {
    sendEvent("danmaku", msg);
  });

  req.on("close", () => {
    unsubState();
    unsubDanmaku();
  });
}

function serveFile(res: any, filePath: string, contentType: string) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("File not found");
  }
}

// ── Gateway health check via `openclaw health` ──

let healthCache: { result: any; ts: number } | null = null;
const HEALTH_CACHE_TTL = 60_000;

function checkGatewayHealth(port: string): Promise<{ ok: boolean; isHost: boolean; gateway?: any }> {
  if (healthCache && Date.now() - healthCache.ts < HEALTH_CACHE_TTL) {
    return Promise.resolve(healthCache.result);
  }

  return new Promise((resolve) => {
    const env = { ...process.env, OPENCLAW_GATEWAY_PORT: port };
    exec("openclaw health --json --timeout 3000", { timeout: 6000, env }, (err, stdout) => {
      if (err) {
        const fail = { ok: false, isHost: false, error: err.message };
        resolve(fail);
        return;
      }
      try {
        const health = JSON.parse(stdout);
        const result = {
          ok: true,
          isHost: health.ok === true,
          gateway: {
            healthy: health.ok,
            channels: Object.keys(health.channels || {}),
            agents: (health.agents || []).map((a: any) => a.agentId),
          },
        };
        healthCache = { result, ts: Date.now() };
        resolve(result);
      } catch {
        resolve({ ok: false, isHost: false });
      }
    });
  });
}

function json(res: any, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}
