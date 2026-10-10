/** Evidence helpers only. These never generate, repair or judge a plan. */
export function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]').replace(/\bsk-(?:or-v1-|proj-|ant-)?[A-Za-z0-9_-]+/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /^(authorization|api[-_]?key|token|password|cookie|secret)$/i.test(key) ? '[REDACTED]' : redact(item, secrets)]));
  return value;
}

export interface Usage { inputTokens: number | null; outputTokens: number | null; costUsd: number | null }
export function readUsage(text: string): Usage {
  let usage: Record<string, unknown> = {};
  const lines = text.split('\n');
  const payloads = lines.some(line => line.startsWith('data:')) ? lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()) : [text];
  for (const payload of payloads) {
    try { const parsed = JSON.parse(payload); if (parsed.usage) usage = parsed.usage; } catch { /* preserve invalid text in record */ }
  }
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { inputTokens: number(usage.prompt_tokens), outputTokens: number(usage.completion_tokens), costUsd: number(usage.cost) };
}

export class BudgetLedger {
  attempts = 0;
  reservedUsd = 0;
  constructor(readonly maxRequests: number, readonly maxUsd: number, readonly prices: { prompt: number; completion: number }) {
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || !Number.isFinite(maxUsd) || maxUsd <= 0 || Object.values(prices).some(price => !Number.isFinite(price) || price < 0)) throw new Error('invalid_budget');
  }
  reserve(requestText: string, maxOutput: number) {
    if (this.attempts >= this.maxRequests) throw new Error('request_limit');
    if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) throw new Error('missing_output_limit');
    // UTF-8 bytes bound input tokens conservatively; include schema/envelope and 1024 framing tokens.
    // Reserve the whole output budget even when actual usage is smaller or unknown.
    const estimatedCeilingUsd = (Buffer.byteLength(requestText, 'utf8') + 1024) * this.prices.prompt + maxOutput * this.prices.completion;
    if (this.reservedUsd + estimatedCeilingUsd > this.maxUsd) throw new Error('budget_limit');
    this.reservedUsd += estimatedCeilingUsd;
    this.attempts++;
    return estimatedCeilingUsd;
  }
}

export interface AttemptRecord {
  attempt: number; stage: string; startedAt: string; endedAt?: string; elapsedMs?: number;
  url: string; requestText: string; status?: number; responseText?: string; error?: string;
  reservedUsd: number; usage?: Usage;
}
interface RecordingOptions {
  ledger: BudgetLedger; model: string; stage: () => string; secrets: string[];
  remote: typeof fetch; onRecord: (record: AttemptRecord) => void | Promise<void>;
}
export function createRecordedFetch(options: RecordingOptions): typeof fetch & { flush(): Promise<void> } {
  const pending: Promise<void>[] = [];
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions' || url.search) throw new Error('unexpected_endpoint');
    const requestText = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    const body = JSON.parse(requestText);
    if (body.model !== options.model) throw new Error('model_mismatch');
    const reservedUsd = options.ledger.reserve(requestText, body.max_tokens ?? body.max_completion_tokens);
    const started = Date.now();
    const record: AttemptRecord = { attempt: options.ledger.attempts, stage: options.stage(), startedAt: new Date(started).toISOString(), url: `${url.origin}${url.pathname}`, requestText: redact(requestText, options.secrets) as string, reservedUsd };
    // Save before transport so a process crash cannot silently erase an attempted call.
    await options.onRecord({ ...record });
    const finish = async () => {
      record.endedAt = new Date().toISOString(); record.elapsedMs = Date.now() - started;
      await options.onRecord({ ...record });
    };
    try {
      const response = await options.remote(input, init);
      record.status = response.status;
      const capture = async () => {
        const reader = response.clone().body?.getReader(); const decoder = new TextDecoder(); let text = '';
        try {
          if (reader) for (;;) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value, { stream: true }); }
        } catch (error) { record.error = redact(error instanceof Error ? error.message : String(error), options.secrets) as string; }
        finally {
          text += decoder.decode(); record.responseText = redact(text, options.secrets) as string; record.usage = readUsage(text);
          reader?.releaseLock(); await finish();
        }
      };
      const read = capture();
      pending.push(read);
      return response;
    } catch (error) {
      record.error = redact(error instanceof Error ? error.message : String(error), options.secrets) as string;
      await finish();
      throw error;
    }
  }) as typeof fetch & { flush(): Promise<void> };
  wrapped.flush = async () => { await Promise.all(pending); };
  return wrapped;
}
