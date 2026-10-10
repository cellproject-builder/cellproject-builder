import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useWorkspaceStore as store, flushWorkspacePersistence, ensureWorkspaceHydrated } from './store';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { workspaceRepository } from '@/data/workspaceRepository';
import { createNoteCanvas } from './noteCanvasModel';

beforeEach(async () => {
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'projects', legacyImported: false });
});

describe('notebook hydration boundary', () => {
  it('rejects invalid remote canvas before replacing state and never writes a partial workspace', async () => {
    await flushWorkspacePersistence();
    const before = store.getState();
    const raw = JSON.stringify({ version: 2, state: { notes: { bad: { id: 'bad', canvas: { version: 9 } } } } });
    const fetcher = vi.fn<typeof fetch>();
    const cloud = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: raw, revision: 1 }], media: [] }, fetcher);
    configureCloud(cloud);
    try {
      await expect(ensureWorkspaceHydrated()).rejects.toThrow('caderno inválido');
      expect(store.getState()).toBe(before);
      expect(store.persist.hasHydrated()).toBe(false);
      expect(cloud.get('cellproject-workspace')).toBe(raw);
      expect(fetcher).not.toHaveBeenCalled();
      expect(cloud.getSnapshot().pending).toBe(0);
    } finally { configureCloud(null); }
  });

  it('waits on an existing hydration once and preserves valid and legacy notes', async () => {
    const legacy = store.getState().createNote({ title: 'Legado' });
    const visual = store.getState().createNote({ title: 'Visual' });
    const canvas = createNoteCanvas();
    store.getState().updateNote(visual, { canvas });
    await flushWorkspacePersistence();
    const saved = await idbGet<string>('cellproject-workspace');
    store.setState({ notes: {} });
    await flushWorkspacePersistence();
    let release!: (raw: string) => void;
    const read = vi.spyOn(workspaceRepository, 'getItem').mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
    try {
      const hydration = store.persist.rehydrate();
      const first = ensureWorkspaceHydrated(), second = ensureWorkspaceHydrated();
      expect(read).toHaveBeenCalledOnce();
      release(saved!);
      await Promise.all([hydration, first, second]);
      expect(read).toHaveBeenCalledOnce();
      expect(store.getState().notes[visual].canvas).toEqual(canvas);
      expect(store.getState().notes[legacy].canvas).toBeUndefined();
      expect(store.getState().notes[legacy].title).toBe('Legado');
    } finally { read.mockRestore(); }
  });
});

