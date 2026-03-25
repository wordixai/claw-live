export interface StreamConfig {
  /** HLS stream URL or RTMP ingest endpoint */
  streamUrl?: string;
  /** Room title shown in overlay header */
  roomTitle?: string;
  /** Enable danmaku overlay */
  danmakuEnabled?: boolean;
  /** Max danmaku items visible at once */
  danmakuLimit?: number;
  /** Auto-start stream on plugin load */
  autoStart?: boolean;
}

export interface StreamState {
  status: "idle" | "connecting" | "live" | "error";
  streamUrl: string | null;
  roomTitle: string;
  startedAt: number | null;
  viewerCount: number;
  danmakuCount: number;
  errorMessage: string | null;
}

export interface DanmakuMessage {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
  color?: string;
}

export interface StreamControlRequest {
  action: "start" | "stop" | "status" | "config";
  streamUrl?: string;
  roomTitle?: string;
}

export interface StreamControlResponse {
  ok: boolean;
  state: StreamState;
  message?: string;
}

export const DEFAULT_STREAM_STATE: StreamState = {
  status: "idle",
  streamUrl: null,
  roomTitle: "OpenClaw Live",
  startedAt: null,
  viewerCount: 0,
  danmakuCount: 0,
  errorMessage: null,
};

export interface AssistSession {
  sessionId: string;
  code: string;
  status: "waiting" | "connected" | "ended";
  createdAt: number;
  hostClientId: string | null;
  assistantClientId: string | null;
}
