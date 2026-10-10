import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { workspaceRepository } from '@/data/workspaceRepository';
import { nanoid } from 'nanoid';
import { TASK_STATUSES, type ManagedProject, type Task, type TaskInput, type TaskComment, type Sprint, type SprintInput, type Note, type Folder, type PlannerSnapshot, type Surface } from './types';

let writes: Promise<void> = Promise.resolve();
let lastWriteError: unknown = null;
const storage: StateStorage = {
  getItem: (key) => workspaceRepository.getItem(key),
  setItem: (key, value) => {
    const next = writes.then(() => workspaceRepository.setItem(key, value));
    writes = next.then(() => { lastWriteError = null; }, (error: unknown) => { lastWriteError = error; });
    return next;
  },
  removeItem: (key) => workspaceRepository.removeItem(key),
};
export const flushWorkspacePersistence = async () => {
  await writes;
  if (lastWriteError) throw lastWriteError;
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
  projects: Record<string, ManagedProject>;
  tasks: Record<string, Task>;
  comments: Record<string, TaskComment>;
  sprints: Record<string, Sprint>;
  notes: Record<string, Note>;
  folders: Record<string, Folder>;
  activeProjectId: string | null;
  surface: Surface;
  legacyImported: boolean;
  createProject: (name: string, objective?: string) => string;
  updateProject: (id: string, patch: Partial<Pick<ManagedProject, 'name' | 'objective' | 'archived'>>) => void;
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
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'blocks' | 'projectId' | 'taskId' | 'folderId' | 'pinned'>>) => void;
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
  if (note.projectId && !state.projects[note.projectId]) throw new Error('projectMissing');
  if (note.folderId && !state.folders[note.folderId]) throw new Error('folderMissing');
  if (note.taskId && (!state.tasks[note.taskId] || state.tasks[note.taskId].projectId !== note.projectId)) throw new Error('invalidTask');
}

export const useWorkspaceStore = create<WorkspaceState>()(persist((set, get) => ({
  projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {},
  activeProjectId: null, surface: 'projects', legacyImported: false,
  createProject: (name, objective = '') => {
    const id = nanoid(10), now = Date.now();
    const project: ManagedProject = { id, name: required(name), objective: objective.trim(), archived: false, createdAt: now, updatedAt: now };
    set((s) => ({ projects: { ...s.projects, [id]: project }, activeProjectId: id, surface: 'overview' }));
    return id;
  },
  updateProject: (id, patch) => set((s) => {
    const project = s.projects[id];
    if (!project) throw new Error('projectMissing');
    const next = { ...project, ...patch, updatedAt: Date.now() };
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
  partialize: ({ projects, tasks, comments, sprints, notes, folders, legacyImported }) => ({ projects, tasks, comments, sprints, notes, folders, legacyImported }),
  migrate: (persisted) => ({ ...(persisted as Partial<WorkspaceState>), comments: (persisted as Partial<WorkspaceState>).comments ?? {} }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<WorkspaceState> | undefined;
    return { ...current, ...saved, comments: saved?.comments ?? {} };
  },
}));
