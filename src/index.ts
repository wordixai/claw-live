import { StreamService } from "./stream-service.js";
import { SignalingService } from "./signaling-service.js";
import { createApiHandler } from "./api-routes.js";

const stream = new StreamService();
const signaling = new SignalingService();

export default function register(api: any) {
  const apiHandler = createApiHandler(stream, signaling);

  api.registerService({
    id: "live-stream",
    start: () => {
      api.logger?.info?.("[live-stream] Service started (signaling via SSE on /live/signal/*)");
    },
    stop: () => {
      stream.destroy();
      signaling.destroy();
      api.logger?.info?.("[live-stream] Service stopped");
    },
  });

  api.registerCommand({
    name: "live",
    description: "直播控制 — /live start [url], /live stop, /live status, /live title <name>",
    acceptsArgs: true,
    handler: async (ctx: any) => {
      const args = (ctx.args || "").trim().split(/\s+/);
      const sub = args[0]?.toLowerCase();

      if (sub === "start") {
        const url = args[1] || undefined;
        stream.start({ streamUrl: url });
        const s = stream.getState();
        return {
          text: `🔴 直播已开始\n标题: ${s.roomTitle}\n流地址: ${s.streamUrl || "(未设置)"}\n访问 Control UI 查看悬浮直播窗口`,
        };
      }

      if (sub === "stop") {
        stream.stop();
        return { text: "⏹ 直播已停止" };
      }

      if (sub === "title") {
        const title = args.slice(1).join(" ") || "OpenClaw Live";
        stream.updateConfig({ roomTitle: title });
        return { text: `📝 直播标题已更新: ${title}` };
      }

      if (sub === "danmaku" || sub === "dm") {
        const text = args.slice(1).join(" ");
        if (!text) return { text: "用法: /live dm <弹幕内容>" };
        stream.pushDanmaku(text, ctx.senderId || "host");
        return { text: `💬 弹幕已发送: ${text}` };
      }

      const s = stream.getState();
      const duration = s.startedAt
        ? formatDuration(Date.now() - s.startedAt)
        : "-";
      return {
        text: [
          `📺 直播状态: ${statusEmoji(s.status)} ${s.status}`,
          `标题: ${s.roomTitle}`,
          `流地址: ${s.streamUrl || "(未设置)"}`,
          `在线: ${s.viewerCount} · 弹幕: ${s.danmakuCount} · 时长: ${duration}`,
          "",
          "命令: /live start [url] | /live stop | /live title <名称> | /live dm <弹幕>",
        ].join("\n"),
      };
    },
  });

  // Register HTTP routes via the gateway's plugin API
  const livePaths = [
    "/live/overlay.js",
    "/live/overlay.css",
    "/live/signal/events",
    "/live/signal/send",
    "/live/api/control",
    "/live/api/state",
    "/live/api/danmaku",
    "/live/api/danmaku/send",
    "/live/api/events",
    "/live/api/assist/create",
    "/live/api/assist/join",
    "/live/api/assist/end",
    "/live/api/assist/state",
  ];

  if (api.registerHttpRoute) {
    for (const p of livePaths) {
      api.registerHttpRoute({
        path: p,
        auth: "plugin",
        match: p.endsWith("/events") || p.endsWith("/send") ? "prefix" : "exact",
        handler: apiHandler,
      });
    }

    // Auth-check route: confirms plugin is loaded and running.
    // The actual host/viewer distinction is determined client-side
    // via WebSocket auth state (__ocWsOk) and DOM heuristics.
    api.registerHttpRoute({
      path: "/live/api/auth-check",
      auth: "plugin",
      match: "exact",
      handler: apiHandler,
    });

    api.logger?.info?.("[live-stream] HTTP routes registered via registerHttpRoute");
  } else if (api.registerRoute) {
    api.registerRoute({ path: "/live/*", handler: apiHandler });
    api.logger?.info?.("[live-stream] HTTP routes registered via registerRoute (fallback)");
  }
}

function statusEmoji(status: string): string {
  switch (status) {
    case "live": return "🔴";
    case "connecting": return "🟡";
    case "error": return "❌";
    default: return "⚪";
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
