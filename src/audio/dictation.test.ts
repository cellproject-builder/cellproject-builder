import { beforeEach, expect, it, vi } from 'vitest';
import { DictationTranscription } from './dictation';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from './transcription';
import { MAX_TRANSCRIPT_LENGTH } from './limits';

vi.mock('./transcription', async () => ({ ...await vi.importActual('./limits'), transcribeAudio: vi.fn() }));
beforeEach(() => vi.mocked(transcribeAudio).mockReset());
const clip = () => new Blob(['recording'], { type: 'audio/webm' });
const result = (text: string) => ({ text, model: DEFAULT_AUDIO_MODEL });

it('only transcribes on confirmation and joins complete segments in their recorded order', async () => {
  const clips = [clip(), clip()];
  vi.mocked(transcribeAudio).mockResolvedValueOnce(result(' primeiro ')).mockResolvedValueOnce(result('segundo'));
  const session = new DictationTranscription(clips, 'pt');
  expect(transcribeAudio).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  expect(await session.transcribe(signal)).toBe('primeiro segundo');
  expect(vi.mocked(transcribeAudio).mock.calls.map(call => call[0])).toEqual(clips);
  expect(transcribeAudio).toHaveBeenCalledWith(clips[0], { language: 'pt', signal });
});

it('preserves successful segments and retries only the failed remainder after an explicit new call', async () => {
  const clips = [clip(), clip(), clip()];
  vi.mocked(transcribeAudio).mockResolvedValueOnce(result('um')).mockRejectedValueOnce(new Error('network'));
  const session = new DictationTranscription(clips, 'pt');
  const signal = new AbortController().signal;
  await expect(session.transcribe(signal)).rejects.toThrow('network');
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  vi.mocked(transcribeAudio).mockResolvedValueOnce(result('dois')).mockResolvedValueOnce(result('três'));
  expect(await session.transcribe(signal)).toBe('um dois três');
  expect(vi.mocked(transcribeAudio).mock.calls.map(call => call[0])).toEqual([clips[0], clips[1], clips[1], clips[2]]);
  expect(await session.transcribe(signal)).toBe('um dois três');
  expect(transcribeAudio).toHaveBeenCalledTimes(4);
});

it('rejects cancellation between segments and ignores a late provider result', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const session = new DictationTranscription([clip(), clip()], 'en');
  const controller = new AbortController();
  const pending = session.transcribe(controller.signal);
  controller.abort(); resolve(result('late'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(transcribeAudio).toHaveBeenCalledOnce();
});

it('does not charge again for concurrent confirmation', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const session = new DictationTranscription([clip()], 'pt');
  const signal = new AbortController().signal;
  const first = session.transcribe(signal), second = session.transcribe(signal);
  resolve(result('uma chamada'));
  expect(await first).toBe('uma chamada'); expect(await second).toBe('uma chamada');
  expect(transcribeAudio).toHaveBeenCalledOnce();
});

it('enforces a total transcript limit and does not silently insert an empty recording', async () => {
  const signal = new AbortController().signal;
  vi.mocked(transcribeAudio).mockResolvedValueOnce(result('a'.repeat(MAX_TRANSCRIPT_LENGTH))).mockResolvedValueOnce(result('b'));
  await expect(new DictationTranscription([clip(), clip()], 'pt').transcribe(signal)).rejects.toThrow(/limite/);
  vi.mocked(transcribeAudio).mockResolvedValue(result('   '));
  await expect(new DictationTranscription([clip()], 'pt').transcribe(signal)).rejects.toThrow(/fala/);
  await expect(new DictationTranscription([], 'pt').transcribe(signal)).rejects.toThrow(/fala/);
});
