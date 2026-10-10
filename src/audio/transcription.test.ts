import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/config/store';
import { configureCloud, CloudRuntime } from '@/cloud/runtime';
import { configureVault } from '@/cloud/vault/privacy';
import { transcribeAudio, audioFormat, MAX_AUDIO_BYTES } from './transcription';

const wav = () => new Blob(['RIFF0000WAVEdata'], { type: 'audio/wav' });
beforeEach(() => { configureCloud(null); configureVault(null, false); useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'LOCAL_FIXTURE_KEY', mainModel: 'm', kbModel: 'k' } } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); configureCloud(null); configureVault(null, false); });
describe('audio transcription transport', () => {
  it('sends only audio to fixed OpenRouter STT using an independent model, preserving actual format', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: 'Olá, Arduino.', usage: { cost: 0.0002 } }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    expect(await transcribeAudio(wav(), { language: 'pt' })).toEqual({ text: 'Olá, Arduino.', model: 'openai/whisper-large-v3-turbo', costUsd: 0.0002 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions'); expect(new Headers(init.headers).get('authorization')).toBe('Bearer LOCAL_FIXTURE_KEY');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'openai/whisper-large-v3-turbo', input_audio: { data: btoa('RIFF0000WAVEdata'), format: 'wav' }, language: 'pt', response_format: 'json' });
  });
  it('cloud uses authenticated same-origin transport and never the configured local key', async () => {
    configureCloud(new CloudRuntime({ documents: [], media: [] }), { openrouter: true });
    const fetcher = vi.fn(async () => new Response('{"text":"teste"}')); vi.stubGlobal('fetch', fetcher);
    await transcribeAudio(wav(), { model: 'openai/whisper-large-v3-turbo' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe('/api/ai/openrouter/audio/transcriptions');
    expect(new Headers(init.headers).get('authorization')).toBeNull(); expect(init.credentials).toBe('same-origin'); expect(JSON.stringify(init)).not.toContain('LOCAL_FIXTURE_KEY');
  });
  it('rejects offline, missing OpenRouter, locked vault and denied sharing before network', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(false); await expect(transcribeAudio(wav())).rejects.toThrow(/conexão/i);
    useConfigStore.setState({ providers: {} }); await expect(transcribeAudio(wav())).rejects.toThrow(/OpenRouter/);
    useConfigStore.setState({ providers: { openrouter: { apiKey: 'fixture', mainModel: 'm', kbModel: 'k' } } });
    configureVault(null, true); await expect(transcribeAudio(wav())).rejects.toThrow(/bloqueado/); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects empty/large/unsupported and mislabeled files and pre-abort before network', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const audio of [new Blob(), new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/wav' }), new Blob(['not audio'], { type: 'image/png' }), new Blob(['<svg>'], { type: 'audio/wav' })]) await expect(transcribeAudio(audio)).rejects.toThrow();
    const controller = new AbortController(); controller.abort(); await expect(transcribeAudio(wav(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('denied sharing blocks transmission and does not expose a local credential', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(false);
    configureVault({ ownerId: 'synthetic-owner' } as Parameters<typeof configureVault>[0], true);
    await expect(transcribeAudio(wav())).rejects.toThrow(/não autorizado/); expect(fetcher).not.toHaveBeenCalled();
  });
  it('discards an upstream response that arrives after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return new Response('{"text":"late"}'); }));
    await expect(transcribeAudio(wav(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('fails closed when cloud identity changes while reading selected audio', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); configureCloud(new CloudRuntime({ documents: [], media: [] }), { openrouter: true });
    const audio = wav(); Object.defineProperty(audio, 'arrayBuffer', { value: async () => { configureCloud(null); return new TextEncoder().encode('RIFF0000WAVEdata').buffer; } });
    await expect(transcribeAudio(audio)).rejects.toThrow(/sessão|contexto/i); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry provider failure or expose provider error bodies', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":"SECRET_SENTINEL"}', { status: 429 })); vi.stubGlobal('fetch', fetcher);
    await expect(transcribeAudio(wav())).rejects.toThrow(/limite/i); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed, empty and overlong transcripts instead of inserting raw JSON', async () => {
    for (const body of ['bad json', '{}', '{"text":"   "}', JSON.stringify({ text: 'x'.repeat(32001) })]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body))); await expect(transcribeAudio(wav())).rejects.toThrow();
    }
  });
  it('identifies containers rather than trusting MIME or renaming bytes', async () => {
    expect(await audioFormat(new File(['RIFF0000WAVEdata'], 'audio.bin'))).toBe('wav');
    expect(await audioFormat(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])], { type: 'audio/webm;codecs=opus' }))).toBe('webm');
    await expect(audioFormat(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], { type: 'audio/webm' }))).rejects.toThrow();
    await expect(audioFormat(new Blob(['RIFF0000WAVEdata'], { type: 'audio/mp4' }))).rejects.toThrow();
  });
});
