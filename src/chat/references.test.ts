import { beforeEach, expect, it } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { extractPlanFile } from '@/attachments/files';
import { addProjectFiles } from '@/attachments/projectFiles';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner, initializeWorkspace, getPlannerOwnerId } from '@/workspace/planner';
import { listChatReferences, resolveChatReferenceTarget, resolveChatReferences } from './references';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'chat-plan' } });
  initializeWorkspace();
});

it('offers personal and explicit cross-project references without exposing bodies in the picker', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Minhas medidas' });
  useWorkspaceStore.getState().updateNote(id, { blocks: [{ id: 'body', type: 'text', text: 'SELECTED MEASUREMENTS' }] });
  const other = useWorkspaceStore.getState().createProject('Outro');
  useWorkspaceStore.getState().createNote({ title: 'Foreign secret', projectId: other });
  useWorkspaceStore.setState({ activeProjectId: null });
  useGraphStore.setState({ project: null });
  const targets = listChatReferences('medidas', null);
  expect(targets).toEqual([expect.objectContaining({ id, kind: 'note', projectId: null })]);
  expect(JSON.stringify(targets)).not.toContain('SELECTED MEASUREMENTS');
  expect(resolveChatReferences(targets, null)[0].content).toContain('SELECTED MEASUREMENTS');
  expect(listChatReferences('Foreign secret', null)).toEqual([expect.objectContaining({ kind: 'note', projectId: other })]);
});

it('resolves an explicit note identity beyond the suggestion limit without changing its origin', () => {
  const owner = useWorkspaceStore.getState().createProject('Fontes');
  const notes = Array.from({ length: 105 }, (_, index) => useWorkspaceStore.getState().createNote({ projectId: owner, title: `Fonte ${index}` }));
  const id = notes[104];
  expect(listChatReferences('', owner).some(target => target.id === id)).toBe(false);
  expect(resolveChatReferenceTarget({ id, kind: 'note', projectId: owner })).toMatchObject({ id, label: 'Fonte 104', projectId: owner, planId: null });
  expect(() => resolveChatReferenceTarget({ id, kind: 'note', projectId: null })).toThrow('chatReferenceMissing');
});

it('preserves the selected occurrence in snapshots while keeping its block baseline private', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Trechos iguais' });
  useWorkspaceStore.getState().updateNote(id, { blocks: [
    { id: 'first', type: 'text', text: 'Servo repetido' },
    { id: 'second', type: 'text', text: 'Servo repetido e Servo repetido' },
  ] });
  const noteSelection = { blockId: 'second', start: 17, end: 31, original: 'Servo repetido e Servo repetido' };
  const target = { ...listChatReferences('Trechos iguais', null)[0], noteSelection };
  const snapshot = resolveChatReferences([target], null)[0];
  expect(snapshot.noteSelection).toEqual({ blockId: 'second', start: 17, end: 31, text: 'Servo repetido', truncated: false });
  expect(snapshot.noteSelection).not.toHaveProperty('original');
  expect(snapshot.noteSelection).not.toBe(noteSelection);
});

it('prioritizes a small selected passage beyond the first eight thousand characters without sending its entire baseline', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Parágrafo longo' });
  const original = 'x'.repeat(9000) + 'SELECTED WORD' + 'x'.repeat(90987);
  useWorkspaceStore.getState().updateNote(id, { blocks: [{ id: 'long-body', type: 'text', text: original }] });
  const target = { ...listChatReferences('Parágrafo longo', null)[0], noteSelection: { blockId: 'long-body', start: 9000, end: 9013, original } };
  const snapshot = resolveChatReferences([target], null)[0];
  expect(snapshot.noteSelection).toEqual({ blockId: 'long-body', start: 9000, end: 9013, text: 'SELECTED WORD', truncated: false });
  expect(snapshot.content).toMatch(/^Selected note passage/);
  expect(snapshot.content).toContain('SELECTED WORD');
  expect(snapshot.content).toContain('context truncated');
  expect(snapshot.truncated).toBe(true);
  expect(snapshot.noteSelection).not.toHaveProperty('original');
  expect(snapshot.content.length + snapshot.noteSelection!.text.length).toBeLessThanOrEqual(8000);
  expect(JSON.stringify(snapshot).length).toBeLessThan(9000);
  expect(target.noteSelection.original.length).toBe(100000);
});

