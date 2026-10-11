import { tool } from 'ai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { useThemeStore } from '@/theme';
import { useLocaleStore } from '@/i18n';
import { createPlannerTools } from './plannerTools';
import { createVisualTools } from './visualTools';
import { createNoteTools } from './noteTools';
import { readRateLimit } from './rateLimit';
import { useSidebarStore } from '@/workspace/sidebarPreference';
import { loadWorkspaceDemo } from '@/workspace/demoData';
import { summarizeNoteCanvas } from '@/workspace/noteCanvasSummary';
import { projectAppearanceSchema } from '@/workspace/project-appearance/projectAppearance';
import { summarizeBoard } from '@/boards/summary';
import type { BoardDocument } from '@/boards/model';
import { captureChatTurnContext, type ChatTurnContext } from '@/chat/turnContext';
import { captureNoteEditBaseline, noteTextSnapshot, type NoteEditBaseline } from './noteEditBaseline';
import { capturePlannerEditBaseline, type PlannerEditBaseline } from './plannerEditBaseline';

const id = z.string().min(1).max(100);
const text = z.string().max(100_000);
const nullableId = id.nullable().optional();
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const block = z.object({ id: id.optional(), type: z.enum(['text', 'heading', 'bullet', 'check']), text, checked: z.boolean().optional(), bold: z.boolean().optional(), italic: z.boolean().optional() }).strict();
const task = z.object({ title: z.string().min(1).max(240), description: text.optional(), status: z.enum(['todo', 'doing', 'review', 'done']).optional(), priority: z.enum(['low', 'medium', 'high']).optional(), dueDate: z.string().optional(), sprintId: nullableId }).strict();
const note = z.object({ title: z.string().max(500).optional(), text: text.optional(), blocks: z.array(block).min(1).max(500).optional(), projectId: nullableId, taskId: nullableId, folderId: nullableId, pinned: z.boolean().optional() }).strict();
export const workspaceActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_project'), name: z.string().min(1).max(240), objective: text.optional(), appearance: projectAppearanceSchema.optional() }).strict(),
  z.object({ action: z.literal('update_project'), id, patch: z.object({ name: z.string().min(1).max(240).optional(), objective: text.optional(), archived: z.boolean().optional(), appearance: projectAppearanceSchema.optional() }).strict() }).strict(),
  z.object({ action: z.literal('navigate'), surface: z.enum(['projects', 'overview', 'kanban', 'scrum', 'notes', 'planner', 'boards']), projectId: nullableId, noteId: id.optional(), taskId: id.optional(), boardId: id.optional() }).strict(),
  z.object({ action: z.literal('open_settings') }).strict(),
  z.object({ action: z.literal('set_appearance'), theme: z.enum(['oled', 'dark', 'light']) }).strict(),
  z.object({ action: z.literal('set_language'), locale: z.enum(['en', 'pt-BR']) }).strict(),
  z.object({ action: z.literal('set_sidebar_collapsed'), collapsed: z.boolean() }).strict(),
  z.object({ action: z.literal('load_demo_data') }).strict(),
  task.extend({ action: z.literal('create_task'), projectId: id }).strict(),
  z.object({ action: z.literal('update_task'), id, patch: task.partial() }).strict(),
  z.object({ action: z.literal('delete_task'), id }).strict(),
  z.object({ action: z.literal('import_plan_tasks'), projectId: id }).strict(),
  z.object({ action: z.literal('create_sprint'), projectId: id, name: z.string().min(1), goal: text, startDate: z.string(), endDate: z.string() }).strict(),
  z.object({ action: z.literal('start_sprint'), id }).strict(),
  z.object({ action: z.literal('complete_sprint'), id }).strict(),
  note.extend({ action: z.literal('create_note') }).strict(),
  z.object({ action: z.literal('update_note'), id, patch: note }).strict(),
  z.object({ action: z.literal('append_note_block'), id, block }).strict(),
  z.object({ action: z.literal('trash_note'), id }).strict(),
  z.object({ action: z.literal('restore_note'), id }).strict(),
  z.object({ action: z.literal('create_folder'), name: z.string().min(1).max(240) }).strict(),
  z.object({ action: z.literal('delete_folder'), id }).strict(),
  z.object({ action: z.literal('add_comment'), taskId: id, body: text.min(1) }).strict(),
  z.object({ action: z.literal('update_comment'), id, body: text.min(1) }).strict(),
  z.object({ action: z.literal('delete_comment'), id }).strict(),
]);

