import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from './limits';

export interface AudioRecording {
  mimeType: string;
  stop: () => Promise<Blob[]>;
  cancel: () => void;
}
export interface RecordingOptions {
  onDuration?: (seconds: number) => void;
  onLimit?: () => void;
  onError?: (error: Error, clips?: Blob[]) => void;
  onLevel?: (level: number) => void;
  signal?: AbortSignal;
}

const SEGMENT_MS = 50_000, SOFT_SEGMENT_MS = 40_000, SILENCE_GAP_MS = 300;
const SILENCE_LEVEL = 0.015, LEVEL_POLL_MS = 100, EMPTY_BYTES = 1024, STOP_GUARD_MS = 1_500;
const abortError = () => new DOMException('Gravação cancelada.', 'AbortError');
const interruptedError = () => new Error('A gravação foi interrompida. Tente novamente.');

interface LevelMeter { level: () => number | null; close: () => void }

/** Metering is optional. A broken/suspended Web Audio session must not lose the recording. */
function createLevelMeter(stream: MediaStream): LevelMeter | null {
  const scope = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return null;
  let context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { source?.disconnect(); } catch { /* Already disconnected. */ }
    try { analyser?.disconnect(); } catch { /* Already disconnected. */ }
    try { void context?.close().catch(() => undefined); } catch { /* Already closed. */ }
  };
  try {
    const runningContext = new Context(); context = runningContext;
    void runningContext.resume().catch(() => undefined);
    const mediaSource = runningContext.createMediaStreamSource(stream); source = mediaSource;
    const levelAnalyser = runningContext.createAnalyser(); analyser = levelAnalyser;
    levelAnalyser.fftSize = 2048;
    mediaSource.connect(levelAnalyser);
    const samples = new Float32Array(levelAnalyser.fftSize);
    return {
      close,
      level: () => {
        // A suspended analyser returns zeroes without measuring silence.
        if (runningContext.state !== 'running') return null;
        levelAnalyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        return Math.min(1, Math.sqrt(sum / samples.length));
      },
    };
  } catch { close(); return null; }
}

interface Segment {
  recorder: MediaRecorder;
  began: number;
  peak: number | null;
  measurementIncomplete: boolean;
  chunks: Blob[];
  blob: Blob | null;
  closed: boolean;
  stopRequested: boolean;
  guard?: ReturnType<typeof setTimeout>;
  detach: () => void;
}

/**
 * Uses one microphone and a new MediaRecorder per segment so every Blob has
 * its own container header. Capture stays in memory until explicit confirmation;
 * duration limits only close capture and notify the caller, never transcribe.
 */
