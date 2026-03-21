/**
 * OpenClaw Live Stream Overlay (WebRTC P2P Edition)
 *
 * Broadcaster: opens camera/screen → streams to all viewers via WebRTC
 * Viewer:      connects automatically → receives broadcaster's stream
 * Signaling:   via WebSocket at /live/signal on the proxy server
 */
(function () {
  "use strict";

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then(
      (r) => console.log("[oc-live] SW registered, scope:", r.scope),
      (e) => console.warn("[oc-live] SW registration failed:", e)
    );
  }

  if (document.getElementById("oc-live-overlay")) return;

  // ── State ──

  let role = null;           // "broadcaster" | "viewer" | null
  let myViewerId = null;
  let localStream = null;
  let signalWs = null;
  let peerConnections = {};  // broadcaster: viewerId → RTCPeerConnection
  let viewerPc = null;       // viewer: single RTCPeerConnection to broadcaster
  let isLive = false;
  let startedAt = null;
  let viewerCount = 0;
  let danmakuCount = 0;
  let durationTimer = null;
  let danmakuTrack = 0;
  const TRACK_COUNT = 8;
  function getIceServers() {
    const cfg = loadConfig();
    const servers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (cfg.turnServer) {
      servers.push({ urls: cfg.turnServer, username: cfg.turnUser || "", credential: cfg.turnPass || "" });
    }
    return servers;
  }

  let micPc = null;          // RTCPeerConnection for cohost audio
  let micStream = null;      // viewer's local mic stream
  let cohostViewerId = null;  // broadcaster: which viewer is co-hosting
  let isCohostActive = false;

  let bubbleExpandTimer = null;
  let bubbleCollapseTimer = null;

  function enterBubbleMode() {
    overlay.classList.remove("oc-minimized");
    overlay.classList.add("oc-bubble");
  }

  function exitBubbleMode() {
    overlay.classList.remove("oc-bubble");
  }

  // ── Inline CSS ──

  const style = document.createElement("style");
  style.textContent = `
/* ── Design Tokens ── */
#oc-live-overlay{
  --oc-bg:       #ffffff;
  --oc-bg-alt:   #f7f8fa;
  --oc-surface:  #f0f1f3;
  --oc-border:   #e2e4e9;
  --oc-border-h: #c8cbd1;
  --oc-text:     #1a1d23;
  --oc-text-2:   #5f6672;
  --oc-text-3:   #9199a5;
  --oc-accent:   #e53935;
  --oc-accent-g: linear-gradient(135deg,#e53935,#ff5722);
  --oc-blue:     #1976d2;
  --oc-cyan:     #0097a7;
  --oc-green:    #2e7d32;
  --oc-radius:   14px;
  --oc-radius-sm:8px;
  --oc-radius-pill:100px;
  --oc-sp-1:4px; --oc-sp-2:8px; --oc-sp-3:12px; --oc-sp-4:16px; --oc-sp-5:20px; --oc-sp-6:24px; --oc-sp-8:32px;
  --oc-font: -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Helvetica Neue",sans-serif;
  --oc-fast: 150ms cubic-bezier(.4,0,.2,1);
  --oc-norm: 250ms cubic-bezier(.4,0,.2,1);
  --oc-slow: 400ms cubic-bezier(.4,0,.2,1);
}

/* ── Container ── */
#oc-live-overlay{
  position:fixed;bottom:var(--oc-sp-6);right:var(--oc-sp-6);width:380px;height:480px;min-width:300px;min-height:380px;
  z-index:99999;border-radius:var(--oc-radius);overflow:hidden;
  background:var(--oc-bg);
  box-shadow:0 8px 32px rgba(0,0,0,0.12),0 0 0 1px var(--oc-border);
  font-family:var(--oc-font);font-size:13px;color:var(--oc-text);
  display:flex;flex-direction:column;user-select:none;
  transition:width var(--oc-norm),height var(--oc-norm),border-radius var(--oc-norm),opacity var(--oc-fast);
  animation:oc-slide-in var(--oc-slow) both;
}
@keyframes oc-slide-in{from{opacity:0;transform:translateY(12px) scale(.97);}to{opacity:1;transform:none;}}

#oc-live-overlay.oc-minimized{width:220px!important;height:42px!important;min-height:42px;border-radius:var(--oc-radius-pill);}
#oc-live-overlay.oc-minimized .oc-live-header{border-bottom:none;padding:0 var(--oc-sp-4);height:42px;}
#oc-live-overlay.oc-minimized .oc-live-body,
#oc-live-overlay.oc-minimized .oc-live-footer{display:none;}
#oc-live-overlay.oc-fullscreen{top:0!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;border-radius:0;}
#oc-live-overlay.oc-hidden{display:none;animation:none;}

/* ── Header ── */
.oc-live-header{
  display:flex;align-items:center;gap:var(--oc-sp-3);
  padding:var(--oc-sp-2) var(--oc-sp-4);
  background:var(--oc-bg);border-bottom:1px solid var(--oc-border);
  cursor:move;flex-shrink:0;min-height:42px;
}
.oc-live-dot{width:8px;height:8px;border-radius:50%;background:#c8cbd1;flex-shrink:0;transition:all var(--oc-norm);}
.oc-live-dot.oc-live-on{background:var(--oc-accent);box-shadow:0 0 8px var(--oc-accent),0 0 20px rgba(239,68,68,0.2);animation:oc-pulse 2s ease-in-out infinite;}
@keyframes oc-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(.85);}}

.oc-live-title{flex:1;color:var(--oc-text);font-size:13px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oc-live-viewers{color:var(--oc-text-3);font-size:11px;font-weight:500;white-space:nowrap;flex-shrink:0;}
.oc-live-controls{display:flex;gap:2px;flex-shrink:0;}
.oc-live-btn{
  width:30px;height:30px;border:none;background:transparent;border-radius:var(--oc-radius-sm);
  color:var(--oc-text-3);font-size:14px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all var(--oc-fast);padding:0;line-height:1;
}
.oc-live-btn:hover{background:var(--oc-surface);color:var(--oc-text);}
.oc-live-btn:active{transform:scale(.9);}

/* ── Body ── */
.oc-live-body{flex:1;position:relative;overflow:hidden;background:var(--oc-bg-alt);}
.oc-live-video{width:100%;height:100%;object-fit:contain;background:#1a1d23;display:block;}

/* ── Placeholder / Mode Select ── */
.oc-live-placeholder{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:0;
  background:var(--oc-bg-alt);z-index:1;
}

#oc-mode-select{display:flex;flex-direction:column;align-items:center;width:100%;padding:0 var(--oc-sp-8);gap:0;}
.oc-mode-label{color:var(--oc-text-2);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;margin-bottom:var(--oc-sp-5);}

.oc-mode-actions{display:flex;gap:var(--oc-sp-3);width:100%;margin-bottom:0;}
.oc-action-card{
  flex:1;display:flex;flex-direction:column;align-items:center;gap:var(--oc-sp-3);
  padding:var(--oc-sp-5) var(--oc-sp-3);border-radius:var(--oc-radius-sm);
  border:1px solid var(--oc-border);background:#ffffff;
  cursor:pointer;transition:all var(--oc-fast);position:relative;overflow:hidden;
}
.oc-action-card::before{
  content:"";position:absolute;inset:0;opacity:0;
  transition:opacity var(--oc-norm);border-radius:inherit;
}
.oc-action-card:nth-child(1)::before{background:radial-gradient(circle at 50% 30%,rgba(229,57,53,0.06),transparent 70%);}
.oc-action-card:nth-child(2)::before{background:radial-gradient(circle at 50% 30%,rgba(25,118,210,0.06),transparent 70%);}
.oc-action-card:hover{border-color:var(--oc-border-h);transform:translateY(-2px);background:#ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.06);}
.oc-action-card:hover::before{opacity:1;}
.oc-action-card:active{transform:translateY(0) scale(.98);}

.oc-action-icon{
  width:44px;height:44px;border-radius:12px;
  display:flex;align-items:center;justify-content:center;font-size:20px;
  transition:transform var(--oc-fast);
}
.oc-action-card:hover .oc-action-icon{transform:scale(1.1);}
.oc-action-icon.oc-red{background:rgba(229,57,53,0.08);color:#e53935;}
.oc-action-icon.oc-blue{background:rgba(25,118,210,0.08);color:#1976d2;}

.oc-action-name{color:var(--oc-text);font-size:12px;font-weight:600;letter-spacing:.3px;}
.oc-action-card:hover .oc-action-name{color:var(--oc-text);}

.oc-mode-divider{width:60%;height:1px;background:var(--oc-border);margin:var(--oc-sp-4) 0;}

.oc-viewer-card{
  display:flex;align-items:center;justify-content:center;gap:var(--oc-sp-2);
  padding:var(--oc-sp-3) var(--oc-sp-6);border-radius:var(--oc-radius-pill);
  border:1px solid var(--oc-border);background:#ffffff;
  cursor:pointer;transition:all var(--oc-fast);
}
.oc-viewer-card:hover{background:rgba(25,118,210,0.04);border-color:rgba(25,118,210,0.3);}
.oc-viewer-card:active{transform:scale(.97);}
.oc-viewer-dot{width:7px;height:7px;border-radius:50%;background:var(--oc-blue);box-shadow:0 0 6px rgba(25,118,210,0.4);animation:oc-dot-blink 2.5s ease-in-out infinite;}
@keyframes oc-dot-blink{0%,100%{opacity:1;}50%{opacity:.3;}}
.oc-viewer-card span{color:var(--oc-text-2);font-size:12px;font-weight:500;}
.oc-viewer-card:hover span{color:var(--oc-text);}
.oc-viewer-card{margin-bottom:var(--oc-sp-4);}

/* ── Viewer Waiting ── */
#oc-viewer-waiting{flex-direction:column;align-items:center;gap:var(--oc-sp-3);}
.oc-spinner{width:28px;height:28px;border:2.5px solid var(--oc-border);border-top-color:var(--oc-accent);border-radius:50%;animation:oc-spin .8s linear infinite;}
@keyframes oc-spin{to{transform:rotate(360deg);}}

/* ── Danmaku ── */
.oc-danmaku-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;}
.oc-danmaku-item{position:absolute;white-space:nowrap;font-size:14px;font-weight:600;text-shadow:0 1px 3px rgba(255,255,255,0.9),0 0 2px rgba(255,255,255,0.6);animation:oc-danmaku-fly linear forwards;pointer-events:none;}
@keyframes oc-danmaku-fly{from{transform:translateX(100%);}to{transform:translateX(-100%);}}

/* ── Chat Panel ── */
.oc-chat-panel{
  display:flex;flex-direction:column;flex-shrink:0;
  border-top:1px solid var(--oc-border);background:var(--oc-bg);
  height:140px;min-height:36px;
  transition:height var(--oc-fast);overflow:hidden;
}
.oc-chat-panel.oc-chat-collapsed{height:36px;}
.oc-chat-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 var(--oc-sp-4);height:36px;min-height:36px;flex-shrink:0;
  background:var(--oc-bg);cursor:pointer;
}
.oc-chat-title{font-size:12px;font-weight:700;color:var(--oc-text);letter-spacing:.3px;}
.oc-chat-toggle{
  width:24px;height:24px;border:none;background:transparent;border-radius:var(--oc-radius-sm);
  color:var(--oc-text-3);cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all var(--oc-fast);padding:0;font-size:12px;
}
.oc-chat-toggle:hover{background:var(--oc-surface);color:var(--oc-text);}
.oc-chat-panel.oc-chat-collapsed .oc-chat-toggle{transform:rotate(180deg);}
.oc-chat-list{
  flex:1;overflow-y:auto;overflow-x:hidden;padding:0 var(--oc-sp-3) var(--oc-sp-2);
  scrollbar-width:thin;scrollbar-color:var(--oc-border) transparent;
}
.oc-chat-list::-webkit-scrollbar{width:4px;}
.oc-chat-list::-webkit-scrollbar-track{background:transparent;}
.oc-chat-list::-webkit-scrollbar-thumb{background:var(--oc-border);border-radius:2px;}
.oc-chat-item{
  display:flex;align-items:flex-start;gap:var(--oc-sp-2);
  padding:var(--oc-sp-1) 0;animation:oc-chat-in var(--oc-fast) both;
}
@keyframes oc-chat-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
.oc-chat-avatar{
  width:24px;height:24px;border-radius:50%;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;color:#fff;
  background:var(--oc-text-3);
}
.oc-chat-body{flex:1;min-width:0;}
.oc-chat-meta{display:flex;align-items:baseline;gap:var(--oc-sp-2);}
.oc-chat-sender{font-size:11px;font-weight:600;color:var(--oc-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;}
.oc-chat-time{font-size:9px;color:var(--oc-text-3);white-space:nowrap;font-variant-numeric:tabular-nums;}
.oc-chat-text{font-size:12px;color:var(--oc-text);line-height:1.4;word-break:break-word;margin-top:1px;}
.oc-chat-empty{
  display:flex;align-items:center;justify-content:center;height:100%;
  color:var(--oc-text-3);font-size:11px;font-weight:500;
}

#oc-live-overlay.oc-minimized .oc-chat-panel{display:none;}
#oc-live-overlay.oc-bubble .oc-chat-panel{display:none!important;}
#oc-live-overlay.oc-fullscreen .oc-chat-panel{height:200px;}

/* ── Footer ── */
.oc-live-footer{
  display:flex;align-items:center;gap:var(--oc-sp-3);
  padding:var(--oc-sp-3) var(--oc-sp-4);
  background:var(--oc-bg);border-top:1px solid var(--oc-border);flex-shrink:0;min-height:48px;
}
.oc-footer-stats{
  display:flex;align-items:center;gap:var(--oc-sp-2);flex-shrink:0;
  color:var(--oc-text-3);font-size:12px;font-variant-numeric:tabular-nums;
}
.oc-footer-stats .oc-stat-sep{
  width:1px;height:14px;background:var(--oc-border);margin:0 2px;
}
.oc-live-stat{color:var(--oc-text-3);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:3px;}
.oc-live-stat b{color:var(--oc-text-2);font-weight:600;}
.oc-dm-wrap{
  flex:1;display:flex;align-items:center;min-width:0;
  height:40px;border:1.5px solid transparent;border-radius:var(--oc-radius-pill);
  background:var(--oc-surface);transition:all var(--oc-fast);padding:3px;box-sizing:border-box;
}
.oc-dm-wrap:focus-within{background:#ffffff;border-color:rgba(147,130,220,0.4);box-shadow:0 0 0 3px rgba(147,130,220,0.08);}
.oc-danmaku-input{
  flex:1;height:100%;border:none;border-radius:var(--oc-radius-pill);
  background:transparent;color:var(--oc-text);font-size:13px;padding:0 var(--oc-sp-5);
  outline:none;min-width:0;
}
.oc-danmaku-input:focus,.oc-danmaku-input:focus-visible{outline:none;border:none;box-shadow:none;}
.oc-danmaku-input::placeholder{color:var(--oc-text-3);}
.oc-danmaku-send-btn{
  height:34px;padding:0 18px;border:none;border-radius:var(--oc-radius-pill);
  background:var(--oc-accent);color:#fff;font-size:13px;font-weight:600;
  cursor:pointer;flex-shrink:0;transition:all var(--oc-fast);
}
.oc-danmaku-send-btn:hover{opacity:.88;}
.oc-danmaku-send-btn:active{transform:scale(.97);}

/* ── Resize Handle ── */
.oc-resize-handle{position:absolute;top:4px;left:4px;width:16px;height:16px;cursor:nw-resize;z-index:10;}
.oc-resize-handle::after{content:"";position:absolute;top:3px;left:3px;width:7px;height:7px;border-top:2px solid var(--oc-border);border-left:2px solid var(--oc-border);border-radius:1px 0 0 0;transition:border-color var(--oc-fast);}
.oc-resize-handle:hover::after{border-color:var(--oc-border-h);}

/* ── Toggle FAB ── */
#oc-live-toggle{
  position:fixed;bottom:24px;right:24px;width:46px;height:46px;
  border-radius:50%;border:none;
  background:#ffffff;color:var(--oc-text-2,#5f6672);font-size:18px;
  cursor:grab;z-index:99998;
  box-shadow:0 2px 12px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.06);
  display:none;align-items:center;justify-content:center;
  transition:transform 150ms cubic-bezier(.4,0,.2,1),color 150ms,box-shadow 150ms;
  touch-action:none;
}
#oc-live-toggle:hover{color:#e53935;box-shadow:0 4px 20px rgba(0,0,0,0.14),0 0 0 1px rgba(229,57,53,0.3);}
#oc-live-toggle.oc-dragging{cursor:grabbing;box-shadow:0 6px 24px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.08);transform:scale(1.08);}
#oc-live-toggle.oc-visible{display:flex;animation:oc-fab-in 250ms cubic-bezier(.4,0,.2,1) both;}
@keyframes oc-fab-in{from{opacity:0;transform:scale(.5);}to{opacity:1;transform:scale(1);}}

/* ── Bubble Mode (circular camera window when live) ── */
#oc-live-overlay.oc-bubble{
  width:168px!important;height:168px!important;min-width:168px!important;min-height:168px!important;
  border-radius:50%;cursor:grab;
  box-shadow:0 4px 20px rgba(0,0,0,0.12),0 0 0 2.5px rgba(229,57,53,0.35);
  transition:width var(--oc-norm),height var(--oc-norm),border-radius var(--oc-norm),
             box-shadow var(--oc-norm),transform var(--oc-fast),opacity var(--oc-fast);
}
#oc-live-overlay.oc-bubble:active{cursor:grabbing;}
#oc-live-overlay.oc-bubble .oc-live-header,
#oc-live-overlay.oc-bubble .oc-live-footer,
#oc-live-overlay.oc-bubble .oc-resize-handle,
#oc-live-overlay.oc-bubble .oc-danmaku-layer,
#oc-live-overlay.oc-bubble .oc-live-source-badge,
#oc-live-overlay.oc-bubble .oc-live-end-btn,
#oc-live-overlay.oc-bubble .oc-settings-panel,
#oc-live-overlay.oc-bubble .oc-live-placeholder{display:none!important;}
#oc-live-overlay.oc-bubble .oc-live-body{border-radius:50%;overflow:hidden;}
#oc-live-overlay.oc-bubble .oc-live-video{object-fit:cover;}
#oc-live-overlay.oc-bubble::after{
  content:"";position:absolute;bottom:2px;right:2px;width:16px;height:16px;
  border-radius:50%;background:var(--oc-accent);border:3px solid #ffffff;
  box-shadow:0 0 6px rgba(229,57,53,0.4);animation:oc-pulse 2s ease-in-out infinite;z-index:10;
  pointer-events:none;
}
#oc-live-overlay.oc-bubble:hover{
  transform:scale(1.08);
  box-shadow:0 4px 24px rgba(0,0,0,0.15),0 0 0 3px rgba(229,57,53,0.4);
}

/* ── Source Badge (LIVE pill) ── */
.oc-live-source-badge{
  position:absolute;top:var(--oc-sp-3);left:var(--oc-sp-3);z-index:4;
  padding:4px 10px;border-radius:var(--oc-radius-pill);
  background:rgba(255,255,255,0.92);backdrop-filter:blur(12px);
  color:var(--oc-text-2);font-size:11px;font-weight:600;letter-spacing:.3px;
  display:none;pointer-events:none;
  box-shadow:0 2px 8px rgba(0,0,0,0.08);
}
.oc-live-badge-dot{
  display:inline-block;width:8px;height:8px;border-radius:50%;
  background:var(--oc-accent);margin-right:6px;flex-shrink:0;
  box-shadow:0 0 6px var(--oc-accent);animation:oc-pulse 2s ease-in-out infinite;
}
.oc-live-source-badge.oc-visible{display:inline-flex;align-items:center;animation:oc-badge-in var(--oc-norm) both;}
@keyframes oc-badge-in{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}

/* ── Stop / End Buttons ── */
.oc-live-stop-btn{
  height:30px;padding:0 12px;
  border:1px solid rgba(229,57,53,0.2);border-radius:var(--oc-radius-pill);
  background:rgba(229,57,53,0.06);color:var(--oc-accent);
  font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;
  transition:all var(--oc-fast);
}
.oc-live-stop-btn:hover{background:rgba(229,57,53,0.12);border-color:rgba(229,57,53,0.35);}
.oc-live-end-btn{
  position:absolute;top:var(--oc-sp-3);right:var(--oc-sp-3);z-index:4;
  padding:4px 10px;border:none;border-radius:var(--oc-radius-pill);
  background:rgba(255,255,255,0.92);backdrop-filter:blur(12px);
  color:var(--oc-text-2);font-size:11px;font-weight:600;cursor:pointer;
  transition:all var(--oc-fast);
  box-shadow:0 2px 8px rgba(0,0,0,0.08);
}
.oc-live-end-btn:hover{background:#ffffff;color:var(--oc-text);box-shadow:0 4px 14px rgba(0,0,0,0.12);transform:scale(1.04);}
.oc-live-end-btn:active{transform:scale(.96);}

/* ── Audio Toggle ── */
#oc-audio-unlock{
  position:absolute;bottom:var(--oc-sp-3);right:var(--oc-sp-3);z-index:6;
  width:32px;height:32px;padding:0;border:none;border-radius:50%;
  background:rgba(0,0,0,0.52);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  color:#fff;cursor:pointer;
  display:none;align-items:center;justify-content:center;
  box-shadow:0 2px 8px rgba(0,0,0,0.2);
  transition:background var(--oc-fast),transform var(--oc-fast);
}
#oc-audio-unlock:hover{background:rgba(0,0,0,0.8);transform:scale(1.12);}
#oc-audio-unlock:active{transform:scale(.92);}
#oc-live-overlay.oc-bubble #oc-audio-unlock{display:none!important;}
#oc-live-overlay.oc-bubble #oc-mic-btn{display:none!important;}

/* ── Cohost (连麦) ── */
#oc-mic-btn{
  position:absolute;bottom:var(--oc-sp-3);left:var(--oc-sp-3);z-index:6;
  height:32px;padding:0 12px;border:none;border-radius:var(--oc-radius-pill);
  background:rgba(0,0,0,0.52);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  color:#fff;cursor:pointer;font-size:12px;font-weight:600;font-family:var(--oc-font);
  display:none;align-items:center;gap:5px;
  box-shadow:0 2px 8px rgba(0,0,0,0.2);
  transition:background var(--oc-fast),transform var(--oc-fast);
}
#oc-mic-btn:hover{background:rgba(0,0,0,0.8);transform:scale(1.05);}
#oc-mic-btn:active{transform:scale(.92);}
#oc-mic-btn.oc-mic-active{background:rgba(229,57,53,0.85);}
#oc-mic-btn.oc-mic-pending{background:rgba(255,152,0,0.75);pointer-events:none;}

.oc-mic-request-popup{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;
  background:rgba(255,255,255,0.97);backdrop-filter:blur(16px);
  border-radius:var(--oc-radius);padding:var(--oc-sp-6);
  box-shadow:0 12px 40px rgba(0,0,0,0.18),0 0 0 1px var(--oc-border);
  display:flex;flex-direction:column;align-items:center;gap:var(--oc-sp-4);
  min-width:220px;animation:oc-settings-in var(--oc-norm) both;
}
.oc-mic-request-title{font-size:14px;font-weight:700;color:var(--oc-text);}
.oc-mic-request-sub{font-size:12px;color:var(--oc-text-2);text-align:center;}
.oc-mic-request-actions{display:flex;gap:var(--oc-sp-3);width:100%;}
.oc-mic-request-actions button{
  flex:1;height:36px;border-radius:var(--oc-radius-sm);font-size:12px;font-weight:600;
  cursor:pointer;border:none;transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-mic-accept{background:var(--oc-green);color:#fff;}
.oc-mic-accept:hover{opacity:.88;}
.oc-mic-decline{background:var(--oc-surface);color:var(--oc-text-2);border:1px solid var(--oc-border)!important;}
.oc-mic-decline:hover{background:var(--oc-border);}

.oc-cohost-badge{
  position:absolute;top:var(--oc-sp-3);right:60px;z-index:6;
  padding:4px 10px;border-radius:var(--oc-radius-pill);
  background:rgba(46,125,50,0.9);color:#fff;font-size:11px;font-weight:600;
  display:none;align-items:center;gap:5px;
  animation:oc-badge-in var(--oc-norm) both;
}
.oc-cohost-badge .oc-cohost-dot{
  width:6px;height:6px;border-radius:50%;background:#fff;animation:oc-pulse 2s ease-in-out infinite;
}

/* ── Settings Panel ── */
.oc-settings-panel{
  position:absolute;inset:0;background:rgba(255,255,255,0.97);backdrop-filter:blur(16px);
  z-index:5;padding:var(--oc-sp-6);
  display:flex;flex-direction:column;gap:var(--oc-sp-4);overflow-y:auto;
  animation:oc-settings-in var(--oc-norm) both;
}
@keyframes oc-settings-in{from{opacity:0;}to{opacity:1;}}
.oc-settings-title{font-size:14px;font-weight:700;color:var(--oc-text);margin-bottom:var(--oc-sp-1);display:flex;align-items:center;gap:var(--oc-sp-2);}
.oc-settings-label{display:flex;flex-direction:column;gap:6px;color:var(--oc-text-2);font-size:11px;letter-spacing:.8px;text-transform:uppercase;font-weight:600;}
.oc-settings-input{
  height:36px;border:1px solid var(--oc-border);border-radius:var(--oc-radius-sm);
  background:#ffffff;color:var(--oc-text);font-size:13px;
  padding:0 var(--oc-sp-4);outline:none;transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-settings-input:focus{border-color:rgba(229,57,53,0.35);background:#ffffff;box-shadow:0 0 0 3px rgba(229,57,53,0.06);}
.oc-settings-actions{display:flex;gap:var(--oc-sp-3);margin-top:var(--oc-sp-3);}
.oc-settings-save,.oc-settings-cancel{
  flex:1;height:36px;border-radius:var(--oc-radius-sm);font-size:12px;font-weight:600;
  cursor:pointer;transition:all var(--oc-fast);border:1px solid transparent;
}
.oc-settings-save{background:var(--oc-accent-g);color:#fff;border:none;}
.oc-settings-save:hover{opacity:.88;transform:translateY(-1px);}
.oc-settings-cancel{background:var(--oc-surface);color:var(--oc-text-2);border-color:var(--oc-border);}
.oc-settings-cancel:hover{background:var(--oc-border);color:var(--oc-text);}
`;
  document.head.appendChild(style);

  // ── Build DOM ──

  const overlay = document.createElement("div");
  overlay.id = "oc-live-overlay";
  overlay.innerHTML = `
    <div class="oc-resize-handle" id="oc-resize"></div>
    <div class="oc-live-header" id="oc-drag-handle">
      <span class="oc-live-dot" id="oc-dot"></span>
      <span class="oc-live-title" id="oc-title">OpenClaw Live</span>
      <span class="oc-live-viewers" id="oc-viewers"></span>
      <div class="oc-live-controls">
        <button class="oc-live-btn" id="oc-btn-settings" title="设置" style="display:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></button>
        <button class="oc-live-btn" id="oc-btn-bubble" title="悬浮窗" style="display:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/></svg></button>
        <button class="oc-live-btn" id="oc-btn-min" title="最小化"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        <button class="oc-live-btn" id="oc-btn-fs" title="全屏"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
        <button class="oc-live-btn" id="oc-btn-close" title="隐藏"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="oc-live-body" id="oc-body">
      <video class="oc-live-video" id="oc-video" autoplay muted playsinline></video>
      <div class="oc-live-placeholder" id="oc-placeholder">
        <div id="oc-mode-select">
          <span class="oc-mode-label" id="oc-mode-label">直播间</span>
          <div class="oc-mode-actions" id="oc-host-actions" style="display:none;">
            <div class="oc-action-card" id="oc-btn-camera">
              <div class="oc-action-icon oc-red"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></div>
              <span class="oc-action-name">开播</span>
            </div>
            <div class="oc-action-card" id="oc-btn-screen">
              <div class="oc-action-icon oc-blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg></div>
              <span class="oc-action-name">共享屏幕</span>
            </div>
          </div>
          <div class="oc-mode-divider" id="oc-mode-divider" style="display:none;"></div>
          <div class="oc-viewer-card" id="oc-btn-viewer" style="display:none;">
            <div class="oc-viewer-dot"></div>
            <span>进入观看</span>
          </div>
        </div>
        <div id="oc-viewer-waiting" style="display:none;">
          <div class="oc-spinner"></div>
          <span style="color:var(--oc-text-2,rgba(255,255,255,0.55));font-size:12px;font-weight:500;">等待主播开播</span>
          <span style="color:var(--oc-text-3,rgba(255,255,255,0.28));font-size:10px;">主播开始后画面自动出现</span>
        </div>
      </div>
      <div class="oc-danmaku-layer" id="oc-danmaku"></div>
      <div class="oc-live-source-badge" id="oc-source-badge"></div>
      <button class="oc-live-end-btn" id="oc-btn-end">结束直播</button>
      <button id="oc-audio-unlock" title="点击开启音频"></button>
      <button id="oc-mic-btn" title="连麦"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg><span>连麦</span></button>
      <div class="oc-cohost-badge" id="oc-cohost-badge"><span class="oc-cohost-dot"></span>连麦中</div>
      <div class="oc-settings-panel" id="oc-settings" style="display:none;">
        <div class="oc-settings-title">⚙ 连接设置</div>
        <label class="oc-settings-label">信令服务器地址
          <input class="oc-settings-input" id="oc-cfg-signal-host" placeholder="如 192.168.1.6 (留空=当前主机)" />
        </label>
        <label class="oc-settings-label">信令服务器端口
          <input class="oc-settings-input" id="oc-cfg-signal-port" type="number" placeholder="留空=当前端口" />
        </label>
        <label class="oc-settings-label">房间标题
          <input class="oc-settings-input" id="oc-cfg-title" placeholder="OpenClaw Live" />
        </label>
        <div style="height:1px;background:var(--oc-border);margin:var(--oc-sp-2) 0;"></div>
        <label class="oc-settings-label">TURN 服务器 <span style="opacity:0.5;text-transform:none;letter-spacing:0;">(可选, 远程部署需要)</span>
          <input class="oc-settings-input" id="oc-cfg-turn-server" placeholder="turn:your-server.com:3478" />
        </label>
        <label class="oc-settings-label">TURN 用户名
          <input class="oc-settings-input" id="oc-cfg-turn-user" placeholder="username" />
        </label>
        <label class="oc-settings-label">TURN 密码
          <input class="oc-settings-input" id="oc-cfg-turn-pass" type="password" placeholder="password" />
        </label>
        <div class="oc-settings-actions">
          <button class="oc-settings-save" id="oc-cfg-save">保存</button>
          <button class="oc-settings-cancel" id="oc-cfg-cancel">取消</button>
        </div>
      </div>
    </div>
    <div class="oc-chat-panel" id="oc-chat-panel">
      <div class="oc-chat-header" id="oc-chat-header">
        <span class="oc-chat-title">Live Chat</span>
        <button class="oc-chat-toggle" id="oc-chat-toggle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
      </div>
      <div class="oc-chat-list" id="oc-chat-list">
        <div class="oc-chat-empty" id="oc-chat-empty">暂无消息</div>
      </div>
    </div>
    <div class="oc-live-footer">
      <div class="oc-footer-stats">
        <span class="oc-live-stat" id="oc-stat-duration">00:00</span>
        <span class="oc-stat-sep"></span>
        <span class="oc-live-stat" id="oc-stat-dm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg><b>0</b></span>
      </div>
      <span class="oc-live-stat" id="oc-stat-role" style="color:var(--oc-accent,#ef4444);font-weight:600;display:none;"></span>
      <button class="oc-live-stop-btn" id="oc-btn-stop" style="display:none;">关播</button>
      <div class="oc-dm-wrap">
        <input class="oc-danmaku-input" id="oc-dm-input" placeholder="发弹幕..." />
        <button class="oc-danmaku-send-btn" id="oc-dm-send">发送</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "oc-live-toggle";
  toggleBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
  toggleBtn.title = "打开直播面板";
  document.body.appendChild(toggleBtn);

  // ── Element refs ──

  const $ = (id) => document.getElementById(id);
  const dot = $("oc-dot");
  const titleEl = $("oc-title");
  const viewersEl = $("oc-viewers");
  const video = $("oc-video");
  const placeholder = $("oc-placeholder");
  const danmakuLayer = $("oc-danmaku");
  const statDuration = $("oc-stat-duration");
  const statDm = $("oc-stat-dm");
  const statRole = $("oc-stat-role");
  const dmInput = $("oc-dm-input");
  const stopBtn = $("oc-btn-stop");
  const bubbleBtn = $("oc-btn-bubble");
  const sourceBadge = $("oc-source-badge");
  const modeSelect = $("oc-mode-select");
  const viewerWaiting = $("oc-viewer-waiting");
  const endBtn = $("oc-btn-end");
  const audioUnlockBtn = $("oc-audio-unlock");
  const settingsPanel = $("oc-settings");
  const cfgSignalHost = $("oc-cfg-signal-host");
  const cfgSignalPort = $("oc-cfg-signal-port");
  const cfgTitle = $("oc-cfg-title");
  const cfgTurnServer = $("oc-cfg-turn-server");
  const cfgTurnUser = $("oc-cfg-turn-user");
  const cfgTurnPass = $("oc-cfg-turn-pass");
  const chatPanel = $("oc-chat-panel");
  const chatList = $("oc-chat-list");
  const chatEmpty = $("oc-chat-empty");
  const micBtn = $("oc-mic-btn");
  const cohostBadge = $("oc-cohost-badge");

  // ── Initialize UI state ──
  video.style.display = "none";
  placeholder.style.display = "flex";
  endBtn.style.display = "none";
  stopBtn.style.display = "none";


  // ── Config (localStorage) ──

  const CFG_KEY = "oc-live-config";
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }
  function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  function getSignalBase() {
    const cfg = loadConfig();
    if (cfg.signalHost) {
      const port = cfg.signalPort || location.port || (location.protocol === "https:" ? "443" : "80");
      const proto = location.protocol;
      return `${proto}//${cfg.signalHost}:${port}`;
    }
    return `${location.protocol}//${location.host}`;
  }

  // populate settings fields from saved config
  (function initSettings() {
    const cfg = loadConfig();
    cfgSignalHost.value = cfg.signalHost || "";
    cfgSignalPort.value = cfg.signalPort || "";
    cfgTitle.value = cfg.roomTitle || "";
    cfgTurnServer.value = cfg.turnServer || "";
    cfgTurnUser.value = cfg.turnUser || "";
    cfgTurnPass.value = cfg.turnPass || "";
  })();

  $("oc-btn-settings").addEventListener("click", () => {
    const visible = settingsPanel.style.display !== "none";
    settingsPanel.style.display = visible ? "none" : "flex";
  });

  $("oc-cfg-save").addEventListener("click", () => {
    const cfg = {
      signalHost: cfgSignalHost.value.trim(),
      signalPort: cfgSignalPort.value.trim(),
      roomTitle: cfgTitle.value.trim(),
      turnServer: cfgTurnServer.value.trim(),
      turnUser: cfgTurnUser.value.trim(),
      turnPass: cfgTurnPass.value.trim(),
    };
    saveConfig(cfg);
    if (cfg.roomTitle) titleEl.textContent = cfg.roomTitle;
    settingsPanel.style.display = "none";
  });

  $("oc-cfg-cancel").addEventListener("click", () => {
    const cfg = loadConfig();
    cfgSignalHost.value = cfg.signalHost || "";
    cfgSignalPort.value = cfg.signalPort || "";
    cfgTitle.value = cfg.roomTitle || "";
    cfgTurnServer.value = cfg.turnServer || "";
    cfgTurnUser.value = cfg.turnUser || "";
    cfgTurnPass.value = cfg.turnPass || "";
    settingsPanel.style.display = "none";
  });

  // ══════════════════════════════════
  //  Signaling via SSE + POST
  // ══════════════════════════════════

  let signalEs = null;
  let myClientId = null;

  function connectSignal(asRole) {
    const base = getSignalBase();
    const eventsUrl = `${base}/live/signal/events?role=${asRole}`;
    signalEs = new EventSource(eventsUrl);

    signalEs.onopen = () => console.log("[signal] SSE connected as", asRole);

    signalEs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.clientId && !myClientId) {
          myClientId = msg.clientId;
          console.log("[signal] assigned clientId:", myClientId);
        }
        handleSignalMessage(msg);
      } catch {}
    };

    signalEs.onerror = () => {
      console.log("[signal] SSE error/disconnected");
      if (signalEs) { signalEs.close(); signalEs = null; }
      myClientId = null;
      if (role === "viewer") {
        setTimeout(() => connectSignal("viewer"), 3000);
      }
    };
  }

  function sendSignal(msg) {
    if (!myClientId) return;
    const base = getSignalBase();
    fetch(`${base}/live/signal/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: myClientId, ...msg }),
    }).catch(() => {});
  }

  function handleSignalMessage(msg) {
    switch (msg.type) {

      // ── Common ──
      case "role":
        role = msg.role;
        myViewerId = msg.viewerId || null;
        statRole.textContent = role === "broadcaster" ? "🔴 主播" : "👁 观众";
        if (role === "broadcaster") {
          stopBtn.style.display = isLive ? "block" : "none";
          endBtn.style.display = isLive ? "block" : "none";
        }
        if (role === "viewer") {
          modeSelect.style.display = "none";
          if (msg.streamInfo?.live) {
            viewerWaiting.innerHTML = '<div class="oc-spinner"></div><span style="color:var(--oc-text-2,#888);font-size:12px;font-weight:500;">主播在线，正在连接</span>';
          }
          viewerWaiting.style.display = "flex";
        }
        break;

      case "viewer-count":
        viewerCount = msg.count;
        updateViewerBadge();
        break;

      case "stream-info":
        if (msg.title) titleEl.textContent = msg.title;
        if (msg.viewerCount != null) viewerCount = msg.viewerCount;
        updateViewerBadge();
        break;

      // ── Broadcaster receives ──
      case "viewer-joined":
        createOfferForViewer(msg.viewerId);
        break;

      case "viewer-left":
        if (peerConnections[msg.viewerId]) {
          peerConnections[msg.viewerId].close();
          delete peerConnections[msg.viewerId];
        }
        break;

      case "answer":
        if (peerConnections[msg.viewerId]) {
          peerConnections[msg.viewerId].setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: msg.sdp })
          );
        }
        break;

      case "ice-candidate":
        if (role === "broadcaster" && msg.viewerId && peerConnections[msg.viewerId]) {
          peerConnections[msg.viewerId].addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        if (role === "viewer" && viewerPc) {
          viewerPc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;

      // ── Viewer receives ──
      case "broadcaster-ready":
        viewerWaiting.innerHTML = '<div class="oc-spinner"></div><span style="color:var(--oc-text-2,#888);font-size:12px;font-weight:500;">主播在线，等待连接</span>';
        break;

      case "offer":
        handleOfferFromBroadcaster(msg.sdp);
        break;

      case "broadcaster-left": {
        const wasBubble = overlay.classList.contains("oc-bubble");
        cleanupCohost();
        if (viewerPc) { viewerPc.close(); viewerPc = null; }
        video.srcObject = null;
        isLive = false;
        audioUnlockBtn.style.display = "none";
        micBtn.style.display = "none";
        exitBubbleMode();
        updateUI(null);
        viewerWaiting.innerHTML = '<div class="oc-spinner"></div><span style="color:var(--oc-text-2,#888);font-size:12px;font-weight:500;">主播已离开，等待重新开播</span>';
        viewerWaiting.style.display = "flex";
        placeholder.style.display = "flex";
        video.style.display = "none";
        if (wasBubble) {
          overlay.classList.add("oc-hidden");
          toggleBtn.classList.add("oc-visible");
        }
        break;
      }

      case "danmaku":
        spawnDanmaku(msg.text, msg.color, msg.sender);
        break;

      // ── Cohost (连麦) ──
      case "mic-request":
        showMicRequestPopup(msg.viewerId);
        break;

      case "mic-accept":
        onMicAccepted();
        break;

      case "mic-reject":
        onMicRejected();
        break;

      case "mic-offer":
        handleMicOffer(msg.viewerId, msg.sdp);
        break;

      case "mic-answer":
        handleMicAnswer(msg.sdp);
        break;

      case "mic-ice":
        if (micPc && msg.candidate) {
          micPc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        }
        break;

      case "mic-stop":
        onMicStopped(msg.viewerId);
        break;

      case "error":
        alert(msg.message);
        break;
    }
  }

  // ══════════════════════════════════
  //  Broadcaster: WebRTC
  // ══════════════════════════════════

  async function createOfferForViewer(viewerId) {
    if (!localStream) return;

    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    peerConnections[viewerId] = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: "ice-candidate", viewerId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        pc.close();
        delete peerConnections[viewerId];
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: "offer", viewerId, sdp: offer.sdp });
  }

  // ══════════════════════════════════
  //  Viewer: WebRTC
  // ══════════════════════════════════

  async function handleOfferFromBroadcaster(sdp) {
    if (viewerPc) { viewerPc.close(); }

    viewerPc = new RTCPeerConnection({ iceServers: getIceServers() });

    viewerPc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: "ice-candidate", candidate: e.candidate });
      }
    };

    viewerPc.ontrack = (e) => {
      video.srcObject = e.streams[0];
      video.muted = true;
      video.play().catch(() => {});
      isLive = true;
      startedAt = startedAt || Date.now();
      placeholder.style.display = "none";
      video.style.display = "block";
      updateUI("📡 观看中");
      audioUnlockBtn.style.display = "flex";
      micBtn.style.display = "flex";
      syncAudioBtn();
      setTimeout(() => enterBubbleMode(), 500);
    };

    viewerPc.onconnectionstatechange = () => {
      if (viewerPc.connectionState === "failed") {
        viewerPc.close();
        viewerPc = null;
        video.srcObject = null;
        placeholder.style.display = "flex";
        video.style.display = "none";
      }
    };

    await viewerPc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await viewerPc.createAnswer();
    await viewerPc.setLocalDescription(answer);
    sendSignal({ type: "answer", sdp: answer.sdp });
  }

  // ══════════════════════════════════
  //  Start / Stop Streaming
  // ══════════════════════════════════

  function checkSecureContext() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("当前页面不是安全上下文，无法使用摄像头/麦克风。\n\n请使用以下方式之一：\n• http://localhost 访问\n• HTTPS 访问\n• Chrome 设置 chrome://flags/#unsafely-treat-insecure-origin-as-secure 添加当前地址");
      return false;
    }
    return true;
  }

  async function startCamera() {
    if (!checkSecureContext()) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: true,
      });
      goLive("📷 摄像头");
    } catch (err) {
      alert("无法访问摄像头: " + err.message);
    }
  }

  async function startScreen() {
    if (!checkSecureContext()) return;
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: true,
      });
      localStream.getVideoTracks()[0].addEventListener("ended", () => stopLive());
      goLive("🖥 屏幕共享");
    } catch (err) {
      if (err.name !== "AbortError" && err.name !== "NotAllowedError") {
        alert("屏幕共享失败: " + err.message);
      }
    }
  }

  function goLive(sourceLabel) {
    video.srcObject = localStream;
    video.play().catch(() => {});
    isLive = true;
    role = "broadcaster";
    startedAt = Date.now();
    statRole.textContent = "🔴 主播";
    connectSignal("broadcaster");
    updateUI(sourceLabel);
    setTimeout(() => enterBubbleMode(), 500);
  }

  function stopLive() {
    const wasBubble = overlay.classList.contains("oc-bubble");
    clearTimeout(bubbleExpandTimer);
    clearTimeout(bubbleCollapseTimer);
    exitBubbleMode();
    cleanupCohost();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    for (const pc of Object.values(peerConnections)) pc.close();
    peerConnections = {};
    if (viewerPc) { viewerPc.close(); viewerPc = null; }
    if (signalEs) { signalEs.close(); signalEs = null; myClientId = null; }
    video.srcObject = null;
    isLive = false;
    startedAt = null;
    role = null;
    audioUnlockBtn.style.display = "none";
    micBtn.style.display = "none";
    if (durationTimer) clearInterval(durationTimer);
    statRole.textContent = "";
    updateUI(null);
    modeSelect.style.display = "block";
    viewerWaiting.style.display = "none";
    if (wasBubble) {
      overlay.classList.add("oc-hidden");
      toggleBtn.classList.add("oc-visible");
    }
  }

  // ── UI ──

  function updateViewerBadge() {
    const text = `LIVE (${viewerCount})`;
    sourceBadge.innerHTML = `<span class="oc-live-badge-dot"></span>${text}`;
  }

  function updateUI(sourceLabel) {
    dot.className = "oc-live-dot" + (isLive ? " oc-live-on" : "");
    viewersEl.textContent = "";
    placeholder.style.display = isLive ? "none" : "flex";
    video.style.display = isLive ? "block" : "none";
    stopBtn.style.display = (isLive && role === "broadcaster") ? "block" : "none";
    if (isLive && role === "broadcaster") {
      endBtn.textContent = "结束直播";
      endBtn.style.display = "block";
    } else if (isLive && role === "viewer") {
      endBtn.textContent = "停止观看";
      endBtn.style.display = "block";
    } else {
      endBtn.style.display = "none";
    }
    bubbleBtn.style.display = isLive ? "flex" : "none";

    if (sourceLabel) {
      updateViewerBadge();
      sourceBadge.classList.add("oc-visible");
    } else {
      sourceBadge.classList.remove("oc-visible");
    }

    if (isLive) {
      startDurationTimer();
    } else {
      statDuration.textContent = "00:00";
    }
  }

  function startDurationTimer() {
    if (durationTimer) clearInterval(durationTimer);
    const tick = () => {
      if (!startedAt) return;
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const h = Math.floor(s / 3600);
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      statDuration.textContent = h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
    };
    tick();
    durationTimer = setInterval(tick, 1000);
  }

  // ── Danmaku ──

  const CHAT_MAX = 100;
  const AVATAR_COLORS = ["#e53935","#1976d2","#2e7d32","#f57c00","#7b1fa2","#00838f","#c62828","#283593","#558b2f","#4e342e"];

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function appendChatMessage(sender, text, color) {
    if (chatEmpty.style.display !== "none") chatEmpty.style.display = "none";
    const item = document.createElement("div");
    item.className = "oc-chat-item";
    const initial = (sender || "?")[0].toUpperCase();
    const bg = avatarColor(sender || "?");
    const now = new Date();
    const ts = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
    item.innerHTML =
      `<div class="oc-chat-avatar" style="background:${bg}">${initial}</div>` +
      `<div class="oc-chat-body">` +
        `<div class="oc-chat-meta"><span class="oc-chat-sender">${sender || "匿名"}</span><span class="oc-chat-time">${ts}</span></div>` +
        `<div class="oc-chat-text">${text.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>` +
      `</div>`;
    chatList.appendChild(item);
    while (chatList.children.length > CHAT_MAX + 1) chatList.removeChild(chatList.children[1]);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function spawnDanmaku(text, color, sender) {
    const el = document.createElement("span");
    el.className = "oc-danmaku-item";
    el.textContent = text;
    el.style.color = color || randomColor();
    const trackHeight = danmakuLayer.clientHeight / TRACK_COUNT;
    danmakuTrack = (danmakuTrack + 1) % TRACK_COUNT;
    el.style.top = `${danmakuTrack * trackHeight + 4}px`;
    el.style.animationDuration = `${6 + Math.random() * 3}s`;
    el.style.left = `${danmakuLayer.clientWidth}px`;
    danmakuLayer.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    danmakuCount++;
    statDm.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg><b>${danmakuCount}</b>`;
    appendChatMessage(sender, text, color);
  }

  function sendDanmaku() {
    const text = dmInput.value.trim();
    if (!text) return;
    const color = randomColor();
    const sender = role === "broadcaster" ? "主播" : (myViewerId || "观众");
    sendSignal({ type: "danmaku", text, sender, color });
    dmInput.value = "";
  }

  function randomColor() {
    const c = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff922b","#cc5de8","#20c997","#ffffff","#ffa94d","#74c0fc"];
    return c[Math.floor(Math.random() * c.length)];
  }

  // ══════════════════════════════════
  //  Cohost (连麦) Logic
  // ══════════════════════════════════

  // ── Viewer: request cohost ──
  function requestMic() {
    if (isCohostActive) {
      stopCohost();
      return;
    }
    micBtn.classList.add("oc-mic-pending");
    micBtn.querySelector("span").textContent = "请求中…";
    sendSignal({ type: "mic-request" });
  }

  // ── Viewer: broadcaster accepted ──
  async function onMicAccepted() {
    micBtn.classList.remove("oc-mic-pending");
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      micBtn.classList.remove("oc-mic-pending", "oc-mic-active");
      micBtn.querySelector("span").textContent = "连麦";
      alert("无法访问麦克风: " + err.message);
      sendSignal({ type: "mic-stop" });
      return;
    }

    micPc = new RTCPeerConnection({ iceServers: getIceServers() });
    micStream.getTracks().forEach((t) => micPc.addTrack(t, micStream));

    micPc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: "mic-ice", candidate: e.candidate });
    };
    micPc.onconnectionstatechange = () => {
      if (micPc && (micPc.connectionState === "failed" || micPc.connectionState === "disconnected")) {
        stopCohost();
      }
    };

    const offer = await micPc.createOffer();
    await micPc.setLocalDescription(offer);
    sendSignal({ type: "mic-offer", sdp: offer.sdp });

    isCohostActive = true;
    micBtn.classList.add("oc-mic-active");
    micBtn.querySelector("span").textContent = "结束连麦";
    cohostBadge.style.display = "flex";
  }

  // ── Viewer: broadcaster rejected ──
  function onMicRejected() {
    micBtn.classList.remove("oc-mic-pending");
    micBtn.querySelector("span").textContent = "连麦";
    appendChatMessage("系统", "主播拒绝了连麦请求", "#999");
  }

  // ── Viewer: handle answer from broadcaster ──
  async function handleMicAnswer(sdp) {
    if (!micPc) return;
    await micPc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }

  // ── Broadcaster: show mic request popup ──
  function showMicRequestPopup(viewerId) {
    const existing = document.querySelector(".oc-mic-request-popup");
    if (existing) existing.remove();

    if (isCohostActive) {
      sendSignal({ type: "mic-reject", viewerId });
      return;
    }

    if (overlay.classList.contains("oc-bubble")) {
      exitBubbleMode();
    }

    const popup = document.createElement("div");
    popup.className = "oc-mic-request-popup";
    popup.innerHTML =
      '<div class="oc-mic-request-title">🎤 连麦请求</div>' +
      '<div class="oc-mic-request-sub">观众 ' + viewerId + ' 请求连麦</div>' +
      '<div class="oc-mic-request-actions">' +
        '<button class="oc-mic-accept" id="oc-mic-popup-accept">同意</button>' +
        '<button class="oc-mic-decline" id="oc-mic-popup-decline">拒绝</button>' +
      '</div>';
    overlay.appendChild(popup);

    var autoRejectTimer = setTimeout(function () {
      popup.remove();
      sendSignal({ type: "mic-reject", viewerId: viewerId });
    }, 15000);

    popup.querySelector("#oc-mic-popup-accept").addEventListener("click", function () {
      clearTimeout(autoRejectTimer);
      popup.remove();
      cohostViewerId = viewerId;
      sendSignal({ type: "mic-accept", viewerId: viewerId });
      cohostBadge.style.display = "flex";
      isCohostActive = true;
    });

    popup.querySelector("#oc-mic-popup-decline").addEventListener("click", function () {
      clearTimeout(autoRejectTimer);
      popup.remove();
      sendSignal({ type: "mic-reject", viewerId: viewerId });
    });
  }

  // ── Broadcaster: handle viewer's mic offer ──
  async function handleMicOffer(viewerId, sdp) {
    if (micPc) { micPc.close(); micPc = null; }

    micPc = new RTCPeerConnection({ iceServers: getIceServers() });

    micPc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: "mic-ice", viewerId: viewerId, candidate: e.candidate });
    };

    micPc.ontrack = (e) => {
      var audio = document.createElement("audio");
      audio.id = "oc-cohost-audio";
      audio.srcObject = e.streams[0];
      audio.autoplay = true;
      document.body.appendChild(audio);
    };

    micPc.onconnectionstatechange = () => {
      if (micPc && (micPc.connectionState === "failed" || micPc.connectionState === "disconnected")) {
        stopCohost();
      }
    };

    await micPc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    var answer = await micPc.createAnswer();
    await micPc.setLocalDescription(answer);
    sendSignal({ type: "mic-answer", viewerId: viewerId, sdp: answer.sdp });
  }

  // ── Both: remote side stopped ──
  function onMicStopped(viewerId) {
    cleanupCohost();
    appendChatMessage("系统", viewerId ? "观众 " + viewerId + " 结束了连麦" : "主播结束了连麦", "#999");
  }

  // ── Both: actively stop cohost ──
  function stopCohost() {
    if (role === "broadcaster" && cohostViewerId) {
      sendSignal({ type: "mic-stop", viewerId: cohostViewerId });
    } else if (role === "viewer") {
      sendSignal({ type: "mic-stop" });
    }
    cleanupCohost();
  }

  function cleanupCohost() {
    if (micPc) { micPc.close(); micPc = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    var cohostAudio = document.getElementById("oc-cohost-audio");
    if (cohostAudio) cohostAudio.remove();
    isCohostActive = false;
    cohostViewerId = null;
    cohostBadge.style.display = "none";
    micBtn.classList.remove("oc-mic-active", "oc-mic-pending");
    micBtn.querySelector("span").textContent = "连麦";
    var popup = document.querySelector(".oc-mic-request-popup");
    if (popup) popup.remove();
  }

  // ── Event Listeners ──

  $("oc-btn-camera").addEventListener("click", startCamera);
  $("oc-btn-screen").addEventListener("click", startScreen);
  $("oc-btn-viewer").addEventListener("click", () => {
    modeSelect.style.display = "none";
    viewerWaiting.style.display = "flex";
    connectSignal("viewer");
  });
  const SVG_VOL_ON  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const SVG_VOL_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

  function syncAudioBtn() {
    if (video.muted) {
      audioUnlockBtn.innerHTML = SVG_VOL_OFF;
      audioUnlockBtn.title = "已静音，点击开启音频";
    } else {
      audioUnlockBtn.innerHTML = SVG_VOL_ON;
      audioUnlockBtn.title = "点击静音";
    }
  }

  audioUnlockBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted) video.play().catch(() => {});
    syncAudioBtn();
  });

  micBtn.addEventListener("click", requestMic);

  stopBtn.addEventListener("click", stopLive);
  endBtn.addEventListener("click", stopLive);

  $("oc-chat-header").addEventListener("click", () => chatPanel.classList.toggle("oc-chat-collapsed"));

  bubbleBtn.addEventListener("click", () => { if (isLive) enterBubbleMode(); });
  $("oc-btn-min").addEventListener("click", () => overlay.classList.toggle("oc-minimized"));
  $("oc-btn-fs").addEventListener("click", () => overlay.classList.toggle("oc-fullscreen"));
  $("oc-btn-close").addEventListener("click", () => {
    overlay.classList.add("oc-hidden");
    toggleBtn.classList.add("oc-visible");
  });
  let _fabDragged = false;
  toggleBtn.addEventListener("click", () => {
    if (_fabDragged) { _fabDragged = false; return; }
    overlay.classList.remove("oc-hidden");
    toggleBtn.classList.remove("oc-visible");
    if (isLive) enterBubbleMode();
  });

  // ── Bubble Mode: click to expand, click again to collapse, drag to move ──

  (function () {
    let dragging = false, moved = false, sx, sy, sl, st;
    const THRESHOLD = 5;

    function startBubbleDrag(cx, cy, e) {
      if (!overlay.classList.contains("oc-bubble")) return;
      dragging = true; moved = false;
      const r = overlay.getBoundingClientRect();
      sx = cx; sy = cy; sl = r.left; st = r.top;
      overlay.style.transition = "none";
      e.preventDefault();
    }
    function moveBubbleDrag(cx, cy) {
      if (!dragging) return;
      const dx = cx - sx, dy = cy - sy;
      if (!moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      moved = true;
      overlay.style.left = `${sl + dx}px`;
      overlay.style.top = `${st + dy}px`;
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
    }
    function endBubbleDrag() {
      if (!dragging) return;
      dragging = false;
      overlay.style.transition = "";
      if (!moved) exitBubbleMode();
    }

    overlay.addEventListener("mousedown", (e) => startBubbleDrag(e.clientX, e.clientY, e));
    document.addEventListener("mousemove", (e) => moveBubbleDrag(e.clientX, e.clientY));
    document.addEventListener("mouseup", endBubbleDrag);

    overlay.addEventListener("touchstart", (e) => {
      if (!overlay.classList.contains("oc-bubble")) return;
      const t = e.touches[0]; startBubbleDrag(t.clientX, t.clientY, e);
    }, { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const t = e.touches[0]; moveBubbleDrag(t.clientX, t.clientY); e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchend", endBubbleDrag);
  })();

  $("oc-dm-send").addEventListener("click", sendDanmaku);
  dmInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") sendDanmaku(); });
  dmInput.addEventListener("keyup", (e) => e.stopPropagation());
  dmInput.addEventListener("keypress", (e) => e.stopPropagation());

  // ── Drag (mouse + touch) ──

  (function () {
    const handle = $("oc-drag-handle");
    let dragging = false, sx, sy, sl, st;
    function startDrag(cx, cy, e) {
      if (e.target.closest(".oc-live-btn,.oc-live-controls")) return;
      dragging = true;
      const r = overlay.getBoundingClientRect();
      sx = cx; sy = cy; sl = r.left; st = r.top;
      overlay.style.transition = "none";
      e.preventDefault();
    }
    function moveDrag(cx, cy) {
      if (!dragging) return;
      overlay.style.left = `${sl + cx - sx}px`;
      overlay.style.top = `${st + cy - sy}px`;
      overlay.style.right = "auto"; overlay.style.bottom = "auto";
    }
    function endDrag() { if (dragging) { dragging = false; overlay.style.transition = ""; } }

    handle.addEventListener("mousedown", (e) => startDrag(e.clientX, e.clientY, e));
    document.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
    document.addEventListener("mouseup", endDrag);

    handle.addEventListener("touchstart", (e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY, e); }, { passive: false });
    document.addEventListener("touchmove", (e) => { if (!dragging) return; const t = e.touches[0]; moveDrag(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener("touchend", endDrag);
  })();

  // ── FAB Drag (mouse + touch) ──

  (function () {
    let dragging = false, moved = false, sx, sy, sl, st;
    const THRESHOLD = 4;

    function startFabDrag(cx, cy, e) {
      dragging = true; moved = false;
      const r = toggleBtn.getBoundingClientRect();
      sx = cx; sy = cy; sl = r.left; st = r.top;
      e.preventDefault();
    }
    function moveFabDrag(cx, cy) {
      if (!dragging) return;
      const dx = cx - sx, dy = cy - sy;
      if (!moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      moved = true;
      toggleBtn.classList.add("oc-dragging");
      toggleBtn.style.left = `${sl + dx}px`;
      toggleBtn.style.top = `${st + dy}px`;
      toggleBtn.style.right = "auto";
      toggleBtn.style.bottom = "auto";
    }
    function endFabDrag() {
      if (!dragging) return;
      dragging = false;
      toggleBtn.classList.remove("oc-dragging");
    }

    toggleBtn.addEventListener("mousedown", (e) => startFabDrag(e.clientX, e.clientY, e));
    document.addEventListener("mousemove", (e) => moveFabDrag(e.clientX, e.clientY));
    document.addEventListener("mouseup", () => {
      if (dragging && moved) _fabDragged = true;
      endFabDrag();
    });

    toggleBtn.addEventListener("touchstart", (e) => { const t = e.touches[0]; startFabDrag(t.clientX, t.clientY, e); }, { passive: false });
    document.addEventListener("touchmove", (e) => { if (!dragging) return; const t = e.touches[0]; moveFabDrag(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener("touchend", () => {
      if (dragging && moved) _fabDragged = true;
      endFabDrag();
    });
  })();

  // ── Resize (mouse + touch) ──

  (function () {
    const handle = $("oc-resize");
    let resizing = false, sx, sy, sw, sh, sl, st;
    function startResize(cx, cy, e) {
      resizing = true;
      const r = overlay.getBoundingClientRect();
      sx = cx; sy = cy; sw = r.width; sh = r.height; sl = r.left; st = r.top;
      overlay.style.transition = "none";
      e.preventDefault();
    }
    function moveResize(cx, cy) {
      if (!resizing) return;
      const nw = Math.max(300, sw - (cx - sx));
      const nh = Math.max(380, sh - (cy - sy));
      overlay.style.width = `${nw}px`; overlay.style.height = `${nh}px`;
      overlay.style.left = `${sl + (sw - nw)}px`; overlay.style.top = `${st + (sh - nh)}px`;
      overlay.style.right = "auto"; overlay.style.bottom = "auto";
    }
    function endResize() { if (resizing) { resizing = false; overlay.style.transition = ""; } }

    handle.addEventListener("mousedown", (e) => startResize(e.clientX, e.clientY, e));
    document.addEventListener("mousemove", (e) => moveResize(e.clientX, e.clientY));
    document.addEventListener("mouseup", endResize);

    handle.addEventListener("touchstart", (e) => { const t = e.touches[0]; startResize(t.clientX, t.clientY, e); }, { passive: false });
    document.addEventListener("touchmove", (e) => { if (!resizing) return; const t = e.touches[0]; moveResize(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener("touchend", endResize);
  })();

  // ── Auto-detect: localStorage openclaw.device.auth.v1 → host or viewer ──

  (async function autoDetect() {
    const base = getSignalBase();

    var broadcasting = false;
    try {
      var stRes = await fetch(base + "/live/api/state");
      var stData = await stRes.json();
      broadcasting = stData.broadcasting === true;
    } catch (e) {}

    if (broadcasting) {
      modeSelect.style.display = "none";
      viewerWaiting.style.display = "flex";
      connectSignal("viewer");
      return;
    }

    var isHost = !!localStorage.getItem("openclaw.device.auth.v1");
    console.log("[oc-live] isHost:", isHost, "(openclaw.device.auth.v1", isHost ? "found" : "missing", ")");

    if (isHost) {
      $("oc-mode-label").textContent = "选择模式";
      $("oc-host-actions").style.display = "flex";
      $("oc-btn-settings").style.display = "flex";
    } else {
      modeSelect.style.display = "none";
      viewerWaiting.style.display = "flex";
      connectSignal("viewer");
    }
  })();

})();
