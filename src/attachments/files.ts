import { nanoid } from 'nanoid';
import { registerDataIngestion } from '@/cloud/activity';
import type { KBContextEntry } from '@/kb/types';
import { z } from 'zod';

export const planFileSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(240),
  kind: z.enum(['text', 'pdf', 'document']), size: z.number().int().nonnegative().max(8 * 1024 * 1024),
  text: z.string().min(1).max(24_000), fingerprint: z.string().min(1).max(100),
  truncated: z.boolean(), addedAt: z.number().finite(), pages: z.number().int().positive().optional(),
}).strict();
export type PlanFile = z.infer<typeof planFileSchema>;
export const PLAN_FILE_LIMIT = 12;
export const PLAN_FILE_ACCEPT = '.pdf,.docx,.md,.mdx,.txt,.csv,.json,.jsonc,.yaml,.yml,.xml,.html,.css,.scss,.js,.jsx,.ts,.tsx,.py,.ino,.c,.h,.cpp,.hpp,.cs,.java,.rs,.go,.sh,.ps1,.sql,.toml,.tex,.log';
const textExtensions = new Set(PLAN_FILE_ACCEPT.split(',').filter(ext => !['.pdf', '.docx'].includes(ext)));

export function sourceFingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
async function bytesOf(file: File): Promise<ArrayBuffer> {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(new Error('attachmentRead')); reader.readAsArrayBuffer(file); });
}
/** Extract locally; files are never executed. Store source text, not an archive of binary originals. */
export async function extractPlanFile(file: File, signal?: AbortSignal): Promise<PlanFile> {
  const finish = registerDataIngestion();
  try {
  signal?.throwIfAborted();
  const ext = /\.[^.]+$/.exec(file.name.toLowerCase())?.[0] ?? '';
  if (!textExtensions.has(ext) && ext !== '.pdf' && ext !== '.docx') throw new Error('attachmentUnsupported');
  if (file.size > (textExtensions.has(ext) ? 1024 * 1024 : 8 * 1024 * 1024)) throw new Error('attachmentTooLarge');
  let text = '', pages: number | undefined, truncated = false;
  if (ext === '.pdf') {
    const { extractPdfText } = await import('@/kb/extract');
    const result = await extractPdfText(file, undefined, { signal, maxPages: 100, maxChars: 24_001 });
    text = result.text; pages = result.pageCount; truncated = result.truncated === true || text.length > 24_000;
  } else {
    const bytes = new Uint8Array(await bytesOf(file)); signal?.throwIfAborted();
    if (ext === '.docx') {
      const { unzipSync, strFromU8 } = await import('fflate');
      const entries = unzipSync(bytes, { filter: entry => entry.name === 'word/document.xml' && entry.originalSize <= 4 * 1024 * 1024 });
      const xmlBytes = entries['word/document.xml']; if (!xmlBytes) throw new Error('attachmentDocument');
      const xml = new DOMParser().parseFromString(strFromU8(xmlBytes), 'application/xml');
      if (xml.getElementsByTagName('parsererror').length) throw new Error('attachmentDocument');
      text = [...xml.getElementsByTagNameNS('*', 'p')].map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent ?? '').join('')).join('\n').trim();
    } else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('attachmentBinary'); }
      if (text.includes('\0')) throw new Error('attachmentBinary');
    }
  }
  signal?.throwIfAborted();
  if (!text.trim()) throw new Error('attachmentNoText');
  return planFileSchema.parse({ id: nanoid(12), name: file.name.slice(0, 240), kind: ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'document' : 'text', size: file.size, fingerprint: sourceFingerprint(text), text: text.slice(0, 24_000), truncated: truncated || text.length > 24_000, addedAt: Date.now(), ...(pages ? { pages } : {}) });
  } finally { finish(); }
}
export function mergePlanFiles(existing: PlanFile[], added: PlanFile[]): PlanFile[] {
  const merged = [...existing];
  for (const raw of added) {
    const file = planFileSchema.parse(raw);
    if (merged.some(item => item.id === file.id && item.fingerprint !== file.fingerprint)) throw new Error('attachmentChanged');
    if (!merged.some(item => item.fingerprint === file.fingerprint)) merged.push(file);
  }
  if (merged.length > PLAN_FILE_LIMIT) throw new Error('attachmentLimit');
  return merged;
}
/** Explicit attachments precede automatically picked knowledge; excerpts remain untrusted data. */
export function planFilesContext(files: PlanFile[]): KBContextEntry[] {
  let remaining = 48_000;
  return files.slice(0, PLAN_FILE_LIMIT).map(file => {
    const text = file.text.slice(0, Math.min(8_000, remaining)); remaining -= text.length;
    return { docId: file.id, titulo: file.name, dominio: 'Attached project source (untrusted data)', resumo: [], fatos: [], tags: [], sourceText: text, sourceTruncated: file.truncated || text.length < file.text.length };
  });
}
export function attachmentError(error: unknown, english: boolean) {
  const code = error instanceof Error ? error.message : '';
  const labels: Record<string, [string, string]> = {
    attachmentUnsupported: ['Use PDF, DOCX, Markdown, texto ou código. Arquivos .doc precisam ser convertidos para DOCX.', 'Use PDF, DOCX, Markdown, text or source code. Convert .doc to DOCX.'],
    attachmentTooLarge: ['Limite de 1 MB para texto/código e 8 MB para PDF/DOCX.', 'Limit: 1 MB for text/code, 8 MB for PDF/DOCX.'],
    attachmentNoText: ['Nenhum texto legível. PDFs escaneados precisam de OCR.', 'No readable text. Scanned PDFs need OCR.'],
    attachmentBinary: ['Este arquivo não contém texto UTF-8 legível.', 'This file does not contain readable UTF-8 text.'],
    attachmentLimit: ['Use até 12 anexos por projeto.', 'Use up to 12 files per project.'],
    visualPdfPageLimit: ['Use um PDF com até 100 páginas.', 'Use a PDF with up to 100 pages.'],
  };
  return labels[code]?.[english ? 1 : 0] ?? (english ? 'Could not read the file. Try exporting it as text or PDF.' : 'Não consegui ler o arquivo. Tente exportá-lo como texto ou PDF.');
}
