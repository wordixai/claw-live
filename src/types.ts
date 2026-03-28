export interface AssistSession {
  sessionId: string;
  code: string;
  status: "waiting" | "connected" | "ended";
  createdAt: number;
  hostClientId: string | null;
  helperClientId: string | null;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
}
