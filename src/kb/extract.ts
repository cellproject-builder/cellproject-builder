// Extração local de texto de PDF via pdf.js (Mozilla).
// Roda 100% no browser — o arquivo nunca sai do dispositivo. Na etapa de
// resumo, o texto extraído (recortado em ~40k caracteres) vai pro modelo.

import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
// O `?url` é parsed pelo Vite: retorna a URL resolvida do worker bundled.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface ExtractResult {
  text: string;
  pageCount: number;
  truncated?: boolean;
}

export type ExtractProgress = (pagesDone: number, totalPages: number) => void;

export async function extractPdfText(
  file: File,
  onProgress?: ExtractProgress,
  options: { signal?: AbortSignal; maxPages?: number; maxChars?: number } = {},
): Promise<ExtractResult> {
  options.signal?.throwIfAborted();
  const buf = await file.arrayBuffer();
  options.signal?.throwIfAborted();
  // `disableWorker: false` é o default; mantemos o worker pra não travar a UI.
  const task = pdfjs.getDocument({ data: buf });
  const abort = () => { void Promise.resolve(task.destroy()).catch(() => {}); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
  const doc = await task.promise;
  const totalPages = doc.numPages;
  if (options.maxPages && totalPages > options.maxPages) throw new Error('visualPdfPageLimit');

  const pageTexts: string[] = [];
  for (let i = 1; i <= totalPages; i += 1) {
    options.signal?.throwIfAborted();
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    options.signal?.throwIfAborted();
    // pdf.js devolve items heterogêneos (texto + marcadores). Filtramos por TextItem.
    const line = content.items
      .filter((it): it is TextItem => 'str' in it)
      .map((it) => it.str)
      .join(' ');
    pageTexts.push(line.replace(/\s+/g, ' ').trim());
    onProgress?.(i, totalPages);
    if (options.maxChars && pageTexts.reduce((sum, text) => sum + text.length + 2, 0) >= options.maxChars) break;
  }

  const fullText = pageTexts.join('\n\n').trim(), text = fullText.slice(0, options.maxChars);
  return { text, pageCount: totalPages, ...(pageTexts.length < totalPages || text.length < fullText.length ? { truncated: true } : {}) };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await task.destroy();
  }
}

// Hash simples (djb2) — suficiente pra deduplicar documentos localmente.
// Não precisa ser criptográfico; só queremos detectar "já processei este texto".
export { fingerprintText } from './content';
