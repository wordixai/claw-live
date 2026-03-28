/**
 * OpenClaw Assist Overlay (Agora RTC Edition)
 *
 * Host: shares screen via Agora → helpers see it
 * Helper: joins Agora channel → receives host's screen
 * Both sides get a simple text chat via REST API + SSE.
 */
(function () {
  "use strict";

  if (document.getElementById("oc-assist-overlay")) return;

  // ── Agora SDK loader ──

  var agoraReady = new Promise(function (resolve, reject) {
    if (window.AgoraRTC) { resolve(window.AgoraRTC); return; }
    var s = document.createElement("script");
    // Load from same origin (injected alongside overlay) to avoid CSP / network issues
    s.src = "./AgoraRTC_N.js";
    s.onload = function () { resolve(window.AgoraRTC); };
    s.onerror = function () { reject(new Error("Failed to load Agora SDK")); };
    document.head.appendChild(s);
  });

  // ── State ──

  var role = null;           // "host" | "helper" | null
  var agoraClient = null;
  var localScreenTrack = null;
  var localAudioTrack = null;  // system audio from screen share
  var localMicTrack = null;
  var isMicOn = false;
  var isSharing = false;
  var startedAt = null;
  var durationTimer = null;
  var sessionData = null;
  var agoraCredentials = null; // { appId, token, channel } from server API

  // ── Config ──

  var CFG_KEY = "oc-assist-config";
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
  }
  function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  function getApiBase() {
    return location.protocol + "//" + location.host;
  }

  // ── Inline CSS ──

  var style = document.createElement("style");
  style.textContent = `
#oc-assist-overlay{
  --oc-bg:#ffffff; --oc-bg-alt:#f7f8fa; --oc-surface:#f0f1f3;
  --oc-border:#e2e4e9; --oc-border-h:#c8cbd1;
  --oc-text:#1a1d23; --oc-text-2:#5f6672; --oc-text-3:#9199a5;
  --oc-accent:#0097a7; --oc-accent-g:linear-gradient(135deg,#0097a7,#00838f);
  --oc-danger:#e53935; --oc-green:#2e7d32;
  --oc-radius:14px; --oc-radius-sm:8px; --oc-radius-pill:100px;
  --oc-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Helvetica Neue",sans-serif;
  --oc-fast:150ms cubic-bezier(.4,0,.2,1);
  --oc-norm:250ms cubic-bezier(.4,0,.2,1);
}
#oc-assist-overlay{
  position:fixed;bottom:24px;right:24px;width:380px;height:520px;min-width:300px;min-height:400px;
  z-index:99999;border-radius:var(--oc-radius);overflow:hidden;
  background:var(--oc-bg);
  box-shadow:0 8px 32px rgba(0,0,0,0.12),0 0 0 1px var(--oc-border);
  font-family:var(--oc-font);font-size:13px;color:var(--oc-text);
  display:flex;flex-direction:column;user-select:none;
  animation:oc-slide-in var(--oc-norm) both;
}
@keyframes oc-slide-in{from{opacity:0;transform:translateY(12px) scale(.97);}to{opacity:1;transform:none;}}
#oc-assist-overlay.oc-minimized{width:220px!important;height:42px!important;min-height:42px;border-radius:var(--oc-radius-pill);}
#oc-assist-overlay.oc-minimized .oc-body,
#oc-assist-overlay.oc-minimized .oc-chat-panel{display:none;}
#oc-assist-overlay.oc-fullscreen{top:0!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;border-radius:0;}
#oc-assist-overlay.oc-hidden{display:none;animation:none;}

.oc-header{
  display:flex;align-items:center;gap:10px;
  padding:0 16px;height:46px;min-height:46px;
  background:var(--oc-bg);border-bottom:1px solid var(--oc-border);
  cursor:move;flex-shrink:0;
}
#oc-assist-overlay.oc-minimized .oc-header{border-bottom:none;}
.oc-dot{width:8px;height:8px;border-radius:50%;background:#c8cbd1;flex-shrink:0;transition:all var(--oc-norm);}
.oc-dot.oc-on{background:var(--oc-accent);box-shadow:0 0 8px var(--oc-accent);animation:oc-pulse 2s ease-in-out infinite;}
@keyframes oc-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(.85);}}
.oc-title{flex:1;font-size:13px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oc-controls{display:flex;gap:2px;flex-shrink:0;}
.oc-btn{
  width:30px;height:30px;border:none;background:transparent;border-radius:var(--oc-radius-sm);
  color:var(--oc-text-3);font-size:14px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all var(--oc-fast);padding:0;
}
.oc-btn:hover{background:var(--oc-surface);color:var(--oc-text);}
.oc-btn:active{transform:scale(.9);}

.oc-body{flex:1;position:relative;overflow:hidden;background:var(--oc-bg-alt);}
#oc-video-container{width:100%;height:100%;background:#1a1d23;display:none;}
#oc-video-container video,#oc-video-container div{width:100%!important;height:100%!important;object-fit:contain!important;}

.oc-placeholder{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:16px;
  background:var(--oc-bg-alt);z-index:1;padding:24px;
}
.oc-start-btn{
  width:100%;max-width:260px;height:44px;border:none;border-radius:var(--oc-radius-sm);
  background:var(--oc-accent-g);color:#fff;
  font-size:14px;font-weight:600;cursor:pointer;transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-start-btn:hover{opacity:.88;transform:translateY(-1px);}
.oc-start-btn:active{transform:translateY(0) scale(.98);}
.oc-join-section{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;max-width:260px;}
.oc-divider{width:80%;height:1px;background:var(--oc-border);margin:4px 0;}
.oc-divider-text{font-size:11px;color:var(--oc-text-3);margin:-4px 0;}
.oc-join-row{display:flex;gap:8px;width:100%;}
.oc-join-input{
  flex:1;height:40px;border:2px solid var(--oc-border);border-radius:var(--oc-radius-sm);
  background:#fff;color:var(--oc-text);font-size:18px;font-weight:700;
  letter-spacing:3px;text-align:center;text-transform:uppercase;
  font-family:"SF Mono",Monaco,"Cascadia Code",monospace;
  outline:none;transition:border-color var(--oc-fast);
}
.oc-join-input:focus{border-color:var(--oc-accent);}
.oc-join-btn{
  height:40px;padding:0 16px;border:none;border-radius:var(--oc-radius-sm);
  background:var(--oc-accent-g);color:#fff;font-size:13px;font-weight:600;
  cursor:pointer;transition:all var(--oc-fast);font-family:var(--oc-font);white-space:nowrap;
}
.oc-join-btn:hover{opacity:.88;}
.oc-join-error{font-size:11px;color:var(--oc-danger);display:none;}

.oc-session-panel{
  position:absolute;inset:0;display:none;flex-direction:column;
  align-items:center;justify-content:flex-start;gap:0;
  background:var(--oc-bg-alt);z-index:2;padding:16px 20px;overflow-y:auto;
}
.oc-session-status{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--oc-text-2);margin-bottom:12px;}
.oc-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.oc-status-dot.oc-waiting{background:#f59e0b;animation:oc-pulse 2s ease-in-out infinite;}
.oc-status-dot.oc-connected{background:var(--oc-green);box-shadow:0 0 6px rgba(46,125,50,0.4);}
.oc-code-box{
  display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:16px;border-radius:var(--oc-radius);
  background:#fff;border:1px solid var(--oc-border);width:100%;margin-bottom:12px;
}
.oc-code-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:var(--oc-text-3);}
.oc-code{
  font-size:24px;font-weight:800;letter-spacing:5px;color:var(--oc-text);
  font-family:"SF Mono",Monaco,"Cascadia Code",monospace;user-select:all;
}
.oc-link-row{display:flex;align-items:center;gap:8px;width:100%;}
.oc-link-input{
  flex:1;height:30px;border:1px solid var(--oc-border);border-radius:var(--oc-radius-sm);
  background:var(--oc-surface);color:var(--oc-text-2);font-size:11px;
  padding:0 10px;outline:none;font-family:var(--oc-font);
}
.oc-copy-btn{
  height:30px;padding:0 10px;border:1px solid var(--oc-border);border-radius:var(--oc-radius-sm);
  background:#fff;color:var(--oc-text-2);font-size:11px;font-weight:600;
  cursor:pointer;transition:all var(--oc-fast);white-space:nowrap;font-family:var(--oc-font);
}
.oc-copy-btn:hover{background:var(--oc-surface);color:var(--oc-text);}
.oc-copy-btn.oc-copied{background:rgba(46,125,50,0.08);color:var(--oc-green);border-color:rgba(46,125,50,0.3);}
.oc-hint{font-size:11px;color:var(--oc-text-3);text-align:center;line-height:1.4;margin-bottom:12px;}
.oc-share-btn{
  width:100%;height:40px;border:none;border-radius:var(--oc-radius-sm);
  background:var(--oc-accent-g);color:#fff;font-size:13px;font-weight:600;
  cursor:pointer;transition:all var(--oc-fast);font-family:var(--oc-font);margin-bottom:12px;
}
.oc-share-btn:hover{opacity:.88;transform:translateY(-1px);}
.oc-end-btn{
  height:30px;padding:0 16px;border:1px solid rgba(229,57,53,0.2);border-radius:var(--oc-radius-pill);
  background:rgba(229,57,53,0.06);color:var(--oc-danger);
  font-size:11px;font-weight:600;cursor:pointer;transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-end-btn:hover{background:rgba(229,57,53,0.12);border-color:rgba(229,57,53,0.35);}

.oc-badge{
  position:absolute;top:10px;left:10px;z-index:4;
  padding:4px 10px;border-radius:var(--oc-radius-pill);
  background:rgba(0,151,167,0.9);color:#fff;
  font-size:11px;font-weight:600;display:none;align-items:center;gap:5px;
  box-shadow:0 2px 8px rgba(0,0,0,0.08);
}
.oc-badge-dot{width:6px;height:6px;border-radius:50%;background:#fff;animation:oc-pulse 2s ease-in-out infinite;}
.oc-end-overlay-btn{
  position:absolute;top:10px;right:10px;z-index:4;
  padding:4px 10px;border:none;border-radius:var(--oc-radius-pill);
  background:rgba(255,255,255,0.92);backdrop-filter:blur(12px);
  color:var(--oc-text-2);font-size:11px;font-weight:600;cursor:pointer;
  transition:all var(--oc-fast);box-shadow:0 2px 8px rgba(0,0,0,0.08);display:none;
}
.oc-end-overlay-btn:hover{background:#fff;color:var(--oc-text);}

.oc-media-bar{
  position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:4;
  display:none;align-items:center;gap:8px;
  padding:6px 10px;border-radius:var(--oc-radius-pill);
  background:rgba(0,0,0,0.55);backdrop-filter:blur(12px);
  box-shadow:0 2px 12px rgba(0,0,0,0.15);
}
.oc-media-btn{
  width:36px;height:36px;border:none;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:all var(--oc-fast);padding:0;
  color:#fff;background:rgba(255,255,255,0.15);
}
.oc-media-btn:hover{background:rgba(255,255,255,0.25);}
.oc-media-btn.oc-active{background:var(--oc-accent);}
.oc-media-btn.oc-mic-off{background:var(--oc-danger);}
.oc-media-btn.oc-mic-off:hover{background:#c62828;}

.oc-waiting-state{display:none;flex-direction:column;align-items:center;gap:10px;}
.oc-spinner{width:28px;height:28px;border:2.5px solid var(--oc-border);border-top-color:var(--oc-accent);border-radius:50%;animation:oc-spin .8s linear infinite;}
@keyframes oc-spin{to{transform:rotate(360deg);}}

.oc-chat-panel{
  display:flex;flex-direction:column;flex-shrink:0;
  border-top:1px solid var(--oc-border);background:var(--oc-bg);
  height:160px;min-height:40px;transition:height var(--oc-fast);overflow:hidden;
}
.oc-chat-panel.oc-collapsed{height:40px;}
.oc-chat-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 16px;height:40px;min-height:40px;flex-shrink:0;cursor:pointer;
}
.oc-chat-label{font-size:12px;font-weight:700;color:var(--oc-text);letter-spacing:.3px;}
.oc-chat-toggle{
  width:24px;height:24px;border:none;background:transparent;border-radius:var(--oc-radius-sm);
  color:var(--oc-text-3);cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all var(--oc-fast);padding:0;font-size:12px;
}
.oc-chat-toggle:hover{background:var(--oc-surface);color:var(--oc-text);}
.oc-chat-panel.oc-collapsed .oc-chat-toggle{transform:rotate(180deg);}
.oc-chat-list{flex:1;overflow-y:auto;padding:0 12px 8px;scrollbar-width:thin;scrollbar-color:var(--oc-border) transparent;}
.oc-chat-list::-webkit-scrollbar{width:4px;}
.oc-chat-list::-webkit-scrollbar-thumb{background:var(--oc-border);border-radius:2px;}
.oc-chat-item{display:flex;align-items:flex-start;gap:8px;padding:3px 0;animation:oc-chat-in var(--oc-fast) both;}
@keyframes oc-chat-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
.oc-chat-avatar{
  width:24px;height:24px;border-radius:50%;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;color:#fff;background:var(--oc-text-3);
}
.oc-chat-body{flex:1;min-width:0;}
.oc-chat-meta{display:flex;align-items:baseline;gap:6px;}
.oc-chat-sender{font-size:11px;font-weight:600;color:var(--oc-text-2);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.oc-chat-time{font-size:9px;color:var(--oc-text-3);font-variant-numeric:tabular-nums;}
.oc-chat-text{font-size:12px;color:var(--oc-text);line-height:1.4;word-break:break-word;margin-top:1px;}
.oc-chat-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--oc-text-3);font-size:11px;}
.oc-chat-input-row{
  display:flex;align-items:center;gap:6px;padding:6px 12px;
  border-top:1px solid var(--oc-border);flex-shrink:0;
}
.oc-chat-input{
  flex:1;height:34px;border:1.5px solid transparent;border-radius:var(--oc-radius-pill);
  background:var(--oc-surface);color:var(--oc-text);font-size:13px;padding:0 16px;
  outline:none;font-family:var(--oc-font);transition:all var(--oc-fast);
}
.oc-chat-input:focus{background:#fff;border-color:rgba(0,151,167,0.35);box-shadow:0 0 0 3px rgba(0,151,167,0.08);}
.oc-chat-input::placeholder{color:var(--oc-text-3);}
.oc-chat-send{
  height:34px;padding:0 14px;border:none;border-radius:var(--oc-radius-pill);
  background:var(--oc-accent);color:#fff;font-size:13px;font-weight:600;
  cursor:pointer;flex-shrink:0;transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-chat-send:hover{opacity:.88;}
.oc-chat-send:active{transform:scale(.97);}
.oc-chat-panel.oc-collapsed .oc-chat-input-row{display:none;}

.oc-resize{position:absolute;top:2px;left:2px;width:22px;height:22px;cursor:nw-resize;z-index:10;}
.oc-resize::after{content:"";position:absolute;top:5px;left:5px;width:8px;height:8px;border-top:2px solid var(--oc-border);border-left:2px solid var(--oc-border);border-radius:1px 0 0 0;transition:border-color var(--oc-fast);}
.oc-resize:hover::after{border-color:var(--oc-border-h);}

#oc-assist-toggle{
  position:fixed;bottom:24px;right:24px;width:46px;height:46px;
  border-radius:50%;border:none;
  background:#fff;color:var(--oc-text-2,#5f6672);font-size:18px;
  cursor:pointer;z-index:99998;
  box-shadow:0 2px 12px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.06);
  display:none;align-items:center;justify-content:center;
  transition:transform var(--oc-fast),color var(--oc-fast),box-shadow var(--oc-fast);
}
#oc-assist-toggle:hover{color:var(--oc-accent);box-shadow:0 4px 20px rgba(0,0,0,0.14),0 0 0 1px rgba(0,151,167,0.3);}
#oc-assist-toggle.oc-visible{display:flex;animation:oc-fab-in var(--oc-norm) both;}
@keyframes oc-fab-in{from{opacity:0;transform:scale(.5);}to{opacity:1;transform:scale(1);}}

.oc-settings{
  position:absolute;inset:0;background:rgba(255,255,255,0.97);backdrop-filter:blur(16px);
  z-index:5;padding:24px;display:none;flex-direction:column;gap:16px;overflow-y:auto;
}
.oc-settings-title{font-size:14px;font-weight:700;color:var(--oc-text);}
.oc-settings-label{display:flex;flex-direction:column;gap:6px;color:var(--oc-text-2);font-size:11px;letter-spacing:.8px;text-transform:uppercase;font-weight:600;}
.oc-settings-input{
  height:36px;border:1px solid var(--oc-border);border-radius:var(--oc-radius-sm);
  background:#fff;color:var(--oc-text);font-size:13px;padding:0 14px;outline:none;
  transition:all var(--oc-fast);font-family:var(--oc-font);
}
.oc-settings-input:focus{border-color:rgba(0,151,167,0.35);box-shadow:0 0 0 3px rgba(0,151,167,0.06);}
.oc-settings-actions{display:flex;gap:10px;margin-top:8px;}
.oc-settings-save,.oc-settings-cancel{
  flex:1;height:36px;border-radius:var(--oc-radius-sm);font-size:12px;font-weight:600;
  cursor:pointer;transition:all var(--oc-fast);border:1px solid transparent;font-family:var(--oc-font);
}
.oc-settings-save{background:var(--oc-accent-g);color:#fff;border:none;}
.oc-settings-save:hover{opacity:.88;}
.oc-settings-cancel{background:var(--oc-surface);color:var(--oc-text-2);border-color:var(--oc-border);}
.oc-settings-cancel:hover{background:var(--oc-border);}

@media (prefers-reduced-motion: reduce){
  #oc-assist-overlay{animation:none;}
  .oc-dot.oc-on,.oc-status-dot.oc-waiting,.oc-badge-dot,.oc-spinner{animation:none!important;}
  #oc-assist-toggle.oc-visible{animation:none;}
}
`;
  document.head.appendChild(style);

  // ── Build DOM ──

  var overlay = document.createElement("div");
  overlay.id = "oc-assist-overlay";
  overlay.innerHTML = `
    <div class="oc-resize" id="oc-resize"></div>
    <div class="oc-header" id="oc-drag">
      <span class="oc-dot" id="oc-dot"></span>
      <span class="oc-title" id="oc-title">远程协助</span>
      <div class="oc-controls">
        <button class="oc-btn" id="oc-btn-settings" title="设置"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></button>
        <button class="oc-btn" id="oc-btn-min" title="最小化"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        <button class="oc-btn" id="oc-btn-fs" title="全屏"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
        <button class="oc-btn" id="oc-btn-close" title="隐藏"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>
    <div class="oc-body" id="oc-body">
      <div id="oc-video-container"></div>
      <div class="oc-placeholder" id="oc-placeholder">
        <button class="oc-start-btn" id="oc-btn-start">发起协助</button>
        <div class="oc-divider"></div>
        <span class="oc-divider-text">或输入会话码加入</span>
        <div class="oc-join-section">
          <div class="oc-join-row">
            <input class="oc-join-input" id="oc-join-code" maxlength="6" placeholder="会话码" />
            <button class="oc-join-btn" id="oc-btn-join">加入</button>
          </div>
          <span class="oc-join-error" id="oc-join-error">会话码无效或已过期</span>
        </div>
      </div>
      <div class="oc-session-panel" id="oc-session-panel">
        <div class="oc-session-status" id="oc-session-status">
          <span class="oc-status-dot oc-waiting" id="oc-session-dot"></span>
          <span id="oc-session-text">等待协助者加入</span>
        </div>
        <div class="oc-code-box">
          <span class="oc-code-label">会话码</span>
          <span class="oc-code" id="oc-session-code">------</span>
          <div class="oc-link-row">
            <input class="oc-link-input" id="oc-session-link" readonly />
            <button class="oc-copy-btn" id="oc-copy-link">复制链接</button>
          </div>
        </div>
        <span class="oc-hint">把会话码或链接发给协助者<br/>对方打开后即可加入</span>
        <button class="oc-share-btn" id="oc-btn-share-screen">共享屏幕给协助者</button>
        <button class="oc-end-btn" id="oc-btn-end-session">结束会话</button>
      </div>
      <div class="oc-waiting-state" id="oc-waiting">
        <div class="oc-spinner"></div>
        <span style="color:var(--oc-text-2);font-size:12px;font-weight:500;">正在连接…</span>
      </div>
      <div class="oc-badge" id="oc-badge"><span class="oc-badge-dot"></span><span id="oc-badge-text">协助中</span></div>
      <div class="oc-media-bar" id="oc-media-bar">
        <button class="oc-media-btn" id="oc-btn-mic" title="开启麦克风"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
      </div>
      <button class="oc-end-overlay-btn" id="oc-btn-end-overlay">结束</button>
      <div class="oc-settings" id="oc-settings">
        <div class="oc-settings-title">设置</div>
        <div style="color:var(--oc-text-2);font-size:12px;line-height:1.6;">Agora 凭据由服务端管理，无需手动配置。</div>
        <div class="oc-settings-actions">
          <button class="oc-settings-cancel" id="oc-cfg-cancel">关闭</button>
        </div>
      </div>
    </div>
    <div class="oc-chat-panel" id="oc-chat-panel">
      <div class="oc-chat-header" id="oc-chat-header">
        <span class="oc-chat-label">聊天</span>
        <button class="oc-chat-toggle" id="oc-chat-toggle"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></button>
      </div>
      <div class="oc-chat-list" id="oc-chat-list">
        <div class="oc-chat-empty" id="oc-chat-empty">暂无消息</div>
      </div>
      <div class="oc-chat-input-row">
        <input class="oc-chat-input" id="oc-chat-input" placeholder="输入消息…" />
        <button class="oc-chat-send" id="oc-chat-send">发送</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  var toggleBtn = document.createElement("button");
  toggleBtn.id = "oc-assist-toggle";
  toggleBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  toggleBtn.title = "远程协助";
  document.body.appendChild(toggleBtn);

  // ── Element refs ──

  var $ = function (id) { return document.getElementById(id); };
  var dot = $("oc-dot");
  var titleEl = $("oc-title");
  var videoContainer = $("oc-video-container");
  var placeholder = $("oc-placeholder");
  var sessionPanel = $("oc-session-panel");
  var sessionCode = $("oc-session-code");
  var sessionLink = $("oc-session-link");
  var sessionDot = $("oc-session-dot");
  var sessionText = $("oc-session-text");
  var waitingState = $("oc-waiting");
  var badge = $("oc-badge");
  var badgeText = $("oc-badge-text");
  var endOverlayBtn = $("oc-btn-end-overlay");
  var joinError = $("oc-join-error");
  var joinCodeInput = $("oc-join-code");
  var settingsPanel = $("oc-settings");
  var mediaBar = $("oc-media-bar");
  var micBtn = $("oc-btn-mic");
  var chatPanel = $("oc-chat-panel");
  var chatList = $("oc-chat-list");
  var chatEmpty = $("oc-chat-empty");
  var chatInput = $("oc-chat-input");

  // ── Init settings ──
  (function () {
    loadConfig();
  })();

  // ══════════════════════════════════
  //  Agora RTC — Host (screen share)
  // ══════════════════════════════════

  async function agoraShareScreen() {
    if (!agoraCredentials || !agoraCredentials.appId) throw new Error("Agora 未配置，请在服务端设置 AGORA_APP_ID 和 AGORA_APP_CERTIFICATE 环境变量");
    var AgoraRTC = await agoraReady;
    AgoraRTC.setLogLevel(3); // warnings only

    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    await agoraClient.join(agoraCredentials.appId, agoraCredentials.channel, agoraCredentials.token, null);

    localScreenTrack = await AgoraRTC.createScreenVideoTrack(
      { encoderConfig: "1080p_2" },
      "auto"
    );

    // createScreenVideoTrack with "auto" may return [videoTrack, audioTrack]
    if (Array.isArray(localScreenTrack)) {
      localAudioTrack = localScreenTrack[1];
      localScreenTrack = localScreenTrack[0];
    }

    var tracksToPublish = [localScreenTrack];
    if (localAudioTrack) tracksToPublish.push(localAudioTrack);
    await agoraClient.publish(tracksToPublish);

    localScreenTrack.on("track-ended", function () { endSession(); });

    localScreenTrack.play(videoContainer);
    videoContainer.style.display = "block";
    isSharing = true;
    role = "host";
    startedAt = Date.now();

    sessionPanel.style.display = "none";
    placeholder.style.display = "none";
    updateUI();
    appendChat("系统", "屏幕共享已开始（通过 Agora）");
  }

  // ══════════════════════════════════
  //  Agora RTC — Helper (view screen)
  // ══════════════════════════════════

  async function agoraJoinAsViewer() {
    if (!agoraCredentials || !agoraCredentials.appId) throw new Error("Agora 未配置，请在服务端设置 AGORA_APP_ID 和 AGORA_APP_CERTIFICATE 环境变量");
    var AgoraRTC = await agoraReady;
    AgoraRTC.setLogLevel(3);

    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    agoraClient.on("user-published", async function (user, mediaType) {
      await agoraClient.subscribe(user, mediaType);
      if (mediaType === "video") {
        videoContainer.innerHTML = "";
        user.videoTrack.play(videoContainer);
        videoContainer.style.display = "block";
        waitingState.style.display = "none";
        placeholder.style.display = "none";
        isSharing = true;
        startedAt = startedAt || Date.now();
        updateUI();
        appendChat("系统", "已连接，正在查看对方屏幕");
      }
      if (mediaType === "audio") {
        user.audioTrack.play();
      }
    });

    agoraClient.on("user-unpublished", function (user, mediaType) {
      if (mediaType === "video") {
        videoContainer.innerHTML = "";
        videoContainer.style.display = "none";
        isSharing = false;
        updateUI();
        waitingState.querySelector("span").textContent = "对方已停止共享屏幕";
        waitingState.style.display = "flex";
      }
    });

    agoraClient.on("user-left", function () {
      videoContainer.innerHTML = "";
      videoContainer.style.display = "none";
      isSharing = false;
      updateUI();
      waitingState.querySelector("span").textContent = "协助会话已结束";
      waitingState.style.display = "flex";
      appendChat("系统", "对方已离开");
    });

    await agoraClient.join(agoraCredentials.appId, agoraCredentials.channel, agoraCredentials.token, null);
    role = "helper";
    updateUI();
  }

  // ══════════════════════════════════
  //  Microphone toggle (both sides)
  // ══════════════════════════════════

  var MIC_ON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var MIC_OFF_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  async function toggleMic() {
    if (!agoraClient) return;

    if (isMicOn && localMicTrack) {
      await agoraClient.unpublish(localMicTrack);
      localMicTrack.close();
      localMicTrack = null;
      isMicOn = false;
      micBtn.innerHTML = MIC_ON_SVG;
      micBtn.classList.remove("oc-active");
      micBtn.classList.remove("oc-mic-off");
      micBtn.title = "开启麦克风";
      appendChat("系统", "麦克风已关闭");
    } else {
      try {
        var AgoraRTC = await agoraReady;
        localMicTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish(localMicTrack);
        isMicOn = true;
        micBtn.innerHTML = MIC_ON_SVG;
        micBtn.classList.add("oc-active");
        micBtn.classList.remove("oc-mic-off");
        micBtn.title = "关闭麦克风";
        appendChat("系统", "麦克风已开启");
      } catch (err) {
        micBtn.innerHTML = MIC_OFF_SVG;
        micBtn.classList.add("oc-mic-off");
        micBtn.classList.remove("oc-active");
        appendChat("系统", "麦克风打开失败: " + err.message);
      }
    }
  }

  // ══════════════════════════════════
  //  Session Logic (REST API)
  // ══════════════════════════════════

  async function createSession() {
    var base = getApiBase();
    try {
      var res = await fetch(base + "/live/api/assist/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      var data = await res.json();
      if (!data.ok) { alert("创建协助会话失败"); return; }
      sessionData = data.session;
      agoraCredentials = data.agora || null;
      placeholder.style.display = "none";
      sessionPanel.style.display = "flex";
      sessionCode.textContent = data.session.code;
      sessionLink.value = data.joinUrl;
      titleEl.textContent = "远程协助";
      dot.className = "oc-dot oc-on";
    } catch (err) {
      alert("创建协助会话失败: " + err.message);
    }
  }

  async function shareScreen() {
    if (!sessionData) return;
    try {
      await agoraShareScreen();
    } catch (err) {
      if (err.name !== "AbortError" && err.name !== "NotAllowedError") {
        alert("屏幕共享失败: " + err.message);
      }
    }
  }

  async function endSession() {
    var base = getApiBase();
    try { await fetch(base + "/live/api/assist/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}

    if (localScreenTrack) { localScreenTrack.close(); localScreenTrack = null; }
    if (localAudioTrack) { localAudioTrack.close(); localAudioTrack = null; }
    if (localMicTrack) { localMicTrack.close(); localMicTrack = null; }
    isMicOn = false;
    if (agoraClient) {
      try { await agoraClient.leave(); } catch {}
      agoraClient = null;
    }

    videoContainer.innerHTML = "";
    videoContainer.style.display = "none";
    isSharing = false;
    startedAt = null;
    role = null;
    sessionData = null;
    agoraCredentials = null;
    if (durationTimer) clearInterval(durationTimer);
    sessionPanel.style.display = "none";
    waitingState.style.display = "none";
    placeholder.style.display = "flex";
    updateUI();
  }

  async function joinByCode(code) {
    var base = getApiBase();
    try {
      var res = await fetch(base + "/live/api/assist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.toUpperCase() }),
      });
      var data = await res.json();
      if (!data.ok) { joinError.style.display = "block"; return; }
      joinError.style.display = "none";
      sessionData = data.session;
      agoraCredentials = data.agora || null;
      titleEl.textContent = "远程协助";
      placeholder.style.display = "none";
      waitingState.querySelector("span").textContent = "正在连接…";
      waitingState.style.display = "flex";

      await agoraJoinAsViewer();
    } catch (err) {
      joinError.textContent = "连接失败: " + err.message;
      joinError.style.display = "block";
    }
  }

  // ── UI ──

  function updateUI() {
    var inSession = isSharing || (agoraClient && role);
    dot.className = "oc-dot" + (isSharing ? " oc-on" : "");
    badge.style.display = isSharing ? "flex" : "none";
    endOverlayBtn.style.display = isSharing ? "block" : "none";
    endOverlayBtn.textContent = role === "host" ? "结束会话" : "离开";
    mediaBar.style.display = inSession ? "flex" : "none";
    if (!inSession) {
      micBtn.innerHTML = MIC_ON_SVG;
      micBtn.classList.remove("oc-active", "oc-mic-off");
      micBtn.title = "开启麦克风";
    }
    if (isSharing) {
      startDurationTimer();
    } else {
      titleEl.textContent = "远程协助";
      if (durationTimer) clearInterval(durationTimer);
    }
  }

  function startDurationTimer() {
    if (durationTimer) clearInterval(durationTimer);
    var tick = function () {
      if (!startedAt) return;
      var s = Math.floor((Date.now() - startedAt) / 1000);
      var m = String(Math.floor(s / 60)).padStart(2, "0");
      var sec = String(s % 60).padStart(2, "0");
      badgeText.textContent = "协助中 " + m + ":" + sec;
    };
    tick();
    durationTimer = setInterval(tick, 1000);
  }

  // ── Chat ──

  var AVATAR_COLORS = ["#0097a7","#1976d2","#2e7d32","#f57c00","#7b1fa2","#00838f","#c62828","#283593","#558b2f","#4e342e"];
  function avatarColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function appendChat(sender, text) {
    if (chatEmpty.style.display !== "none") chatEmpty.style.display = "none";
    var item = document.createElement("div");
    item.className = "oc-chat-item";
    var initial = (sender || "?")[0].toUpperCase();
    var bg = avatarColor(sender || "?");
    var now = new Date();
    var ts = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
    item.innerHTML =
      '<div class="oc-chat-avatar" style="background:' + bg + '">' + initial + '</div>' +
      '<div class="oc-chat-body">' +
        '<div class="oc-chat-meta"><span class="oc-chat-sender">' + (sender || "匿名") + '</span><span class="oc-chat-time">' + ts + '</span></div>' +
        '<div class="oc-chat-text">' + text.replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</div>' +
      '</div>';
    chatList.appendChild(item);
    while (chatList.children.length > 101) chatList.removeChild(chatList.children[1]);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function sendChat() {
    var text = chatInput.value.trim();
    if (!text) return;
    var sender = role === "host" ? "主机" : "协助者";
    appendChat(sender, text);
    fetch(getApiBase() + "/live/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, sender: sender }),
    }).catch(function () {});
    chatInput.value = "";
  }

  function connectChatSSE() {
    var es = new EventSource(getApiBase() + "/live/api/events");
    es.addEventListener("chat", function (e) {
      try {
        var msg = JSON.parse(e.data);
        var mySender = role === "host" ? "主机" : "协助者";
        if (msg.sender !== mySender) appendChat(msg.sender, msg.text);
      } catch {}
    });
  }

  // ── Event Listeners ──

  $("oc-btn-start").addEventListener("click", createSession);
  $("oc-btn-share-screen").addEventListener("click", shareScreen);
  $("oc-btn-end-session").addEventListener("click", endSession);
  endOverlayBtn.addEventListener("click", endSession);
  micBtn.addEventListener("click", toggleMic);

  $("oc-btn-join").addEventListener("click", function () {
    var code = joinCodeInput.value.trim();
    if (code.length >= 4) joinByCode(code);
  });
  joinCodeInput.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { var code = joinCodeInput.value.trim(); if (code.length >= 4) joinByCode(code); }
  });
  joinCodeInput.addEventListener("keyup", function (e) { e.stopPropagation(); });

  $("oc-copy-link").addEventListener("click", function () {
    var link = sessionLink.value;
    if (!link) return;
    var btn = $("oc-copy-link");
    navigator.clipboard.writeText(link).then(function () {
      btn.textContent = "已复制"; btn.classList.add("oc-copied");
      setTimeout(function () { btn.textContent = "复制链接"; btn.classList.remove("oc-copied"); }, 2000);
    }).catch(function () {
      sessionLink.select(); document.execCommand("copy");
      btn.textContent = "已复制"; btn.classList.add("oc-copied");
      setTimeout(function () { btn.textContent = "复制链接"; btn.classList.remove("oc-copied"); }, 2000);
    });
  });

  $("oc-chat-send").addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") sendChat(); });
  chatInput.addEventListener("keyup", function (e) { e.stopPropagation(); });
  $("oc-chat-header").addEventListener("click", function () { chatPanel.classList.toggle("oc-collapsed"); });

  $("oc-btn-settings").addEventListener("click", function () {
    settingsPanel.style.display = settingsPanel.style.display === "flex" ? "none" : "flex";
  });
  $("oc-cfg-cancel").addEventListener("click", function () {
    settingsPanel.style.display = "none";
  });

  $("oc-btn-min").addEventListener("click", function () { overlay.classList.toggle("oc-minimized"); });
  $("oc-btn-fs").addEventListener("click", function () { overlay.classList.toggle("oc-fullscreen"); });
  $("oc-btn-close").addEventListener("click", function () {
    overlay.classList.add("oc-hidden"); toggleBtn.classList.add("oc-visible");
  });
  toggleBtn.addEventListener("click", function () {
    overlay.classList.remove("oc-hidden"); toggleBtn.classList.remove("oc-visible");
  });

  // ── Drag ──
  (function () {
    var handle = $("oc-drag"), dragging = false, sx, sy, sl, st;
    function start(cx, cy, e) {
      if (e.target.closest(".oc-btn,.oc-controls")) return;
      dragging = true; var r = overlay.getBoundingClientRect();
      sx = cx; sy = cy; sl = r.left; st = r.top;
      overlay.style.transition = "none"; e.preventDefault();
    }
    function move(cx, cy) { if (!dragging) return; overlay.style.left = (sl + cx - sx) + "px"; overlay.style.top = (st + cy - sy) + "px"; overlay.style.right = "auto"; overlay.style.bottom = "auto"; }
    function end() { if (dragging) { dragging = false; overlay.style.transition = ""; } }
    handle.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY, e); });
    document.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
    document.addEventListener("mouseup", end);
    handle.addEventListener("touchstart", function (e) { var t = e.touches[0]; start(t.clientX, t.clientY, e); }, { passive: false });
    document.addEventListener("touchmove", function (e) { if (!dragging) return; var t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener("touchend", end);
  })();

  // ── Resize ──
  (function () {
    var handle = $("oc-resize"), resizing = false, sx, sy, sw, sh, sl, st;
    function start(cx, cy, e) { resizing = true; var r = overlay.getBoundingClientRect(); sx = cx; sy = cy; sw = r.width; sh = r.height; sl = r.left; st = r.top; overlay.style.transition = "none"; e.preventDefault(); }
    function move(cx, cy) { if (!resizing) return; var nw = Math.max(300, sw - (cx - sx)), nh = Math.max(400, sh - (cy - sy)); overlay.style.width = nw + "px"; overlay.style.height = nh + "px"; overlay.style.left = (sl + (sw - nw)) + "px"; overlay.style.top = (st + (sh - nh)) + "px"; overlay.style.right = "auto"; overlay.style.bottom = "auto"; }
    function end() { if (resizing) { resizing = false; overlay.style.transition = ""; } }
    handle.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY, e); });
    document.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
    document.addEventListener("mouseup", end);
  })();

  // ── Auto-detect: join by URL param ──
  (function () {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("assist");
    if (code && code.length >= 4) { joinByCode(code.toUpperCase()); return; }
    var isHost = !!localStorage.getItem("openclaw.device.auth.v1");
    if (!isHost) { overlay.classList.add("oc-hidden"); toggleBtn.classList.add("oc-visible"); }
  })();

  connectChatSSE();

})();
