import { AssistSession, ChatMessage } from "./types.js";

type SessionListener = (session: AssistSession | null) => void;
type ChatListener = (msg: ChatMessage) => void;

export class AssistService {
  private session: AssistSession | null = null;
  private sessionListeners: Set<SessionListener> = new Set();
  private chatListeners: Set<ChatListener> = new Set();
  private chatHistory: ChatMessage[] = [];
  private msgCounter = 0;

  createSession(): AssistSession {
    this.chatHistory = [];
    this.msgCounter = 0;
    const code = this.generateCode();
    this.session = {
      sessionId: `assist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      code,
      status: "waiting",
      createdAt: Date.now(),
      hostClientId: null,
      helperClientId: null,
    };
    this.notifySession();
    return { ...this.session };
  }

  joinSession(code: string): AssistSession | null {
    if (!this.session || this.session.code !== code) return null;
    if (this.session.status === "ended") return null;
    this.session.status = "connected";
    this.notifySession();
    return { ...this.session };
  }

  endSession(): AssistSession | null {
    if (!this.session) return null;
    this.session.status = "ended";
    const ended = { ...this.session };
    this.session = null;
    this.notifySession();
    return ended;
  }

  getSession(): AssistSession | null {
    return this.session ? { ...this.session } : null;
  }

  pushChat(text: string, sender: string): ChatMessage {
    const msg: ChatMessage = {
      id: `chat-${++this.msgCounter}-${Date.now()}`,
      text,
      sender,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 200) {
      this.chatHistory = this.chatHistory.slice(-150);
    }
    this.chatListeners.forEach((fn) => fn(msg));
    return msg;
  }

  getChatHistory(limit = 50): ChatMessage[] {
    return this.chatHistory.slice(-limit);
  }

  onSessionChange(fn: SessionListener): () => void {
    this.sessionListeners.add(fn);
    return () => this.sessionListeners.delete(fn);
  }

  onChat(fn: ChatListener): () => void {
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  destroy() {
    this.session = null;
    this.sessionListeners.clear();
    this.chatListeners.clear();
    this.chatHistory = [];
  }

  private generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private notifySession() {
    const snapshot = this.getSession();
    this.sessionListeners.forEach((fn) => fn(snapshot));
  }
}
