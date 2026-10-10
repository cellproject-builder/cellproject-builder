/** Audio bytes stay transient; documents only receive the accepted transcript. */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 300;
export const MAX_TRANSCRIPT_LENGTH = 32_000;
export const AUDIO_MODELS = [
  { id: 'openai/gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe' },
  { id: 'openai/whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo' },
] as const;
export type AudioModel = typeof AUDIO_MODELS[number]['id'];
// Tested against the real account on 2026-10-10. Mini was listed in the catalog
// but its three first attempts returned 404; never hide that with a paid retry.
export const DEFAULT_AUDIO_MODEL: AudioModel = 'openai/whisper-large-v3-turbo';
