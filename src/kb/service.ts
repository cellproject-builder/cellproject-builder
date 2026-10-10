import { generateObject, NoObjectGeneratedError } from 'ai';
import { kbModel, assertAIReady, currentModelIds, isReasoningModel } from '@/ai/client';
import { currentLocaleAIName } from '@/i18n';
import { readRateLimit } from '@/ai/rateLimit';
import { KBSummarySchema, RelevancePickSchema } from './schemas';
import type { KBContextEntry, KBDocument, KBSummary } from './types';

// ---------------------------------------------------------------------------
// summarizeDocument — 1 call to kbModel per upload.
// We clip the input before sending: most useful PDFs fit in ~40k chars from
// the first slice, and cheap models have limited context. If the doc is much
// larger we take start + middle chunk + end — good coverage without blowing
// up the prompt.
// ---------------------------------------------------------------------------

export const MAX_CHARS = 40_000;

// Parâmetros das chamadas do kbModel: modelos de raciocínio ignoram/rejeitam
// temperature; o teto de saída ganha folga pros tokens de pensamento.
function kbCallOpts(
  temperature: number,
  budget: number,
): { temperature?: number; maxOutputTokens: number } {
  const id = currentModelIds()?.kb;
  const reasoning = !!id && isReasoningModel(id);
  return reasoning
    ? { maxOutputTokens: budget + 4_000 }
    : { temperature, maxOutputTokens: budget };
}

// O kbModel padrão (gemini flash-lite via OpenRouter) às vezes corta a
// resposta no meio (finishReason "other", JSON inválido). É transitório:
// repetimos uma vez antes de mostrar erro ao usuário.
async function withOneRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (signal?.aborted || readRateLimit(e) || !NoObjectGeneratedError.isInstance(e)) throw e;
    return await fn();
  }
}

// O trecho exato do texto que vai pro modelo no resumo — a UI mostra isso em
// "ver texto enviado", pra privacidade ser verificável e não só prometida.
export function textSentToModel(text: string): string {
  return clipText(text);
}

function clipText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const chunk = Math.floor(MAX_CHARS / 3);
  const start = text.slice(0, chunk);
  const midStart = Math.floor(text.length / 2) - Math.floor(chunk / 2);
  const mid = text.slice(midStart, midStart + chunk);
  const end = text.slice(-chunk);
  return `${start}\n\n[...cut...]\n\n${mid}\n\n[...cut...]\n\n${end}`;
}

function summarySystem(): string {
  const lang = currentLocaleAIName();
  return `You are a knowledge indexer. Given a document's text, extract a structured summary that will be used later as background context by another planning AI.

RULES
- Respond in ${lang}, even when the document is in another language (translate concepts, not established technical vocabulary).
- Stay faithful to the text. DO NOT invent facts that are not there.
- 'dominio' must be short and specific — "analog electronics" is useful, "science" is useless.
- 'fatos' should contain VERIFIABLE claims: measurements with units, limits, explicit rules from the author. If the text is purely conceptual, return an empty array.
- If authors are not mentioned in the text, return null for 'autores'. Do not invent.
- In 'fatos', 'valor' is the isolated value when there is one, otherwise null.`;
}

export async function summarizeDocument(
  extractedText: string,
  opts: { signal?: AbortSignal } = {},
): Promise<KBSummary> {
  assertAIReady();
  const clipped = clipText(extractedText);
  const prompt = `DOCUMENT (extracted text, may be clipped):
"""
${clipped}
"""

TASK
Generate the structured summary for this document.`;
  const { object } = await withOneRetry(
    () =>
      generateObject({
        model: kbModel,
        schema: KBSummarySchema,
        schemaName: 'KBSummary',
        system: summarySystem(),
        prompt,
        ...kbCallOpts(0.3, 2_500),
        abortSignal: opts.signal,
      }),
    opts.signal,
  );
  // null (strict schema) → ausente no tipo persistido.
  return {
    titulo: object.titulo,
    autores: object.autores?.trim() || undefined,
    dominio: object.dominio,
    tags: object.tags,
    resumo: object.resumo,
    fatos: object.fatos.map((f) => ({
      claim: f.claim,
      tipo: f.tipo,
      ...(f.valor?.trim() ? { valor: f.valor.trim() } : {}),
    })),
    nivel: object.nivel,
  };
}

// ---------------------------------------------------------------------------
// pickRelevantDocs — AI relevance judge.
// Receives the pool of known docs (only title + domain + tags + first bullet
// of the summary, to keep the prompt cheap) plus the context being planned.
// Returns up to N ids considered relevant, with a reason.
// ---------------------------------------------------------------------------

export interface PickContext {
  // Usage context: project goal + breadcrumb + optional node name.
  label: string;
  extra?: string;
  // Chave estável do contexto (ex.: id do nó). Sem ela, o store deriva uma
  // chave de label/extra — sem o texto da falha. Ver kb/store.ts.
  cacheKey?: string;
}

export interface KBRequestOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  beforeRequest?: () => Promise<void>;
}

function judgeSystem(): string {
  const lang = currentLocaleAIName();
  return `You pick which documents from a personal repository are relevant to a specific planning goal.

RULES
- Respond in ${lang}.
- Be strict. Prefer empty over including tangential docs. "Somewhat related" = do not include.
- Justify in 1 direct sentence. If no doc applies, return an empty array.
- Maximum 2 docs. If more than 2 seem relevant, pick the 2 best.`;
}

export async function pickRelevantDocs(
  ctx: PickContext,
  docs: KBDocument[],
  max = 2,
  opts: KBRequestOptions = {},
): Promise<{ docId: string; reason: string }[]> {
  if (docs.length === 0) return [];
  assertAIReady();

  const catalog = docs
    .map(
      (d) =>
        `- docId: ${d.id}
  title: ${d.summary.titulo}
  domain: ${d.summary.dominio}
  tags: ${d.summary.tags.slice(0, 8).join(', ')}
  summary: ${d.summary.resumo[0] ?? ''}`,
    )
    .join('\n');

  const prompt = `USAGE CONTEXT
${ctx.label}
${ctx.extra ? `\nDetail: ${ctx.extra}` : ''}

AVAILABLE REPOSITORY
${catalog}

TASK
Pick up to ${max} docs whose content directly applies to the context. Empty if none applies.`;
  const { object } = await withOneRetry(
    async () => {
      await opts.beforeRequest?.();
      opts.signal?.throwIfAborted();
      return generateObject({
        model: kbModel,
        schema: RelevancePickSchema,
        schemaName: 'RelevancePick',
        system: judgeSystem(),
        prompt,
        ...kbCallOpts(0.2, 600),
        abortSignal: opts.signal,
        maxRetries: opts.maxRetries,
      });
    },
    opts.signal,
  );

  // Defensive filter: drop invalid ids (model may hallucinate).
  const validIds = new Set(docs.map((d) => d.id));
  return object.picks.filter((p) => validIds.has(p.docId)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Helper: builds KBContextEntry[] to inject into ai/service.ts prompts
// ---------------------------------------------------------------------------

export function toContextEntries(
  docs: KBDocument[],
  reasons?: Record<string, string>,
): KBContextEntry[] {
  return docs.map((d) => ({
    docId: d.id,
    titulo: d.summary.titulo,
    dominio: d.summary.dominio,
    resumo: d.summary.resumo,
    fatos: d.summary.fatos,
    tags: d.summary.tags,
    ...(reasons?.[d.id] ? { reason: reasons[d.id] } : {}),
  }));
}
