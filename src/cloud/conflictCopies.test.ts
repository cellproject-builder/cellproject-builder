import { describe, expect, it } from 'vitest';
import { mergeCloudDocument } from './documentMerge';
import { preserveConflictCopies } from './conflictCopies';

const W = 'cellproject-workspace', G = 'cellproject-graph', C = 'dynamic_diary-chat';
const envelope = (state: unknown, version = 2) => JSON.stringify({ state, version });
const input = (key: string, base: unknown, local: unknown, remote: unknown, version = 2) => ({ key, base: base === null ? null : envelope(base, version), local: envelope(local, version), remote: remote === null ? null : envelope(remote, version) });
const workspace = () => ({ projects: {}, tasks: {}, sprints: {}, comments: {}, notes: {}, folders: {}, boards: {}, legacyImported: true });
const note = (id: string, text: string, projectId: string | null = null, taskId: string | null = null) => ({ id, title: 'Anotações', blocks: [{ id: 'block', type: 'text', text }], projectId, taskId, folderId: null, pinned: false, deletedAt: null, createdAt: 1, updatedAt: 1 });
const plan = (id: string, text: string) => ({ id, name: 'Plano', objective: text, rootId: 'root', nodes: { root: { id: 'root', name: text, parentId: null, position: { x: 0, y: 0 } } }, edges: {}, createdAt: 1, updatedAt: 1 });
const planner = (text: string) => ({ project: plan('plan', text), archivedProject: plan('older-plan', 'Anterior'), selectedNodeId: 'root', focusedParentId: 'root', lens: 'structure', viewMode: 'graph', detailPanelOpen: true, lastTutorNodeId: null, drafts: {}, objectiveDraft: { name: 'Plano', objective: text, rules: [], expanded: {} }, pendingSuggestions: null, parkedSuggestions: {}, archivedPending: null });
const project = (text: string) => ({ id: 'project', name: text, objective: text, archived: false, createdAt: 1, updatedAt: 1, planner: planner(text) });
const get = (result: ReturnType<typeof preserveConflictCopies>, key: string) => {
  expect(result).not.toBeNull();
  return JSON.parse(result!.documents.find(item => item.key === key)!.value).state;
};

