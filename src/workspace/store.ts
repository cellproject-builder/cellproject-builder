import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { workspaceRepository } from '@/data/workspaceRepository';
import { getCloudRuntime } from '@/cloud/runtime';
import { nanoid } from 'nanoid';
import { noteCanvasSchema } from './noteCanvasModel';
import { noteInkSchema } from './noteInkModel';
import { assertNoteImageBudget } from './noteImages';
import { validatePersistedNoteCanvases } from './noteCanvasPersistence';
import { projectAppearanceSchema, type ProjectAppearance } from './project-appearance/projectAppearance';
import { assertBoardWorkspaceImageBudget, boardRecordSchema, createBoardDocument, validatePersistedBoards, type BoardRecord } from '@/boards/model';
import { TASK_STATUSES, type ManagedProject, type Task, type TaskInput, type TaskComment, type Sprint, type SprintInput, type Note, type Folder, type PlannerSnapshot, type Surface } from './types';

let writes: Promise<void> = Promise.resolve();
let lastWriteError: unknown = null;
interface HydrationAttempt {
  source: ReturnType<typeof getCloudRuntime>;
  done: Promise<void>;
  finish: () => void;
  pending: boolean;
  reported: boolean;
  error?: unknown;
}
let hydrationAttempt: HydrationAttempt | undefined;
const storage: StateStorage = {
  getItem: (key) => workspaceRepository.getItem(key),
  setItem: (key, value) => {
    // CloudRuntime already serializes and coalesces drafts; do not retain a
    // second queue of complete envelopes while a remote request is pending.
    const cloud = getCloudRuntime(); if (cloud) return cloud.write(key, value);
    const next = writes.then(() => workspaceRepository.setItem(key, value));
    writes = next.then(() => { lastWriteError = null; }, (error: unknown) => { lastWriteError = error; });
    return next;
  },
  removeItem: (key) => workspaceRepository.removeItem(key),
};
export const flushWorkspacePersistence = async () => {
  await writes;
  if (lastWriteError) throw lastWriteError;
  await getCloudRuntime()?.flush();
};
const required = (text: string) => {
  if (!text.trim()) throw new Error('required');
  return text.trim();
};
const commentBody = (body: string) => {
  if (typeof body !== 'string' || !body.trim()) throw new Error('commentRequired');
  return body.trim();
};
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export interface WorkspaceState {
  boards: Record<string, BoardRecord>;
  activeBoardId: string | null;
  projects: Record<string, ManagedProject>;
  tasks: Record<string, Task>;
  comments: Record<string, TaskComment>;
  sprints: Record<string, Sprint>;
  notes: Record<string, Note>;
  folders: Record<string, Folder>;
  activeProjectId: string | null;
  surface: Surface;
  legacyImported: boolean;
  createBoard: (title?: string) => string;
  openBoard: (id: string) => void;
  updateBoard: (id: string, patch: Partial<Pick<BoardRecord, 'title' | 'archived' | 'document'>>) => void;
  createProject: (name: string, objective?: string, appearance?: ProjectAppearance) => string;
  updateProject: (id: string, patch: Partial<Pick<ManagedProject, 'name' | 'objective' | 'archived' | 'appearance'>>) => void;
  selectProject: (id: string) => void;
  navigate: (surface: Surface) => void;
  savePlanner: (id: string, snapshot: PlannerSnapshot) => void;
  createTask: (projectId: string, input: TaskInput) => string;
  updateTask: (id: string, patch: Partial<TaskInput>) => void;
  deleteTask: (id: string) => void;
  addComment: (taskId: string, body: string, author?: TaskComment['author']) => string;
  updateComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;
  importPlanTasks: (projectId: string) => number;
  createSprint: (projectId: string, input: SprintInput) => string;
  startSprint: (id: string) => void;
  completeSprint: (id: string) => void;
  createNote: (input?: Partial<Pick<Note, 'projectId' | 'taskId' | 'folderId' | 'title'>>) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'blocks' | 'canvas' | 'ink' | 'projectId' | 'taskId' | 'folderId' | 'pinned'>>) => void;
  trashNote: (id: string) => void;
  restoreNote: (id: string) => void;
  createFolder: (name: string) => string;
  deleteFolder: (id: string) => void;
}

