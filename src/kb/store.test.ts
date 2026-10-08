import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { KBDocument } from './types';
import { useKBStore, pickCacheKey } from './store';

// O juiz de relevância e o resumo são chamadas de IA — mockados aqui.
const pickMock = vi.fn();
const summarizeMock = vi.fn();
vi.mock('./service', async (orig) => {
  const real = await orig<typeof import('./service')>();
  return {
    ...real,
    pickRelevantDocs: (...args: unknown[]) => pickMock(...args),
    summarizeDocument: (...args: unknown[]) => summarizeMock(...args),
  };
});


function doc(id: string, i: number): KBDocument {
  return {
    id,
    filename: `${id}.pdf`,
    sizeBytes: 1,
    pageCount: 1,
    extractedAt: 1000 + i,
    extractedText: `texto ${id}`,
    fingerprint: `fp-${id}`,
    summary: {
      titulo: `Doc ${id}`,
      dominio: 'teste',
      tags: [],
      resumo: ['r'],
      fatos: [],
      nivel: 'iniciante',
    },
  };
}

function seed(n: number) {
  const docs = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`d${i}`, doc(`d${i}`, i)]),
  );
  useKBStore.setState({ docs, pickCache: {}, usage: {}, lastContext: null });
}

const objective = { label: 'Objetivo: pipa' };
const nodeA = { label: 'Objetivo: pipa', extra: 'Nó: Vareta (recurso) — fx a' };
const nodeB = { label: 'Objetivo: pipa', extra: 'Nó: Linha (recurso) — fx b' };

beforeEach(() => {
  pickMock.mockReset();
  summarizeMock.mockReset();
  useKBStore.getState().clearAll();
});

describe('getContextFor — seleção de docs da base', () => {
  it('base vazia: nada, sem chamada de IA', async () => {
    expect(await useKBStore.getState().getContextFor(objective)).toEqual([]);
    expect(pickMock).not.toHaveBeenCalled();
  });

  it('1-2 docs: injeta direto, sem pickRelevantDocs', async () => {
    seed(2);
    const entries = await useKBStore.getState().getContextFor(nodeA);
    expect(entries.map((e) => e.docId).sort()).toEqual(['d0', 'd1']);
    expect(entries.every((e) => e.reason)).toBe(true);
    expect(pickMock).not.toHaveBeenCalled();

    const r = await useKBStore.getState().getContext(objective);
    expect(r.mode).toBe('all');
    expect(r.docs).toHaveLength(2);
    expect(pickMock).not.toHaveBeenCalled();
  });

  it('3-5 docs: um julgamento por objetivo, reaproveitado entre nós', async () => {
    seed(4);
    pickMock.mockResolvedValue([{ docId: 'd2', reason: 'fala de varetas' }]);
    const a = await useKBStore.getState().getContext(nodeA);
    const b = await useKBStore.getState().getContext(nodeB);
    const fail = await useKBStore.getState().getContext({
      label: 'Objetivo: pipa',
      extra: 'Nó que falhou: Vareta — quebrou com vento de 30km/h',
    });
    expect(pickMock).toHaveBeenCalledTimes(1);
    // No modo projeto o juiz vê só o objetivo.
    expect(pickMock.mock.calls[0][0]).toEqual({ label: 'Objetivo: pipa' });
    expect(a.docs).toEqual([{ id: 'd2', titulo: 'Doc d2', reason: 'fala de varetas' }]);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(fail.docs.map((d) => d.id)).toEqual(['d2']);
  });

  it('chamadas simultâneas no mesmo contexto pagam um julgamento só', async () => {
    seed(3);
    pickMock.mockResolvedValue([{ docId: 'd0', reason: 'x' }]);
    await Promise.all([
      useKBStore.getState().getContextFor(nodeA),
      useKBStore.getState().getContextFor(nodeB),
    ]);
    expect(pickMock).toHaveBeenCalledTimes(1);
  });

  it('> 5 docs: relevância por nó, e a chave não inclui o texto da falha', async () => {
    seed(6);
    pickMock.mockResolvedValue([{ docId: 'd5', reason: 'y' }]);
    await useKBStore.getState().getContext(nodeA);
    await useKBStore.getState().getContext(nodeB);
    expect(pickMock).toHaveBeenCalledTimes(2);

    const k1 = pickCacheKey(
      { label: 'Objetivo: pipa', extra: 'Nó que falhou: Vareta — quebrou' },
      'node',
    );
    const k2 = pickCacheKey(
      { label: 'Objetivo: pipa', extra: 'Nó que falhou: Vareta — outra falha totalmente diferente' },
      'node',
    );
    expect(k1).toBe(k2);
  });

  it('falha do juiz não derruba a ação: segue sem a base e não cacheia', async () => {
    seed(3);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pickMock.mockRejectedValueOnce(new Error('rede caiu'));
    const r = await useKBStore.getState().getContext(objective);
    expect(r.entries).toEqual([]);
    expect(r.mode).toBe('none');
    pickMock.mockResolvedValueOnce([{ docId: 'd1', reason: 'z' }]);
    const r2 = await useKBStore.getState().getContext(objective);
    expect(r2.docs.map((d) => d.id)).toEqual(['d1']);
    expect(pickMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('cancelamento propaga AbortError', async () => {
    seed(3);
    pickMock.mockReturnValue(new Promise(() => {}));
    const ctrl = new AbortController();
    const p = useKBStore.getState().getContextFor(objective, 2, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('registra uso por doc e o último contexto', async () => {
    seed(1);
    await useKBStore.getState().getContextFor(objective);
    await useKBStore.getState().getContextFor(nodeA);
    const s = useKBStore.getState();
    expect(s.usage.d0.count).toBe(2);
    expect(s.lastContext?.docs.map((d) => d.id)).toEqual(['d0']);
  });

  it('remover um doc invalida o cache de escolhas', async () => {
    seed(3);
    pickMock.mockResolvedValue([{ docId: 'd2', reason: 'x' }]);
    await useKBStore.getState().getContext(objective);
    useKBStore.getState().removeDoc('d2');
    pickMock.mockResolvedValue([]);
    // Restam 2 docs → injeção direta, sem juiz.
    const r = await useKBStore.getState().getContext(objective);
    expect(r.mode).toBe('all');
    expect(pickMock).toHaveBeenCalledTimes(1);
  });
});

describe('addFromPdf — erros classificados', () => {
  it('arquivo que não é PDF vira errorKind notPdf', async () => {
    const events: unknown[] = [];
    const file = new File(['oi'], 'nota.txt', { type: 'text/plain' });
    const id = await useKBStore.getState().addFromPdf(file, (p) => events.push(p));
    expect(id).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({ phase: 'error', errorKind: 'notPdf', filename: 'nota.txt' }),
    ]);
    expect(summarizeMock).not.toHaveBeenCalled();
  });
});