export const workspaceReadSchema = z.object({ collection: z.enum(['projects', 'tasks', 'sprints', 'notes', 'folders', 'comments', 'boards']), id: id.optional(), projectId: id.optional(), query: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();

export function readWorkspace(raw: unknown) {
  const input = workspaceReadSchema.parse(raw), state = useWorkspaceStore.getState();
  const records = Object.values(state[input.collection]) as unknown as Record<string, unknown>[];
  const matching = records.filter((r) => (!input.id || r.id === input.id) && (!input.projectId || (input.collection === 'projects' ? r.id : r.projectId) === input.projectId) && (!input.query || JSON.stringify(input.collection === 'notes' ? { title: r.title, blocks: r.blocks, canvasSummary: summarizeNoteCanvas(r.canvas, true) } : input.collection === 'boards' ? { title: r.title } : r).toLocaleLowerCase().includes(input.query.toLocaleLowerCase())));
  const offset = input.offset ?? 0, limit = input.limit ?? 30;
  const items = matching.slice(offset, offset + limit).map((r) => {
    if (input.collection === 'boards') return { id: r.id, title: r.title, archived: r.archived, createdAt: r.createdAt, updatedAt: r.updatedAt, summary: summarizeBoard(r.document as BoardDocument, !!input.id) };
    const { planner: _planner, attachments: _attachments, canvas: _canvas, ink: _ink, ...rest } = r;
    if (input.collection === 'projects') return { ...rest, attachments: (_attachments as { id: string; name: string; kind: string; truncated: boolean }[] | undefined)?.map(({ id, name, kind, truncated }) => ({ id, name, kind, truncated })) };
    if (input.collection === 'notes') {
      const canvasSummary = summarizeNoteCanvas(_canvas, !!input.id);
      return { ...rest, ...(canvasSummary ? { canvasSummary } : {}), ...(!input.id ? { blocks: undefined, preview: (r.blocks as { text: string }[]).map((b) => b.text).join('\n').slice(0, 300) } : {}) };
    }
    return rest;
  });
  const context = captureChatTurnContext();
  return { items, total: matching.length, offset, nextOffset: offset + items.length < matching.length ? offset + items.length : null, currentProjectId: context.projectId, visibleProjectId: context.visibleProjectId, surface: context.surface };
}

function notePatch(input: z.infer<typeof note>) {
  const { text: body, blocks, ...rest } = input;
  const ids = blocks?.flatMap((b) => b.id ? [b.id] : []) ?? [];
  if (new Set(ids).size !== ids.length) throw new Error('Note blocks must have unique IDs.');
  return { ...rest, ...(body !== undefined ? { blocks: [{ id: nanoid(10), type: 'text' as const, text: body }] } : {}), ...(blocks ? { blocks: blocks.map((b) => ({ ...b, id: b.id ?? nanoid(10) })) } : {}) };
}

export async function executeWorkspaceAction(raw: unknown, signal?: AbortSignal): Promise<unknown> {
  const input = workspaceActionSchema.parse(raw);
  signal?.throwIfAborted();
  const state = useWorkspaceStore.getState();
  let result: unknown = { changed: true };
  switch (input.action) {
    case 'create_project': result = { id: state.createProject(input.name, input.objective, input.appearance) }; break;
    case 'update_project': state.updateProject(input.id, input.patch); break;
    case 'navigate': result = requestWorkspaceUI(input); break;
    case 'open_settings': requestWorkspaceUI({ settings: true }); break;
    case 'set_appearance': useThemeStore.getState().setTheme(input.theme); break;
    case 'set_language': useLocaleStore.getState().setLocale(input.locale); break;
    case 'set_sidebar_collapsed': useSidebarStore.getState().setCollapsed(input.collapsed); break;
    case 'load_demo_data': result = await loadWorkspaceDemo(); break;
    case 'create_task': { const { action: _action, projectId, ...values } = input; result = { id: state.createTask(projectId, values) }; break; }
    case 'update_task': state.updateTask(input.id, input.patch); break;
    case 'delete_task': if (!state.tasks[input.id]) throw new Error('taskMissing'); state.deleteTask(input.id); break;
    case 'import_plan_tasks': result = { added: state.importPlanTasks(input.projectId) }; break;
    case 'create_sprint': { const { action: _action, projectId, ...values } = input; result = { id: state.createSprint(projectId, values) }; break; }
    case 'start_sprint': state.startSprint(input.id); break;
    case 'complete_sprint': state.completeSprint(input.id); break;
    case 'create_note': {
      const { action: _action, ...values } = input;
      const patch = notePatch(values);
      const noteId = state.createNote(defined({ title: input.title, projectId: input.projectId, taskId: input.taskId, folderId: input.folderId }));
      state.updateNote(noteId, patch); result = { id: noteId }; break;
    }
    case 'update_note': state.updateNote(input.id, notePatch(input.patch)); break;
    case 'append_note_block': {
      const existing = state.notes[input.id]; if (!existing) throw new Error('noteMissing');
      state.updateNote(input.id, notePatch({ blocks: [...existing.blocks, input.block] })); break;
    }
    case 'trash_note': if (!state.notes[input.id]) throw new Error('noteMissing'); state.trashNote(input.id); break;
    case 'restore_note': if (!state.notes[input.id]) throw new Error('noteMissing'); state.restoreNote(input.id); break;
    case 'create_folder': result = { id: state.createFolder(input.name) }; break;
    case 'delete_folder': if (!state.folders[input.id]) throw new Error('folderMissing'); state.deleteFolder(input.id); break;
    case 'add_comment': result = { id: state.addComment(input.taskId, input.body, 'assistant') }; break;
    case 'update_comment': state.updateComment(input.id, input.body); break;
    case 'delete_comment': if (!state.comments[input.id]) throw new Error('commentMissing'); state.deleteComment(input.id); break;
  }
  try { await flushWorkspacePersistence(); } catch {
    return { applied: true, saved: false, result, error: 'Changes are visible but local saving failed. Do not repeat the mutation; ask the user to preserve this session.' };
  }
  return result;
}

export interface AssistantActionEvent { id: string; name: string; action: string; status: 'running' | 'done' | 'error' | 'awaiting_approval'; detail?: string; result?: unknown }
export function createAssistantTools(signal: AbortSignal, onAction: (event: AssistantActionEvent) => void, userText: string, control?: { beforeRequest: () => Promise<void>; onRateLimit: (error: unknown) => void; assertActive?: () => void; contextProjectId?: string | null; turnContext?: ChatTurnContext; noteEditBaseline?: NoteEditBaseline | null; plannerEditBaseline?: PlannerEditBaseline | null }) {
  const turnContext = control?.turnContext ?? captureChatTurnContext();
  const contextProjectId = control?.contextProjectId !== undefined ? control.contextProjectId : turnContext.projectId;
  const focusedNoteId = turnContext.surface === 'notes' ? turnContext.noteId : null;
  let noteEditBaseline = control?.noteEditBaseline !== undefined ? control.noteEditBaseline : captureNoteEditBaseline(turnContext);
  const plannerEditBaseline = control?.plannerEditBaseline !== undefined ? control.plannerEditBaseline : capturePlannerEditBaseline(turnContext, contextProjectId);
  const executeContextAction = async (raw: unknown) => {
    const input = workspaceActionSchema.parse(raw);
    const focusedWrite = focusedNoteId && (input.action === 'update_note' || input.action === 'append_note_block') && input.id === focusedNoteId;
    let advanceNoteBaseline = false;
    if (focusedWrite) {
      const current = useWorkspaceStore.getState().notes[focusedNoteId];
      if (!current || current.deletedAt !== null || !noteEditBaseline || noteEditBaseline.noteId !== focusedNoteId || current.createdAt !== noteEditBaseline.createdAt ||
        input.action === 'update_note' && noteTextSnapshot(current) !== noteEditBaseline.textSnapshot) {
        throw new Error(useLocaleStore.getState().locale === 'en'
          ? 'The note changed or is no longer available. Your edits were kept. Send the request again using its current text.'
          : 'A nota mudou ou não está mais disponível. Suas edições foram preservadas. Envie o pedido novamente usando o texto atual.');
      }
      advanceNoteBaseline = noteTextSnapshot(current) === noteEditBaseline.textSnapshot;
    }
    // These note mutations happen synchronously before executeWorkspaceAction awaits saving.
    // Capture that own write now; a local edit during persistence must remain a conflict.
    const action = executeWorkspaceAction(input, signal);
    const appliedBaseline = focusedWrite ? captureNoteEditBaseline(turnContext) : null;
    const result = await action;
    // A safe append must not absorb an external edit and unlock a stale replacement later.
    if (focusedWrite && advanceNoteBaseline) noteEditBaseline = appliedBaseline;
    return result;
  };
  let pending: Promise<unknown> = Promise.resolve();
  let halted: unknown;
  const execute = (name: string, fn: (input: unknown) => unknown | Promise<unknown>) => (input: unknown) => {
    const next = pending.then(async () => {
    if (halted) throw halted;
    signal.throwIfAborted();
    control?.assertActive?.();
    const event: AssistantActionEvent = { id: nanoid(10), name, action: (input as { action?: string }).action ?? name, status: 'running' };
    onAction(event);
    try {
      let result = await fn(input);
      try { await flushWorkspacePersistence(); } catch {
        result = { applied: true, saved: false, result, error: 'Local saving failed. Do not repeat mutations; preserve this session and retry saving.' };
      }
      const saveFailed = !!result && typeof result === 'object' && 'saved' in result && result.saved === false;
      const unchanged = !!result && typeof result === 'object' && 'changed' in result && result.changed === false;
      const requiresApproval = !!result && typeof result === 'object' && 'requiresApproval' in result && result.requiresApproval === true;
      onAction({ ...event, status: saveFailed || unchanged ? 'error' : requiresApproval ? 'awaiting_approval' : 'done', ...(name !== 'workspace_read' && event.action !== 'read_plan' ? { result } : {}), ...(saveFailed ? { detail: 'Not saved' } : unchanged ? { detail: 'No change applied' } : {}) });
      return { ok: !saveFailed && !unchanged, result };
    } catch (error) {
      if (readRateLimit(error)) { halted = error; control?.onRateLimit(error); }
      const detail = error instanceof Error ? error.message : 'Action failed';
      onAction({ ...event, status: 'error', detail });
      if (signal.aborted) throw error;
      return { ok: false, error: detail };
    }
    });
    pending = next.catch(() => {});
    return next;
  };
  return {
    workspace_read: tool({ description: 'Read actual project/task/issue/sprint/note/folder/comment/board records. Paginated; use IDs from results, never guess them. Projects exclude planner snapshots. A note id returns its full blocks and a bounded text summary of visual items; image pixels, drawing points and diagram internals are not included or analyzed. Boards are independent of projects; query matches their titles and an id returns a bounded textual summary with omittedItems, never full geometry, pixels or ink. currentProjectId is the frozen explicit chat context; visibleProjectId is the project on its origin screen.', inputSchema: workspaceReadSchema, execute: execute('workspace_read', input => {
      const result = readWorkspace(input);
      return { ...result, visibleProjectId: turnContext.visibleProjectId, currentProjectId: contextProjectId, surface: turnContext.surface, noteId: turnContext.noteId, boardId: turnContext.boardId };
    }) }),
    workspace_action: tool({ description: 'Perform an application action through its validated store. create_note/update_note text replaces the body; append_note_block appends. Updating the focused note from Notes rejects changed text or identity since submission; report the conflict and preserve the human edits. Append preserves current blocks. Comments are attached to tasks/issues. Navigation can open a noteId, taskId, or boardId with surface=boards; boards cannot be combined with projectId/noteId/taskId. Board objects cannot be edited by these tools. Do only actions requested by the user.', inputSchema: workspaceActionSchema, execute: execute('workspace_action', executeContextAction) }),
    ...createPlannerTools(signal, execute, userText, control?.beforeRequest, plannerEditBaseline),
    ...createVisualTools(signal, execute, control?.beforeRequest, userText),
    ...createNoteTools(signal, execute, control?.beforeRequest, turnContext),
  };
}
