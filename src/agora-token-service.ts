import { RtcTokenBuilder, RtcRole } from "agora-token";
import * as fs from "fs";
import * as path from "path";

const TOKEN_EXPIRE_SECONDS = 24 * 3600; // 24 hours

function loadDotEnv(extra: string[] = []): Record<string, string> {
  const envPaths = [
    ...extra,
    path.resolve(__dirname, "..", ".env"),
    path.resolve(__dirname, ".env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of envPaths) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      const vars: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        vars[key] = val;
      }
      return vars;
    } catch {}
  }
  return {};
}

export class AgoraTokenService {
  private appId: string;
  private appCertificate: string;

  constructor(pluginRoot?: string) {
    const extraPaths = pluginRoot ? [path.resolve(pluginRoot, ".env")] : [];
    const dotenv = loadDotEnv(extraPaths);
    this.appId = process.env.AGORA_APP_ID || dotenv.AGORA_APP_ID || "";
    this.appCertificate = process.env.AGORA_APP_CERTIFICATE || dotenv.AGORA_APP_CERTIFICATE || "";
  }

  get isConfigured(): boolean {
    return !!(this.appId && this.appCertificate);
  }

  getAppId(): string {
    return this.appId;
  }

  generateToken(channelName: string, uid: number = 0): string | null {
    if (!this.isConfigured) return null;
    return RtcTokenBuilder.buildTokenWithUid(
      this.appId,
      this.appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      TOKEN_EXPIRE_SECONDS,
      TOKEN_EXPIRE_SECONDS,
    );
  }
}