it('bounds a large selected passage together with its source content', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Trecho longo' });
  const original = 'L'.repeat(100000);
  useWorkspaceStore.getState().updateNote(id, { blocks: [{ id: 'long-body', type: 'text', text: original }] });
  const target = { ...listChatReferences('Trecho longo', null)[0], noteSelection: { blockId: 'long-body', start: 0, end: 100000, original } };
  const snapshot = resolveChatReferences([target], null)[0];
  expect(snapshot.noteSelection?.truncated).toBe(true);
  expect(snapshot.content).toContain('truncated=true');
  expect(snapshot.content.length + snapshot.noteSelection!.text.length).toBeLessThanOrEqual(8000);
  expect(snapshot.noteSelection).not.toHaveProperty('original');
});

it('charges selected passage metadata against the total reference context budget', () => {
  const original = 'L'.repeat(100000);
  const targets = Array.from({ length: 7 }, (_, index) => {
    const id = useWorkspaceStore.getState().createNote({ title: `Fonte longa ${index}` });
    useWorkspaceStore.getState().updateNote(id, { blocks: [{ id: 'body', type: 'text', text: original }] });
    return resolveChatReferenceTarget({ id, kind: 'note', projectId: null, noteSelection: { blockId: 'body', start: 0, end: 100000, original } });
  });
  const snapshots = resolveChatReferences(targets.slice(0, 6), null);
  expect(snapshots.reduce((total, snapshot) => total + snapshot.content.length + (snapshot.noteSelection?.text.length ?? 0), 0)).toBeLessThanOrEqual(48000);
  expect(() => resolveChatReferences(targets, null)).toThrow('chatReferenceLimit');
});

it.each([
  { blockId: 'missing', start: 0, end: 5, original: 'Servo repetido' },
  { blockId: 'body', start: 0, end: 5, original: 'Texto anterior' },
  { blockId: 'body', start: -1, end: 5, original: 'Servo repetido' },
  { blockId: 'body', start: 5, end: 4, original: 'Servo repetido' },
  { blockId: 'body', start: 0, end: 50, original: 'Servo repetido' },
  { blockId: 'body', start: 0.5, end: 5, original: 'Servo repetido' },
])('rejects stale or invalid note selection metadata before sending (%j)', (noteSelection) => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Nota atual' });
  useWorkspaceStore.getState().updateNote(id, { blocks: [{ id: 'body', type: 'text', text: 'Servo repetido' }] });
  const target = { ...listChatReferences('Nota atual', null)[0], noteSelection };
  expect(() => resolveChatReferences([target], null)).toThrow('chatReferenceSelectionChanged');
});

it('offers project attachments with @ and resolves their own origin from another screen', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Arduino');
  const file = await extractPlanFile(new File(['USB serial 115200'], 'firmware.ino'));
  addProjectFiles(projectId, [file]);
  const targets = listChatReferences('firmware', projectId);
  expect(targets).toHaveLength(1); expect(targets[0].kind).toBe('file');
  expect(JSON.stringify(targets)).not.toContain('115200');
  expect(resolveChatReferences(targets, projectId)[0].content).toContain('115200');
  const other = useWorkspaceStore.getState().createProject('Outro');
  expect(listChatReferences('firmware', other)).toEqual(targets);
  expect(resolveChatReferences(targets, other)[0]).toMatchObject({ projectId, kind: 'file' });
});

