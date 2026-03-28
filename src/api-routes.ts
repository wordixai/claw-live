import { AssistService } from "./assist-service.js";
import { AgoraTokenService } from "./agora-token-service.js";
import * as fs from "fs";
import * as path from "path";

export function createApiHandler(assist: AssistService, agora: AgoraTokenService) {
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

    // --- Assist: create session ---
    if (pathname === "/live/api/assist/create" && req.method === "POST") {
      const session = assist.createSession();
      const host = req.headers.host || "localhost";
      const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
      const joinUrl = `${proto}://${host}?assist=${session.code}`;
      return json(res, {
        ok: true,
        session,
        joinUrl,
        agora: agora.isConfigured
          ? { appId: agora.getAppId(), token: agora.generateToken(session.code), channel: session.code }
          : null,
      });
    }

    // --- Assist: join by code ---
    if (pathname === "/live/api/assist/join" && req.method === "POST") {
      const body = await readBody(req);
      const { code } = body as { code: string };
      if (!code) return json(res, { ok: false, message: "code is required" }, 400);
      const normalizedCode = code.toUpperCase();
      const session = assist.joinSession(normalizedCode);
      if (!session) return json(res, { ok: false, message: "Invalid or expired session code" }, 404);
      return json(res, {
        ok: true,
        session,
        agora: agora.isConfigured
          ? { appId: agora.getAppId(), token: agora.generateToken(normalizedCode), channel: normalizedCode }
          : null,
      });
    }

    // --- Assist: end session ---
    if (pathname === "/live/api/assist/end" && req.method === "POST") {
      const session = assist.endSession();
      if (!session) return json(res, { ok: false, message: "No active assist session" }, 404);
      return json(res, { ok: true, session });
    }

    // --- Assist: current state ---
    if (pathname === "/live/api/assist/state") {
      const session = assist.getSession();
      return json(res, { ok: true, session });
    }

    // --- Chat: send message ---
    if (pathname === "/live/api/chat/send" && req.method === "POST") {
      const body = await readBody(req);
      const { text, sender } = body as { text: string; sender?: string };
      if (!text) return json(res, { ok: false, message: "text is required" }, 400);
      const msg = assist.pushChat(text, sender || "anonymous");
      return json(res, { ok: true, message: msg });
    }

    // --- Chat: history ---
    if (pathname === "/live/api/chat/history") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      return json(res, { ok: true, messages: assist.getChatHistory(limit) });
    }

    // --- SSE: real-time session + chat events ---
    if (pathname === "/live/api/events") {
      return handleSSE(req, res, assist);
    }

    res.writeHead(404);
    res.end("Not Found");
  };

  return handler;
}

function handleSSE(req: any, res: any, assist: AssistService) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("session", assist.getSession());

  const unsubSession = assist.onSessionChange((session) => {
    sendEvent("session", session);
  });

  const unsubChat = assist.onChat((msg) => {
    sendEvent("chat", msg);
  });

  req.on("close", () => {
    unsubSession();
    unsubChat();
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
