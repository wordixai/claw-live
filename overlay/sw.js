/**
 * OpenClaw Assist — Service Worker
 *
 * ONLY intercepts top-level navigation responses (HTML pages)
 * and strips restrictive CSP / security headers so that the
 * Agora SDK can connect to its cloud servers.
 */

const HEADERS_TO_REMOVE = ["x-frame-options"];
const POLICY_OVERRIDES = {
  "permissions-policy": "camera=(self), microphone=(self), display-capture=(self)",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(proxyAndStrip(event.request));
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

  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