it('reads an inactive selected project without swapping the editor and hides independent criteria', () => {
  const owner = useWorkspaceStore.getState().createProject('Estudo do robô');
  const graph = useGraphStore.getState().project!;
  const root = graph.nodes[graph.rootId];
  useGraphStore.setState({ project: { ...graph, nodes: { ...graph.nodes, [root.id]: { ...root, name: 'Braço', comoConfirmar: 'HIDDEN CRITERION', aiCriterionSeenAt: 1, confirmado: false, takenAsKnown: false, comoConfirmarUsuarioAt: undefined } } } });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner());
  initializeWorkspace();
  const ownNote = useWorkspaceStore.getState().createNote({ projectId: owner, title: 'Cálculo de torque' });
  const second = useWorkspaceStore.getState().createProject('Outro plano');
  useWorkspaceStore.getState().savePlanner(second, { ...capturePlanner(), project: { ...buildDemoProject(), id: 'other-plan' } });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'other-plan' } });
  initializeWorkspace();
  const targets = listChatReferences('', owner);
  const selected = targets.filter(t => t.projectId === owner && (t.id === root.id || t.id === ownNote));
  expect(selected).toHaveLength(2);
  expect(JSON.stringify(resolveChatReferences(selected, owner))).not.toContain('HIDDEN CRITERION');
  expect(useGraphStore.getState().project!.id).toBe('other-plan');
  expect(getPlannerOwnerId()).toBe(second);
  expect(useWorkspaceStore.getState().activeProjectId).toBe(second);
});

it('rejects deleted, changed or wrong-project selections instead of silently sending a different source', () => {
  const owner = useWorkspaceStore.getState().createProject('A');
  const note = useWorkspaceStore.getState().createNote({ projectId: owner, title: 'Premissas' });
  const target = listChatReferences('', owner).find(t => t.id === note)!;
  const other = useWorkspaceStore.getState().createProject('B');
  expect(resolveChatReferences([target], other)[0]).toMatchObject({ projectId: owner });
  useWorkspaceStore.getState().updateNote(note, { title: 'Premissas revisadas' });
  expect(() => resolveChatReferences([target], owner)).toThrow('chatReferenceChanged');
  useWorkspaceStore.getState().trashNote(note);
  expect(() => resolveChatReferences([target], owner)).toThrow('chatReferenceMissing');
});

