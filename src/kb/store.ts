import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { selectedStorage } from '@/cloud/storage';
import { registerDataIngestion } from '@/cloud/activity';
const idbGet = selectedStorage.getItem, idbSet = selectedStorage.setItem, idbDel = selectedStorage.removeItem;
import { nanoid } from 'nanoid';
import { t } from '@/i18n';
import { classifyAIError, type AIErrorInfo } from '@/ai/service';
import { readRateLimit } from '@/ai/rateLimit';
import type {
  KBContextEntry,
  KBContextResult,
  KBDocSummaryView,
  KBDocUsage,
  KBDocument,
  KBPickMode,
  KBUsedDoc,
} from './types';
import { pickRelevantDocs, summarizeDocument, toContextEntries, type PickContext, type KBRequestOptions } from './service';

type IngestPhase = 'extracting' | 'summarizing' | 'done' | 'error';

// Por que a ingestão falhou — a UI traduz e decide se oferece "tentar de novo".
export type IngestErrorKind = 'notPdf' | 'noText' | 'extract' | 'summary';

export interface IngestProgress {
  phase: IngestPhase;
  filename: string;
  pagesDone?: number;
  totalPages?: number;
  // Mensagem crua (compat); a UI prefere errorKind/errorInfo.
  error?: string;
  errorKind?: IngestErrorKind;
  // Falha do resumo por IA, já classificada (auth, créditos, rede…).
  errorInfo?: AIErrorInfo;
  // done: o texto já estava na base (dedup por fingerprint), nada foi enviado.
  duplicate?: boolean;
  docId?: string;
}

// Último contexto da base usado numa ação de IA — outros componentes podem
// assinar pra mostrar "Baseado em: …".
export interface KBLastContext {
  at: number;
  label: string;
  docs: KBUsedDoc[];
  mode: KBPickMode;
}

interface PickCacheEntry {
  ids: string[];
  reasons: Record<string, string>;
  at: number;
}

interface KBContextOptions extends KBRequestOptions {
  // Chat must stop the entire run after a provider limit instead of continuing
  // into another planning request with empty knowledge context.
  throwOnRateLimit?: boolean;
}

interface KBState {
  docs: Record<string, KBDocument>;
  // Escolhas do juiz de relevância por contexto (objetivo, ou nó com base
  // grande). Persistido pra sobreviver reload; zerado quando a base muda.
  pickCache: Record<string, PickCacheEntry>;
  usage: Record<string, KBDocUsage>;
  lastContext: KBLastContext | null;

  addFromPdf: (
    file: File,
    onProgress?: (p: IngestProgress) => void,
    opts?: { signal?: AbortSignal },
  ) => Promise<string | null>;
  removeDoc: (id: string) => void;
  clearAll: () => void;

  list: () => KBDocSummaryView[];
  // Contexto + quais docs entraram e por quê.
  getContext: (
    ctx: PickContext,
    opts?: KBContextOptions & { max?: number },
  ) => Promise<KBContextResult>;
  // Wrapper compatível: só as entradas (cada uma com docId/titulo/reason).
  getContextFor: (
    ctx: PickContext,
    max?: number,
    opts?: KBContextOptions,
  ) => Promise<KBContextEntry[]>;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await idbDel(name);
  },
};

// Base pequena: injeta tudo direto, sem pagar o juiz de relevância.
export const DIRECT_INJECT_MAX = 2;
// Relevância por nó só compensa com base grande; abaixo disso, uma escolha
// por objetivo vale pro projeto inteiro.
export const NODE_RELEVANCE_MIN_DOCS = 6;
const PICK_CACHE_LIMIT = 60;

