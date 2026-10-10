export interface RateLimitInfo { retryAfterMs?: number; quotaExhausted: boolean }

const RATE = /rate[_\s-]?limit|too many requests/i;
// Daily and per-minute quotas can reset. Only explicit billing/account signals
// identify exhaustion that cannot be fixed by a short cooldown.
const EXHAUSTED = /insufficient[_\s-](?:quota|credits?|funds|balance)|credit[_\s-]balance[_\s-](?:is[_\s-])?too[_\s-]low|billing[_\s-]hard[_\s-]limit[_\s-]reached|(?:quota|credits?).{0,100}(?:check.{0,30}billing|billing.{0,30}(?:details|exhausted))|(?:account|billing).{0,40}(?:quota|credits?).{0,30}(?:exhausted|depleted)/i;

function saneDelay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

function numericDelay(value: unknown, multiplier: number): number | undefined {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined;
  return saneDelay(Number(value.trim()) * multiplier);
}

function headerDelay(headers: unknown, nowMs: number): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const precise = numericDelay(normalized['retry-after-ms'], 1);
  if (precise !== undefined) return precise;
  const raw = normalized['retry-after'];
  const seconds = numericDelay(raw, 1000);
  if (seconds !== undefined) return seconds;
  // Date.parse also accepts invalid numeric HTTP values such as "-10" as
  // calendar dates. Require an HTTP month before interpreting a reset date.
  if (typeof raw !== 'string' || !/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(raw)) return undefined;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? saneDelay(Math.max(0, date - nowMs)) : undefined;
}

/** Read only error metadata; never serialize request bodies or return raw errors. */
export function readRateLimit(error: unknown, nowMs = Date.now()): RateLimitInfo | null {
  const pending: unknown[] = [error], seen = new Set<object>();
  let limited = false, quotaExhausted = false;
  let advertisedDelay: number | undefined, classifiedDelay: number | undefined;
  // Known wrapper fields handle SDK RetryError, APICallError and AIError without
  // importing the service (which consumes this helper). Bound cyclic/deep data.
  for (let count = 0; pending.length && count < 40; count++) {
    const value = pending.shift();
    if (typeof value === 'string') {
      const sample = value.slice(0, 16_000);
      limited ||= RATE.test(sample);
      quotaExhausted ||= EXHAUSTED.test(sample);
      if (/^\s*[\[{]/.test(sample)) {
        try { pending.push(JSON.parse(sample)); } catch { /* Plain provider text is valid error data. */ }
      }
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    limited ||= [record.statusCode, record.status, record.code].some((status) => status === 429 || status === '429') || record.kind === 'rate';
    quotaExhausted ||= record.quotaExhausted === true;
    advertisedDelay ??= headerDelay(record.responseHeaders, nowMs);
    classifiedDelay ??= saneDelay(record.retryAfterMs);
    for (const key of ['message', 'code', 'type', 'detail', 'responseBody', 'data', 'lastError', 'cause', 'info', 'error', 'metadata', 'raw']) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
  }
  if (!limited && !quotaExhausted) return null;
  const retryAfterMs = advertisedDelay ?? classifiedDelay;
  return { quotaExhausted, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}