describe('preserveConflictCopies', () => {
  it('uses the normal merge without copying independent edits', () => {
    const base = { ...workspace(), notes: { a: note('a', 'A'), b: note('b', 'B') } };
    const local = { ...base, notes: { ...base.notes, a: note('a', 'Local') } };
    const remote = { ...base, notes: { ...base.notes, b: note('b', 'Remote') } };
    const result = preserveConflictCopies([input(W, base, local, remote)]);
    expect(result?.copies).toBe(0);
    expect(get(result, W).notes).toEqual({ a: note('a', 'Local'), b: note('b', 'Remote') });
  });

  it('keeps a remote note and adds the incompatible local note under a collision-free identity', () => {
    const base = { ...workspace(), notes: { a: note('a', 'Before') } };
    const local = { ...base, notes: { a: note('a', 'Local'), recovered_1: note('recovered_1', 'Independent') } };
    const remote = { ...base, notes: { a: note('a', 'Remote'), recovered_2: note('recovered_2', 'Remote addition') } };
    const inputs = [input(W, base, local, remote)], before = structuredClone(inputs);
    const result = preserveConflictCopies(inputs), state = get(result, W);
    expect(result?.copies).toBe(1);
    expect(state.notes.a).toEqual(remote.notes.a);
    const copy = Object.values(state.notes).find((value: any) => value.title.includes('(cópia deste aparelho)')) as any;
    expect(copy.id).not.toMatch(/^(a|recovered_1|recovered_2)$/);
    expect(copy.blocks).toEqual(local.notes.a.blocks);
    expect(state.notes.recovered_1).toEqual(local.notes.recovered_1);
    expect(state.notes.recovered_2).toEqual(remote.notes.recovered_2);
    expect(inputs).toEqual(before);
    expect(preserveConflictCopies(inputs)).toEqual(result);
    const value = result!.documents[0].value;
    expect(mergeCloudDocument(W, value, value, value)).toBe(value);
  });

  it('copies an entire local project with remapped task, sprint, comment, note and plan ownership', () => {
    const base = { ...workspace(), projects: { project: project('Before') },
      sprints: { sprint: { id: 'sprint', projectId: 'project', name: 'Sprint' } },
      tasks: { task: { id: 'task', projectId: 'project', title: 'Task', sprintId: 'sprint', sourcePlanId: 'plan', sourceNodeId: 'root' }, oldTask: { id: 'oldTask', projectId: 'project', title: 'Old', sprintId: null, sourcePlanId: 'older-plan', sourceNodeId: 'root' } },
      comments: { comment: { id: 'comment', projectId: 'project', taskId: 'task', body: 'Context' } },
      notes: { n: note('n', 'Body', 'project', 'task') } };
    const local = { ...base, projects: { project: project('Local') } }, remote = { ...base, projects: { project: project('Remote') } };
    const result = preserveConflictCopies([input(W, base, local, remote)]), state = get(result, W);
    expect(result?.copies).toBe(1);
    expect(state.projects.project).toEqual(remote.projects.project);
    const copy = Object.values(state.projects).find((value: any) => value.id !== 'project') as any;
    expect(copy.name).toBe('Local (cópia deste aparelho)');
    expect(copy.planner.project.id).not.toBe('plan');
    expect(copy.planner.archivedProject.id).not.toBe('older-plan');
    const tasks = Object.values(state.tasks).filter((value: any) => value.projectId === copy.id) as any[];
    expect(tasks).toHaveLength(2);
    const task = tasks.find(value => value.title === 'Task');
    expect(task.id).not.toBe('task');
    expect(task.sourceNodeId).toBe('root');
    expect(task.sourcePlanId).toBe(copy.planner.project.id);
    expect(tasks.find(value => value.title === 'Old').sourcePlanId).toBe(copy.planner.archivedProject.id);
    expect(state.sprints[task.sprintId].projectId).toBe(copy.id);
    const copiedNote = Object.values(state.notes).find((value: any) => value.projectId === copy.id) as any;
    expect(copiedNote.taskId).toBe(task.id);
    const copiedComment = Object.values(state.comments).find((value: any) => value.projectId === copy.id) as any;
    expect(copiedComment.taskId).toBe(task.id);
    expect(state.notes.n).toEqual(base.notes.n);
  });

  it('does not resurrect a remotely deleted original when preserving a local edit', () => {
    const base = { ...workspace(), notes: { a: note('a', 'Before') } };
    const local = { ...base, notes: { a: note('a', 'Local') } }, remote = workspace();
    const result = preserveConflictCopies([input(W, base, local, remote)]), state = get(result, W);
    expect(result?.copies).toBe(1);
    expect(state.notes.a).toBeUndefined();
    expect(Object.values(state.notes)).toMatchObject([{ blocks: [{ text: 'Local' }] }]);
    expect(preserveConflictCopies([input(W, base, base, remote)])?.copies).toBe(0);
  });

  it('keeps the local singleton coherent with its copied managed planner', () => {
    const base = { ...workspace(), projects: { project: project('Before') } };
    const local = { ...base, projects: { project: project('Local') } }, remote = { ...base, projects: { project: project('Remote') } };
    const result = preserveConflictCopies([input(W, base, local, remote), input(G, base.projects.project.planner, local.projects.project.planner, remote.projects.project.planner, 6)]);
    const copy = Object.values(get(result, W).projects).find((value: any) => value.id !== 'project') as any;
    expect(get(result, G)).toEqual(copy.planner);
    expect(copy.planner.project.nodes).toEqual(local.projects.project.planner.project.nodes);
  });

  it('copies the canonical owner with its newer editor and archived session', () => {
    const modern = (text: string) => ({ ...planner(text), archivedSession: { projectId: 'older-plan',
      drafts: { root: { name: 'Archived local draft' } }, parkedSuggestions: {}, objectiveDraft: planner('Archived').objectiveDraft } });
    const base = { ...workspace(), projects: { project: { ...project('Before'), planner: modern('Before') } } };
    const local = { ...base, projects: { project: { ...project('Local'), planner: modern('Local checkpoint') } } };
    const remote = { ...base, projects: { project: { ...project('Remote'), planner: modern('Remote') } } };
    const localEditor = { ...modern('Canonical local'), plannerOwnerId: 'project' };
    const result = preserveConflictCopies([input(W, base, local, remote),
      input(G, { ...modern('Before'), plannerOwnerId: 'project' }, localEditor, { ...modern('Remote'), plannerOwnerId: 'project' }, 6)]);
    const state = get(result, W), graph = get(result, G);
    const copy = Object.values(state.projects).find((value: any) => value.id !== 'project') as any;
    expect(result?.copies).toBe(1);
    expect(state.projects.project).toEqual(remote.projects.project);
    expect(copy.planner).not.toHaveProperty('plannerOwnerId');
    expect(graph).toEqual({ ...copy.planner, plannerOwnerId: copy.id });
    expect(copy.planner.project.objective).toBe('Canonical local');
    expect(copy.planner.archivedSession).toEqual({ ...localEditor.archivedSession, projectId: copy.planner.archivedProject.id });
  });

  it('keeps an explicitly standalone editor separate from an identical managed checkpoint', () => {
    const base = { ...planner('Before'), archivedSession: null, plannerOwnerId: null };
    const local = { ...planner('Local'), archivedSession: null, plannerOwnerId: null };
    const remote = { ...planner('Remote'), archivedSession: null, plannerOwnerId: null };
    const managed = { ...workspace(), projects: { project: { ...project('Local'), planner: { ...planner('Local'), archivedSession: null } } } };
    const result = preserveConflictCopies([input(W, managed, managed, managed), input(G, base, local, remote, 6)]);
    const state = get(result, W), copy = Object.values(state.projects).find((value: any) => value.id !== 'project') as any;
    expect(result?.copies).toBe(1);
    expect(state.projects.project).toEqual(managed.projects.project);
    expect(copy.planner).not.toHaveProperty('plannerOwnerId');
    expect(copy.planner.project.nodes).toEqual(local.project.nodes);
    expect(get(result, G)).toEqual(remote);
  });

  it('recovers the entire owner when only its active editor has conflicting newer edits', () => {
    const managed = { ...workspace(), projects: { project: project('Checkpoint') },
      tasks: { task: { id: 'task', projectId: 'project', title: 'Investigation', sourcePlanId: 'plan', sourceNodeId: 'root' } } };
    const graph = (text: string) => ({ ...planner(text), archivedSession: null, plannerOwnerId: 'project' });
    const result = preserveConflictCopies([input(W, managed, managed, managed), input(G, graph('Before'), graph('Local editor'), graph('Remote editor'), 6)]);
    const state = get(result, W), copy = Object.values(state.projects).find((value: any) => value.id !== 'project') as any;
    expect(result?.copies).toBe(1);
    expect(state.projects.project).toEqual(managed.projects.project);
    expect(copy.planner.project.objective).toBe('Local editor');
    expect(Object.values(state.tasks)).toEqual(expect.arrayContaining([expect.objectContaining({ projectId: copy.id, sourcePlanId: copy.planner.project.id })]));
    expect(get(result, G)).toEqual({ ...copy.planner, plannerOwnerId: copy.id });
  });

  it('recovers a standalone local editor as a project and retains the remote singleton', () => {
    const base = planner('Before'), local = planner('Local'), remote = planner('Remote');
    const result = preserveConflictCopies([input(W, workspace(), workspace(), workspace()), input(G, base, local, remote, 6)]);
    const copy = Object.values(get(result, W).projects)[0] as any;
    expect(result?.copies).toBe(1);
    expect(copy.planner.project.id).not.toBe(local.project.id);
    expect(copy.planner.project.nodes).toEqual(local.project.nodes);
    expect(copy.planner.objectiveDraft).toEqual(local.objectiveDraft);
    expect(get(result, G)).toEqual(remote);
  });

  it('preserves divergent chats as complete conversations instead of mixing messages and model history', () => {
    const base = { sessionId: 'session', messages: [], modelHistory: [], archivedSessions: [], rateLimits: {} };
    const local = { ...base, messages: [{ id: 'local-message', role: 'user', text: 'Local question', createdAt: 1 }], modelHistory: [{ role: 'user', content: 'Local context' }] };
    const remote = { ...base, messages: [{ id: 'remote-message', role: 'user', text: 'Remote question', createdAt: 2 }], modelHistory: [{ role: 'user', content: 'Remote context' }] };
    const result = preserveConflictCopies([input(C, base, local, remote, 1)]), state = get(result, C);
    expect(result?.copies).toBe(1);
    expect(state.messages).toEqual(remote.messages);
    expect(state.modelHistory).toEqual(remote.modelHistory);
    expect(state.archivedSessions).toHaveLength(1);
    expect(state.archivedSessions[0].sessionId).not.toBe(base.sessionId);
    expect(state.archivedSessions[0].messages).toEqual([{ ...local.messages[0], id: expect.any(String) }]);
    expect(state.archivedSessions[0].messages[0].id).not.toBe(local.messages[0].id);
    expect(state.archivedSessions[0].modelHistory).toEqual(local.modelHistory);
  });

  it('refuses unsafe envelopes, unsupported conflicts and unknown workspace fields', () => {
    expect(preserveConflictCopies([{ key: W, base: '{}', local: '{}', remote: '{}' }])).toBeNull();
    expect(preserveConflictCopies([{ key: 'dynamic_diary-theme', base: 'light', local: 'dark', remote: 'oled' }])).toBeNull();
    const base = { ...workspace(), mystery: 'before' };
    expect(preserveConflictCopies([input(W, base, { ...base, mystery: 'local' }, { ...base, mystery: 'remote' })])).toBeNull();
    const invalid = { ...workspace(), notes: { a: { ...note('a', 'Body'), taskId: 'missing', projectId: 'missing' } } };
    expect(preserveConflictCopies([input(W, workspace(), invalid, workspace())])).toBeNull();
    const legacy = { ...workspace(), tasks: { a: { id: 'a', title: 'Before' } } };
    expect(preserveConflictCopies([input(W, legacy, { ...legacy, tasks: { a: { id: 'a', title: 'Local' } } }, { ...legacy, tasks: { a: { id: 'a', title: 'Remote' } } })])).toBeNull();
  });

  it('keeps the original remote owner when a task conflict also has independent local project changes', () => {
    const base = { ...workspace(), projects: { project: project('Before') }, tasks: { task: { id: 'task', projectId: 'project', title: 'Before' } } };
    const local = { ...base, projects: { project: { ...base.projects.project, name: 'Local owner' } }, tasks: { task: { ...base.tasks.task, title: 'Local task' } } };
    const remote = { ...base, tasks: { task: { ...base.tasks.task, title: 'Remote task' } } };
    const result = preserveConflictCopies([input(W, base, local, remote)]), state = get(result, W);
    expect(state.projects.project).toEqual(remote.projects.project);
    expect(state.tasks.task).toEqual(remote.tasks.task);
    expect(Object.values(state.projects)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Local owner (cópia deste aparelho)' })]));
  });

  it('preserves independently added local content when its project was deleted remotely', () => {
    const base = { ...workspace(), projects: { project: project('Before') } };
    const local = { ...base, notes: { n: note('n', 'New local investigation', 'project') } };
    const result = preserveConflictCopies([input(W, base, local, workspace())]), state = get(result, W);
    expect(result?.copies).toBe(1);
    expect(state.projects.project).toBeUndefined();
    expect(state.notes.n).toBeUndefined();
    const copy = Object.values(state.projects)[0] as any;
    expect(Object.values(state.notes)).toMatchObject([{ projectId: copy.id, blocks: [{ text: 'New local investigation' }] }]);
  });

  it('copies conflicting boards without synthesizing their drawing or edge structure', () => {
    const board = { id: 'board', title: 'Board', archived: false, createdAt: 1, updatedAt: 1, document: { version: 1, items: [{ id: 'text', kind: 'text', text: 'Before', x: 0, y: 0, width: 200, height: 100, fontSize: 18, color: '#000000' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    const base = { ...workspace(), boards: { board } };
    const local = { ...base, boards: { board: { ...board, document: { ...board.document, items: [{ ...board.document.items[0], text: 'Local' }] } } } };
    const remote = { ...base, boards: { board: { ...board, document: { ...board.document, items: [{ ...board.document.items[0], text: 'Remote' }] } } } };
    const result = preserveConflictCopies([input(W, base, local, remote)]), state = get(result, W);
    expect(result?.copies).toBe(1);
    expect(state.boards.board).toEqual(remote.boards.board);
    expect(Object.values(state.boards).find((value: any) => value.id !== 'board')).toMatchObject({ title: 'Board (cópia deste aparelho)', document: local.boards.board.document });
  });

  it('refuses unsupported envelope metadata instead of silently dropping a local change', () => {
    const base = { state: { ...workspace(), notes: { a: note('a', 'Before') } }, version: 2, unknown: 'before' };
    const local = { ...base, unknown: 'local', state: { ...base.state, notes: { a: note('a', 'Local') } } };
    const remote = { ...base, state: { ...base.state, notes: { a: note('a', 'Remote') } } };
    expect(preserveConflictCopies([{ key: W, base: JSON.stringify(base), local: JSON.stringify(local), remote: JSON.stringify(remote) }])).toBeNull();
  });

  it('preserves a long chat question even when its derived display title must be shortened', () => {
    const base = { sessionId: 'session', messages: [], modelHistory: [], archivedSessions: [] };
    const text = 'Uma pergunta longa sobre a organização completa de um projeto. '.repeat(8);
    const local = { ...base, messages: [{ id: 'local', role: 'user', text, createdAt: 1 }] };
    const remote = { ...base, messages: [{ id: 'remote', role: 'user', text: 'Outra pergunta', createdAt: 2 }] };
    const state = get(preserveConflictCopies([input(C, base, local, remote, 1)]), C);
    expect(state.archivedSessions[0].messages[0].text).toBe(text);
    expect(state.archivedSessions[0].title.length).toBeLessThanOrEqual(160);
  });

  it('remaps visual proposal ownership to the plan when legacy workspace and plan IDs coincide', () => {
    const legacy = (text: string) => {
      const item = project(text);
      const prompt = { text: 'Um modelo de exemplo', mentions: [], attachments: [] };
      return { ...item, planner: { ...item.planner, project: { ...item.planner.project, id: 'project', visuals: { version: 1, mode: 'approval', artifacts: [],
        proposals: [{ id: 'proposal', projectId: 'project', label: 'Exemplo', input: prompt, contextFingerprint: 'example', createdAt: 1, status: 'ready', scene: { version: 1, label: 'Exemplo', objects: [] } }], drafts: { search: prompt, model: prompt } } } } };
    };
    const base = { ...workspace(), projects: { project: legacy('Before') } };
    const local = { ...base, projects: { project: legacy('Local') } }, remote = { ...base, projects: { project: legacy('Remote') } };
    const copy = Object.values(get(preserveConflictCopies([input(W, base, local, remote)]), W).projects).find((value: any) => value.id !== 'project') as any;
    expect(copy.planner.project.visuals.proposals[0].projectId).toBe(copy.planner.project.id);
    expect(copy.planner.project.visuals.proposals[0].projectId).not.toBe(copy.id);
  });
});
