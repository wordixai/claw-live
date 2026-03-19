import {
  StreamState,
  StreamConfig,
  DanmakuMessage,
  DEFAULT_STREAM_STATE,
} from "./types.js";

type Listener = (state: StreamState) => void;
type DanmakuListener = (msg: DanmakuMessage) => void;

export class StreamService {
  private state: StreamState = { ...DEFAULT_STREAM_STATE };
  private listeners: Set<Listener> = new Set();
  private danmakuListeners: Set<DanmakuListener> = new Set();
  private danmakuHistory: DanmakuMessage[] = [];
  private viewerTimer: ReturnType<typeof setInterval> | null = null;
  private msgCounter = 0;

  getState(): StreamState {
    return { ...this.state };
  }

  getDanmakuHistory(limit = 50): DanmakuMessage[] {
    return this.danmakuHistory.slice(-limit);
  }

  start(config: StreamConfig): StreamState {
    if (this.state.status === "live") return this.state;

    this.state = {
      status: "live",
      streamUrl: config.streamUrl || null,
      roomTitle: config.roomTitle || this.state.roomTitle,
      startedAt: Date.now(),
      viewerCount: 1,
      danmakuCount: 0,
      errorMessage: null,
    };

    this.startViewerSimulation();
    this.notify();
    return this.getState();
  }

  stop(): StreamState {
    this.stopViewerSimulation();
    this.state = {
      ...this.state,
      status: "idle",
      streamUrl: null,
      startedAt: null,
      viewerCount: 0,
    };
    this.notify();
    return this.getState();
  }

  updateConfig(config: Partial<StreamConfig>): StreamState {
    if (config.roomTitle) this.state.roomTitle = config.roomTitle;
    if (config.streamUrl) this.state.streamUrl = config.streamUrl;
    this.notify();
    return this.getState();
  }

  pushDanmaku(text: string, sender = "anonymous"): DanmakuMessage {
    const msg: DanmakuMessage = {
      id: `dm-${++this.msgCounter}-${Date.now()}`,
      text,
      sender,
      timestamp: Date.now(),
      color: this.randomColor(),
    };
    this.danmakuHistory.push(msg);
    if (this.danmakuHistory.length > 500) {
      this.danmakuHistory = this.danmakuHistory.slice(-300);
    }
    this.state.danmakuCount++;
    this.danmakuListeners.forEach((fn) => fn(msg));
    return msg;
  }

  onStateChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onDanmaku(fn: DanmakuListener): () => void {
    this.danmakuListeners.add(fn);
    return () => this.danmakuListeners.delete(fn);
  }

  destroy() {
    this.stopViewerSimulation();
    this.listeners.clear();
    this.danmakuListeners.clear();
  }

  private notify() {
    const snapshot = this.getState();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private startViewerSimulation() {
    this.stopViewerSimulation();
    this.viewerTimer = setInterval(() => {
      if (this.state.status !== "live") return;
      const delta = Math.floor(Math.random() * 5) - 2;
      this.state.viewerCount = Math.max(1, this.state.viewerCount + delta);
      this.notify();
    }, 5000);
  }

  private stopViewerSimulation() {
    if (this.viewerTimer) {
      clearInterval(this.viewerTimer);
      this.viewerTimer = null;
    }
  }

  private randomColor(): string {
    const colors = [
      "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
      "#ff922b", "#cc5de8", "#20c997", "#ff8787",
      "#ffffff", "#ffa94d", "#74c0fc", "#b2f2bb",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
