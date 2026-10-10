import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(value) {
  try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; }
}

function publicUrl(raw) {
  if (typeof raw !== 'string' || /[\x00-\x20\x7f]/.test(raw)) throw new Error('Invalid HTTPS URL');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Only public HTTPS on port 443 is allowed');
  if (!url.hostname || url.hostname.endsWith('.localhost') || url.hostname === 'localhost') throw new Error('Destination must be public');
  return url;
}

// DNS is validated as a complete answer set and pinned into the TLS request.
// No user cookies/authorization are forwarded, and redirects repeat validation.
export async function fetchPublicHttps(raw, { maxBytes = 1024 * 1024, signal, lookup = dnsLookup, requestImpl = https.request, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('Download timed out')), timeoutMs);
  try {
    let url = publicUrl(raw);
    for (let redirect = 0; redirect <= 3; redirect++) {
      controller.signal.throwIfAborted();
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }] : await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
      ]);
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Destination must have only public addresses');
      controller.signal.throwIfAborted();
      const address = addresses[0];
      const response = await new Promise((resolve, reject) => {
        const req = requestImpl(url, {
          method: 'GET', agent: false, maxHeaderSize: 16 * 1024,
          servername: hostname, rejectUnauthorized: true,
          headers: { accept: '*/*', 'accept-encoding': 'identity', 'user-agent': 'CellProjectReferenceGateway/1.0 (local visual references)' },
          lookup: (_host, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family),
        }, res => {
          const status = res.statusCode ?? 500;
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.destroy(); resolve({ location: res.headers.location }); return;
          }
          if (status < 200 || status >= 300) { res.destroy(); reject(new Error('Remote resource unavailable')); return; }
          if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new Error('Unsupported content encoding')); return; }
          const expected = Number(res.headers['content-length']);
          if (Number.isFinite(expected) && expected > maxBytes) { res.destroy(); reject(new Error('Remote resource too large')); return; }
          let length = 0; const chunks = [];
          res.on('data', chunk => {
            length += chunk.length;
            if (length > maxBytes) { reject(new Error('Remote resource too large')); req.destroy(); res.destroy(); return; }
            chunks.push(Buffer.from(chunk));
          });
          res.on('error', reject);
          res.on('end', () => resolve({ mime: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), bytes: Buffer.concat(chunks) }));
        });
        const cancel = () => { req.destroy(controller.signal.reason ?? new Error('Download cancelled')); reject(new Error('Download cancelled or timed out')); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        req.on('error', reject);
        req.on('close', () => controller.signal.removeEventListener('abort', cancel));
        if (controller.signal.aborted) cancel(); else req.end();
      });
      if ('location' in response) {
        if (!response.location || redirect === 3) throw new Error('Too many or invalid redirects');
        url = publicUrl(new URL(response.location, url).href); continue;
      }
      return { finalUrl: url.href, ...response };
    }
    throw new Error('Too many redirects');
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
