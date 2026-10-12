import { describe, expect, it } from 'vitest';
import { mergeCloudDocument } from './documentMerge';

const key = 'cellproject-workspace';
const envelope = (state: unknown, version = 2) => JSON.stringify({ state, version });
const merge = (base: unknown, local: unknown, remote: unknown) => {
  const result = mergeCloudDocument(key, envelope(base), envelope(local), envelope(remote));
  return result === null ? null : JSON.parse(result).state;
};
const stroke = (id: string, x = 10) => ({ id, color: '#000000', width: 3, points: [{ x, y: 20 }] });
const drawing = (id: string, x = 0) => ({ id, kind: 'drawing', x, y: 0, width: 100, height: 100, color: '#000000', widthStroke: 3, points: [{ x: 10, y: 20 }] });
const board = (id: string, items: unknown[] = []) => ({
  id, title: id, archived: false, createdAt: 1, updatedAt: 1,
  document: { version: 1, items, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
});
const ink = (strokes: unknown[]) => ({ version: 1, width: 1200, height: 900, strokes });

describe('mergeCloudDocument', () => {
  it('combines a note edit with an independent board edit', () => {
    const b1 = board('b1');
    expect(merge(
      { notes: { n1: { id: 'n1', title: 'before' } }, boards: { b1 } },
      { notes: { n1: { id: 'n1', title: 'local' } }, boards: { b1 } },
      { notes: { n1: { id: 'n1', title: 'before' } }, boards: { b1: { ...b1, title: 'remote' } } },
    )).toEqual({ notes: { n1: { id: 'n1', title: 'local' } }, boards: { b1: { ...b1, title: 'remote' } } });
  });

  it('combines edits to different boards', () => {
    const b1 = board('b1'), b2 = board('b2');
    expect(merge({ boards: { b1, b2 } }, { boards: { b1: { ...b1, title: 'local' }, b2 } }, { boards: { b1, b2: { ...b2, title: 'remote' } } }))
      .toEqual({ boards: { b1: { ...b1, title: 'local' }, b2: { ...b2, title: 'remote' } } });
  });

  it('combines independent same-board drawings and takes the latest update timestamp', () => {
    const b1 = board('b1', [drawing('d1'), drawing('d2')]);
    const local = { ...b1, updatedAt: 4, document: { ...b1.document, items: [drawing('d1', 20), drawing('d2')] } };
    const remote = { ...b1, updatedAt: 8, document: { ...b1.document, items: [drawing('d1'), drawing('d2', 30)] } };
    expect(merge({ boards: { b1 } }, { boards: { b1: local } }, { boards: { b1: remote } }))
      .toEqual({ boards: { b1: { ...b1, updatedAt: 8, document: { ...b1.document, items: [drawing('d1', 20), drawing('d2', 30)] } } } });
  });

  it('combines independent strokes in one note', () => {
    expect(merge(
      { notes: { n1: { ink: ink([stroke('s1'), stroke('s2')]) } } },
      { notes: { n1: { ink: ink([stroke('s1', 30), stroke('s2')]) } } },
      { notes: { n1: { ink: ink([stroke('s1'), stroke('s2', 40)]) } } },
    )).toEqual({ notes: { n1: { ink: ink([stroke('s1', 30), stroke('s2', 40)]) } } });
  });

  it('combines first independent strokes on an existing note without stored ink', () => {
    const note = { id: 'n1', title: 'Shared note' };
    const local = { ...note, ink: ink([stroke('pc')]) };
    const remote = { ...note, ink: ink([stroke('tablet')]) };
    expect(merge({ notes: { n1: note } }, { notes: { n1: local } }, { notes: { n1: remote } }))
      .toEqual({ notes: { n1: { ...note, ink: { version: 1, width: 1200, height: 900, strokes: [stroke('pc'), stroke('tablet')] } } } });
  });

  it.each([false, true])('keeps both strokes and the taller measured note page (previous ink: %s)', (existing) => {
    const note = { id: 'n1', title: 'Shared note' };
    const base = { ...note, ...(existing ? { ink: ink([]) } : {}) };
    const local = { ...note, ink: { ...ink([stroke('pc')]), height: 1200 } };
    const remote = { ...note, ink: { ...ink([stroke('tablet', 30)]), height: 1700 } };
    const expected = { notes: { n1: { ...note, ink: { version: 1, width: 1200, height: 1700, strokes: [stroke('pc'), stroke('tablet', 30)] } } } };
    expect(merge({ notes: { n1: base } }, { notes: { n1: local } }, { notes: { n1: remote } })).toEqual(expected);
    expect(merge({ notes: { n1: base } }, { notes: { n1: remote } }, { notes: { n1: local } })).toEqual(expected);
  });

  it('keeps a first-stroke ID collision conflicted instead of synthesizing its geometry or style', () => {
    const note = { id: 'n1', title: 'Shared note' };
    expect(merge({ notes: { n1: note } },
      { notes: { n1: { ...note, ink: ink([stroke('same', 30)]) } } },
      { notes: { n1: { ...note, ink: ink([{ ...stroke('same'), color: '#ffffff' }]) } } })).toBeNull();
  });

  it('does not combine independently created notes merely because their first strokes have distinct IDs', () => {
    const note = { id: 'n1', title: 'Shared note' };
    expect(merge({ notes: {} },
      { notes: { n1: { ...note, ink: ink([stroke('pc')]) } } },
      { notes: { n1: { ...note, ink: ink([stroke('tablet')]) } } })).toBeNull();
  });

  it.each(['delete ink', 'delete stroke', 'edit style', 'change width', 'shrink page', 'malformed ink'] as const)('keeps unsafe note ink changes conflicted while page heights diverge: %s', (change) => {
    const note = { id: 'n1', title: 'Shared note', ink: ink([stroke('shared')]) };
    const local: Record<string, unknown> = { ...note, ink: { ...ink([stroke('shared', 40)]), height: 1200 } };
    const remote: Record<string, unknown> = { ...note, ink: { ...ink([stroke('shared', 70)]), height: 1700 } };
    if (change === 'delete ink') delete local.ink;
    if (change === 'delete stroke') local.ink = { ...ink([]), height: 1200 };
    if (change === 'edit style') {
      local.ink = { ...ink([{ ...stroke('shared'), color: '#ffffff' }]), height: 1200 };
      remote.ink = { ...ink([{ ...stroke('shared'), color: '#ff0000' }]), height: 1700 };
    }
    if (change === 'change width') {
      local.ink = { ...ink([stroke('shared'), stroke('pc')]), width: 1400, height: 1200 };
      remote.ink = { ...ink([stroke('shared'), stroke('tablet')]), height: 1700 };
    }
    if (change === 'shrink page') {
      local.ink = { ...ink([stroke('shared'), stroke('pc')]), height: 600 };
      remote.ink = { ...ink([stroke('shared'), stroke('tablet')]), height: 1700 };
    }
    if (change === 'malformed ink') remote.ink = { ...ink([stroke('tablet')]), height: 10001 };
    expect(merge({ notes: { n1: note } }, { notes: { n1: local } }, { notes: { n1: remote } })).toBeNull();
  });

  it('keeps unrelated height fields atomic instead of applying the note ink extent rule globally', () => {
    expect(merge({ ink: ink([]) }, { ink: { ...ink([stroke('pc')]), height: 1200 } },
      { ink: { ...ink([stroke('tablet')]), height: 1700 } })).toBeNull();
    expect(merge({ notes: { n1: { ink: ink([]) } } },
      { notes: { n1: { ink: ink([stroke('pc')]), canvas: { version: 1, width: 1200, height: 1200, paper: 'plain', strokes: [], items: [] } } } },
      { notes: { n1: { ink: ink([stroke('tablet')]), canvas: { version: 1, width: 1200, height: 1700, paper: 'plain', strokes: [], items: [] } } } })).toBeNull();
  });

  it('validates the combined first-stroke budget instead of accepting individually valid layers', () => {
    const note = { id: 'n1', title: 'Shared note' };
    const local = { ...note, ink: ink(Array.from({ length: 1001 }, (_, index) => stroke(`pc-${index}`))) };
    const remote = { ...note, ink: ink(Array.from({ length: 1001 }, (_, index) => stroke(`tablet-${index}`))) };
    expect(merge({ notes: { n1: note } }, { notes: { n1: local } }, { notes: { n1: remote } })).toBeNull();
  });

  it('preserves a removed stroke while accepting a new independent stroke', () => {
    expect(merge(
      { notes: { n1: { ink: ink([stroke('s1')]) } } },
      { notes: { n1: { ink: ink([]) } } },
      { notes: { n1: { ink: ink([stroke('s1'), stroke('s2')]) } } },
    )).toEqual({ notes: { n1: { ink: ink([stroke('s2')]) } } });
  });

  it('combines additions in an empty stable-ID list in deterministic order', () => {
    const b1 = board('b1');
    const local = { boards: { b1: { ...b1, document: { ...b1.document, items: [drawing('a')] } } } };
    const remote = { boards: { b1: { ...b1, document: { ...b1.document, items: [drawing('z')] } } } };
    expect(merge({ boards: { b1 } }, local, remote)).toEqual({ boards: { b1: { ...b1, document: { ...b1.document, items: [drawing('a'), drawing('z')] } } } });
    expect(merge({ boards: { b1 } }, remote, local)).toEqual(merge({ boards: { b1 } }, local, remote));
  });

  it('preserves insertion positions and each side’s added-item order', () => {
    expect(merge({ list: [{ id: 'a' }, { id: 'b' }] },
      { list: [{ id: 'a' }, { id: 'z' }, { id: 'y' }, { id: 'b' }] },
      { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }))
      .toEqual({ list: [{ id: 'a' }, { id: 'z' }, { id: 'y' }, { id: 'b' }, { id: 'c' }] });
  });

  it('accepts a one-sided reorder with independent item edits', () => {
    expect(merge({ list: [{ id: 'a', x: 1 }, { id: 'b', x: 1 }] },
      { list: [{ id: 'b', x: 1 }, { id: 'a', x: 1 }] },
      { list: [{ id: 'a', x: 2 }, { id: 'b', x: 1 }] }))
      .toEqual({ list: [{ id: 'b', x: 1 }, { id: 'a', x: 2 }] });
  });

  it('rejects conflicting reorder of existing items', () => {
    expect(merge({ list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      { list: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] },
      { list: [{ id: 'a' }, { id: 'c' }, { id: 'b' }] })).toBeNull();
  });

  it('rejects incompatible placements of a shared new item', () => {
    expect(merge({ list: [{ id: 'a' }, { id: 'b' }] },
      { list: [{ id: 'a' }, { id: 'x' }, { id: 'b' }] },
      { list: [{ id: 'a' }, { id: 'b' }, { id: 'x' }] })).toBeNull();
  });

  it('rejects different concurrent edits to the same scalar', () => {
    expect(merge({ notes: { n1: { title: 'before', updatedAt: 1 } } },
      { notes: { n1: { title: 'local', updatedAt: 2 } } },
      { notes: { n1: { title: 'remote', updatedAt: 3 } } })).toBeNull();
  });

  it('preserves record deletion and independent record edits', () => {
    expect(merge({ notes: { n1: { title: 'one' }, n2: { title: 'two' } } },
      { notes: { n2: { title: 'two' } } },
      { notes: { n1: { title: 'one' }, n2: { title: 'edited' } } })).toEqual({ notes: { n2: { title: 'edited' } } });
  });

  it('rejects record deletion versus edit', () => {
    expect(merge({ notes: { n1: { title: 'before' } } }, { notes: {} }, { notes: { n1: { title: 'remote' } } })).toBeNull();
  });

  it('rejects soft deletion versus a concurrent note edit', () => {
    expect(merge({ notes: { n1: { title: 'before', deletedAt: null } } },
      { notes: { n1: { title: 'before', deletedAt: 2 } } },
      { notes: { n1: { title: 'edited', deletedAt: null } } })).toBeNull();
  });

  it('distinguishes a missing property from JSON null', () => {
    expect(merge({ value: null, other: 1 }, { other: 1 }, { value: null, other: 2 })).toEqual({ other: 2 });
    expect(merge({ value: null }, {}, { value: 'edited' })).toBeNull();
    expect(merge({}, { value: null }, { other: true })).toEqual({ value: null, other: true });
  });

  it('does not invent a merge for concurrent creation of the same record', () => {
    expect(merge({ notes: {} }, { notes: { n1: { title: 'local' } } }, { notes: { n1: { text: 'remote' } } })).toBeNull();
  });

  it('rejects duplicate IDs even on the unchanged fast path', () => {
    const invalid = envelope({ list: [{ id: 'a' }, { id: 'a' }] });
    expect(mergeCloudDocument(key, invalid, invalid, invalid)).toBeNull();
  });

  it('treats arrays without stable IDs as indivisible values', () => {
    expect(merge({ list: ['a'] }, { list: ['a', 'b'] }, { list: ['a', 'c'] })).toBeNull();
    expect(merge({ list: ['a'], other: 0 }, { list: ['a', 'b'], other: 0 }, { list: ['a'], other: 1 }))
      .toEqual({ list: ['a', 'b'], other: 1 });
  });

  it('does not concatenate concurrent model histories even if entries happen to have IDs', () => {
    expect(mergeCloudDocument('dynamic_diary-chat',
      envelope({ sessionId: 's1', modelHistory: [] }, 1),
      envelope({ sessionId: 's1', modelHistory: [{ id: 'm1', role: 'user', content: 'local' }] }, 1),
      envelope({ sessionId: 's1', modelHistory: [{ id: 'm2', role: 'user', content: 'remote' }] }, 1))).toBeNull();
  });

  it('rejects a conversation switch concurrent with changes to the previous conversation', () => {
    expect(mergeCloudDocument('dynamic_diary-chat',
      envelope({ sessionId: 's1', messages: [], modelHistory: [] }, 1),
      envelope({ sessionId: 's2', messages: [], modelHistory: [] }, 1),
      envelope({ sessionId: 's1', messages: [{ id: 'm1', text: 'remote' }], modelHistory: [] }, 1))).toBeNull();
  });

  it('rejects concurrent new conversations with different IDs', () => {
    expect(mergeCloudDocument('dynamic_diary-chat', envelope({ sessionId: 's1' }, 1), envelope({ sessionId: 's2' }, 1), envelope({ sessionId: 's3' }, 1))).toBeNull();
  });

  it('does not combine concurrent same-session turns before model history is saved', () => {
    expect(mergeCloudDocument('dynamic_diary-chat',
      envelope({ sessionId: 's1', messages: [], modelHistory: [] }, 1),
      envelope({ sessionId: 's1', messages: [{ id: 'm1', text: 'local question' }], modelHistory: [] }, 1),
      envelope({ sessionId: 's1', messages: [{ id: 'm2', text: 'remote question' }], modelHistory: [] }, 1))).toBeNull();
  });

  it('keeps a chat turn’s visible messages and model history together', () => {
    expect(mergeCloudDocument('dynamic_diary-chat',
      envelope({ sessionId: 's1', messages: [], modelHistory: [] }, 1),
      envelope({ sessionId: 's1', messages: [{ id: 'm1', text: 'local question' }], modelHistory: [] }, 1),
      envelope({ sessionId: 's1', messages: [], modelHistory: [{ role: 'user', content: 'remote question' }] }, 1))).toBeNull();
  });

  it('keeps a compaction checkpoint atomic with the active conversation history', () => {
    const base = { sessionId: 's1', messages: [], modelHistory: [], compaction: null };
    expect(mergeCloudDocument('dynamic_diary-chat', envelope(base, 1),
      envelope({ ...base, messages: [{ id: 'local', text: 'Local question' }] }, 1),
      envelope({ ...base, compaction: { summary: 'Remote summary', window: 1 } }, 1))).toBeNull();
  });

  it('merges metadata changes to independent stable inactive sessions', () => {
    const first = { id: 'one', sessionId: 'one', title: 'One', messages: [], modelHistory: [], archivedAt: null, deletedAt: null };
    const second = { ...first, id: 'two', sessionId: 'two', title: 'Two' };
    const base = { sessionId: 'active', messages: [], modelHistory: [], archivedSessions: [first, second] };
    const result = mergeCloudDocument('dynamic_diary-chat', envelope(base, 1),
      envelope({ ...base, archivedSessions: [{ ...first, title: 'Renamed' }, second] }, 1),
      envelope({ ...base, archivedSessions: [first, { ...second, archivedAt: 20 }] }, 1));
    expect(JSON.parse(result!).state.archivedSessions).toMatchObject([{ ...first, title: 'Renamed' }, { ...second, archivedAt: 20 }]);
  });

  it('never synthesizes an inactive conversation from one device’s messages and another’s summary', () => {
    const one = { id: 'one', sessionId: 'one', messages: [], modelHistory: [], compaction: null };
    const base = { sessionId: 'active', messages: [], modelHistory: [], archivedSessions: [one] };
    expect(mergeCloudDocument('dynamic_diary-chat', envelope(base, 1),
      envelope({ ...base, archivedSessions: [{ ...one, messages: [{ id: 'm', text: 'Local question' }] }] }, 1),
      envelope({ ...base, archivedSessions: [{ ...one, compaction: { summary: 'Remote summary', window: 1 } }] }, 1))).toBeNull();
  });

  it('preserves deletion receipts and rejects stale edits rather than resurrecting chat content', () => {
    const one = { id: 'one', sessionId: 'one', messages: [{ id: 'm', text: 'Private' }], modelHistory: [], deletedAt: null };
    const base = { sessionId: 'active', messages: [], modelHistory: [], archivedSessions: [one] };
    const deleted = { ...one, messages: [], deletedAt: 20 };
    const local = { ...base, archivedSessions: [deleted] };
    expect(JSON.parse(mergeCloudDocument('dynamic_diary-chat', envelope(base, 1), envelope(local, 1), envelope(base, 1))!).state.archivedSessions).toEqual([deleted]);
    expect(mergeCloudDocument('dynamic_diary-chat', envelope(base, 1), envelope(local, 1),
      envelope({ ...base, archivedSessions: [{ ...one, messages: [{ id: 'm', text: 'Stale edited content' }] }] }, 1))).toBeNull();
  });

  it('normalizes legacy session identities before merging independent first-upgrade metadata changes', () => {
    const first = { sessionId: 'one', messages: [{ id: 'one-u', role: 'user', text: 'One', createdAt: 1 }], modelHistory: [] };
    const second = { sessionId: 'two', messages: [{ id: 'two-u', role: 'user', text: 'Two', createdAt: 2 }], modelHistory: [] };
    const normalize = (value: typeof first) => ({ ...value, id: value.sessionId, createdAt: value.messages[0].createdAt, updatedAt: value.messages[0].createdAt, archivedAt: null, deletedAt: null, pendingHistory: null, compaction: null, contextUsage: null, contextObservation: null });
    const base = { sessionId: 'active', messages: [], modelHistory: [], archivedSessions: [first, second] };
    const active = { ...base, id: 'active', createdAt: 0, updatedAt: 0, archivedAt: null, deletedAt: null, pendingHistory: null, compaction: null, contextUsage: null, contextObservation: null };
    const result = mergeCloudDocument('dynamic_diary-chat', envelope(base, 1),
      envelope({ ...active, archivedSessions: [{ ...normalize(first), title: 'Renamed one' }, normalize(second)] }, 1),
      envelope({ ...active, archivedSessions: [normalize(first), { ...normalize(second), title: 'Renamed two' }] }, 1));
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).state.archivedSessions.map((item: { title: string }) => item.title)).toEqual(['Renamed one', 'Renamed two']);
  });

  it('keeps local per-device board viewport while merging independent drawings', () => {
    const b1 = board('b1');
    const local = { ...b1, document: { ...b1.document, items: [drawing('a')], viewport: { x: 10, y: 20, zoom: 2 } } };
    const remote = { ...b1, document: { ...b1.document, items: [drawing('b')], viewport: { x: 30, y: 40, zoom: 3 } } };
    expect(merge({ boards: { b1 } }, { boards: { b1: local } }, { boards: { b1: remote } }))
      .toEqual({ boards: { b1: { ...local, document: { ...local.document, items: [drawing('a'), drawing('b')] } } } });
  });

  it('does not synthesize UI viewport state outside the board viewport path', () => {
    expect(merge({ viewport: { x: 0, y: 0 } }, { viewport: { x: 1, y: 0 } }, { viewport: { x: 0, y: 1 } })).toBeNull();
  });

  it('keeps local graph selection when two devices view the same plan', () => {
    const project = { id: 'p1', nodes: {} };
    const result = mergeCloudDocument('cellproject-graph',
      envelope({ project, selectedNodeId: 'a', focusedParentId: null }, 6),
      envelope({ project, selectedNodeId: 'b', focusedParentId: null }, 6),
      envelope({ project, selectedNodeId: 'c', focusedParentId: 'parent' }, 6));
    expect(result === null ? null : JSON.parse(result).state).toEqual({ project, selectedNodeId: 'b', focusedParentId: null });
  });

  it('keeps a managed project planner’s local selection with independent plan edits', () => {
    const planner = { project: { id: 'plan1', nodes: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } } }, selectedNodeId: 'a' };
    const localPlanner = { project: { ...planner.project, nodes: { a: { id: 'a', name: 'local' }, b: { id: 'b', name: 'B' } } }, selectedNodeId: 'b' };
    const remotePlanner = { project: { ...planner.project, nodes: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'remote' } } }, selectedNodeId: 'c' };
    expect(merge({ projects: { p1: { id: 'p1', planner } } },
      { projects: { p1: { id: 'p1', planner: localPlanner } } },
      { projects: { p1: { id: 'p1', planner: remotePlanner } } }))
      .toEqual({ projects: { p1: { id: 'p1', planner: { project: { id: 'plan1', nodes: { a: { id: 'a', name: 'local' }, b: { id: 'b', name: 'remote' } } }, selectedNodeId: 'b' } } } });
  });

  it('rejects a graph project switch concurrent with edits bound to the previous plan', () => {
    expect(mergeCloudDocument('cellproject-graph',
      envelope({ project: { id: 'p1' }, objectiveDraft: { text: '' } }, 6),
      envelope({ project: { id: 'p2' }, objectiveDraft: { text: '' } }, 6),
      envelope({ project: { id: 'p1' }, objectiveDraft: { text: 'old plan draft' } }, 6))).toBeNull();
  });

  it('does not combine independent parent changes into a graph cycle', () => {
    const project = { id: 'p1', rootId: 'root', edges: {}, nodes: {
      root: { id: 'root', parentId: null, name: 'root' },
      a: { id: 'a', parentId: 'root', name: 'A' }, b: { id: 'b', parentId: 'root', name: 'B' },
    } };
    const local = { ...project, nodes: { ...project.nodes, a: { ...project.nodes.a, parentId: 'b' } } };
    const remote = { ...project, nodes: { ...project.nodes, b: { ...project.nodes.b, parentId: 'a' } } };
    expect(mergeCloudDocument('cellproject-graph', envelope({ project }, 6), envelope({ project: local }, 6), envelope({ project: remote }, 6))).toBeNull();
  });

  it('keeps graph topology atomic against simultaneous independent text changes', () => {
    const project = { id: 'p1', rootId: 'a', edges: {}, nodes: { a: { id: 'a', parentId: null, name: 'A' } } };
    const local = { ...project, nodes: { ...project.nodes, b: { id: 'b', parentId: 'a', name: 'B' } } };
    const remote = { ...project, nodes: { a: { ...project.nodes.a, name: 'remote' } } };
    expect(mergeCloudDocument('cellproject-graph', envelope({ project }, 6), envelope({ project: local }, 6), envelope({ project: remote }, 6))).toBeNull();
  });

  it('merges node text and edge notes when graph relations are unchanged', () => {
    const project = { id: 'p1', rootId: 'a', nodes: { a: { id: 'a', parentId: null, name: 'A' } }, edges: { e: { id: 'e', source: 'a', target: 'a', kind: 'link', note: '' } } };
    const local = { ...project, nodes: { a: { ...project.nodes.a, name: 'local' } } };
    const remote = { ...project, edges: { e: { ...project.edges.e, note: 'remote' } } };
    const result = mergeCloudDocument('cellproject-graph', envelope({ project }, 6), envelope({ project: local }, 6), envelope({ project: remote }, 6));
    expect(result === null ? null : JSON.parse(result).state).toEqual({ project: { ...local, edges: remote.edges } });
  });

  it.each([
    { notes: { n1: { id: 'wrong', title: 'note' } } },
    { notes: { n1: { title: 42 } } },
    { notes: { n1: { blocks: [{ id: 'b1', text: 42 }] } } },
    { projects: { p1: { id: 'wrong', name: 'project' } } },
    { projects: { p1: { objective: false } } },
  ])('rejects malformed present core workspace fields', invalid => {
    const text = envelope(invalid);
    expect(mergeCloudDocument(key, text, text, text)).toBeNull();
  });

  it('rejects present graph references to missing nodes before accepting an unchanged branch', () => {
    const project = { id: 'p1', rootId: 'a', nodes: { a: { id: 'a', name: 'A', parentId: 'missing' } }, edges: {} };
    const text = envelope({ project }, 6);
    expect(mergeCloudDocument('cellproject-graph', text, text, text)).toBeNull();
    const managed = envelope({ projects: { p1: { id: 'p1', planner: { project: { ...project, nodes: { a: { id: 'a', name: 'A', parentId: null } } }, archivedProject: { id: 'p2', nodes: {}, edges: { e: { source: 'missing', target: 'missing' } } } } } } });
    expect(mergeCloudDocument(key, managed, managed, managed)).toBeNull();
  });

  it('rejects already cyclic graph parents even when all three copies match', () => {
    const text = envelope({ project: { id: 'p1', nodes: { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } } } }, 6);
    expect(mergeCloudDocument('cellproject-graph', text, text, text)).toBeNull();
  });

  it('uses maximum numeric modification timestamps only after a safe merge', () => {
    expect(merge({ note: { title: 'old', body: '', modifiedAt: 1 } },
      { note: { title: 'local', body: '', modifiedAt: 5 } },
      { note: { title: 'old', body: 'remote', modifiedAt: 9 } }))
      .toEqual({ note: { title: 'local', body: 'remote', modifiedAt: 9 } });
  });

  it('preserves identical noncanonical local JSON and rejects envelope version divergence', () => {
    const local = '{ "state": {"notes":{}}, "version": 2 }';
    expect(mergeCloudDocument(key, null, local, local)).toBe(local);
    expect(mergeCloudDocument(key, envelope({}, 1), envelope({}, 2), envelope({}, 1))).toBeNull();
    expect(mergeCloudDocument(key, envelope({ a: 0 }), envelope({ a: 1 }), envelope({ a: 0 }, 3))).toBeNull();
  });

  it('refuses nested schema version changes during concurrent edits', () => {
    expect(merge({ doc: { version: 1, a: 0, b: 0 } }, { doc: { version: 2, a: 1, b: 0 } }, { doc: { version: 1, a: 0, b: 1 } })).toBeNull();
  });

  it('requires a known common base for two independently created documents', () => {
    expect(mergeCloudDocument(key, null, envelope({ notes: {} }), null)).toBe(envelope({ notes: {} }));
    expect(mergeCloudDocument(key, null, envelope({ a: 1 }), envelope({ b: 1 }))).toBeNull();
    expect(mergeCloudDocument(key, envelope({ a: 1 }), envelope({ a: 2 }), null)).toBeNull();
    expect(mergeCloudDocument(key, envelope({ a: 1 }), envelope({ a: 1 }), null)).toBeNull();
  });

  it('merges raw preferences only if the change is one-sided or identical', () => {
    expect(mergeCloudDocument('dynamic_diary-theme', 'light', 'dark', 'light')).toBe('dark');
    expect(mergeCloudDocument('dynamic_diary-theme', 'light', 'light', 'oled')).toBe('oled');
    expect(mergeCloudDocument('dynamic_diary-theme', 'light', 'dark', 'oled')).toBeNull();
    expect(mergeCloudDocument('dynamic_diary-sidebar-collapsed', 'false', 'true', 'true')).toBe('true');
  });

  it.each([
    ['invalid JSON', '{'],
    ['non-finite number', '{"state":{"x":1e999},"version":2}'],
    ['missing state', '{"version":2}'],
    ['array state', '{"state":[],"version":2}'],
    ['invalid version', '{"state":{},"version":-1}'],
    ['prototype key', '{"state":{"__proto__":{"polluted":true}},"version":2}'],
    ['constructor key', '{"state":{"constructor":{"prototype":{"polluted":true}}},"version":2}'],
  ])('rejects %s before accepting equal documents', (_description, invalid) => {
    expect(mergeCloudDocument(key, invalid, invalid, invalid)).toBeNull();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects unknown document keys', () => {
    expect(mergeCloudDocument('unknown', null, envelope({}), null)).toBeNull();
  });

  it('validates board references after merging independent edits', () => {
    const b1 = board('b1', [drawing('a'), drawing('b')]);
    const local = { ...b1, document: { ...b1.document, items: [drawing('b')] } };
    const remote = { ...b1, document: { ...b1.document, edges: [{ id: 'e1', source: 'a', target: 'b' }] } };
    expect(merge({ boards: { b1 } }, { boards: { b1: local } }, { boards: { b1: remote } })).toBeNull();
  });

  it('refuses a safe structural merge that would exceed the board item budget', () => {
    const items = Array.from({ length: 199 }, (_, index) => drawing(`d${index}`));
    const b1 = board('b1', items);
    const local = { ...b1, document: { ...b1.document, items: [...items, drawing('local')] } };
    const remote = { ...b1, document: { ...b1.document, items: [...items, drawing('remote')] } };
    expect(merge({ boards: { b1 } }, { boards: { b1: local } }, { boards: { b1: remote } })).toBeNull();
  });
});
