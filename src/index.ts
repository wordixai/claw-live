import * as path from "path";
import { AssistService } from "./assist-service.js";
import { AgoraTokenService } from "./agora-token-service.js";
import { createApiHandler } from "./api-routes.js";

const pluginRoot = path.resolve(__dirname, "..");
const assist = new AssistService();
const agora = new AgoraTokenService(pluginRoot);

export default function register(api: any) {
  api.logger?.info?.(`[assist] Plugin root: ${pluginRoot}, Agora configured: ${agora.isConfigured}`);
  const apiHandler = createApiHandler(assist, agora);

  api.registerService({
    id: "live-stream",
    start: () => {
      api.logger?.info?.("[assist] Service started");
    },
    stop: () => {
      assist.destroy();
      api.logger?.info?.("[assist] Service stopped");
    },
  });

  api.registerCommand({
    name: "assist",
    description: "远程协助 — /assist start 创建会话, /assist stop 结束会话, /assist status 查看状态",
    acceptsArgs: true,
    handler: async (ctx: any) => {
      const args = (ctx.args || "").trim().split(/\s+/);
      const sub = args[0]?.toLowerCase();

      if (sub === "start" || sub === "create") {
        const session = assist.createSession();
        return {
          text: `🛠 协助会话已创建\n会话码: ${session.code}\n等待协助者加入…\n\n在 Control UI 中可以看到协助面板`,
        };
      }

      if (sub === "stop" || sub === "end") {
        const session = assist.endSession();
        if (!session) return { text: "当前没有活跃的协助会话" };
        return { text: "✅ 协助会话已结束" };
      }

      const session = assist.getSession();
      if (!session) {
        return {
          text: "当前没有活跃的协助会话\n\n用 /assist start 创建一个",
        };
      }

      return {
        text: [
          `🛠 协助会话状态: ${session.status}`,
          `会话码: ${session.code}`,
          `创建时间: ${new Date(session.createdAt).toLocaleTimeString()}`,
          "",
          "命令: /assist start | /assist stop | /assist",
        ].join("\n"),
      };
    },
  });

  const livePaths = [
    "/live/overlay.js",
    "/live/overlay.css",
    "/live/api/assist/create",
    "/live/api/assist/join",
    "/live/api/assist/end",
    "/live/api/assist/state",
    "/live/api/chat/send",
    "/live/api/chat/history",
    "/live/api/events",
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
    api.logger?.info?.("[assist] HTTP routes registered via registerHttpRoute");
  } else if (api.registerRoute) {
    api.registerRoute({ path: "/live/*", handler: apiHandler });
    api.logger?.info?.("[assist] HTTP routes registered via registerRoute (fallback)");
  }
}
