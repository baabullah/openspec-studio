// Request origin checks. The server can start agents that run code, so a web
// page must never be able to talk to it. Comparing Origin with Host is not
// enough: with DNS rebinding an attacker's domain resolves to 127.0.0.1 and
// both headers carry that domain. So the Host itself must be one we serve.

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

const hostnameOf = (host: string): string | null => {
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return null; }
};

export function allowedHostnames(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = (env.ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.HOST && !['0.0.0.0', '::'].includes(env.HOST)) extra.push(env.HOST.includes(':') && !env.HOST.startsWith('[') ? `[${env.HOST}]` : env.HOST);
  return new Set([...LOOPBACK, ...extra.map((h) => hostnameOf(h)).filter((h): h is string => !!h)]);
}

/** Is this Host header one of ours (any port)? */
export function hostAllowed(host: string | null | undefined, allowed = allowedHostnames()): boolean {
  const h = host ? hostnameOf(host) : null;
  return !!h && allowed.has(h);
}

/**
 * A browser request is acceptable when its Host is ours and, if it carries an
 * Origin (browsers always do for WebSocket and cross-origin/POST requests), that
 * origin is the same host. Requests without Origin come from non-browser clients.
 */
export function requestAllowed(host: string | null | undefined, origin: string | null | undefined, allowed = allowedHostnames()): boolean {
  if (!hostAllowed(host, allowed)) return false;
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

/**
 * CSRF check for API calls. Safe methods pass. Everything else must pass
 * requestAllowed (browsers send Origin on every non-GET/HEAD request).
 * A POST must also be JSON: a page on another site can send a form or
 * text/plain POST without a CORS preflight, but not an application/json one.
 * DELETE/PATCH/PUT always need a preflight cross-origin, which we never
 * grant, so they may have no body (and so no Content-Type), as the web's
 * DELETE /api/comments/:id does.
 */
export function mutationAllowed(method: string, host: string | null | undefined, origin: string | null | undefined, contentType: string | null | undefined, allowed = allowedHostnames()): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (!requestAllowed(host, origin, allowed)) return false;
  return m !== 'POST' || !!contentType?.toLowerCase().startsWith('application/json');
}