function hash(base: string): string {
  let h = 2166136261;
  for (let i = 0; i < base.length; i += 1) {
    h ^= base.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Chave por nó sem o texto da falha: o `extra` dos call sites é
// "Nó: nome (kind) — fx" ou "Nó que falhou: nome — contexto". Ficamos só com
// o trecho antes do " — ", que identifica o nó.
function nodePart(extra: string | undefined): string {
  return norm((extra ?? '').split(' — ')[0]);
}

export function pickCacheKey(ctx: PickContext, mode: 'project' | 'node'): string {
  if (mode === 'project') return `p:${hash(norm(ctx.label))}`;
  if (ctx.cacheKey) return `n:${hash(`${norm(ctx.label)}::${ctx.cacheKey}`)}`;
  return `n:${hash(`${norm(ctx.label)}::${nodePart(ctx.extra)}`)}`;
}

function isAbort(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    ((e as { name: unknown }).name === 'AbortError' ||
      (e as { name: unknown }).name === 'ResponseAborted')
  );
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// Cancelamento responsivo sem matar a chamada compartilhada: o juiz termina
// em segundo plano (e cacheia), quem cancelou recebe AbortError na hora.
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

// Julgamentos em andamento, por chave — duas ações seguidas no mesmo
// contexto pagam uma chamada só.
const inflight = new Map<string, Promise<PickCacheEntry>>();

function trimCache(cache: Record<string, PickCacheEntry>): Record<string, PickCacheEntry> {
  const keys = Object.keys(cache);
  if (keys.length <= PICK_CACHE_LIMIT) return cache;
  const keep = keys
    .sort((a, b) => cache[b].at - cache[a].at)
    .slice(0, PICK_CACHE_LIMIT);
  return Object.fromEntries(keep.map((k) => [k, cache[k]]));
}

export function usedDocsOf(entries: KBContextEntry[]): KBUsedDoc[] {
  return entries.map((e) => ({ id: e.docId, titulo: e.titulo, reason: e.reason ?? '' }));
}

const EMPTY_RESULT: KBContextResult = { entries: [], docs: [], mode: 'none', cached: true };

export const useKBStore = create<KBState>()(
  persist(
    (set, get) => {
      // Registra o uso (contagem por doc + último contexto pra UI).
      const recordUse = (label: string, result: KBContextResult) => {
        if (result.docs.length === 0) return;
        const now = Date.now();
        set((state) => {
          const usage = { ...state.usage };
          for (const d of result.docs) {
            const prev = usage[d.id];
            usage[d.id] = { count: (prev?.count ?? 0) + 1, lastUsedAt: now, lastLabel: label };
          }
          return {
            usage,
            lastContext: { at: now, label, docs: result.docs, mode: result.mode },
          };
        });
      };

      const fromIds = (
        ids: string[],
        reasons: Record<string, string>,
        mode: KBPickMode,
        cached: boolean,
      ): KBContextResult | null => {
        const docsMap = get().docs;
        const chosen = ids.map((id) => docsMap[id]).filter((d): d is KBDocument => Boolean(d));
        // Algum doc escolhido sumiu → o cache não vale mais.
        if (chosen.length !== ids.length) return null;
        const entries = toContextEntries(chosen, reasons);
        return { entries, docs: usedDocsOf(entries), mode, cached };
      };

      return {
        docs: {},
        pickCache: {},
        usage: {},
        lastContext: null,

        addFromPdf: async (file, onProgress, opts = {}) => {
          const finish = registerDataIngestion();
          try {
          const base = { filename: file.name };
          if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            onProgress?.({ ...base, phase: 'error', errorKind: 'notPdf', error: 'not a PDF' });
            return null;
          }
          onProgress?.({ ...base, phase: 'extracting' });
          // Lazy-load pdfjs (~1 MB) only when a PDF is actually ingested, so it
          // never lands in the eager main bundle for the common visitor.
          let extracted;
          let fingerprint: string;
          try {
            const { extractPdfText, fingerprintText } = await import('./extract');
            extracted = await extractPdfText(file, (done, total) => {
              onProgress?.({ ...base, phase: 'extracting', pagesDone: done, totalPages: total });
            });
            fingerprint = fingerprintText(extracted.text);
          } catch (e) {
            onProgress?.({
              ...base,
              phase: 'error',
              errorKind: 'extract',
              error: e instanceof Error ? e.message : String(e),
            });
            return null;
          }

          if (!extracted.text.trim()) {
            // PDF escaneado (só imagens): a mensagem traduzida sugere OCR.
            onProgress?.({ ...base, phase: 'error', errorKind: 'noText', error: 'no text' });
            return null;
          }

          // Dedup: mesmo texto já na base → devolve o id existente, sem IA.
          const existing = Object.values(get().docs).find((d) => d.fingerprint === fingerprint);
          if (existing) {
            onProgress?.({ ...base, phase: 'done', duplicate: true, docId: existing.id });
            return existing.id;
          }

          onProgress?.({
            ...base,
            phase: 'summarizing',
            pagesDone: extracted.pageCount,
            totalPages: extracted.pageCount,
          });
          let summary;
          try {
            summary = await summarizeDocument(extracted.text, { signal: opts.signal });
          } catch (e) {
            const info = classifyAIError(e);
            onProgress?.({
              ...base,
              phase: 'error',
              errorKind: 'summary',
              errorInfo: info,
              error: info.title,
            });
            return null;
          }

          const id = nanoid(10);
          const doc: KBDocument = {
            id,
            filename: file.name,
            sizeBytes: file.size,
            pageCount: extracted.pageCount,
            extractedAt: Date.now(),
            extractedText: extracted.text,
            fingerprint,
            summary,
          };

          set((state) => ({
            docs: { ...state.docs, [id]: doc },
            // Doc novo muda as escolhas → cache de picks invalidado.
            pickCache: {},
          }));
          inflight.clear();
          onProgress?.({ ...base, phase: 'done', docId: id });
          return id;
          } finally { finish(); }
        },

        removeDoc: (id) => {
          set((state) => {
            if (!state.docs[id]) return state;
            const { [id]: _gone, ...rest } = state.docs;
            const { [id]: _used, ...usage } = state.usage;
            void _gone;
            void _used;
            return { docs: rest, usage, pickCache: {} };
          });
          inflight.clear();
        },

        clearAll: () => {
          set({ docs: {}, pickCache: {}, usage: {}, lastContext: null });
          inflight.clear();
        },

        list: () => {
          const docs = Object.values(get().docs);
          return docs
            .map((d) => ({
              id: d.id,
              filename: d.filename,
              titulo: d.summary.titulo,
              dominio: d.summary.dominio,
              tags: d.summary.tags,
              nivel: d.summary.nivel,
              pageCount: d.pageCount,
              extractedAt: d.extractedAt,
            }))
            .sort((a, b) => b.extractedAt - a.extractedAt);
        },

        getContext: async (ctx, opts = {}) => {
          const max = opts.max ?? 2;
          const docsMap = get().docs;
          const docs = Object.values(docsMap).sort((a, b) => b.extractedAt - a.extractedAt);
          if (docs.length === 0 || max <= 0) return EMPTY_RESULT;
          if (opts.signal?.aborted) throw abortError();

          // Base pequena: tudo entra, sem chamada de IA.
          if (docs.length <= Math.min(max, DIRECT_INJECT_MAX)) {
            const reason = t().kb.reasonSmallBase;
            const reasons = Object.fromEntries(docs.map((d) => [d.id, reason]));
            const entries = toContextEntries(docs, reasons);
            const result: KBContextResult = {
              entries,
              docs: usedDocsOf(entries),
              mode: 'all',
              cached: true,
            };
            recordUse(ctx.label, result);
            return result;
          }

          const mode: 'project' | 'node' =
            docs.length >= NODE_RELEVANCE_MIN_DOCS && (ctx.extra || ctx.cacheKey)
              ? 'node'
              : 'project';
          const key = pickCacheKey(ctx, mode);

          const hit = get().pickCache[key];
          if (hit) {
            const result = fromIds(hit.ids, hit.reasons, mode, true);
            if (result) {
              recordUse(ctx.label, result);
              return result;
            }
          }

          // A controlled chat request owns its cancellation/retry policy; it
          // cannot inherit an unrelated UI request already retrying in the SDK.
          const controlled = !!opts.beforeRequest || opts.maxRetries !== undefined || opts.throwOnRateLimit === true;
          let pending = controlled ? undefined : inflight.get(key);
          if (!pending) {
            // No modo projeto o juiz vê só o objetivo — a escolha vale pra
            // todos os nós; no modo nó vê também o detalhe.
            const judgeCtx: PickContext =
              mode === 'project' ? { label: ctx.label } : { label: ctx.label, extra: ctx.extra };
            pending = pickRelevantDocs(judgeCtx, docs, max, controlled ? {
              signal: opts.signal, maxRetries: opts.maxRetries, beforeRequest: opts.beforeRequest,
            } : undefined).then((picks) => {
              const entry: PickCacheEntry = {
                ids: picks.map((p) => p.docId),
                reasons: Object.fromEntries(picks.map((p) => [p.docId, p.reason])),
                at: Date.now(),
              };
              // Só cacheia se a base não mudou no meio do caminho.
              if (controlled ? get().docs === docsMap && !opts.signal?.aborted : inflight.get(key) === pending) {
                set((state) => ({ pickCache: trimCache({ ...state.pickCache, [key]: entry }) }));
              }
              return entry;
            });
            if (!controlled) {
              const mine = pending;
              inflight.set(key, mine);
              const cleanup = () => {
                if (inflight.get(key) === mine) inflight.delete(key);
              };
              mine.then(cleanup, cleanup);
            }
          }

          let picked: PickCacheEntry;
          try {
            picked = await raceAbort(pending, opts.signal);
          } catch (e) {
            if (isAbort(e) || opts.signal?.aborted) throw e;
            if (opts.throwOnRateLimit && readRateLimit(e)) throw e;
            // A seleção é um extra: se falhar, a ação segue sem a base.
            console.warn('[kb] seleção de docs falhou; seguindo sem a base', e);
            return { entries: [], docs: [], mode: 'none', cached: false };
          }
          const result = fromIds(picked.ids, picked.reasons, mode, false) ?? {
            ...EMPTY_RESULT,
            cached: false,
          };
          recordUse(ctx.label, result);
          return result;
        },

        getContextFor: async (ctx, max = 2, opts = {}) =>
          (await get().getContext(ctx, { ...opts, max })).entries,
      };
    },
    {
      name: 'cellproject-kb',
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        docs: state.docs,
        pickCache: state.pickCache,
        usage: state.usage,
      }),
      // v1 guardava pickCache como string[] (sem motivo) → descartado.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<KBState>;
        if (version < 2) return { docs: p.docs ?? {}, pickCache: {}, usage: {} } as Partial<KBState>;
        return p;
      },
    },
  ),
);