export async function createAudioRecording(options: RecordingOptions): Promise<AudioRecording> {
  if (options.signal?.aborted) throw abortError();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador não permite gravar aqui. Use HTTPS e um navegador com acesso ao microfone.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const tracks = stream.getTracks();
  if (options.signal?.aborted) { tracks.forEach(track => track.stop()); throw abortError(); }
  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
    .find(mime => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime));
  const segments: Segment[] = [];
  const waiting: { resolve: (blobs: Blob[]) => void; reject: (error: Error) => void }[] = [];
  const began = Date.now();
  let current: Segment | null = null, meter = createLevelMeter(stream);
  let result: Blob[] | null = null, failure: Error | null = null;
  let totalBytes = 0, silentFor = 0, stopping = false, released = false, limitNotified = false;
  let rotation: ReturnType<typeof setTimeout> | undefined, duration: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;

  const terminal = () => result !== null || failure !== null;
  const releaseInput = () => {
    if (released) return;
    released = true;
    clearTimeout(rotation); clearTimeout(deadline); clearInterval(duration); clearInterval(poll);
    for (const track of tracks) track.removeEventListener('ended', ended);
    tracks.forEach(track => track.stop());
    meter?.close(); meter = null;
  };
  const detach = () => {
    options.signal?.removeEventListener('abort', cancel);
    for (const segment of segments) { clearTimeout(segment.guard); segment.detach(); }
  };
  const fail = (error: Error, notify = true, preserveCompleted = true) => {
    if (terminal()) return;
    // Only final stop events establish complete files. Never expose cancelled
    // or oversized audio, and never promote an unfinished recorder's chunks.
    const clips = notify && preserveCompleted && error.name !== 'AbortError'
      ? segments.flatMap(segment => segment.closed && segment.blob ? [segment.blob] : []) : [];
    const reported = clips.length
      ? new Error('A gravação foi interrompida. Confirme para transcrever os trechos capturados.') : error;
    failure = reported; stopping = true;
    releaseInput(); detach();
    for (const segment of segments) {
      segment.chunks.length = 0; segment.blob = null;
      if (segment.recorder.state !== 'inactive') {
        try { segment.recorder.stop(); } catch { /* Failed recorder; input is already released. */ }
      }
    }
    waiting.splice(0).forEach(item => item.reject(reported));
    if (notify) options.onError?.(reported, clips.length ? clips : undefined);
  };
  const cancel = () => fail(abortError(), false, false);
  const ended = () => fail(new Error('O microfone foi desconectado.'));
  const maybeFinish = () => {
    if (!stopping || terminal() || segments.some(segment => !segment.closed)) return;
    const blobs = segments.flatMap(segment => segment.blob ? [segment.blob] : []);
    if (!blobs.length) { fail(new Error('Nenhum áudio foi capturado.')); return; }
    result = blobs; detach();
    waiting.splice(0).forEach(item => item.resolve(blobs));
  };
  const flushSegment = (segment: Segment) => {
    if (segment.closed || terminal()) return;
    try { if (segment.recorder.state !== 'inactive') segment.recorder.stop(); }
    catch { fail(interruptedError()); return; }
    if (!segment.closed && !terminal()) segment.guard = setTimeout(() => fail(interruptedError()), STOP_GUARD_MS);
  };
  const stopSegment = (segment: Segment) => {
    if (segment.closed || segment.stopRequested || terminal()) return;
    segment.stopRequested = true; flushSegment(segment);
  };
  const halt = () => {
    if (stopping || terminal()) return;
    stopping = true;
    // Release tracks/context immediately, while final data/stop events can still arrive.
    // Mark requests before releasing the stream: track.stop may stop a recorder too.
    const pending = segments.filter(segment => !segment.closed && !segment.stopRequested);
    for (const segment of pending) segment.stopRequested = true;
    releaseInput();
    for (const segment of pending) flushSegment(segment);
    maybeFinish();
  };
  const reachLimit = () => {
    if (limitNotified || stopping || terminal()) return;
    limitNotified = true;
    options.onDuration?.(MAX_RECORDING_SECONDS); halt();
    if (!failure) options.onLimit?.();
  };
  const openSegment = () => {
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    const segment: Segment = {
      recorder, began: Date.now(), peak: null, measurementIncomplete: meter === null, chunks: [], blob: null,
      closed: false, stopRequested: false, detach: () => {},
    };
    const index = segments.length;
    const data = (event: BlobEvent) => {
      if (terminal() || segment.closed || !event.data.size) return;
      if (totalBytes + event.data.size > MAX_AUDIO_BYTES) {
        fail(new Error('A gravação excedeu 12 MB. Grave um trecho menor.'), true, false); return;
      }
      totalBytes += event.data.size; segment.chunks.push(event.data);
    };
    const failed = () => fail(interruptedError());
    const finish = () => {
      if (terminal() || segment.closed) return;
      if (!segment.stopRequested) { fail(interruptedError()); return; }
      segment.closed = true; clearTimeout(segment.guard); segment.detach();
      const blob = new Blob(segment.chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      segment.chunks.length = 0;
      // A short tail can contain a complete word. An unmeasured interval may
      // contain speech even if sampling later resumes and measures silence.
      const usableTail = index === 0 || segment.measurementIncomplete || segment.peak === null || segment.peak >= SILENCE_LEVEL;
      if (blob.size >= EMPTY_BYTES && usableTail) segment.blob = blob;
      maybeFinish();
    };
    segment.detach = () => {
      recorder.removeEventListener('dataavailable', data); recorder.removeEventListener('stop', finish); recorder.removeEventListener('error', failed);
    };
    segments.push(segment);
    recorder.addEventListener('dataavailable', data); recorder.addEventListener('stop', finish); recorder.addEventListener('error', failed);
    // No timeslice: each recorder must finish a complete, independently decodable file.
    recorder.start(); current = segment; silentFor = 0;
    rotation = setTimeout(rotate, SEGMENT_MS);
    return segment;
  };
  function rotate() {
    if (stopping || terminal() || !current) return;
    if (Date.now() - began >= MAX_RECORDING_SECONDS * 1000) { reachLimit(); return; }
    clearTimeout(rotation);
    const previous = current;
    // Start on the same stream before asking the previous recorder to flush.
    try { openSegment(); } catch { fail(interruptedError()); return; }
    stopSegment(previous);
  }

  tracks.forEach(track => track.addEventListener('ended', ended));
  options.signal?.addEventListener('abort', cancel, { once: true });
  try { openSegment(); }
  catch (error) { fail(error instanceof Error ? error : interruptedError(), false); throw error; }
  duration = setInterval(() => options.onDuration?.(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - began) / 1000))), 1000);
  deadline = setTimeout(reachLimit, MAX_RECORDING_SECONDS * 1000);
  if (meter) poll = setInterval(() => {
    if (stopping || terminal() || !current || !meter) return;
    let level: number | null;
    try { level = meter.level(); }
    catch { current.measurementIncomplete = true; meter.close(); meter = null; clearInterval(poll); return; }
    if (level === null || !Number.isFinite(level)) { current.measurementIncomplete = true; silentFor = 0; return; }
    current.peak = Math.max(current.peak ?? 0, level);
    options.onLevel?.(level);
    silentFor = level < SILENCE_LEVEL ? silentFor + LEVEL_POLL_MS : 0;
    if (Date.now() - current.began >= SOFT_SEGMENT_MS && silentFor >= SILENCE_GAP_MS) rotate();
  }, LEVEL_POLL_MS);

  return {
    mimeType: current!.recorder.mimeType || mimeType || 'audio/webm', cancel,
    stop: () => {
      if (result) return Promise.resolve(result);
      if (failure) return Promise.reject(failure);
      const promise = new Promise<Blob[]>((resolve, reject) => waiting.push({ resolve, reject }));
      halt(); return promise;
    },
  };
}
