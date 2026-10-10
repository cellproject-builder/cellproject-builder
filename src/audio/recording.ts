import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from './limits';

export interface AudioRecording { mimeType: string; stop: () => Promise<Blob>; cancel: () => void }
export interface RecordingOptions { onDuration?: (seconds: number) => void; onLimit?: () => void; onError?: (error: Error) => void; signal?: AbortSignal }
const abortError = () => new DOMException('Gravação cancelada.', 'AbortError');
/** No microphone access before this user-initiated call. Never retains a stream after failure/cancel. */
export async function createAudioRecording(options: RecordingOptions): Promise<AudioRecording> {
  if (options.signal?.aborted) throw abortError();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador não permite gravar aqui. Use HTTPS ou importe um arquivo de áudio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const tracks = stream.getTracks();
  if (options.signal?.aborted) { tracks.forEach(track => track.stop()); throw abortError(); }
  let recorder: MediaRecorder;
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(mime => MediaRecorder.isTypeSupported(mime));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 });
  } catch (error) { tracks.forEach(track => track.stop()); throw error; }
  const chunks: Blob[] = []; const waiting: { resolve: (blob: Blob) => void; reject: (error: Error) => void }[] = [];
  let size = 0, result: Blob | null = null, failure: Error | null = null, disposed = false, stopping = false;
  let interval: ReturnType<typeof setInterval> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (disposed) return; disposed = true;
    clearInterval(interval); clearTimeout(deadline); options.signal?.removeEventListener('abort', cancel);
    recorder.removeEventListener('dataavailable', data); recorder.removeEventListener('stop', finish); recorder.removeEventListener('error', failed);
    tracks.forEach(track => { track.removeEventListener('ended', ended); track.stop(); });
  };
  const reject = (error: Error) => { failure = error; chunks.length = 0; cleanup(); if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Tracks already ended. */ } } waiting.splice(0).forEach(item => item.reject(error)); };
  const cancel = () => { if (!disposed) reject(abortError()); };
  const fail = (error: Error) => { if (!disposed) { reject(error); options.onError?.(error); } };
  const failed = () => fail(new Error('A gravação foi interrompida. Tente novamente.'));
  const ended = () => fail(new Error('O microfone foi desconectado.'));
  const finish = () => {
    if (disposed) return;
    if (!size) { fail(new Error('Nenhum áudio foi capturado.')); return; }
    result = new Blob(chunks, { type: recorder.mimeType }); chunks.length = 0; cleanup(); waiting.splice(0).forEach(item => item.resolve(result!));
  };
  const halt = () => { if (!disposed && !stopping) { stopping = true; try { recorder.stop(); } catch { failed(); } } };
  const data = (event: BlobEvent) => {
    if (disposed || !event.data.size) return;
    if (size + event.data.size > MAX_AUDIO_BYTES) { fail(new Error('A gravação excedeu 12 MB. Grave um trecho menor.')); return; }
    size += event.data.size; chunks.push(event.data);
  };
  recorder.addEventListener('dataavailable', data); recorder.addEventListener('stop', finish); recorder.addEventListener('error', failed);
  tracks.forEach(track => track.addEventListener('ended', ended)); options.signal?.addEventListener('abort', cancel, { once: true });
  try { recorder.start(250); } catch (error) { cleanup(); throw error; }
  const started = Date.now();
  interval = setInterval(() => options.onDuration?.(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - started) / 1000))), 250);
  deadline = setTimeout(() => { options.onDuration?.(MAX_RECORDING_SECONDS); halt(); options.onLimit?.(); }, MAX_RECORDING_SECONDS * 1000);
  return {
    mimeType: recorder.mimeType,
    cancel,
    stop: () => {
      if (result) return Promise.resolve(result);
      if (failure) return Promise.reject(failure);
      const promise = new Promise<Blob>((resolve, reject) => waiting.push({ resolve, reject })); halt(); return promise;
    },
  };
}
