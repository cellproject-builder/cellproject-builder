// Explicit, bounded paid comparison. Only synthetic fixtures selected by the operator are sent.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createAIProxy } from '../server/cloudAI.mjs';

const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (!args.includes('--live')) { console.log('No calls made. Use --live --fixtures <manifest.json> --env-file <private.env> --output <new-report.json>. Maximum: 3 synthetic clips x 2 models.'); process.exit(0); }
const fixturesPath = option('--fixtures'), envPath = option('--env-file'), outputPath = option('--output');
if (!fixturesPath || !envPath || !outputPath) throw new Error('Missing comparison paths.');
const env = parseEnv(await readFile(envPath, 'utf8')), key = env.OPENROUTER_API_KEY || env.OPENROUTER;
if (!key) throw new Error('OpenRouter is not configured.');
const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
if (!Array.isArray(fixtures) || fixtures.length < 1 || fixtures.length > 3) throw new Error('Expected 1-3 synthetic fixtures.');
const clips = await Promise.all(fixtures.map(async fixture => {
  if (fixture.synthetic !== true || typeof fixture.expected !== 'string' || fixture.expected.length > 1500 || !/^[a-z0-9-]+\.wav$/.test(fixture.file)) throw new Error('Only labeled synthetic WAV fixtures are accepted.');
  const bytes = await readFile(resolve(dirname(fixturesPath), fixture.file));
  if (bytes.length < 44 || bytes.length > 2 * 1024 * 1024 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid or oversized WAV fixture.');
  let byteRate = 0, blockAlign = 0, dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length) throw new Error('Invalid WAV chunk.');
    const kind = bytes.toString('latin1', offset, offset + 4);
    if (kind === 'fmt ') {
      if (byteRate || size < 16 || bytes.readUInt16LE(offset + 8) !== 1) throw new Error('Expected one PCM format chunk.');
      const channels = bytes.readUInt16LE(offset + 10), rate = bytes.readUInt32LE(offset + 12), bits = bytes.readUInt16LE(offset + 22);
      byteRate = bytes.readUInt32LE(offset + 16); blockAlign = bytes.readUInt16LE(offset + 20);
      if (![1, 2].includes(channels) || ![8, 16, 24, 32].includes(bits) || rate < 8000 || rate > 48000 || blockAlign !== channels * bits / 8 || byteRate !== rate * blockAlign) throw new Error('Invalid PCM format.');
    }
    if (kind === 'data') dataBytes += size;
    offset = end + size % 2;
  }
  const durationSeconds = dataBytes / byteRate;
  if (!byteRate || !dataBytes || dataBytes % blockAlign || durationSeconds > 30) throw new Error('Synthetic PCM fixture must last at most 30 seconds.');
  return { ...fixture, bytes, durationSeconds };
}));
// Refuse overwrite before any paid call and keep an initial manifest for interrupted runs.
await mkdir(dirname(resolve(outputPath)), { recursive: true });
const report = { version: 1, createdAt: new Date().toISOString(), protocol: 'First attempts, synthetic pt-BR Microsoft Maria Desktop speech, same bytes, actual local HTTP proxy with fixture auth, real OpenRouter STT. No main LLM/context. Sequential requests, no retries. Not a physical microphone or general Portuguese quality benchmark.', requests: [] };
await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' });
const proxy = createAIProxy({ keys: { openrouter: key } });
const server = createServer((req, res) => proxy(req, res, { user: { id: 'synthetic-audio-comparison' } }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const clip of clips) for (const model of ['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3-turbo']) {
    const body = JSON.stringify({ model, input_audio: { data: clip.bytes.toString('base64'), format: 'wav' }, language: 'pt', response_format: 'json' }), started = performance.now();
    const entry = { file: clip.file, synthetic: true, expected: clip.expected, bytes: clip.bytes.length, durationSeconds: clip.durationSeconds, audioSha256: createHash('sha256').update(clip.bytes).digest('hex'), requestSha256: createHash('sha256').update(body).digest('hex'), model };
    try {
      const response = await fetch(`${origin}/api/ai/openrouter/audio/transcriptions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(100000) });
      entry.status = response.status; entry.response = await response.json(); entry.elapsedMs = Math.round(performance.now() - started);
    } catch { entry.elapsedMs = Math.round(performance.now() - started); entry.error = 'Request failed; no automatic retry.'; }
    report.requests.push(entry); await writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(`${clip.file} ${model}: ${entry.status ?? 'failed'}, ${entry.elapsedMs} ms${typeof entry.response?.usage?.cost === 'number' ? `, USD ${entry.response.usage.cost}` : ''}`);
  }
} finally { proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
if (report.requests.some(entry => entry.status !== 200)) process.exitCode = 1;
