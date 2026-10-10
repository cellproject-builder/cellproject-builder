import { randomUUID } from 'node:crypto';

const COOKIE = 'cellvisual_access';
const loopback = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
export function createLocalAccess({ now = Date.now, allowedOrigins } = {}) {
  const sessions = new Map();
  return (req, res, establish = false) => {
    if (!loopback(req.socket.remoteAddress)) return null;
    let origin;
    try {
      const host = req.headers.host;
      if (typeof host !== 'string' || /[\s/@\\]/.test(host)) return null;
      const parsed = new URL(`http://${host}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || Number(parsed.port || 80) !== req.socket.localPort) return null;
      origin = parsed.origin;
      if (allowedOrigins?.length && !allowedOrigins.includes(origin)) return null;
    } catch { return null; }
    const supplied = req.headers.origin;
    if (supplied && supplied !== origin) return null;
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return null;
    if (req.method !== 'GET' && supplied !== origin) return null;
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    const cookie = (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const session = sessions.get(cookie);
    if (session?.origin === origin) return cookie;
    if (!establish || req.method !== 'GET') return null;
    if (sessions.size >= 100) return null;
    const id = randomUUID();
    sessions.set(id, { origin, expiresAt: now() + 30 * 60_000 });
    res.setHeader('set-cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/api/visuals; Max-Age=1800`);
    return id;
  };
}