it('exposes selected canvas photos as textual provenance without sending pixel or unrelated image data', () => {
  const owner = useWorkspaceStore.getState().createProject('Plano');
  const project = useGraphStore.getState().project!;
  const image = { id: 'photo', label: 'ESP32', kind: 'image' as const, mediaId: 'local-photo', scene: null, source: null, x: 0, y: 0, width: 80, height: 80, revisions: [{ scene: null, mediaId: 'local-photo', createdAt: Date.now() }], revisionIndex: 0 };
  useGraphStore.setState({ project: { ...project, visuals: { version: 1, mode: 'approval', artifacts: [image], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner()); initializeWorkspace();
  const target = listChatReferences('ESP32', owner).find(target => target.kind === 'image')!;
  const [snapshot] = resolveChatReferences([target], owner);
  expect(snapshot).toMatchObject({ id: 'photo', kind: 'image', projectId: owner, planId: 'chat-plan' });
  expect(snapshot.content).toContain('Pixels não analisados');
  expect(snapshot.content).not.toContain('base64');
  expect(() => resolveChatReferences(Array(21).fill(target), owner)).toThrow('chatReferenceLimit');
});

it('offers project and board references with stable origin and summaries excluding heavy payloads', () => {
  const owner = useWorkspaceStore.getState().createProject('Electrical research', 'Compare servo wiring');
  const boardId = useWorkspaceStore.getState().createBoard('Servo sketch');
  const board = useWorkspaceStore.getState().boards[boardId];
  useWorkspaceStore.setState({ boards: { [boardId]: { ...board, document: { ...board.document, items: [
    { id: 'text', kind: 'card', text: 'Use a shared ground', color: '#ffffff', fontSize: 16, x: 0, y: 0, width: 200, height: 100 },
    { id: 'image', kind: 'image', src: 'data:image/png;base64,HEAVY_PIXELS', label: 'Servo reference', x: 0, y: 0, width: 200, height: 100 },
  ] } } } });
  const project = listChatReferences('Electrical research', null).find(target => target.kind === 'project')!;
  const target = listChatReferences('Servo sketch', null).find(target => target.kind === 'board')!;
  expect(project).toMatchObject({ id: owner, projectId: owner, planId: null });
  expect(JSON.stringify(target)).not.toContain('shared ground');
  const frozen = resolveChatReferences([project, target], null);
  expect(frozen[0].content).toContain('Compare servo wiring');
  expect(frozen[1].content).toContain('Use a shared ground');
  expect(JSON.stringify(frozen)).not.toContain('HEAVY_PIXELS');
  useWorkspaceStore.getState().updateBoard(boardId, { title: 'Changed sketch' });
  expect(() => resolveChatReferences([target], null)).toThrow('chatReferenceChanged');
});

it('rejects forged origins and duplicate namespaced identities for explicit cross-project sources', () => {
  const first = useWorkspaceStore.getState().createProject('First');
  const noteId = useWorkspaceStore.getState().createNote({ projectId: first, title: 'Stable source' });
  const second = useWorkspaceStore.getState().createProject('Second');
  const target = listChatReferences('Stable source', second)[0];
  expect(() => resolveChatReferences([{ ...target, projectId: second }], second)).toThrow('chatReferenceMissing');
  expect(() => resolveChatReferences([target, target], second)).toThrow('chatReferenceDuplicate');
  expect(resolveChatReferences([target], second)[0].id).toBe(noteId);
  expect(useWorkspaceStore.getState().activeProjectId).toBe(second);
});

it('references diagrams and 3D through textual meaning without sending SVG paths or mesh buffers', () => {
  const owner = useWorkspaceStore.getState().createProject('Geometry study');
  const plan = useGraphStore.getState().project!;
  const common = { x: 0, y: 0, width: 300, height: 200, mediaId: null, source: null, revisions: [], revisionIndex: 0 };
  const diagram = { version: 1 as const, title: 'Servo wiring', explanation: 'Identify signal and ground.', assumptions: ['Illustration'], viewBox: [0, 0, 400, 300] as [0, 0, number, number], parameters: [], constants: {}, calculations: [], bindings: [], elements: [
    { id: 'signal', type: 'text' as const, x: 1, y: 20, text: 'PWM signal' },
    { id: 'wire', type: 'path' as const, d: 'M98,65L123,45' },
  ] };
  const scene = { version: 1 as const, label: 'Servo module', objects: [{ id: 'mesh', type: 'custom' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#ffffff', geometry: { kind: 'buffer' as const, vertices: [[987, 654, 321], [988, 654, 321], [987, 655, 321]] as [number, number, number][], indices: [0, 1, 2] } }] };
  useGraphStore.setState({ project: { ...plan, visuals: { version: 1, mode: 'approval', drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } }, proposals: [], artifacts: [
    { ...common, id: 'diagram-artifact', kind: 'diagram', label: 'Wiring labels', diagram, scene: null, revisions: [{ scene: null, mediaId: null, diagram, createdAt: Date.now() }] },
    { ...common, id: 'model-artifact', kind: 'model', label: 'Servo module', scene, revisions: [{ scene, mediaId: null, createdAt: Date.now() }] },
  ] } } });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner()); initializeWorkspace();
  const selected = listChatReferences('', null).filter(target => target.kind === 'diagram' || target.kind === 'model');
  expect(selected).toHaveLength(2);
  const snapshots = resolveChatReferences(selected, null);
  expect(snapshots.find(item => item.kind === 'diagram')?.content).toContain('PWM signal');
  expect(snapshots.find(item => item.kind === 'model')?.content).toContain('objectCount');
  expect(JSON.stringify(snapshots)).not.toMatch(/987|654|vertices|indices|M98/);
});
