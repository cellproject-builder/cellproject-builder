import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { nanoid } from 'nanoid';
import type { KBDocSummaryView, KBDocument, KBContextEntry } from './types';
import { extractPdfText, fingerprintText } from './extract';
import { pickRelevantDocs, summarizeDocument, toContextEntries, type PickContext } from './service';

type IngestPhase = 'extracting' | 'summarizing' | 'done' | 'error';

export interface IngestProgress {
  phase: IngestPhase;
  filename: string;
  pagesDone?: number;
  totalPages?: number;
  error?: string;
}

interface KBState {
  docs: Record<string, KBDocument>;
  // Cache em memória: chave = hash(label), valor = docIds picados.
  // Pequeno, recriável; persistido pra sobreviver reload.
  pickCache: Record<string, string[]>;

  addFromPdf: (file: File, onProgress?: (p: IngestProgress) => void) => Promise<string | null>;
  removeDoc: (id: string) => void;
  clearAll: () => void;

  list: () => KBDocSummaryView[];
  getContextFor: (ctx: PickContext, max?: number) => Promise<KBContextEntry[]>;
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

// Chave de cache determinística pra PickContext. Não precisa ser perfeita;
// objetivo é evitar re-julgar o mesmo contexto duas vezes em sequência.
function cacheKey(ctx: PickContext): string {
  const base = `${ctx.label}::${ctx.extra ?? ''}`.toLowerCase().trim();
  let hash = 2166136261;
  for (let i = 0; i < base.length; i += 1) {
    hash ^= base.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

export const useKBStore = create<KBState>()(
  persist(
    (set, get) => ({
      docs: {},
      pickCache: {},

      addFromPdf: async (file, onProgress) => {
        onProgress?.({ phase: 'extracting', filename: file.name });
        let extracted;
        try {
          extracted = await extractPdfText(file, (done, total) => {
            onProgress?.({
              phase: 'extracting',
              filename: file.name,
              pagesDone: done,
              totalPages: total,
            });
          });
        } catch (e) {
          onProgress?.({
            phase: 'error',
            filename: file.name,
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        }

        if (!extracted.text.trim()) {
          onProgress?.({
            phase: 'error',
            filename: file.name,
            error: 'PDF sem texto extraível (pode ser só imagens).',
          });
          return null;
        }

        const fingerprint = fingerprintText(extracted.text);
        // Dedup: se já temos este fingerprint, retornamos o id existente sem re-chamar IA.
        const existing = Object.values(get().docs).find((d) => d.fingerprint === fingerprint);
        if (existing) {
          onProgress?.({ phase: 'done', filename: file.name });
          return existing.id;
        }

        onProgress?.({
          phase: 'summarizing',
          filename: file.name,
          pagesDone: extracted.pageCount,
          totalPages: extracted.pageCount,
        });
        let summary;
        try {
          summary = await summarizeDocument(extracted.text);
        } catch (e) {
          onProgress?.({
            phase: 'error',
            filename: file.name,
            error: e instanceof Error ? e.message : String(e),
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
          // Invalida o cache de picks — um doc novo muda as escolhas.
          pickCache: {},
        }));
        onProgress?.({ phase: 'done', filename: file.name });
        return id;
      },

      removeDoc: (id) =>
        set((state) => {
          if (!state.docs[id]) return state;
          const { [id]: _gone, ...rest } = state.docs;
          void _gone;
          return { docs: rest, pickCache: {} };
        }),

      clearAll: () => set({ docs: {}, pickCache: {} }),

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

      getContextFor: async (ctx, max = 2) => {
        const state = get();
        const docs = Object.values(state.docs);
        if (docs.length === 0) return [];

        const key = cacheKey(ctx);
        const cachedIds = state.pickCache[key];
        if (cachedIds) {
          const cached = cachedIds
            .map((id) => state.docs[id])
            .filter((d): d is KBDocument => Boolean(d));
          // Se algum id cacheado não existe mais (doc removido), refazemos.
          if (cached.length === cachedIds.length) {
            return toContextEntries(cached);
          }
        }

        const picks = await pickRelevantDocs(ctx, docs, max);
        const chosen = picks
          .map((p) => state.docs[p.docId])
          .filter((d): d is KBDocument => Boolean(d));

        set({
          pickCache: {
            ...state.pickCache,
            [key]: chosen.map((d) => d.id),
          },
        });

        return toContextEntries(chosen);
      },
    }),
    {
      name: 'cellproject-kb',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        docs: state.docs,
        pickCache: state.pickCache,
      }),
    },
  ),
);
