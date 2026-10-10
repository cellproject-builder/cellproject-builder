import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CloudError, invalid, readJson, remoteJson, sendJson, sendError } from './cloudUtils.mjs';

const AUDIO_BYTE_LIMIT = 12 * 1024 * 1024;
const AUDIO_JSON_LIMIT = Math.ceil(AUDIO_BYTE_LIMIT / 3) * 4 + 16 * 1024;
const AUDIO_MODELS = new Set(['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3-turbo']);
const AUDIO_FORMATS = new Set(['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac']);
const exactFields = (value, allowed) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

function ebmlInteger(bytes, offset, id = false) {
  const first = bytes[offset];
  if (!first) return null;
  let width = 1, marker = 0x80;
  while (!(first & marker)) { marker >>= 1; width++; }
  if (width > (id ? 4 : 8) || offset + width > bytes.length) return null;
  let value = id ? first : first & (marker - 1);
  for (let index = 1; index < width; index++) value = value * 256 + bytes[offset + index];
  return Number.isSafeInteger(value) ? { value, next: offset + width } : null;
}

function hasWebmHeader(bytes) {
  if (bytes.length < 5 || bytes.readUInt32BE(0) !== 0x1a45dfa3) return false;
  const header = ebmlInteger(bytes, 4);
  if (!header || header.value > 4096 || header.next + header.value > bytes.length) return false;
  const end = header.next + header.value;
  for (let offset = header.next; offset < end;) {
    const id = ebmlInteger(bytes, offset, true);
    const size = id && ebmlInteger(bytes, id.next);
    if (!size || size.next + size.value > end) return false;
    if (id.value === 0x4282) return bytes.subarray(size.next, size.next + size.value).toString('latin1') === 'webm';
    offset = size.next + size.value;
  }
  return false;
}

function hasMp3Header(bytes) {
  let offset = 0;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    if (bytes.length < 10 || bytes[3] === 0xff || bytes.subarray(6, 10).some(value => value & 0x80)) return false;
    const tagSize = bytes[6] * 2 ** 21 + bytes[7] * 2 ** 14 + bytes[8] * 2 ** 7 + bytes[9];
    offset = 10 + tagSize + (bytes[5] & 0x10 ? 10 : 0);
  }
  if (offset + 4 > bytes.length) return false;
  const second = bytes[offset + 1], third = bytes[offset + 2];
  return bytes[offset] === 0xff && (second & 0xe0) === 0xe0 && ((second >> 3) & 3) !== 1 && ((second >> 1) & 3) === 1 && (third >> 4) !== 0 && (third >> 4) !== 15 && ((third >> 2) & 3) !== 3;
}

/** Container identification only: codec integrity and audio decoding remain the provider's responsibility. */
function hasAudioContainer(bytes, format) {
  switch (format) {
    case 'wav': return bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WAVE';
    case 'mp3': return hasMp3Header(bytes);
    case 'flac': return bytes.length >= 8 && bytes.toString('latin1', 0, 4) === 'fLaC';
    case 'm4a': return bytes.length >= 16 && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length && bytes.toString('latin1', 4, 8) === 'ftyp' && ['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42'].includes(bytes.toString('latin1', 8, 12));
    case 'ogg': return bytes.length >= 27 && bytes.toString('latin1', 0, 4) === 'OggS' && bytes[4] === 0;
    case 'webm': return hasWebmHeader(bytes);
    case 'aac': return bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    default: return false;
  }
}

