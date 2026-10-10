import { useConfigStore } from '@/config/store';
import { cloudProviderAvailable, isCloudEnabled, getCloudRuntime, encodeBytes } from '@/cloud/runtime';
import { authorizeVaultSharing, getVaultSession } from '@/cloud/vault/privacy';
import { providerTransport } from '@/ai/transport';
import { AUDIO_MODELS, DEFAULT_AUDIO_MODEL, MAX_AUDIO_BYTES, MAX_TRANSCRIPT_LENGTH, type AudioModel } from './limits';
export { AUDIO_MODELS, DEFAULT_AUDIO_MODEL, MAX_AUDIO_BYTES, type AudioModel } from './limits';

export type AudioFormat = 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg' | 'webm' | 'aac';
export interface TranscriptionOptions { model?: AudioModel; language?: 'pt' | 'en'; signal?: AbortSignal }
export interface AudioTranscript { text: string; model: AudioModel; costUsd?: number }
const path = '/api/ai/openrouter/audio/transcriptions';
const mimeFormats: Record<string, AudioFormat> = {
  'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/x-mp3': 'mp3',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/webm': 'webm', 'audio/aac': 'aac', 'audio/x-aac': 'aac',
};
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Operação cancelada.', 'AbortError'); };
function validSize(blob: Blob) {
  if (!blob.size) throw new Error('O áudio está vazio. Grave ou selecione outro arquivo.');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('O áudio excede 12 MB. Selecione um trecho menor.');
}
async function readBytes(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  aborted(signal);
  if (typeof blob.arrayBuffer === 'function') { const result = await blob.arrayBuffer(); aborted(signal); return result; }
  // FileReader is also needed by older WebViews and the DOM test environment.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const done = () => signal?.removeEventListener('abort', cancel);
    const cancel = () => { reader.abort(); done(); reject(new DOMException('Operação cancelada.', 'AbortError')); };
    reader.onload = () => { done(); resolve(reader.result as ArrayBuffer); };
    reader.onerror = () => { done(); reject(new Error('Não foi possível ler o áudio.')); };
    signal?.addEventListener('abort', cancel, { once: true }); reader.readAsArrayBuffer(blob);
  });
}
function detectFormat(bytes: Uint8Array, mime: string): AudioFormat {
  const at = (text: string, offset = 0) => bytes.length >= offset + text.length && [...text].every((c, index) => bytes[offset + index] === c.charCodeAt(0));
  const ebml = (offset: number, id = false): { value: number; next: number } | null => {
    const first = bytes[offset]; if (!first) return null;
    let width = 1, marker = 0x80; while (!(first & marker)) { marker >>= 1; width++; }
    if (width > (id ? 4 : 8) || offset + width > bytes.length) return null;
    let value = id ? first : first & (marker - 1); for (let i = 1; i < width; i++) value = value * 256 + bytes[offset + i];
    return Number.isSafeInteger(value) ? { value, next: offset + width } : null;
  };
  const webm = () => {
    if (![0x1a, 0x45, 0xdf, 0xa3].every((b, i) => bytes[i] === b)) return false;
    const header = ebml(4); if (!header || header.value > 4096 || header.next + header.value > bytes.length) return false;
    const end = header.next + header.value;
    for (let offset = header.next; offset < end;) {
      const id = ebml(offset, true), size = id && ebml(id.next); if (!id || !size || size.next + size.value > end) return false;
      if (id.value === 0x4282) return size.value === 4 && at('webm', size.next);
      offset = size.next + size.value;
    }
    return false;
  };
  const mp3 = () => {
    let offset = 0;
    if (at('ID3')) {
      if (bytes.length < 10 || bytes[3] === 0xff || bytes.subarray(6, 10).some(byte => byte & 0x80)) return false;
      offset = 10 + bytes[6] * 2 ** 21 + bytes[7] * 2 ** 14 + bytes[8] * 2 ** 7 + bytes[9] + (bytes[5] & 0x10 ? 10 : 0);
    }
    if (offset + 4 > bytes.length) return false;
    const second = bytes[offset + 1], third = bytes[offset + 2];
    return bytes[offset] === 0xff && (second & 0xe0) === 0xe0 && ((second >> 3) & 3) !== 1 && ((second >> 1) & 3) === 1 && (third >> 4) !== 0 && (third >> 4) !== 15 && ((third >> 2) & 3) !== 3;
  };
  let format: AudioFormat | undefined;
  if (at('RIFF') && at('WAVE', 8)) format = 'wav';
  else if (bytes.length >= 8 && at('fLaC')) format = 'flac';
  else if (bytes.length >= 27 && at('OggS') && bytes[4] === 0) format = 'ogg';
  else if (webm()) format = 'webm';
  else if (bytes.length >= 16 && at('ftyp', 4) && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) >= 16 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) <= bytes.length && ['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42'].some(brand => at(brand, 8))) format = 'm4a';
  else if (bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) format = 'aac';
  else if (mp3()) format = 'mp3';
  const normalized = mime.toLowerCase().split(';')[0].trim();
  if (!format || normalized && normalized !== 'application/octet-stream' && mimeFormats[normalized] !== format) throw new Error('Formato de áudio inválido. Use WAV, MP3, M4A, WebM, Ogg, FLAC ou AAC.');
  return format;
}
/** Sniff the real container; an extension or claimed MIME does not convert audio. */
export async function audioFormat(blob: Blob, signal?: AbortSignal): Promise<AudioFormat> {
  validSize(blob); return detectFormat(new Uint8Array(await readBytes(blob, signal)), blob.type);
}
export async function transcribeAudio(audio: Blob, options: TranscriptionOptions = {}): Promise<AudioTranscript> {
  aborted(options.signal);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('A transcrição precisa de conexão. Seu áudio continua disponível aqui.');
  const model = options.model ?? DEFAULT_AUDIO_MODEL;
  if (!AUDIO_MODELS.some(item => item.id === model) || options.language && !['pt', 'en'].includes(options.language)) throw new Error('Configuração de áudio inválida.');
  const cloud = isCloudEnabled(), runtime = getCloudRuntime(), vault = getVaultSession(), localKey = useConfigStore.getState().providers.openrouter?.apiKey ?? '';
  if (cloud ? !cloudProviderAvailable('openrouter') : !localKey) throw new Error('Configure o OpenRouter para transcrever áudio.');
  const transport = providerTransport('openrouter', localKey);
  const assertContext = () => {
    if (getCloudRuntime() !== runtime || getVaultSession() !== vault || (cloud ? !cloudProviderAvailable('openrouter') : useConfigStore.getState().providers.openrouter?.apiKey !== localKey)) throw new Error('A sessão mudou durante a leitura do áudio. Abra a ferramenta novamente.');
  };
  validSize(audio);
  const bytes = await readBytes(audio, options.signal), format = detectFormat(new Uint8Array(bytes), audio.type);
  assertContext(); authorizeVaultSharing(path, { method: 'POST' }); assertContext(); aborted(options.signal);
  const endpoint = `${transport.baseURL ?? 'https://openrouter.ai/api/v1'}/audio/transcriptions`;
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
  if (!cloud) headers.set('authorization', `Bearer ${transport.apiKey}`);
  const timeout = AbortSignal.timeout(90_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (transport.fetch ?? fetch)(endpoint, {
      method: 'POST', headers, signal, redirect: 'error', cache: 'no-store',
      body: JSON.stringify({ model, input_audio: { data: encodeBytes(bytes), format }, ...(options.language ? { language: options.language } : {}), response_format: 'json' }),
    });
  } catch (error) {
    aborted(options.signal);
    if (timeout.aborted) throw new Error('A transcrição demorou demais. Tente um áudio menor.');
    // Keep consent/session messages from our authenticated transport; raw upstream bodies are never read.
    if (error instanceof Error && /cofre|compartilhamento/i.test(error.message)) throw error;
    throw new Error('Não foi possível transcrever. Confira a conexão e tente novamente.');
  }
  try { aborted(options.signal); assertContext(); }
  catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 429 ? 'Limite de transcrição atingido. Aguarde antes de tentar novamente.' : [401, 403].includes(response.status) ? 'Acesso à transcrição recusado. Confira sua sessão e a configuração do OpenRouter.' : response.status === 402 ? 'Créditos insuficientes no OpenRouter.' : 'Não foi possível transcrever esse áudio. Confira o modelo e o formato.');
  }
  // Bound output even in direct BYOK mode. Speech cannot legitimately expand to an unbounded response.
  const reader = response.body?.getReader(); if (!reader) throw new Error('A transcrição veio vazia.');
  const decoder = new TextDecoder(); let raw = '', length = 0;
  try {
    while (true) { const chunk = await reader.read(); aborted(options.signal); if (chunk.done) break; length += chunk.value.byteLength; if (length > 256 * 1024) throw new Error('A transcrição excedeu o limite. Use um áudio menor.'); raw += decoder.decode(chunk.value, { stream: true }); }
    raw += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  assertContext(); let result: { text?: unknown; usage?: { cost?: unknown } };
  try { result = JSON.parse(raw); } catch { throw new Error('A transcrição retornou um resultado inválido.'); }
  if (!result || typeof result.text !== 'string' || !result.text.trim() || result.text.length > MAX_TRANSCRIPT_LENGTH) throw new Error('Não foi possível reconhecer uma transcrição válida. Tente outro trecho.');
  const cost = result.usage?.cost;
  return { text: result.text.trim(), model, ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}) };
}
