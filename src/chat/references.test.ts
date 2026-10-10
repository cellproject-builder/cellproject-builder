import { beforeEach, expect, it } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { extractPlanFile } from '@/attachments/files';
import { addProjectFiles } from '@/attachments/projectFiles';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner, initializeWorkspace, getPlannerOwnerId } from '@/workspace/planner';
import { listChatReferences, resolveChatReferences } from './references';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'chat-plan' } });
  initializeWorkspace();
});

it('offers personal notes with no active plan without exposing bodies in the picker', () => {
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
  expect(listChatReferences('', null).map(t => t.label)).not.toContain('Foreign secret');
});

it('offers project attachments with @ and prevents using files from another project', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Arduino');
  const file = await extractPlanFile(new File(['USB serial 115200'], 'firmware.ino'));
  addProjectFiles(projectId, [file]);
  const targets = listChatReferences('firmware', projectId);
  expect(targets).toHaveLength(1); expect(targets[0].kind).toBe('file');
  expect(JSON.stringify(targets)).not.toContain('115200');
  expect(resolveChatReferences(targets, projectId)[0].content).toContain('115200');
  const other = useWorkspaceStore.getState().createProject('Outro');
  expect(listChatReferences('firmware', other)).toEqual([]);
  expect(() => resolveChatReferences(targets, other)).toThrow('chatReferenceScope');
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
  const selected = targets.filter(t => t.id === root.id || t.id === ownNote);
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
  expect(() => resolveChatReferences([target], other)).toThrow('chatReferenceScope');
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