function checkTask(state: WorkspaceState, task: Task) {
  if (!state.projects[task.projectId]) throw new Error('projectMissing');
  required(task.title);
  if (!TASK_STATUSES.includes(task.status) || !['low', 'medium', 'high'].includes(task.priority)) throw new Error('invalidTask');
  if (task.dueDate && !validDate(task.dueDate)) throw new Error('invalidDates');
  if (task.sprintId) {
    const sprint = state.sprints[task.sprintId];
    if (!sprint || sprint.projectId !== task.projectId || sprint.status === 'completed') throw new Error('invalidSprint');
  }
}
function checkNote(state: WorkspaceState, note: Note) {
  if (note.ink !== undefined) noteInkSchema.parse(note.ink);
  if (note.canvas) {
    noteCanvasSchema.parse(note.canvas);
    assertNoteImageBudget(Object.values(state.notes).filter(item => item.id !== note.id), {}, note.canvas.items.flatMap(item => item.kind === 'image' ? [item.src] : []));
  }
  if (note.projectId && !state.projects[note.projectId]) throw new Error('projectMissing');
  if (note.folderId && !state.folders[note.folderId]) throw new Error('folderMissing');
  if (note.taskId && (!state.tasks[note.taskId] || state.tasks[note.taskId].projectId !== note.projectId)) throw new Error('invalidTask');
  assertBoardWorkspaceImageBudget(state.boards ?? {}, { ...state.notes, [note.id]: note });
}

