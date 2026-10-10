import { CloudError, readJson, sendJson } from './cloudUtils.mjs';

/** Ephemeral, opaque relay. A deployment with several replicas needs a shared pub/sub adapter. */
export const LIVE_INK_LIMIT = 512 * 1024;
const invalid = () => new CloudError(400, 'invalid_live_ink', 'An encrypted drawing frame is required.');
function ciphertext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'data,iv,v' || value.v !== 1) throw invalid();
  const canonical = (text, max) => typeof text === 'string' && text.length <= max && text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text) && Buffer.from(text, 'base64').toString('base64') === text;
  if (!canonical(value.iv, 16) || Buffer.from(value.iv, 'base64').length !== 12 || !canonical(value.data, LIVE_INK_LIMIT - 128) || Buffer.from(value.data, 'base64').length < 16) throw invalid();
  return value;
}

export function createLiveInkRelay({ authorize, now = Date.now, rate = 20, burst = 40, heartbeatMs = 15_000, reauthorizeMs = 30_000, streamTtlMs = 300_000, drainTimeoutMs = 5000 } = {}) {
  const owners = new Map(); let peers = 0, closed = false;
  const stateTtl = 120_000;
  function ownerState(id) {
    let state = owners.get(id);
    if (!state) {
      if (owners.size >= 128) throw new CloudError(429, 'live_ink_busy', 'Drawing relay is busy.');
      state = { peers: new Set(), seen: new Map(), tokens: burst, bytes: 4 * LIVE_INK_LIMIT, updated: now() }; owners.set(id, state);
    }
    return state;
  }
  function cleanup() {
    const time = now();
    for (const [id, state] of owners) {
      for (const [iv, at] of state.seen) if (time - at > stateTtl) state.seen.delete(iv);
      if (!state.peers.size && time - state.updated > stateTtl) owners.delete(id);
    }
  }
  const cleaner = setInterval(cleanup, 30_000); cleaner.unref?.();
  function disconnect(peer) {
    if (peer.closed) return; peer.closed = true;
    clearInterval(peer.timer); clearTimeout(peer.drainTimer); peer.state.peers.delete(peer); peers--;
    peer.res.off('drain', peer.drain);
    peer.res.off('close', peer.close); peer.req.off('aborted', peer.close);
    if (!peer.res.writableEnded && !peer.res.destroyed) peer.res.end();
  }
  function write(peer, data) {
    if (peer.closed || peer.res.destroyed || peer.res.writableEnded) { disconnect(peer); return; }
    // write(false) accepted the frame: wait for drain without queuing subsequent previews.
    // Bound stalled connections; durable document sync recovers the saved drawing separately.
    if (peer.blocked) return;
    try {
      if (!peer.res.write(data)) {
        peer.blocked = true; peer.res.once('drain', peer.drain);
        peer.drainTimer = setTimeout(() => disconnect(peer), drainTimeoutMs); peer.drainTimer.unref?.();
      }
    } catch { disconnect(peer); }
  }
  async function handle(req, res, session) {
    if (closed) throw new CloudError(503, 'live_ink_closed', 'Drawing relay is unavailable.');
    const owner = session?.user?.id;
    if (typeof owner !== 'string' || !owner || session.passwordSetup) throw new CloudError(401, 'authentication_required', 'Sign in to continue.');
    if (!['GET', 'POST'].includes(req.method)) throw new CloudError(405, 'method_not_allowed', 'Unsupported drawing method.');
    cleanup();
    if (req.method === 'POST') {
      const value = ciphertext(await readJson(req, LIVE_INK_LIMIT)), encoded = JSON.stringify(value), bytes = Buffer.byteLength(encoded), state = ownerState(owner), time = now();
      if (state.seen.has(value.iv)) throw new CloudError(409, 'live_ink_replay', 'This drawing frame was already received.');
      const elapsed = Math.max(0, time - state.updated) / 1000;
      state.tokens = Math.min(burst, state.tokens + elapsed * rate); state.bytes = Math.min(4 * LIVE_INK_LIMIT, state.bytes + elapsed * 2 * LIVE_INK_LIMIT); state.updated = time;
      if (state.tokens < 1 || state.bytes < bytes) throw new CloudError(429, 'live_ink_rate_limited', 'Drawing updates are too frequent.');
      state.tokens--; state.bytes -= bytes; state.seen.set(value.iv, time);
      if (state.seen.size > 4096) state.seen.delete(state.seen.keys().next().value);
      for (const peer of [...state.peers]) write(peer, `event: ink\ndata: ${encoded}\n\n`);
      sendJson(res, 202, { received: true }); return;
    }
    const state = ownerState(owner);
    if (state.peers.size >= 8 || peers >= 256) throw new CloudError(429, 'live_ink_connections', 'Too many drawing connections.');
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'private, no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' }); res.flushHeaders?.();
    const peer = { req, res, state, closed: false, blocked: false, created: now(), checked: now(), checking: false, timer: null, drainTimer: null, drain: null, close: null };
    peer.drain = () => { clearTimeout(peer.drainTimer); peer.drainTimer = null; peer.blocked = false; };
    peer.close = () => disconnect(peer); state.peers.add(peer); peers++;
    req.once('aborted', peer.close); res.once('close', peer.close);
    peer.timer = setInterval(async () => {
      if (peer.closed) return;
      const time = now();
      if (time - peer.created >= streamTtlMs) { disconnect(peer); return; }
      if (time - peer.checked >= reauthorizeMs && !peer.checking) {
        peer.checking = true; peer.checked = time;
        try { const current = await authorize?.(req); if (!current || current.passwordSetup || current.user?.id !== owner) { disconnect(peer); return; } }
        catch { disconnect(peer); return; }
        finally { peer.checking = false; }
      }
      write(peer, ': heartbeat\n\n');
    }, Math.min(heartbeatMs, reauthorizeMs, streamTtlMs)); peer.timer.unref?.();
    write(peer, ': connected\n\n');
  }
  return { handle, close() { if (closed) return; closed = true; clearInterval(cleaner); for (const state of owners.values()) for (const peer of [...state.peers]) disconnect(peer); owners.clear(); } };
}
