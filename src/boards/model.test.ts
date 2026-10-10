import { describe, expect, it } from 'vitest';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { boardDocumentSchema, boardRecordSchema, createBoardDocument, validatePersistedBoards } from './model';

const base = { id: 'item', x: -100, y: 50, width: 300, height: 220 };
const text = { ...base, kind: 'card' as const, text: '**Ideia**', color: '#a78bfa', fontSize: 18 };
const scene = { version: 1 as const, label: 'Peça', objects: [{ id: 'body', type: 'box' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#abcdef' }] };
const png = 'data:image/png;base64,iVBORw0KGgoA';
const record = () => ({ id: 'board', title: 'Ideias', archived: false, createdAt: 1, updatedAt: 2, document: createBoardDocument() });

describe('independent board documents', () => {
  it('creates isolated blank documents without project or note ownership', () => {
    const a = createBoardDocument(), b = createBoardDocument();
    expect(a).toEqual({ version: 1, items: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    a.items.push(text); expect(b.items).toEqual([]);
    expect(boardRecordSchema.parse(record())).not.toHaveProperty('projectId');
  });

  it('round-trips all independent item kinds, connections and a negative canvas viewport', () => {
    const document = { ...createBoardDocument(), viewport: { x: -300, y: 200, zoom: .5 }, items: [
      text, { ...text, id: 'text', kind: 'text' as const },
      { ...base, id: 'image', kind: 'image' as const, src: png, label: 'Referência' },
      { ...base, id: 'model', kind: 'model' as const, scene },
      { ...base, id: 'diagram', kind: 'diagram' as const, diagram: torqueDiagram(), values: { mass: .4 } },
      { ...base, id: 'drawing', kind: 'drawing' as const, points: [{ x: 0, y: 0 }, { x: 300, y: 220 }], color: '#ffffff', widthStroke: 2 },
    ], edges: [{ id: 'edge', source: 'item', target: 'image' }] };
    expect(boardDocumentSchema.parse(document)).toEqual(document);
  });

  it.each([
    ['duplicate item ids', { items: [text, text] }],
    ['dangling edge', { items: [text], edges: [{ id: 'edge', source: 'item', target: 'missing' }] }],
    ['duplicate edge ids', { items: [text], edges: [{ id: 'e', source: 'item', target: 'item' }, { id: 'e', source: 'item', target: 'item' }] }],
    ['nonfinite layout', { items: [{ ...text, x: Infinity }] }],
    ['invalid viewport', { viewport: { x: 0, y: 0, zoom: 0 } }],
    ['executable image', { items: [{ ...base, kind: 'image', label: '', src: 'javascript:alert(1)' }] }],
    ['out of bounds drawing', { items: [{ ...base, kind: 'drawing', points: [{ x: 301, y: 0 }], color: '#abcdef', widthStroke: 1 }] }],
    ['too many drawing samples', { items: [{ ...base, kind: 'drawing', points: Array(4097).fill({ x: 1, y: 1 }), color: '#abcdef', widthStroke: 1 }] }],
    ['too many items', { items: Array.from({ length: 201 }, (_, i) => ({ ...text, id: `item-${i}` })) }],
    ['too many edges', { items: [text], edges: Array.from({ length: 501 }, (_, i) => ({ id: `edge-${i}`, source: 'item', target: 'item' })) }],
    ['too many model objects', { items: [{ ...base, kind: 'model', scene: { ...scene, objects: Array.from({ length: 129 }, (_, i) => ({ ...scene.objects[0], id: `object-${i}` })) } }] }],
    ['unknown diagram parameter', { items: [{ ...base, kind: 'diagram', diagram: torqueDiagram(), values: { unknown: 1 } }] }],
    ['out of range diagram parameter', { items: [{ ...base, kind: 'diagram', diagram: torqueDiagram(), values: { mass: 10000 } }] }],
  ])('rejects %s before storage', (_label, patch) => {
    expect(boardDocumentSchema.safeParse({ ...createBoardDocument(), ...patch }).success).toBe(false);
  });

  it('validates collection keys and preserves originals when a board is incompatible', () => {
    const boards = { board: record() }, original = structuredClone(boards);
    expect(() => validatePersistedBoards(boards)).not.toThrow();
    expect(() => validatePersistedBoards(undefined)).not.toThrow();
    expect(() => validatePersistedBoards({ wrong: record() })).toThrow('quadro inválido');
    expect(() => validatePersistedBoards({ board: { ...record(), document: { version: 9 } } })).toThrow('originais foram preservados');
    expect(boards).toEqual(original);
  });

  it('enforces six MiB per board and sixteen MiB shared with notebook images', () => {
    const src = png + 'A'.repeat(1536 * 1024);
    const image = { ...base, kind: 'image' as const, src, label: '' };
    const threeImages = { ...record(), document: { ...createBoardDocument(), items: Array.from({ length: 3 }, (_, i) => ({ ...image, id: `image-${i}` })) } };
    expect(boardRecordSchema.safeParse(threeImages).success).toBe(true);
    expect(boardDocumentSchema.safeParse({ ...threeImages.document, items: Array.from({ length: 4 }, (_, i) => ({ ...image, id: `image-${i}` })) }).success).toBe(false);
    const boards = { board: threeImages, second: { ...threeImages, id: 'second' } };
    expect(() => validatePersistedBoards(boards)).not.toThrow();
    const notes = { first: { canvas: { items: Array.from({ length: 5 }, () => image) } } };
    expect(() => validatePersistedBoards(boards, notes)).toThrow('limite do workspace');
  });
});
