import type { ModelMessage } from 'ai';
import { validatePersistedNoteCanvases } from '@/workspace/noteCanvasPersistence';
import { validatePersistedBoards, type BoardRecord } from '@/boards/model';
import type { ManagedProject, Task, Sprint, Note, Folder, PlannerSnapshot, NoteBlock, TaskComment } from '@/workspace/types';

export type WorkspaceComment = TaskComment;

/** Persisted domain data only; actions, credentials and transient UI state stay out. */
export interface WorkspaceData {
  boards?: Record<string, BoardRecord>;
  projects: Record<string, ManagedProject>;
  tasks: Record<string, Task>;
  sprints: Record<string, Sprint>;
  notes: Record<string, Note>;
  folders: Record<string, Folder>;
  comments?: Record<string, WorkspaceComment>;
  legacyImported: boolean;
}

export interface WorkspaceBackup {
  format: 'cellproject-workspace-backup';
  version: 1;
  exportedAt: string;
  data: WorkspaceData;
}

interface OwnedRow { owner_id: string; id: string }
interface TimestampedRow extends OwnedRow { created_at: string; updated_at: string }

export interface WorkspaceDatabaseRows {
  boards: (TimestampedRow & { title: string; archived: boolean; document: BoardRecord['document'] })[];
  workspace_settings: { owner_id: string; legacy_imported: boolean }[];
  projects: (TimestampedRow & {
    name: string; objective: string; archived: boolean; planner_snapshot: PlannerSnapshot | null;
    appearance: NonNullable<ManagedProject['appearance']> | null;
  })[];
  sprints: (OwnedRow & {
    project_id: string; name: string; goal: string; start_date: string; end_date: string;
    status: Sprint['status']; created_at: string; completed_at: string | null;
  })[];
  tasks: (TimestampedRow & {
    project_id: string; title: string; description: string; status: Task['status']; priority: Task['priority'];
    due_date: string | null; sprint_id: string | null; source_node_id: string | null; source_plan_id: string | null;
  })[];
  folders: (OwnedRow & { name: string })[];
  notes: (TimestampedRow & {
    title: string; blocks: NoteBlock[]; project_id: string | null; task_id: string | null;
    folder_id: string | null; pinned: boolean; deleted_at: string | null; canvas: NonNullable<Note['canvas']> | null;
    ink: NonNullable<Note['ink']> | null;
  })[];
  task_comments: (TimestampedRow & {
    project_id: string; task_id: string; body: string; author: WorkspaceComment['author'];
  })[];
}

export interface WorkspaceRowSnapshot {
  format: 'cellproject-workspace-rows';
  version: 1;
  exportedAt: string;
  ownerId: string;
  rows: WorkspaceDatabaseRows;
}

export interface ChatActionData {
  id: string;
  name: string;
  action: string;
  status: 'running' | 'done' | 'error' | 'awaiting_approval';
  detail?: string;
  result?: unknown;
}

export interface ChatSessionData {
  sessionId: string;
  messages: {
    id: string; role: 'user' | 'assistant'; text: string; createdAt: number;
    actions?: ChatActionData[]; interrupted?: boolean;
  }[];
  modelHistory: ModelMessage[];
}

export interface ChatData extends ChatSessionData {
  archivedSessions?: ChatSessionData[];
}

export interface ChatRowSnapshot {
  format: 'cellproject-chat-rows';
  version: 1;
  ownerId: string;
  rows: {
    chat_sessions: (OwnedRow & { model_history: ModelMessage[] })[];
    chat_messages: (OwnedRow & {
      session_id: string; position: number; role: 'user' | 'assistant'; content: string;
      actions: ChatActionData[]; interrupted: boolean; created_at: string;
    })[];
  };
}

function checkOwnerId(ownerId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error('Invalid owner ID');
  }
}

function isoTimestamp(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error('Invalid timestamp');
  }
  return new Date(value).toISOString();
}

function copyData(workspace: WorkspaceData): WorkspaceData {
  // An explicit allowlist prevents spreading a live store's methods or API settings.
  return structuredClone({
    projects: workspace.projects, tasks: workspace.tasks, sprints: workspace.sprints,
    notes: workspace.notes, folders: workspace.folders, comments: workspace.comments ?? {},
    ...(workspace.boards === undefined ? {} : { boards: workspace.boards }),
    legacyImported: workspace.legacyImported,
  });
}

/** Pure: the caller supplies the export timestamp; no database or browser storage is read. */
export function createWorkspaceBackup(workspace: WorkspaceData, exportedAt: number): WorkspaceBackup {
  return {
    format: 'cellproject-workspace-backup', version: 1,
    exportedAt: isoTimestamp(exportedAt), data: copyData(workspace),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the envelope and new notebook content; other domain validation remains the caller's responsibility. */
export function restoreWorkspaceBackup(backup: unknown): WorkspaceData {
  if (!isRecord(backup) || backup.format !== 'cellproject-workspace-backup' || backup.version !== 1) {
    throw new Error('Unsupported workspace backup');
  }
  const data = backup.data;
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt)) ||
    !isRecord(data) || !['projects', 'tasks', 'sprints', 'notes', 'folders'].every((key) => isRecord(data[key])) ||
    (data.comments !== undefined && !isRecord(data.comments)) || typeof data.legacyImported !== 'boolean') {
    throw new Error('Invalid workspace backup');
  }
  validatePersistedNoteCanvases(data.notes);
  validatePersistedBoards(data.boards, data.notes);
  return copyData(data as unknown as WorkspaceData);
}

