/* Service Worker bootstrap + WS auth interceptor */
(function(){
  /* ── Register SW to strip CSP on navigation responses ── */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then(function(reg) {
      if (navigator.serviceWorker.controller) return; /* already controlling */

      /* Wait for the new SW to activate, then reload so CSP is stripped */
      function waitAndReload(sw) {
        if (sw.state === "activated") { location.reload(); return; }
        sw.addEventListener("statechange", function() {
          if (sw.state === "activated") location.reload();
        });
      }

      if (reg.active) { location.reload(); return; }
      if (reg.installing) { waitAndReload(reg.installing); return; }
      if (reg.waiting)    { waitAndReload(reg.waiting); return; }

      reg.addEventListener("updatefound", function() {
        if (reg.installing) waitAndReload(reg.installing);
      });
    }).catch(function(){});
  }

  /* ── WebSocket auth hook ── */
  var W=WebSocket,d=false;window.__ocWsOk=false;
  window.WebSocket=function(u,p){
    var s=p!==void 0?new W(u,p):new W(u);
    if(!d&&u&&String(u).indexOf("/live/")<0){
      d=true;
      s.addEventListener("message",function h(e){
        try{var m=JSON.parse(e.data);if(m.type==="res"&&m.ok===true){window.__ocWsOk=true;s.removeEventListener("message",h)}}catch(x){}
      });
    }
    return s;
  };
  window.WebSocket.prototype=W.prototype;
  window.WebSocket.CONNECTING=W.CONNECTING;
  window.WebSocket.OPEN=W.OPEN;
  window.WebSocket.CLOSING=W.CLOSING;
  window.WebSocket.CLOSED=W.CLOSED;
})()
