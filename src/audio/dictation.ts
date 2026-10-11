import { MAX_TRANSCRIPT_LENGTH } from './limits';
import { transcribeAudio } from './transcription';

const assertActive = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Ditado cancelado.', 'AbortError');
};

/** Complete recordings stay in memory; explicit retry reuses already transcribed parts. */
export class DictationTranscription {
  private readonly texts: (string | undefined)[];
  private pending: Promise<string> | null = null;

  constructor(private readonly clips: Blob[], private readonly language: 'pt' | 'en') {
    this.texts = new Array(clips.length);
  }

  transcribe(signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(new DOMException('Ditado cancelado.', 'AbortError'));
    if (this.pending) return this.pending;
    this.pending = this.run(signal).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async run(signal: AbortSignal): Promise<string> {
    for (let index = 0; index < this.clips.length; index++) {
      assertActive(signal);
      if (this.texts[index] !== undefined) continue;
      const result = await transcribeAudio(this.clips[index], { language: this.language, signal });
      assertActive(signal);
      this.texts[index] = result.text.trim();
    }
    assertActive(signal);
    const text = this.texts.filter(Boolean).join(' ');
    if (!text) throw new Error('Não foi possível identificar fala. Grave novamente.');
    if (text.length > MAX_TRANSCRIPT_LENGTH) throw new Error('O ditado ultrapassa o limite de texto. Grave um trecho menor.');
    return text;
  }
}
