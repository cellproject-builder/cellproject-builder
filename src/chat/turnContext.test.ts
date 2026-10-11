import { beforeEach, expect, it } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner, initializeWorkspace } from '@/workspace/planner';
import { captureChatTurnContext, publishChatNoteFocus, useChatFocusStore } from './turnContext';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, boards: {}, activeBoardId: null, activeProjectId: null, surface: 'projects', legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'context-plan' }, selectedNodeId: null });
  useChatFocusStore.setState({ noteId: null, noteScopeProjectId: null });
  initializeWorkspace();
});

it('captures the current project and selected node with a bounded public excerpt', () => {
  const owner = useWorkspaceStore.getState().createProject('Robô', 'Objetivo público');
  const graph = useGraphStore.getState().project!;
  const root = graph.nodes[graph.rootId];
  useGraphStore.setState({ project: { ...graph, nodes: { ...graph.nodes, [root.id]: { ...root, name: 'Servo', oQue: 'Corpo do servo '.repeat(200), comoConfirmar: 'HIDDEN CRITERION', comoConfirmarUsuario: '', comoConfirmarUsuarioAt: undefined, aiCriterionSeenAt: 1, confirmado: false, takenAsKnown: false } } }, selectedNodeId: root.id });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner()); initializeWorkspace();
  useWorkspaceStore.setState({ surface: 'planner' });
  const snapshot = captureChatTurnContext();
  expect(snapshot).toMatchObject({ surface: 'planner', visibleProjectId: owner, projectId: owner, projectName: 'Robô', planId: 'context-plan', selectedNodeId: root.id, nodeName: 'Servo', noteId: null, boardId: null });
  expect(snapshot.excerpt).toContain('Corpo do servo');
  expect(snapshot.excerpt.length).toBeLessThanOrEqual(1200);
  expect(JSON.stringify(snapshot)).not.toContain('HIDDEN CRITERION');
  expect(Object.isFrozen(snapshot)).toBe(true);
  useWorkspaceStore.getState().navigate('projects');
  expect(snapshot.surface).toBe('planner');
});

it('does not inherit a previous project or plan on the project library and boards', () => {
  useWorkspaceStore.getState().createProject('Previous project');
  useWorkspaceStore.getState().navigate('projects');
  expect(captureChatTurnContext()).toMatchObject({ surface: 'projects', visibleProjectId: null, projectId: null, planId: null, selectedNodeId: null });
  const boardId = useWorkspaceStore.getState().createBoard('Research board');
  expect(captureChatTurnContext()).toMatchObject({ surface: 'boards', visibleProjectId: null, projectId: null, boardId, boardTitle: 'Research board', planId: null });
  useWorkspaceStore.getState().navigate('overview');
  expect(captureChatTurnContext().boardId).toBeNull();
});

it('identifies the actual open note and clears focus without clobbering a newer editor', () => {
  const projectId = useWorkspaceStore.getState().createProject('Previous project');
  const personal = useWorkspaceStore.getState().createNote({ title: 'Meu diário' });
  useWorkspaceStore.getState().updateNote(personal, { blocks: [{ id: 'text', type: 'text', text: 'Nota visível' }] });
  useWorkspaceStore.getState().navigate('notes');
  const previous = publishChatNoteFocus(personal, null);
  expect(captureChatTurnContext()).toMatchObject({ projectId: null, visibleProjectId: null, noteId: personal, noteTitle: 'Meu diário', excerpt: 'Nota visível' });
  const linked = useWorkspaceStore.getState().createNote({ projectId, title: 'Cálculo' });
  const latest = publishChatNoteFocus(linked, projectId);
  previous();
  expect(captureChatTurnContext()).toMatchObject({ projectId, noteId: linked, noteTitle: 'Cálculo' });
  latest();
  expect(captureChatTurnContext()).toMatchObject({ projectId: null, noteId: null });
});

it('ignores removed notes, removed projects and stale selections', () => {
  const projectId = useWorkspaceStore.getState().createProject('A');
  const noteId = useWorkspaceStore.getState().createNote({ projectId, title: 'Removed note' });
  publishChatNoteFocus(noteId, projectId); useWorkspaceStore.getState().trashNote(noteId);
  useWorkspaceStore.getState().navigate('notes');
  expect(captureChatTurnContext().noteId).toBeNull();
  useWorkspaceStore.setState({ projects: {}, surface: 'planner' });
  expect(captureChatTurnContext()).toMatchObject({ projectId: null, planId: null, selectedNodeId: null });
});

it('keeps an explicitly personal note personal even if its editor scope still names a project', () => {
  const projectId = useWorkspaceStore.getState().createProject('Earlier scope');
  const noteId = useWorkspaceStore.getState().createNote({ title: 'Personal note' });
  useWorkspaceStore.getState().navigate('notes');
  const clear = publishChatNoteFocus(noteId, projectId);
  expect(captureChatTurnContext()).toMatchObject({ projectId: null, visibleProjectId: null, noteId });
  clear();
});

it('stops reading note prose when the visible-context excerpt is full', () => {
  const noteId = useWorkspaceStore.getState().createNote({ title: 'Large note' });
  const note = useWorkspaceStore.getState().notes[noteId];
  let tailReads = 0;
  const tail = { id: 'tail', type: 'text' as const, get text() { tailReads++; return 'UNRELATED TAIL '.repeat(10000); } };
  useWorkspaceStore.setState({ notes: { [noteId]: { ...note, blocks: [{ id: 'head', type: 'text', text: 'Visible '.repeat(300) }, tail] } }, surface: 'notes' });
  // Persistence may inspect the synthetic fixture independently; count only context capture.
  tailReads = 0; const clear = publishChatNoteFocus(noteId, null);
  const context = captureChatTurnContext(); clear();
  expect(context.excerpt).toHaveLength(1200);
  expect(context.excerpt).not.toContain('UNRELATED TAIL');
  expect(tailReads).toBe(0);
});
