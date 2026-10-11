import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { findMentionTarget, getVisualWorkspace, listMentionTargets, resolveVisualContext, visualContextSources } from './domain';
import type { ConceptNodeData } from '@/types';
import type { VisualArtifact, VisualPromptInput } from './types';

const input = (mentions: VisualPromptInput['mentions'] = []): VisualPromptInput => ({ text: 'Explorar a referência', mentions, attachments: [] });
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'source-performance' }, selectedNodeId: null });
  initializeWorkspace();
});
afterEach(() => vi.restoreAllMocks());

function nodes(count: number) {
  const project = useGraphStore.getState().project!, root = project.nodes[project.rootId];
  const result = Array.from({ length: count }, (_, index) => ({ ...root, id: `pin-${index}`, parentId: index ? 'pin-0' : null, name: `Pin ${index}`, oQue: `Part ${index}`, notes: 'Detailed source '.repeat(100) }));
  useGraphStore.setState({ project: { ...project, rootId: result[0].id, nodes: Object.fromEntries(result.map(node => [node.id, node])) } });
  return result;
}
function nodeEncodings(spy: { mock: { calls: unknown[][] } }, records: ConceptNodeData[]) {
  return spy.mock.calls.filter(([value]) => Array.isArray(value) && records.includes(value[0] as ConceptNodeData));
}

it('does not encode any source body when standard context has no mentions', () => {
  const records = nodes(160);
  const id = useWorkspaceStore.getState().createNote({ title: 'Unselected note' });
  const note = useWorkspaceStore.getState().notes[id];
  const stringify = vi.spyOn(JSON, 'stringify');
  const context = resolveVisualContext(input());
  expect(JSON.parse(context.text).selected).toEqual([]);
  expect(nodeEncodings(stringify, records)).toHaveLength(0);
  expect(stringify.mock.calls.some(([value]) => value && typeof value === 'object' && 'blocks' in value && value.blocks === note.blocks)).toBe(false);
});

it('resolves an exact node past the menu limit without encoding unrelated nodes or notes', () => {
  const records = nodes(160), selected = records[159];
  const id = useWorkspaceStore.getState().createNote({ title: 'Unrelated personal note' });
  const note = useWorkspaceStore.getState().notes[id];
  const stringify = vi.spyOn(JSON, 'stringify');
  const target = findMentionTarget(selected.id, 'node')!;
  expect(target).toMatchObject({ id: selected.id, kind: 'node', label: 'Pin 159' });
  expect(JSON.parse(resolveVisualContext(input([target])).text).selected).toHaveLength(1);
  expect(nodeEncodings(stringify, records.filter(node => node !== selected))).toHaveLength(0);
  expect(stringify.mock.calls.some(([value]) => value && typeof value === 'object' && 'blocks' in value && value.blocks === note.blocks)).toBe(false);
});

it('encodes only the first 100 label matches and reuses them while typing', () => {
  const records = nodes(160), stringify = vi.spyOn(JSON, 'stringify');
  expect(listMentionTargets('@pin').map(target => target.id)).toEqual(records.slice(0, 100).map(node => node.id));
  expect(nodeEncodings(stringify, records)).toHaveLength(100);
  stringify.mockClear();
  expect(listMentionTargets('pi')).toHaveLength(100);
  expect(listMentionTargets('no matching label')).toEqual([]);
  expect(nodeEncodings(stringify, records)).toHaveLength(0);
});

it('reuses immutable source bodies for repeated lookups and invalidates edited content', () => {
  const records = nodes(2), selected = records[1];
  const target = findMentionTarget(selected.id, 'node')!, before = resolveVisualContext(input([target]));
  const stringify = vi.spyOn(JSON, 'stringify');
  expect(findMentionTarget(selected.id, 'node')).toEqual(target);
  expect(resolveVisualContext(input([target]))).toEqual(before);
  expect(nodeEncodings(stringify, records)).toHaveLength(0);
  useGraphStore.setState(state => ({ project: { ...state.project!, nodes: { ...state.project!.nodes, [selected.id]: { ...selected, notes: 'Edited source content' } } } }));
  const after = resolveVisualContext(input([target]));
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.text).toContain('Edited source content');
});

