import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CloudError, invalid, readJson, sendError } from './cloudUtils.mjs';

const ROUTES = new Map([
  ['/api/ai/openrouter/chat/completions', { provider: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', budget: 'max_tokens', input: 'messages' }],
  ['/api/ai/openai/chat/completions', { provider: 'openai', url: 'https://api.openai.com/v1/chat/completions', budget: 'max_completion_tokens', input: 'messages' }],
  ['/api/ai/openai/responses', { provider: 'openai', url: 'https://api.openai.com/v1/responses', budget: 'max_output_tokens', input: 'input' }],
  ['/api/ai/anthropic/messages', { provider: 'anthropic', url: 'https://api.anthropic.com/v1/messages', budget: 'max_tokens', input: 'messages' }],
]);

export function createAIProxy({ keys = {}, fetchImpl = fetch, now = Date.now } = {}) {
  const windows = new Map(); const active = new Map(); const controllers = new Set(); let global = 0;
  const proxy = async (req, res, session) => {
    let controller; let release; let cancel;
    try {
      if (!session?.user?.id) throw new CloudError(401, 'authentication_required', 'Sign in to continue.');
      const route = ROUTES.get(req.url); if (req.method !== 'POST' || !route) throw new CloudError(404, 'not_found', 'Unknown AI endpoint.');
      const key = keys[route.provider]; if (!key) throw new CloudError(503, 'provider_not_configured', 'This AI provider is not configured on the server.');
      const owner = session.user.id;
      for (const [id, window] of windows) if (window.until <= now()) windows.delete(id);
      const window = windows.get(owner) ?? { count: 0, until: now() + 60_000 };
      if (window.count >= 40 || (active.get(owner) ?? 0) >= 4 || global >= 6) throw new CloudError(429, 'ai_rate_limited', 'Too many AI requests. Please wait before trying again.');
      window.count++; windows.set(owner, window); active.set(owner, (active.get(owner) ?? 0) + 1); global++;
      release = () => { active.set(owner, active.get(owner) - 1); global--; };
      const body = await readJson(req, 24 * 1024 * 1024);
      if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 || body.background === true || body.webhook_url !== undefined || body.callback_url !== undefined || body.api_key !== undefined || body.apiKey !== undefined || body.authorization !== undefined || body.access_token !== undefined) throw invalid('Invalid AI request.');
      const input = body[route.input];
      if (typeof input !== 'string' && (!Array.isArray(input) || input.length > 500) || typeof input === 'string' && !input.length) throw invalid('AI input is required.');
      for (const budget of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) if (body[budget] !== undefined && (!Number.isSafeInteger(body[budget]) || body[budget] < 1 || body[budget] > 65_536)) throw invalid('AI output exceeds the server limit.');
      if (!['max_tokens', 'max_completion_tokens', 'max_output_tokens'].some(name => body[name] !== undefined)) body[route.budget] = 16_384;
      if (body.stream !== undefined && typeof body.stream !== 'boolean') throw invalid();
      if (route.input === 'messages' && !Array.isArray(input)) throw invalid();
      controller = new AbortController(); controllers.add(controller);
      cancel = () => { if (!res.writableEnded) controller.abort(); };
      req.on('aborted', cancel); res.on('close', cancel);
      const headers = { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json' };
      if (route.provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else headers.authorization = `Bearer ${key}`;
      // Only fixed provider endpoints and a newly constructed header set are used.
      // No client cookies, Authorization, URLs or provider credentials are forwarded.
      const response = await fetchImpl(route.url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new CloudError(429, 'provider_rate_limited', 'The AI provider is rate limited. Please try again later.');
        if ([400, 404, 422].includes(response.status)) throw new CloudError(response.status, 'provider_request_failed', 'The AI provider rejected this model or request.');
        throw new CloudError(502, 'provider_unavailable', 'The AI provider could not complete this request.');
      }
      const type = response.headers.get('content-type') ?? '';
      if (!(type.includes('application/json') || type.includes('text/event-stream')) || !response.body) { await response.body?.cancel(); throw new CloudError(502, 'provider_invalid_response', 'The AI provider returned an invalid response.'); }
      res.writeHead(200, { 'content-type': type.includes('text/event-stream') ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
      await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal });
    } catch (error) { sendError(res, error); }
    finally { release?.(); if (controller) controllers.delete(controller); if (cancel) { req.off('aborted', cancel); res.off('close', cancel); } }
  };
  proxy.close = () => { for (const controller of controllers) controller.abort(); controllers.clear(); };
  return proxy;
}
