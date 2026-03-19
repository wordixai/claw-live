/**
 * OpenClaw Live Stream — Service Worker
 *
 * Intercepts all responses from the Gateway and strips
 * restrictive security headers so that camera/mic and
 * iframe embedding work on the original port.
 */

const HEADERS_TO_REMOVE = ["x-frame-options"];
const POLICY_OVERRIDES = {
  "permissions-policy": "camera=(self), microphone=(self), display-capture=(self)",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.mode === "navigate" || req.destination === "document" || req.destination === "") {
    event.respondWith(proxyAndStrip(req));
    return;
  }
});

async function proxyAndStrip(request) {
  const response = await fetch(request);
  const headers = new Headers(response.headers);

  for (const h of HEADERS_TO_REMOVE) {
    headers.delete(h);
  }

  for (const [k, v] of Object.entries(POLICY_OVERRIDES)) {
    headers.set(k, v);
  }

  let csp = headers.get("content-security-policy");
  if (csp) {
    csp = csp.replace(/frame-ancestors\s+[^;]*(;|$)/gi, "");
    headers.set("content-security-policy", csp);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