it('rechecks criterion visibility when the grace period changes without a new node identity', () => {
  const [base] = nodes(1), clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const node = { ...base, confirmado: false, takenAsKnown: false, comoConfirmarUsuarioAt: 100_000, comoConfirmar: 'INDEPENDENT CRITERION', explicacao: 'EXPLANATION WITH CRITERION' };
  useGraphStore.setState(state => ({ project: { ...state.project!, nodes: { [node.id]: node } } }));
  const target = findMentionTarget(node.id, 'node')!, hidden = resolveVisualContext(input([target]));
  expect(hidden.text).not.toContain('INDEPENDENT CRITERION');
  clock.mockReturnValue(120_000);
  const revealed = resolveVisualContext(input([target]));
  expect(useGraphStore.getState().project!.nodes[node.id]).toBe(node);
  expect(revealed.text).toContain('INDEPENDENT CRITERION');
  expect(revealed.text).toContain('EXPLANATION WITH CRITERION');
  expect(revealed.fingerprint).not.toBe(hidden.fingerprint);
  clock.mockReturnValue(100_000);
  expect(resolveVisualContext(input([target]))).toEqual(hidden);
});

it('checks current note access and deletions before returning cached references', () => {
  const [node] = nodes(1), noteId = useWorkspaceStore.getState().createNote({ title: 'Personal source' });
  const note = findMentionTarget(noteId, 'note')!;
  useWorkspaceStore.getState().updateNote(noteId, { blocks: [{ id: 'updated', type: 'text', text: 'Edited note body' }] });
  expect(findMentionTarget(noteId, 'note')!.fingerprint).not.toBe(note.fingerprint);
  expect(resolveVisualContext(input([note])).text).toContain('Edited note body');
  const activeProjectId = useWorkspaceStore.getState().activeProjectId;
  const otherOwner = useWorkspaceStore.getState().createProject('Another owner');
  useWorkspaceStore.setState({ activeProjectId });
  useWorkspaceStore.getState().updateNote(noteId, { projectId: otherOwner });
  expect(findMentionTarget(noteId, 'note')).toBeUndefined();
  expect(() => resolveVisualContext(input([note]))).toThrow('visualSourceMissing');
  useWorkspaceStore.getState().updateNote(noteId, { projectId: null });
  expect(findMentionTarget(noteId, 'note')).toBeDefined();
  useWorkspaceStore.getState().trashNote(noteId);
  expect(findMentionTarget(noteId, 'note')).toBeUndefined();
  const target = findMentionTarget(node.id, 'node')!;
  useGraphStore.setState(state => ({ project: { ...state.project!, nodes: {} } }));
  expect(findMentionTarget(node.id, 'node')).toBeUndefined();
  expect(() => resolveVisualContext(input([target]))).toThrow('visualSourceMissing');
});

it('invalidates image metadata and never revives a deleted cached image', () => {
  const image: VisualArtifact = { id: 'image', label: 'Initial reference', kind: 'image', x: 0, y: 0, width: 100, height: 100, mediaId: 'media', scene: null, source: null, revisions: [{ scene: null, mediaId: 'media', createdAt: 1 }], revisionIndex: 0 };
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...getVisualWorkspace(state.project), artifacts: [image] } } }));
  const target = findMentionTarget(image.id, 'image')!;
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...getVisualWorkspace(state.project), artifacts: [{ ...image, label: 'Revised reference' }] } } }));
  expect(findMentionTarget(image.id, 'image')!.fingerprint).not.toBe(target.fingerprint);
  expect(resolveVisualContext(input([target])).text).toContain('Revised reference');
  expect(findMentionTarget(image.id, 'unsupported' as never)).toBeUndefined();
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...getVisualWorkspace(state.project), artifacts: [] } } }));
  expect(findMentionTarget(image.id, 'image')).toBeUndefined();
});

it('reuses cached bodies for full advanced context and still detects related edits', () => {
  const records = nodes(4), target = findMentionTarget(records[0].id, 'node')!;
  const request = { ...input([target]), generationMode: 'advanced' as const };
  const before = resolveVisualContext(request);
  const stringify = vi.spyOn(JSON, 'stringify');
  expect(visualContextSources()).toHaveLength(4);
  expect(resolveVisualContext(request)).toEqual(before);
  expect(nodeEncodings(stringify, records)).toHaveLength(0);
  useGraphStore.setState(state => ({ project: { ...state.project!, nodes: { ...state.project!.nodes, [records[3].id]: { ...records[3], name: 'Edited related node' } } } }));
  expect(resolveVisualContext(request).fingerprint).not.toBe(before.fingerprint);
});