function transcriptionRequest(body) {
  if (!exactFields(body, ['model', 'input_audio', 'language', 'response_format']) || !AUDIO_MODELS.has(body.model) || !exactFields(body.input_audio, ['data', 'format']) || !AUDIO_FORMATS.has(body.input_audio.format) || body.language !== undefined && !['pt', 'en'].includes(body.language) || body.response_format !== undefined && body.response_format !== 'json') throw invalid('Invalid audio transcription request.');
  const { data, format } = body.input_audio;
  if (typeof data !== 'string' || !data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw invalid('Invalid audio bytes.');
  if (data.length > Math.ceil(AUDIO_BYTE_LIMIT / 3) * 4) throw new CloudError(413, 'request_too_large', 'Audio exceeds the 12 MiB limit.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > AUDIO_BYTE_LIMIT || bytes.toString('base64') !== data || !hasAudioContainer(bytes, format)) throw invalid('Invalid audio format or bytes.');
  return { model: body.model, input_audio: { data, format }, ...(body.language !== undefined ? { language: body.language } : {}), response_format: 'json' };
}

function transcriptionResponse(value) {
  if (!value || typeof value.text !== 'string' || value.text.length > 32_000) throw new CloudError(502, 'provider_invalid_response', 'The AI provider returned an invalid transcript.');
  const usage = {};
  for (const key of ['seconds', 'cost', 'input_tokens', 'output_tokens', 'total_tokens']) {
    const number = value.usage?.[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER && (!key.endsWith('_tokens') || Number.isSafeInteger(number))) usage[key] = number;
  }
  return { text: value.text, ...(Object.keys(usage).length ? { usage } : {}) };
}

const ROUTES = new Map([
  ['/api/ai/openrouter/audio/transcriptions', { provider: 'openrouter', url: 'https://openrouter.ai/api/v1/audio/transcriptions', audio: true }],
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
      let body = await readJson(req, route.audio ? AUDIO_JSON_LIMIT : 24 * 1024 * 1024);
      if (route.audio) body = transcriptionRequest(body);
      else {
        if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 || body.background === true || body.webhook_url !== undefined || body.callback_url !== undefined || body.api_key !== undefined || body.apiKey !== undefined || body.authorization !== undefined || body.access_token !== undefined) throw invalid('Invalid AI request.');
        const input = body[route.input];
        if (typeof input !== 'string' && (!Array.isArray(input) || input.length > 500) || typeof input === 'string' && !input.length) throw invalid('AI input is required.');
        for (const budget of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) if (body[budget] !== undefined && (!Number.isSafeInteger(body[budget]) || body[budget] < 1 || body[budget] > 65_536)) throw invalid('AI output exceeds the server limit.');
        if (!['max_tokens', 'max_completion_tokens', 'max_output_tokens'].some(name => body[name] !== undefined)) body[route.budget] = 16_384;
        if (body.stream !== undefined && typeof body.stream !== 'boolean') throw invalid();
        if (route.input === 'messages' && !Array.isArray(input)) throw invalid();
      }
      if (req.aborted || res.destroyed) return;
      controller = new AbortController(); controllers.add(controller);
      cancel = () => { if (!res.writableEnded) controller.abort(); };
      req.on('aborted', cancel); res.on('close', cancel);
      const headers = { 'content-type': 'application/json', accept: body.stream ? 'text/event-stream' : 'application/json' };
      if (route.provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
      else headers.authorization = `Bearer ${key}`;
      // Only fixed provider endpoints and a newly constructed header set are used.
      // No client cookies, Authorization, URLs or provider credentials are forwarded.
      const response = await fetchImpl(route.url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(route.audio ? 90_000 : 10 * 60_000)]) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new CloudError(429, 'provider_rate_limited', 'The AI provider is rate limited. Please try again later.');
        if ([400, 404, 422].includes(response.status)) throw new CloudError(response.status, 'provider_request_failed', 'The AI provider rejected this model or request.');
        throw new CloudError(502, 'provider_unavailable', 'The AI provider could not complete this request.');
      }
      const type = response.headers.get('content-type') ?? '';
      if (route.audio) {
        if (type.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) { await response.body?.cancel(); throw new CloudError(502, 'provider_invalid_response', 'The AI provider returned an invalid transcript.'); }
        sendJson(res, 200, transcriptionResponse(await remoteJson(response, 256 * 1024)));
        return;
      }
      if (!(type.includes('application/json') || type.includes('text/event-stream')) || !response.body) { await response.body?.cancel(); throw new CloudError(502, 'provider_invalid_response', 'The AI provider returned an invalid response.'); }
      res.writeHead(200, { 'content-type': type.includes('text/event-stream') ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
      await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal });
    } catch (error) { sendError(res, error); }
    finally { release?.(); if (controller) controllers.delete(controller); if (cancel) { req.off('aborted', cancel); res.off('close', cancel); } }
  };
  proxy.close = () => { for (const controller of controllers) controller.abort(); controllers.clear(); };
  return proxy;
}
