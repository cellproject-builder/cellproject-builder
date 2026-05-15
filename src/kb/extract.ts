// Extração local de texto de PDF via pdf.js (Mozilla).
// Roda 100% no browser — o PDF nunca sai do dispositivo até a etapa opcional
// de resumo, onde apenas o texto extraído é enviado ao modelo.

import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
// O `?url` é parsed pelo Vite: retorna a URL resolvida do worker bundled.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface ExtractResult {
  text: string;
  pageCount: number;
}

export type ExtractProgress = (pagesDone: number, totalPages: number) => void;

export async function extractPdfText(
  file: File,
  onProgress?: ExtractProgress,
): Promise<ExtractResult> {
  const buf = await file.arrayBuffer();
  // `disableWorker: false` é o default; mantemos o worker pra não travar a UI.
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const totalPages = doc.numPages;

  const pageTexts: string[] = [];
  for (let i = 1; i <= totalPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdf.js devolve items heterogêneos (texto + marcadores). Filtramos por TextItem.
    const line = content.items
      .filter((it): it is TextItem => 'str' in it)
      .map((it) => it.str)
      .join(' ');
    pageTexts.push(line.replace(/\s+/g, ' ').trim());
    onProgress?.(i, totalPages);
  }

  const text = pageTexts.join('\n\n').trim();
  return { text, pageCount: totalPages };
}

// Hash simples (djb2) — suficiente pra deduplicar documentos localmente.
// Não precisa ser criptográfico; só queremos detectar "já processei este texto".
export function fingerprintText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
