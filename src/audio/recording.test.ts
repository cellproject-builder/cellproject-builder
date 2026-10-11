import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAudioRecording } from './recording';

let recorders: FakeRecorder[], track: FakeTrack, microphone: MediaStream;
let level: number, contexts: FakeAudioContext[];

// Browser recording and permissions are unavailable in jsdom.
class FakeTrack extends EventTarget { stop = vi.fn(); }
class FakeRecorder extends EventTarget {
  static autoFinish = true;
  static isTypeSupported = (mime: string) => mime.startsWith('audio/webm');
  state: RecordingState = 'inactive';
  mimeType: string;
  start = vi.fn((_timeslice?: number) => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; if (FakeRecorder.autoFinish) this.finish(); });
  constructor(readonly stream: MediaStream, options?: MediaRecorderOptions) {
    super(); this.mimeType = options?.mimeType ?? 'audio/webm'; recorders.push(this);
  }
  data(blob: Blob) { this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob })); }
  finish(blob = audioBlob(recorders.indexOf(this))) { this.data(blob); this.dispatchEvent(new Event('stop')); }
}
class FakeAudioContext {
  state: AudioContextState = 'running';
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  source = { connect: vi.fn(), disconnect: vi.fn() };
  analyser = { fftSize: 2048, disconnect: vi.fn(), getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level) };
  createMediaStreamSource = vi.fn(() => this.source);
  createAnalyser = vi.fn(() => this.analyser);
  constructor() { contexts.push(this); }
}
function audioBlob(marker = 0, size = 2048) {
  const bytes = new Uint8Array(size);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, marker].slice(0, size));
  return new Blob([bytes], { type: 'audio/webm;codecs=opus' });
}
function readBytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
beforeEach(() => {
  vi.useFakeTimers(); recorders = []; contexts = []; level = 0.1;
  track = new FakeTrack(); microphone = { getTracks: () => [track] } as unknown as MediaStream;
  FakeRecorder.autoFinish = true;
  vi.stubGlobal('MediaRecorder', FakeRecorder); vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => microphone) } });
});
afterEach(() => { vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('returns complete files in capture order even when stop events arrive out of order', async () => {
  FakeRecorder.autoFinish = false;
  const session = await createAudioRecording({});
  vi.advanceTimersByTime(50_000);
  expect(recorders).toHaveLength(2); expect(recorders[0].stop).toHaveBeenCalledOnce();
  expect(recorders[1].stream).toBe(microphone); expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  for (const recorder of recorders) expect(recorder.start).toHaveBeenCalledWith();
  vi.advanceTimersByTime(1_000);
  let settled = false;
  const pending = session.stop().then(blobs => { settled = true; return blobs; });
  expect(track.stop).toHaveBeenCalledOnce(); expect(contexts[0].close).toHaveBeenCalledOnce();
  recorders[1].finish(audioBlob(2)); await Promise.resolve(); expect(settled).toBe(false);
  recorders[0].data(audioBlob(1).slice(0, 5)); recorders[0].finish(audioBlob(1).slice(5));
  const blobs = await pending;
  expect(blobs).toHaveLength(2); expect(blobs.map(blob => blob.type)).toEqual([session.mimeType, session.mimeType]);
  vi.useRealTimers();
  expect((await readBytes(blobs[0])).slice(0, 5)).toEqual([0x1a, 0x45, 0xdf, 0xa3, 1]);
  expect((await readBytes(blobs[1])).slice(0, 5)).toEqual([0x1a, 0x45, 0xdf, 0xa3, 2]);
  expect(await session.stop()).toBe(blobs);
});

it('rotates on a 300 ms pause after 40 seconds and reports RMS at 10 Hz', async () => {
  const onLevel = vi.fn(); const session = await createAudioRecording({ onLevel });
  vi.advanceTimersByTime(40_000); expect(recorders).toHaveLength(1);
  expect(onLevel).toHaveBeenCalledTimes(400); expect(onLevel).toHaveBeenLastCalledWith(expect.closeTo(0.1));
  level = 0; vi.advanceTimersByTime(299); expect(recorders).toHaveLength(1);
  vi.advanceTimersByTime(1); expect(recorders).toHaveLength(2); session.cancel();
});

it('forces a complete new file at 50 seconds when speech has no pause', async () => {
  const session = await createAudioRecording({});
  vi.advanceTimersByTime(49_999); expect(recorders).toHaveLength(1);
  vi.advanceTimersByTime(1); expect(recorders).toHaveLength(2);
  vi.advanceTimersByTime(1_000); expect(await session.stop()).toHaveLength(2);
});

it('accepts final data if releasing the microphone stops its recorder immediately', async () => {
  const session = await createAudioRecording({});
  track.stop.mockImplementation(() => {
    for (const recorder of recorders) if (recorder.state !== 'inactive') {
      recorder.state = 'inactive'; recorder.finish();
    }
  });
  expect(await session.stop()).toHaveLength(1);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not treat a suspended audio context as silence', async () => {
  const onLevel = vi.fn(); const session = await createAudioRecording({ onLevel });
  contexts[0].state = 'suspended'; level = 0; vi.advanceTimersByTime(49_900);
  expect(recorders).toHaveLength(1); expect(onLevel).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100); expect(recorders).toHaveLength(2); session.cancel();
});

it('keeps capture working without Web Audio', async () => {
  vi.stubGlobal('AudioContext', undefined); const session = await createAudioRecording({});
  vi.advanceTimersByTime(51_000); expect(await session.stop()).toHaveLength(2); expect(track.stop).toHaveBeenCalledOnce();
});

it('closes a partially initialized optional meter and keeps recording if analyser creation fails', async () => {
  class BrokenMeter extends FakeAudioContext { createAnalyser = vi.fn(() => { throw new Error('no analyser'); }); }
  vi.stubGlobal('AudioContext', BrokenMeter); const session = await createAudioRecording({});
  expect(contexts[0].close).toHaveBeenCalledOnce(); expect(await session.stop()).toHaveLength(1);
  expect(contexts[0].close).toHaveBeenCalledOnce();
});

it('disables a failing level reader without interrupting capture', async () => {
  const onError = vi.fn(); const session = await createAudioRecording({ onError });
  contexts[0].analyser.getFloatTimeDomainData = () => { throw new Error('meter failed'); };
  expect(() => vi.advanceTimersByTime(51_000)).not.toThrow();
  expect(await session.stop()).toHaveLength(2); expect(onError).not.toHaveBeenCalled();
});

it('preserves speech after an optional meter failure and treats later segments as unmeasured', async () => {
  const session = await createAudioRecording({});
  vi.advanceTimersByTime(49_900); level = 0; vi.advanceTimersByTime(200);
  contexts[0].analyser.getFloatTimeDomainData = () => { throw new Error('meter failed before speech'); };
  level = 0.1; vi.advanceTimersByTime(400);
  // The next hard rotation starts without a meter; no earlier silence proves
  // that either this segment or its successor contains no speech.
  vi.advanceTimersByTime(50_000);
  expect(await session.stop()).toHaveLength(3);
  expect(contexts[0].close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('preserves speech captured while the meter was suspended even if sampling resumes (%s)', async resume => {
  const session = await createAudioRecording({});
  vi.advanceTimersByTime(49_900); level = 0; vi.advanceTimersByTime(200);
  contexts[0].state = 'suspended'; level = 0.1; vi.advanceTimersByTime(400);
  if (resume) {
    // Speech happened while unmeasured. Later measured silence must not erase it.
    contexts[0].state = 'running'; level = 0; vi.advanceTimersByTime(400);
  }
  expect(await session.stop()).toHaveLength(2);
  expect(contexts[0].close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops at five minutes and preserves files for explicit confirmation', async () => {
  const onLimit = vi.fn(), onDuration = vi.fn(), onError = vi.fn();
  const session = await createAudioRecording({ onLimit, onDuration, onError }); vi.advanceTimersByTime(300_000);
  expect(onLimit).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled(); expect(onDuration).toHaveBeenLastCalledWith(300);
  expect(track.stop).toHaveBeenCalledOnce(); expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(await session.stop()).toHaveLength(6); expect(vi.getTimerCount()).toBe(0);
});

it('enforces 12 MiB across all files and ignores late data after failure', async () => {
  FakeRecorder.autoFinish = false; const onError = vi.fn(); const session = await createAudioRecording({ onError });
  vi.advanceTimersByTime(50_000); recorders[0].finish(audioBlob(0, 7 * 1024 * 1024));
  recorders[1].data(audioBlob(1, 6 * 1024 * 1024));
  expect(track.stop).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][1]).toBeUndefined();
  recorders[1].finish(); recorders[0].finish(); await expect(session.stop()).rejects.toThrow('12 MB');
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending stop immediately and ignores later recorder events', async () => {
  FakeRecorder.autoFinish = false; const onError = vi.fn(), onLimit = vi.fn(), onLevel = vi.fn();
  const session = await createAudioRecording({ onError, onLimit, onLevel }); const pending = session.stop(); session.cancel();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  recorders[0].finish(); recorders[0].dispatchEvent(new Event('error')); vi.advanceTimersByTime(300_000);
  await expect(session.stop()).rejects.toMatchObject({ name: 'AbortError' });
  expect(track.stop).toHaveBeenCalledOnce(); expect(contexts[0].close).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled(); expect(onLimit).not.toHaveBeenCalled(); expect(onLevel).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels active capture via AbortSignal and releases the microphone', async () => {
  const controller = new AbortController(); const session = await createAudioRecording({ signal: controller.signal }); controller.abort();
  await expect(session.stop()).rejects.toMatchObject({ name: 'AbortError' });
  expect(track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('releases a stream arriving after microphone permission was cancelled', async () => {
  let grant!: (stream: MediaStream) => void;
  navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
  const controller = new AbortController(); const pending = createAudioRecording({ signal: controller.signal }); controller.abort(); grant(microphone);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(track.stop).toHaveBeenCalledOnce(); expect(recorders).toHaveLength(0);
});

it('never requests microphone permission for an already cancelled session', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(createAudioRecording({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it('releases resources if the first recorder cannot start', async () => {
  class BrokenRecorder extends FakeRecorder { start = vi.fn(() => { throw new Error('start failed'); }); }
  vi.stubGlobal('MediaRecorder', BrokenRecorder); await expect(createAudioRecording({})).rejects.toThrow('start failed');
  expect(track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  for (const context of contexts) expect(context.close).toHaveBeenCalledOnce();
});

it('propagates permission errors without opening a recorder', async () => {
  navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); });
  await expect(createAudioRecording({})).rejects.toMatchObject({ name: 'NotAllowedError' });
  expect(recorders).toHaveLength(0); expect(contexts).toHaveLength(0);
});

it('fails once and cleans up every active recorder if a rotation cannot start', async () => {
  const onError = vi.fn(); const session = await createAudioRecording({ onError });
  class BrokenRecorder extends FakeRecorder { start = vi.fn(() => { throw new Error('rotation failed'); }); }
  vi.stubGlobal('MediaRecorder', BrokenRecorder); expect(() => vi.advanceTimersByTime(50_000)).not.toThrow();
  await expect(session.stop()).rejects.toThrow(); expect(onError).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it.each(['recorder', 'microphone'])('reports a %s interruption once and releases resources', async source => {
  const onError = vi.fn(); const session = await createAudioRecording({ onError });
  const target = source === 'recorder' ? recorders[0] : track, event = source === 'recorder' ? 'error' : 'ended';
  target.dispatchEvent(new Event(event)); target.dispatchEvent(new Event(event)); await expect(session.stop()).rejects.toThrow();
  expect(onError).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  expect(contexts[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('rejects instead of hanging if a stopped recorder never delivers its final event', async () => {
  FakeRecorder.autoFinish = false; const onError = vi.fn(); const session = await createAudioRecording({ onError });
  const pending = session.stop(), rejected = expect(pending).rejects.toThrow('interrompida');
  expect(track.stop).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(1_500); await rejected;
  expect(onError).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('rejects an empty or header-only recording', async () => {
  FakeRecorder.autoFinish = false; const session = await createAudioRecording({});
  const pending = session.stop(); recorders[0].finish(audioBlob(0, 100));
  await expect(pending).rejects.toThrow('Nenhum áudio'); expect(track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('preserves an audible 400 ms tail after rotation even if the stop event arrives late', async () => {
  FakeRecorder.autoFinish = false; const session = await createAudioRecording({}); vi.advanceTimersByTime(50_400);
  const pending = session.stop(); vi.advanceTimersByTime(1_000); recorders[0].finish(); recorders[1].finish();
  expect(await pending).toHaveLength(2);
});

it('preserves a 400 ms tail when no level meter can establish silence', async () => {
  vi.stubGlobal('AudioContext', undefined);
  const session = await createAudioRecording({}); vi.advanceTimersByTime(50_400);
  expect(await session.stop()).toHaveLength(2);
});

it.each(['recorder', 'microphone', 'flush guard'] as const)('offers only already complete files after a %s interruption at 51 seconds', async source => {
  const onError = vi.fn(); const session = await createAudioRecording({ onError });
  vi.advanceTimersByTime(50_000); FakeRecorder.autoFinish = false; vi.advanceTimersByTime(1_000);
  // Data without its final stop event does not prove a complete container.
  recorders[1].data(audioBlob(9));
  if (source === 'flush guard') {
    const rejected = session.stop().catch(reason => reason);
    vi.advanceTimersByTime(1_500);
    expect(await rejected).toBeInstanceOf(Error);
  } else {
    (source === 'recorder' ? recorders[1] : track).dispatchEvent(new Event(source === 'recorder' ? 'error' : 'ended'));
  }
  expect(onError).toHaveBeenCalledOnce();
  const [error, clips] = onError.mock.calls[0] as [Error, Blob[]];
  expect(error.message).toContain('Confirme para transcrever'); expect(clips).toHaveLength(1);
  expect(clips[0].type).toBe(session.mimeType); expect(clips[0].size).toBe(2048);
  expect(track.stop).toHaveBeenCalledOnce(); expect(contexts[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  recorders[1].finish(audioBlob(9)); recorders[1].dispatchEvent(new Event('error'));
  expect(onError).toHaveBeenCalledOnce(); expect(clips).toHaveLength(1);
  await expect(session.stop()).rejects.toThrow('interrompida');
  vi.useRealTimers(); expect((await readBytes(clips[0])).slice(0, 5)).toEqual([0x1a, 0x45, 0xdf, 0xa3, 0]);
});

it.each(['cancel', 'abort'] as const)('discards completed files without exposing partials on %s', async source => {
  const onError = vi.fn(), controller = new AbortController();
  const session = await createAudioRecording({ onError, signal: controller.signal }); vi.advanceTimersByTime(51_000);
  if (source === 'cancel') session.cancel(); else controller.abort();
  await expect(session.stop()).rejects.toMatchObject({ name: 'AbortError' });
  recorders[1].finish(); vi.advanceTimersByTime(300_000);
  expect(onError).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledOnce();
  expect(contexts[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('drops a silent final tail while keeping the preceding complete file', async () => {
  const session = await createAudioRecording({}); vi.advanceTimersByTime(49_900); level = 0; vi.advanceTimersByTime(100);
  vi.advanceTimersByTime(1_000); expect(await session.stop()).toHaveLength(1);
});
