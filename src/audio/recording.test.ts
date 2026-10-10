import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAudioRecording } from './recording';

let stopped: ReturnType<typeof vi.fn>, recorder: FakeRecorder;
class FakeRecorder extends EventTarget {
  static isTypeSupported = (mime: string) => mime.startsWith('audio/webm');
  state: RecordingState = 'inactive'; mimeType: string;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { super(); this.mimeType = options?.mimeType ?? 'audio/webm'; recorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]) })); this.dispatchEvent(new Event('stop')); }
}
const stream = () => ({ getTracks: () => [{ stop: stopped, addEventListener: vi.fn(), removeEventListener: vi.fn() }] }) as unknown as MediaStream;
beforeEach(() => { stopped = vi.fn(); vi.stubGlobal('MediaRecorder', FakeRecorder); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream()) } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('negotiates real MIME, produces a blob and ends microphone tracks', async () => {
  const session = await createAudioRecording({}); expect(session.mimeType).toContain('audio/webm'); const blob = await session.stop(); expect(blob.type).toBe(session.mimeType); expect(blob.size).toBeGreaterThan(0); expect(stopped).toHaveBeenCalledOnce(); session.cancel(); expect(stopped).toHaveBeenCalledOnce();
});
it('cancels the microphone and rejects later stop without emitting a recording', async () => {
  const session = await createAudioRecording({}); session.cancel(); expect(stopped).toHaveBeenCalledOnce(); await expect(session.stop()).rejects.toMatchObject({ name: 'AbortError' });
});
it('stops a stream that arrives after permission was cancelled', async () => {
  let grant!: (stream: MediaStream) => void; navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
  const controller = new AbortController(); const pending = createAudioRecording({ signal: controller.signal }); controller.abort(); grant(stream()); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(stopped).toHaveBeenCalledOnce();
});
it('ends on duration limit and reports elapsed time without waiting for user stop', async () => {
  vi.useFakeTimers(); const limit = vi.fn(), duration = vi.fn(); const session = await createAudioRecording({ onLimit: limit, onDuration: duration });
  vi.advanceTimersByTime(300000); expect(limit).toHaveBeenCalledOnce(); expect(stopped).toHaveBeenCalledOnce(); expect(duration).toHaveBeenCalledWith(300); expect((await session.stop()).size).toBeGreaterThan(0);
});
it('ends tracks if MediaRecorder.start fails and reports permission errors', async () => {
  class Broken extends FakeRecorder { start() { throw new Error('start failed'); } } vi.stubGlobal('MediaRecorder', Broken); await expect(createAudioRecording({})).rejects.toThrow('start failed'); expect(stopped).toHaveBeenCalledOnce();
  navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }); await expect(createAudioRecording({})).rejects.toMatchObject({ name: 'NotAllowedError' });
});
it('aborts an active capture and notifies recorder failures exactly once', async () => {
  const onError = vi.fn(); const session = await createAudioRecording({ onError }); recorder.dispatchEvent(new Event('error')); expect(onError).toHaveBeenCalledOnce(); expect(stopped).toHaveBeenCalledOnce(); await expect(session.stop()).rejects.toThrow();
});
