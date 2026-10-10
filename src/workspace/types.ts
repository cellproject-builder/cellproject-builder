import type { GraphState } from '@/store';

export type Surface = 'projects' | 'overview' | 'kanban' | 'scrum' | 'notes' | 'planner' | 'boards';
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export type Priority = 'low' | 'medium' | 'high';
export type PlannerSnapshot = Pick<GraphState,
  'project' | 'selectedNodeId' | 'focusedParentId' | 'lens' | 'viewMode' |
  'detailPanelOpen' | 'lastTutorNodeId' | 'drafts' | 'objectiveDraft' |
  'pendingSuggestions' | 'parkedSuggestions' | 'archivedProject' | 'archivedPending'>;

export interface ManagedProject {
  appearance?: import('./project-appearance/projectAppearance').ProjectAppearance;
  attachments?: import('@/attachments/files').PlanFile[];
  id: string;
  name: string;
  objective: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  planner?: PlannerSnapshot;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  sprintId: string | null;
  sourceNodeId?: string;
  sourcePlanId?: string;
  createdAt: number;
  updatedAt: number;
}
export type TaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueDate' | 'sprintId'>>;

export interface TaskComment {
  id: string;
  projectId: string;
  taskId: string;
  body: string;
  author: 'user' | 'assistant';
  createdAt: number;
  updatedAt: number;
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'active' | 'completed';
  createdAt: number;
  completedAt?: number;
}
export type SprintInput = Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>;
export type BlockType = 'text' | 'heading' | 'bullet' | 'check';
export interface NoteBlock {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  bold?: boolean;
  italic?: boolean;
}
export interface Note {
  id: string;
  title: string;
  blocks: NoteBlock[];
  canvas?: import('./noteCanvasModel').NoteCanvasDocument;
  ink?: import('./noteInkModel').NoteInkDocument;
  projectId: string | null;
  taskId: string | null;
  folderId: string | null;
  pinned: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface Folder { id: string; name: string }