/**
 * Produces rows for docs/database/workspace-schema.sql without sending them anywhere.
 * IDs remain text; the owner is a future authenticated Supabase user's UUID.
 */
export function workspaceToDatabaseRows(workspace: WorkspaceData, ownerId: string, exportedAt: number): WorkspaceRowSnapshot {
  checkOwnerId(ownerId);
  const data = copyData(workspace);
  const owned = (id: string): OwnedRow => ({ owner_id: ownerId, id });
  const timestamps = (entity: { createdAt: number; updatedAt: number }) => ({
    created_at: isoTimestamp(entity.createdAt), updated_at: isoTimestamp(entity.updatedAt),
  });
  return {
    format: 'cellproject-workspace-rows', version: 1, exportedAt: isoTimestamp(exportedAt), ownerId,
    rows: {
      boards: Object.values(data.boards ?? {}).map(board => ({
        ...owned(board.id), ...timestamps(board), title: board.title, archived: board.archived, document: board.document,
      })),
      workspace_settings: [{ owner_id: ownerId, legacy_imported: data.legacyImported }],
      projects: Object.values(data.projects).map((project) => ({
        ...owned(project.id), ...timestamps(project), name: project.name, objective: project.objective,
        archived: project.archived, planner_snapshot: project.planner ?? null, appearance: project.appearance ?? null,
      })),
      sprints: Object.values(data.sprints).map((sprint) => ({
        ...owned(sprint.id), project_id: sprint.projectId, name: sprint.name, goal: sprint.goal,
        start_date: sprint.startDate, end_date: sprint.endDate, status: sprint.status,
        created_at: isoTimestamp(sprint.createdAt),
        completed_at: sprint.completedAt === undefined ? null : isoTimestamp(sprint.completedAt),
      })),
      tasks: Object.values(data.tasks).map((task) => ({
        ...owned(task.id), ...timestamps(task), project_id: task.projectId, title: task.title,
        description: task.description, status: task.status, priority: task.priority,
        due_date: task.dueDate || null, sprint_id: task.sprintId,
        source_node_id: task.sourceNodeId ?? null, source_plan_id: task.sourcePlanId ?? null,
      })),
      folders: Object.values(data.folders).map((folder) => ({ ...owned(folder.id), name: folder.name })),
      notes: Object.values(data.notes).map((note) => ({
        ...owned(note.id), ...timestamps(note), title: note.title, blocks: note.blocks,
        canvas: note.canvas ?? null,
        ink: note.ink ?? null,
        project_id: note.projectId, task_id: note.taskId, folder_id: note.folderId, pinned: note.pinned,
        deleted_at: note.deletedAt === null ? null : isoTimestamp(note.deletedAt),
      })),
      task_comments: Object.values(data.comments ?? {}).map((comment) => ({
        ...owned(comment.id), ...timestamps(comment), project_id: comment.projectId,
        task_id: comment.taskId, body: comment.body, author: comment.author,
      })),
    },
  };
}

const privateHistoryKeys = new Set([
  'apikey', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'token', 'tokens',
  'authorization', 'password', 'secret', 'secrets', 'clientsecret', 'credentials',
  'headers', 'provideroptions', 'servicerole', 'servicerolekey',
]);

function safeHistoryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeHistoryValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateHistoryKeys.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()))
    .map(([key, item]) => [key, safeHistoryValue(item)]));
}

/** Chat is exported separately; provider options and credential fields are never row columns. */
export function chatToDatabaseRows(chat: ChatData, ownerId: string): ChatRowSnapshot {
  checkOwnerId(ownerId);
  const sessions = [...(chat.archivedSessions ?? []), chat];
  return {
    format: 'cellproject-chat-rows', version: 1, ownerId,
    rows: {
      chat_sessions: sessions.map((session) => ({
        owner_id: ownerId, id: session.sessionId,
        // Retain conversational content/tool results; discard provider configuration.
        model_history: structuredClone(session.modelHistory.map(({ role, content }) => ({
          role, content: safeHistoryValue(content),
        }))) as ModelMessage[],
      })),
      chat_messages: sessions.flatMap((session) => session.messages.map((message, position) => ({
        owner_id: ownerId, id: message.id, session_id: session.sessionId, position,
        role: message.role, content: message.text, created_at: isoTimestamp(message.createdAt),
        interrupted: message.interrupted ?? false,
        actions: (message.actions ?? []).map(({ id, name, action, status, detail, result }) => ({
          id, name, action, status, ...(detail === undefined ? {} : { detail }), ...(result === undefined ? {} : { result: structuredClone(safeHistoryValue(result)) }),
        })),
      }))),
    },
  };
}