export const useWorkspaceStore = create<WorkspaceState>()(persist((set, get) => ({
  boards: {}, activeBoardId: null,
  projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {},
  activeProjectId: null, surface: 'projects', legacyImported: false,
  createBoard: (title = 'Novo quadro') => {
    const id = nanoid(10), now = Date.now();
    const board = boardRecordSchema.parse({ id, title, document: createBoardDocument(), archived: false, createdAt: now, updatedAt: now });
    set(state => ({ boards: { ...state.boards, [id]: board }, activeBoardId: id, surface: 'boards' }));
    return id;
  },
  openBoard: id => {
    if (!get().boards[id]) throw new Error('boardMissing');
    set({ activeBoardId: id, surface: 'boards' });
  },
  updateBoard: (id, patch) => set(state => {
    const board = state.boards[id];
    if (!board) throw new Error('boardMissing');
    const next = boardRecordSchema.parse({ ...board, ...patch, id: board.id, createdAt: board.createdAt, updatedAt: Date.now() });
    const boards = { ...state.boards, [id]: next };
    assertBoardWorkspaceImageBudget(boards, state.notes);
    return { boards };
  }),
  createProject: (name, objective = '', appearance) => {
    const id = nanoid(10), now = Date.now();
    const project: ManagedProject = { id, name: required(name), objective: objective.trim(), archived: false, createdAt: now, updatedAt: now, ...(appearance === undefined ? {} : { appearance: projectAppearanceSchema.parse(appearance) }) };
    set((s) => ({ projects: { ...s.projects, [id]: project }, activeProjectId: id, surface: 'overview' }));
    return id;
  },
  updateProject: (id, patch) => set((s) => {
    const project = s.projects[id];
    if (!project) throw new Error('projectMissing');
    // Validate only the incoming customization; older projects keep their stored data.
    const next = { ...project, ...patch, ...(patch.appearance === undefined ? {} : { appearance: projectAppearanceSchema.parse(patch.appearance) }), updatedAt: Date.now() };
    next.name = required(next.name);
    return { projects: { ...s.projects, [id]: next } };
  }),
  selectProject: (id) => {
    if (!get().projects[id]) throw new Error('projectMissing');
    set({ activeProjectId: id, surface: 'overview' });
  },
  navigate: (surface) => set({ surface }),
  savePlanner: (id, planner) => set((s) => {
    const project = s.projects[id];
    if (!project) return s;
    return { projects: { ...s.projects, [id]: { ...project, planner, updatedAt: Date.now() } } };
  }),
  createTask: (projectId, input) => {
    const id = nanoid(10), now = Date.now();
    const task: Task = { id, projectId, description: '', status: 'todo', priority: 'medium', dueDate: '', sprintId: null, createdAt: now, updatedAt: now, ...input, title: input.title.trim() };
    checkTask(get(), task);
    set((s) => ({ tasks: { ...s.tasks, [id]: task } }));
    return id;
  },
  updateTask: (id, patch) => set((s) => {
    const task = s.tasks[id];
    if (!task) throw new Error('invalidTask');
    const next = { ...task, ...patch, title: (patch.title ?? task.title).trim(), updatedAt: Date.now() };
    // Reopening completed historical work puts it back in the backlog.
    if (next.sprintId && next.sprintId === task.sprintId && s.sprints[next.sprintId]?.status === 'completed' && next.status !== 'done') next.sprintId = null;
    if (next.sprintId && next.sprintId === task.sprintId && s.sprints[next.sprintId]?.status === 'completed') {
      checkTask(s, { ...next, sprintId: null });
    } else checkTask(s, next);
    return { tasks: { ...s.tasks, [id]: next } };
  }),
  deleteTask: (id) => set((s) => {
    const tasks = { ...s.tasks };
    delete tasks[id];
    const notes = Object.fromEntries(Object.entries(s.notes).map(([key, n]) => [key, n.taskId === id ? { ...n, taskId: null } : n]));
    const comments = Object.fromEntries(Object.entries(s.comments).filter(([, comment]) => comment.taskId !== id));
    return { tasks, notes, comments };
  }),
  addComment: (taskId, body, author = 'user') => {
    const task = get().tasks[taskId];
    if (!task) throw new Error('invalidTask');
    if (author !== 'user' && author !== 'assistant') throw new Error('invalidComment');
    const text = commentBody(body);
    const id = nanoid(10), now = Date.now();
    const comment: TaskComment = { id, projectId: task.projectId, taskId, body: text, author, createdAt: now, updatedAt: now };
    set((s) => ({ comments: { ...s.comments, [id]: comment } }));
    return id;
  },
  updateComment: (id, body) => set((s) => {
    const comment = s.comments[id];
    if (!comment) throw new Error('commentMissing');
    if (s.tasks[comment.taskId]?.projectId !== comment.projectId) throw new Error('invalidTask');
    return { comments: { ...s.comments, [id]: { ...comment, body: commentBody(body), updatedAt: Date.now() } } };
  }),
  deleteComment: (id) => set((s) => {
    const comments = { ...s.comments };
    delete comments[id];
    return { comments };
  }),
  importPlanTasks: (projectId) => {
    const s = get(), plan = s.projects[projectId]?.planner?.project;
    if (!plan) return 0;
    const existing = new Set(Object.values(s.tasks).filter((t) => t.projectId === projectId && t.sourcePlanId === plan.id).map((t) => t.sourceNodeId));
    const parents = new Set(Object.values(plan.nodes).map((n) => n.parentId));
    const tasks = { ...s.tasks };
    let count = 0;
    for (const node of Object.values(plan.nodes)) {
      if (node.kind !== 'passo' || parents.has(node.id) || existing.has(node.id) || node.state === 'discarded') continue;
      const id = nanoid(10), now = Date.now();
      tasks[id] = { id, projectId, title: node.name, description: [node.oQue, node.porQue].filter(Boolean).join('\n\n'), status: 'todo', priority: 'medium', dueDate: '', sprintId: null, sourceNodeId: node.id, sourcePlanId: plan.id, createdAt: now, updatedAt: now };
      count++;
    }
    if (count) set({ tasks });
    return count;
  },
  createSprint: (projectId, input) => {
    if (!get().projects[projectId]) throw new Error('projectMissing');
    if (!validDate(input.startDate) || !validDate(input.endDate) || input.endDate < input.startDate) throw new Error('invalidDates');
    const id = nanoid(10);
    const sprint: Sprint = { ...input, name: required(input.name), id, projectId, status: 'planned', createdAt: Date.now() };
    set((s) => ({ sprints: { ...s.sprints, [id]: sprint } }));
    return id;
  },
  startSprint: (id) => set((s) => {
    const sprint = s.sprints[id];
    if (!sprint || sprint.status !== 'planned') throw new Error('invalidSprint');
    if (Object.values(s.sprints).some((other) => other.projectId === sprint.projectId && other.status === 'active')) throw new Error('activeSprint');
    return { sprints: { ...s.sprints, [id]: { ...sprint, status: 'active' } } };
  }),
  completeSprint: (id) => set((s) => {
    const sprint = s.sprints[id];
    if (!sprint || sprint.status !== 'active') throw new Error('invalidSprint');
    const tasks = Object.fromEntries(Object.entries(s.tasks).map(([key, task]) => [key, task.sprintId === id && task.status !== 'done' ? { ...task, sprintId: null, updatedAt: Date.now() } : task]));
    return { tasks, sprints: { ...s.sprints, [id]: { ...sprint, status: 'completed', completedAt: Date.now() } } };
  }),
  createNote: (input = {}) => {
    const id = nanoid(10), now = Date.now();
    const note: Note = { id, title: '', blocks: [{ id: nanoid(10), type: 'text', text: '' }], projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: now, updatedAt: now, ...input };
    checkNote(get(), note);
    set((s) => ({ notes: { ...s.notes, [id]: note } }));
    return id;
  },
  updateNote: (id, patch) => set((s) => {
    const note = s.notes[id];
    if (!note) throw new Error('noteMissing');
    const next = { ...note, ...patch, updatedAt: Date.now() };
    checkNote(s, next);
    return { notes: { ...s.notes, [id]: next } };
  }),
  trashNote: (id) => set((s) => s.notes[id] ? { notes: { ...s.notes, [id]: { ...s.notes[id], deletedAt: Date.now(), updatedAt: Date.now() } } } : s),
  restoreNote: (id) => set((s) => s.notes[id] ? { notes: { ...s.notes, [id]: { ...s.notes[id], deletedAt: null, updatedAt: Date.now() } } } : s),
  createFolder: (name) => {
    const id = nanoid(10), folder: Folder = { id, name: required(name) };
    set((s) => ({ folders: { ...s.folders, [id]: folder } }));
    return id;
  },
  deleteFolder: (id) => set((s) => {
    const folders = { ...s.folders };
    delete folders[id];
    return { folders, notes: Object.fromEntries(Object.entries(s.notes).map(([key, note]) => [key, note.folderId === id ? { ...note, folderId: null } : note])) };
  }),
}), {
  name: 'cellproject-workspace', version: 2,
  storage: createJSONStorage(() => storage),
  partialize: ({ projects, tasks, comments, sprints, notes, folders, boards, legacyImported }) => ({ projects, tasks, comments, sprints, notes, folders, boards, legacyImported }),
  migrate: (persisted) => ({ ...(persisted as Partial<WorkspaceState>), comments: (persisted as Partial<WorkspaceState>).comments ?? {}, boards: (persisted as Partial<WorkspaceState>).boards === undefined ? {} : (persisted as Partial<WorkspaceState>).boards }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<WorkspaceState> | undefined;
    validatePersistedNoteCanvases(saved?.notes);
    validatePersistedBoards(saved?.boards, saved?.notes);
    return { ...current, ...saved, comments: saved?.comments ?? {}, boards: saved?.boards ?? {}, activeBoardId: null };
  },
  onRehydrateStorage: () => {
    // A superseding hydration must release any bootstrap waiting on the old one.
    hydrationAttempt?.finish();
    let finish!: () => void;
    const attempt: HydrationAttempt = {
      source: getCloudRuntime(), done: new Promise<void>(resolve => { finish = resolve; }),
      finish: () => { attempt.pending = false; finish(); }, pending: true, reported: false,
    };
    hydrationAttempt = attempt;
    return (_state, error) => { attempt.error = error; attempt.finish(); };
  },
}));

/** Zustand absorbs hydration errors; surface them to bootstrap instead of waiting on Splash forever. */
export async function ensureWorkspaceHydrated(): Promise<void> {
  for (;;) {
    let attempt = hydrationAttempt;
    const sameSource = attempt?.source === getCloudRuntime();
    if (sameSource && !attempt?.pending && !attempt?.error && useWorkspaceStore.persist.hasHydrated()) return;
    if (!sameSource || !attempt || !attempt.pending && (!attempt.error || attempt.reported)) {
      const loading = useWorkspaceStore.persist.rehydrate();
      attempt = hydrationAttempt;
      await loading;
    }
    await attempt?.done;
    if (attempt !== hydrationAttempt) continue;
    if (attempt) attempt.reported = true;
    if (attempt?.error) throw attempt.error;
    if (!useWorkspaceStore.persist.hasHydrated()) throw new Error('Não foi possível abrir os dados do workspace. Tente novamente.');
    return;
  }
}