describe('task comments', () => {
  it('requires an existing task, a body and a supported author without changing comments', () => {
    const project = store.getState().createProject('Projeto');
    const task = store.getState().createTask(project, { title: 'Tarefa' });
    expect(() => store.getState().addComment('missing-task', 'Contexto')).toThrow('invalidTask');
    expect(() => store.getState().addComment(task, ' \n ')).toThrow('commentRequired');
    expect(() => store.getState().addComment(task, 'Contexto', 'other' as 'user')).toThrow('invalidComment');
    expect(store.getState().comments).toEqual({});
  });

  it('derives comment ownership from the task and identifies user and assistant authors', () => {
    const project = store.getState().createProject('Projeto');
    const task = store.getState().createTask(project, { title: 'Tarefa' });
    const user = store.getState().addComment(task, '  Contexto\n adicional  ');
    const assistant = store.getState().addComment(task, 'Próximo passo', 'assistant');
    expect(store.getState().comments[user]).toEqual({
      id: user, projectId: project, taskId: task, body: 'Contexto\n adicional', author: 'user',
      createdAt: expect.any(Number), updatedAt: expect.any(Number),
    });
    expect(store.getState().comments[assistant].author).toBe('assistant');
  });

  it('edits the body while preserving ownership, author and creation time', () => {
    const project = store.getState().createProject('Projeto');
    const task = store.getState().createTask(project, { title: 'Tarefa' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const id = store.getState().addComment(task, 'Antes', 'assistant');
      clock.mockReturnValue(200);
      store.getState().updateComment(id, '  Depois  ');
      expect(store.getState().comments[id]).toEqual({ id, projectId: project, taskId: task, body: 'Depois', author: 'assistant', createdAt: 100, updatedAt: 200 });
      expect(() => store.getState().updateComment(id, '\n ')).toThrow('commentRequired');
      expect(store.getState().comments[id].body).toBe('Depois');
      expect(() => store.getState().updateComment('missing-comment', 'Texto')).toThrow('commentMissing');
    } finally {
      clock.mockRestore();
    }
  });

  it('deletes one comment without changing other comments or its task', () => {
    const project = store.getState().createProject('Projeto');
    const task = store.getState().createTask(project, { title: 'Tarefa' });
    const first = store.getState().addComment(task, 'Primeiro');
    const second = store.getState().addComment(task, 'Segundo');
    store.getState().deleteComment(first);
    expect(store.getState().comments[first]).toBeUndefined();
    expect(store.getState().comments[second].body).toBe('Segundo');
    expect(store.getState().tasks[task].title).toBe('Tarefa');
  });

  it('removes the deleted task’s comments while preserving another project’s comments', () => {
    const a = store.getState().createProject('A');
    const b = store.getState().createProject('B');
    const taskA = store.getState().createTask(a, { title: 'A' });
    const taskB = store.getState().createTask(b, { title: 'B' });
    const commentA = store.getState().addComment(taskA, 'Contexto A');
    const commentB = store.getState().addComment(taskB, 'Contexto B');
    store.getState().deleteTask(taskA);
    expect(store.getState().comments[commentA]).toBeUndefined();
    expect(store.getState().comments[commentB].taskId).toBe(taskB);
  });

  it('persists comment edits and restores them from the existing IndexedDB key', async () => {
    const project = store.getState().createProject('Projeto');
    const task = store.getState().createTask(project, { title: 'Tarefa' });
    const id = store.getState().addComment(task, 'Antes', 'assistant');
    store.getState().updateComment(id, 'Depois');
    await flushWorkspacePersistence();
    const saved = await idbGet<string>('cellproject-workspace');
    store.setState({ projects: {}, tasks: {}, comments: {} });
    await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', saved);
    await store.persist.rehydrate();
    expect(store.getState().comments[id]).toMatchObject({ projectId: project, taskId: task, author: 'assistant', body: 'Depois' });
    expect(store.getState().tasks[task].title).toBe('Tarefa');
    store.getState().deleteComment(id);
    await flushWorkspacePersistence();
    expect(JSON.parse((await idbGet<string>('cellproject-workspace'))!).state.comments).toEqual({});
  });

  it.each([1, 2])('keeps existing workspace data when rehydrating a version %s snapshot without comments', async (version) => {
    const project = store.getState().createProject('Projeto antigo');
    const task = store.getState().createTask(project, { title: 'Tarefa antiga' });
    const note = store.getState().createNote({ projectId: project, taskId: task, title: 'Nota antiga' });
    const sprint = store.getState().createSprint(project, { name: 'Sprint antiga', goal: '', startDate: '2026-10-08', endDate: '2026-10-22' });
    const folder = store.getState().createFolder('Pasta antiga');
    store.setState({ legacyImported: true });
    await flushWorkspacePersistence();
    const saved = JSON.parse((await idbGet<string>('cellproject-workspace'))!);
    delete saved.state.comments;
    saved.version = version;
    store.getState().addComment(task, 'Apenas em memória');
    await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', JSON.stringify(saved));
    await store.persist.rehydrate();
    expect(store.getState().comments).toEqual({});
    expect(store.getState().projects[project].name).toBe('Projeto antigo');
    expect(store.getState().tasks[task].title).toBe('Tarefa antiga');
    expect(store.getState().notes[note].title).toBe('Nota antiga');
    expect(store.getState().sprints[sprint].name).toBe('Sprint antiga');
    expect(store.getState().folders[folder].name).toBe('Pasta antiga');
    expect(store.getState().legacyImported).toBe(true);
    expect(typeof store.getState().addComment).toBe('function');
  });
});

describe('project workspace', () => {
  it('persists independent project appearances and preserves legacy projects without one', async () => {
    const legacy = store.getState().createProject('Legado');
    const appearance = { icon: 'FutureRobotIcon', color: '#A1b2C3' };
    const first = store.getState().createProject('Robótica', 'Construir', appearance);
    const second = store.getState().createProject('Pesquisa', '', { icon: 'RocketIcon', color: '#a78bfa' });
    appearance.color = '#000000';
    expect(store.getState().projects[first].appearance?.color).toBe('#A1b2C3');
    store.getState().updateProject(first, { name: 'Robótica revisada' });
    await flushWorkspacePersistence();
    const saved = await idbGet('cellproject-workspace');
    store.setState({ projects: {} });
    await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', saved);
    await store.persist.rehydrate();
    expect(store.getState().projects[first]).toMatchObject({ name: 'Robótica revisada', appearance: { icon: 'FutureRobotIcon', color: '#A1b2C3' } });
    expect(store.getState().projects[second].appearance).toEqual({ icon: 'RocketIcon', color: '#a78bfa' });
    expect(store.getState().projects[legacy].appearance).toBeUndefined();
  });

  it('rejects invalid project appearance before creating or partially updating a project', () => {
    const id = store.getState().createProject('Original', 'Preservar', { icon: 'GearIcon', color: '#60a5fa' });
    const before = store.getState();
    expect(() => store.getState().createProject('Inválido', '', { icon: '🚀', color: '#60a5fa' })).toThrow();
    expect(store.getState()).toBe(before);
    expect(() => store.getState().updateProject(id, { name: 'Não aplicar', appearance: { icon: 'GearIcon', color: 'red' } })).toThrow();
    expect(store.getState()).toBe(before);
    expect(store.getState().projects[id].name).toBe('Original');
  });

  it('reports failed persistence and recovers on a successful retry', async () => {
    await flushWorkspacePersistence();
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Storage full', 'QuotaExceededError'); });
    const note = store.getState().createNote({ title: 'Não perder' });
    await expect(flushWorkspacePersistence()).rejects.toThrow('Storage full');
    write.mockRestore();
    store.getState().updateNote(note, { title: 'Salvar novamente' });
    await expect(flushWorkspacePersistence()).resolves.toBeUndefined();
    expect(JSON.parse((await idbGet<string>('cellproject-workspace'))!).state.notes[note].title).toBe('Salvar novamente');
  });
  it('creates projects without AI and keeps their tasks isolated', () => {
    const a = store.getState().createProject('Primeiro', 'Objetivo');
    const b = store.getState().createProject('Segundo');
    const task = store.getState().createTask(a, { title: 'Entrega' });
    store.getState().selectProject(b);
    expect(store.getState().tasks[task].projectId).toBe(a);
    expect(store.getState().activeProjectId).toBe(b);
    expect(store.getState().surface).toBe('overview');
    expect(() => store.getState().createProject('  ')).toThrow();
  });

  it('archives a project without deleting tasks or notes', () => {
    const id = store.getState().createProject('Projeto');
    const task = store.getState().createTask(id, { title: 'Tarefa' });
    const note = store.getState().createNote({ projectId: id });
    store.getState().updateProject(id, { archived: true });
    expect(store.getState().tasks[task]).toBeDefined();
    expect(store.getState().notes[note].projectId).toBe(id);
  });

  it('persists and rehydrates projects, notes and task changes', async () => {
    const id = store.getState().createProject('Persistente');
    const task = store.getState().createTask(id, { title: 'Teste' });
    store.getState().updateTask(task, { status: 'review' });
    const note = store.getState().createNote({ projectId: id });
    store.getState().updateNote(note, { title: 'Diário', blocks: [{ id: 'block', type: 'check', text: 'Conferir', checked: true }] });
    await flushWorkspacePersistence();
    const saved = await idbGet('cellproject-workspace');
    // Replace only in-memory state; rehydrate must restore IndexedDB.
    store.setState({ projects: {}, tasks: {}, notes: {} });
    await flushWorkspacePersistence();
    await idbSet('cellproject-workspace', saved);
    await store.persist.rehydrate();
    expect(store.getState().projects[id].name).toBe('Persistente');
    expect(store.getState().tasks[task].status).toBe('review');
    expect(store.getState().notes[note].blocks[0].checked).toBe(true);
  });
});

describe('sprints share the Kanban tasks', () => {
  it('rejects cross-project references and invalid dates', () => {
    const a = store.getState().createProject('A');
    const b = store.getState().createProject('B');
    const sprint = store.getState().createSprint(a, { name: 'Sprint 1', goal: '', startDate: '2026-10-08', endDate: '2026-10-22' });
    const task = store.getState().createTask(b, { title: 'Outro projeto' });
    expect(() => store.getState().updateTask(task, { sprintId: sprint })).toThrow();
    expect(() => store.getState().createSprint(a, { name: 'Inválida', goal: '', startDate: '2026-10-22', endDate: '2026-10-08' })).toThrow();
    expect(() => store.getState().createSprint(a, { name: 'Inválida', goal: '', startDate: '2026-02-30', endDate: '2026-03-10' })).toThrow();
  });

  it('allows one active sprint and returns unfinished work to the backlog', () => {
    const id = store.getState().createProject('Execução');
    const data = { name: 'Sprint', goal: 'Entregar', startDate: '2026-10-08', endDate: '2026-10-22' };
    const first = store.getState().createSprint(id, data);
    const second = store.getState().createSprint(id, data);
    const pending = store.getState().createTask(id, { title: 'Pendente', sprintId: first });
    const done = store.getState().createTask(id, { title: 'Pronta', sprintId: first, status: 'done' });
    store.getState().startSprint(first);
    expect(() => store.getState().startSprint(second)).toThrow();
    store.getState().completeSprint(first);
    expect(store.getState().tasks[pending].sprintId).toBeNull();
    expect(store.getState().tasks[done].sprintId).toBe(first);
    expect(() => store.getState().updateTask(pending, { sprintId: first })).toThrow();
    store.getState().startSprint(second);
    expect(store.getState().sprints[second].status).toBe('active');
  });
});

describe('personal diary', () => {
  it('supports independent notes, folders, pinning, trash and restore', () => {
    const folder = store.getState().createFolder('Ideias');
    const note = store.getState().createNote({ folderId: folder });
    store.getState().updateNote(note, { pinned: true, title: 'Ideia' });
    store.getState().trashNote(note);
    expect(store.getState().notes[note].deletedAt).toEqual(expect.any(Number));
    store.getState().restoreNote(note);
    expect(store.getState().notes[note].deletedAt).toBeNull();
    expect(store.getState().notes[note].pinned).toBe(true);
    expect(store.getState().notes[note].projectId).toBeNull();
    store.getState().deleteFolder(folder);
    expect(store.getState().notes[note].folderId).toBeNull();
  });

  it('validates linked tasks and preserves a note when its task is deleted', () => {
    const a = store.getState().createProject('A');
    const b = store.getState().createProject('B');
    const task = store.getState().createTask(a, { title: 'Tarefa' });
    const note = store.getState().createNote({ projectId: a, taskId: task });
    expect(() => store.getState().updateNote(note, { projectId: b })).toThrow();
    store.getState().deleteTask(task);
    expect(store.getState().notes[note].taskId).toBeNull();
    expect(store.getState().notes[note].projectId).toBe(a);
  });
});
