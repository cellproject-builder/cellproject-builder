export function createLimits(now = Date.now) {
  const windows = new Map(), active = { resolve: 0, review: 0, media: 0 };
  return {
    enter(kind, accessId) {
      const rule = kind === 'review' ? { perSession: 12, total: 24, concurrent: 2 } : kind === 'media' ? { perSession: 60, total: 120, concurrent: 4 } : { perSession: 6, total: 12, concurrent: 4 };
      for (const [key, window] of windows) if (window.start + 60_000 <= now()) windows.delete(key);
      const keys = [`${kind}:global`, `${kind}:${accessId}`];
      const values = keys.map(key => windows.get(key) ?? { start: now(), count: 0 });
      if (active[kind] >= rule.concurrent || values[0].count >= rule.total || values[1].count >= rule.perSession) throw new Error('Visual request limit reached');
      keys.forEach((key, i) => windows.set(key, { ...values[i], count: values[i].count + 1 }));
      active[kind]++;
      let released = false;
      return () => { if (!released) { active[kind]--; released = true; } };
    },
  };
}

// Only unpaid image downloads queue. Search and paid review retain immediate limits.
export function createMediaQueue(concurrent = 4, maxPending = 32) {
  let active = 0;
  const pending = [];
  const releaseSlot = () => {
    active--;
    const next = pending.shift();
    if (next) next.start();
  };
  return {
    acquire(signal) {
      signal?.throwIfAborted();
      if (active >= concurrent && pending.length >= maxPending) return Promise.reject(new Error('Media queue limit reached'));
      return new Promise((resolve, reject) => {
        const item = {
          start() {
            signal?.removeEventListener('abort', abort);
            active++; let released = false;
            resolve(() => { if (!released) { released = true; releaseSlot(); } });
          },
        };
        const abort = () => { const i = pending.indexOf(item); if (i >= 0) pending.splice(i, 1); reject(new Error('Media download cancelled')); };
        if (active < concurrent) item.start();
        else { pending.push(item); signal?.addEventListener('abort', abort, { once: true }); }
      });
    },
  };
}
