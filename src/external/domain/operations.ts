import { z } from 'zod';
import { nanoid } from 'nanoid';
import { useGraphStore, buildStagedNodes, canRevealAICriterionNow, flushGraphPersistence, parseImportedProject } from '@/store';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { capturePlanner, initializeWorkspace, openPlanner, getPlannerOwnerId, readPlanner } from '@/workspace/planner';
import { useLocaleStore } from '@/i18n';
import { projectAppearanceSchema } from '@/workspace/project-appearance/projectAppearance';
import { noteCanvasSchema } from '@/workspace/noteCanvasModel';
import { noteInkSchema } from '@/workspace/noteInkModel';
import { boardDocumentSchema, boardItemSchema, boardEdgeSchema } from '@/boards/model';
import { removeBoardItems, pasteBoardItems } from '@/boards/operations';
import { canvasInkSchema } from '@/ink/canvasModel';
import { canvasAttachmentsSchema } from '@/attachments/canvasModel';
import { planFileSchema } from '@/attachments/files';
import { addProjectFiles, removeProjectFile, projectFiles } from '@/attachments/projectFiles';
import { applyPlanStructure, planStructureSchema, planRevision } from '@/ai/planStructure';
import { diagramSchema, parseDiagram } from '@/visuals/diagram/model';
import { artifactSchema, normalizeVisualWorkspace, sceneSchema, decompositionSchema } from '@/visuals/normalize';
import { modelAssemblySchema } from '@/visuals/modelAssembly';
import { decompositionResearchSchema } from '@/visuals/decompositionSchema';
import { decompositionHash, researchFingerprint } from '@/visuals/decompositionState';
import { applyVisualModelRevision, applyDecompositionResearch, applyStoredDecompositionAssembly, portableDecompositionTxt } from '@/visuals/portableMutations';
import { collectVisualMediaIds } from '@/visuals/references';
import { createMediaScopeResolver } from '@/external/mediaOwnership.js';
import { parseRules, mergeRules, sameRules } from '@/planningRules';
import { getVisualWorkspace, mutateVisualWorkspace, removeVisualArtifact, revertVisualArtifact, setDiagramParameter, setVisualArtifactLink, updateVisualArtifact, setVisualMode, saveVisualDraft, applyVisualProposal, rejectVisualProposal, removeVisualProposalHistory, resolveVisualContext, storeVisualProposal, currentVisualScope } from '@/visuals/domain';
import type { CloudSnapshot } from '@/cloud/runtime';
import type { AISuggestedNode, AIPlan, Project } from '@/types';
import type { NoteBlock } from '@/workspace/types';
import type { VisualPromptInput } from '@/visuals/types';
import { seedMemory, writePreference, readPreference } from './memoryStorage';
import { contentOperationDefinitions, CONTENT_DOCUMENT_KEYS } from './contentOperations';
import { id, text, short, noInput, pageInput, nodeTarget, recordTarget, point, source, hint, suggested, suggestedEdge, planInput, nodePatch, taskInput, noteText, importedPlan } from './schemas';

type Scope = 'account' | 'project' | 'projects-list';
// Inputs cross their strict per-command schema before entering any store handler.
type Input = Record<string, any>;
interface Definition { name: string; kind: 'query' | 'action'; description: string; schema: z.ZodType; permission: 'read' | 'write'; projectRequired: boolean; scope: Scope; planner: boolean; execute(input: Input, projectId: string | null): unknown }
const definitions: Definition[] = contentOperationDefinitions.map(value => ({ ...value, planner: false }));
function define(name: string, kind: Definition['kind'], schema: z.ZodType, description: string, execute: Definition['execute'], scope: Scope = 'project', planner = false) {
  definitions.push({ name, kind, schema, description, execute, scope, planner, projectRequired: scope === 'project', permission: kind === 'query' ? 'read' : 'write' });
}
const action = (name: string, schema: z.ZodType, description: string, execute: Definition['execute'], scope: Scope = 'project', planner = false) => define(name, 'action', schema, description, execute, scope, planner);
const query = (name: string, schema: z.ZodType, description: string, execute: Definition['execute'], scope: Scope = 'project') => define(name, 'query', schema, description, execute, scope);
const ws = () => useWorkspaceStore.getState();
const graph = () => useGraphStore.getState();
let snapshotMedia: CloudSnapshot['media'] = [];
let mediaInScope: ReturnType<typeof createMediaScopeResolver>;
function scopedMedia(mediaId: string, projectId: string | null) {
  const value = snapshotMedia.find(value => value.id === mediaId);
  if (!value) throw new Error('mediaMissing');
  if (!mediaInScope(value, projectId)) throw new Error('project_scope');
  return value;
}
const node = (nodeId: string) => { const value = graph().project?.nodes[nodeId]; if (!value) throw new Error('nodeMissing'); return value; };
function scopedRecord<T extends { projectId: string | null }>(records: Record<string, T>, recordId: string, projectId: string | null): T {
  const record = Object.hasOwn(records, recordId) ? records[recordId] : undefined;
  if (!record) throw new Error('recordMissing');
  if (record.projectId !== projectId) throw new Error('project_scope');
  return record;
}
function managed(projectId: string | null) {
  if (!projectId || !Object.hasOwn(ws().projects, projectId)) throw new Error('projectMissing');
  return ws().projects[projectId];
}
function board(boardId: string, editable = true) {
  const value = Object.hasOwn(ws().boards, boardId) ? ws().boards[boardId] : undefined;
  if (!value) throw new Error('boardMissing');
  if (editable && value.archived) throw new Error('boardArchived');
  return value;
}
function page<T>(items: T[], input: Input) {
  const offset = input.offset ?? 0, limit = input.limit ?? 50, values = items.slice(offset, offset + limit);
  return { items: values, total: items.length, offset, nextOffset: offset + values.length < items.length ? offset + values.length : null };
}
function projectMetadata(project: ReturnType<typeof managed>) {
  const { planner: _planner, attachments, ...rest } = project;
  return { ...rest, attachments: attachments?.map(({ text: _text, ...metadata }) => metadata) ?? [] };
}
function publicProject(project: Project | null): Project | null {
  if (!project) return null;
  return { ...project, nodes: Object.fromEntries(Object.entries(project.nodes).map(([key, value]) => {
    if (canRevealAICriterionNow(value)) return [key, value];
    return [key, { ...value, comoConfirmar: '', explicacao: undefined, ...(value.critica ? { critica: { ...value.critica, criterioAlternativo: '' } } : {}) }];
  })) };
}
query('projects', pageInput, 'List project metadata. Transport filters items to the credential project grants.', input => page(Object.values(ws().projects).map(projectMetadata), input), 'projects-list');
query('project', noInput, 'Read the selected managed project metadata.', (_input, projectId) => projectMetadata(managed(projectId)));
query('plan', noInput, 'Read complete plan content and staged work. Independent AI criteria retain the UI visibility gate.', (_input, projectId) => {
  const snapshot = readPlanner(projectId!), project = publicProject(snapshot.project);
  const batch = (value: typeof snapshot.pendingSuggestions) => value && { ...value, nodes: value.nodes.map(item => ({ ...item, data: { ...item.data, comoConfirmar: '' } })) };
  const parked = (values: typeof snapshot.parkedSuggestions) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, batch(value)]));
  return { ...snapshot, project, archivedProject: publicProject(snapshot.archivedProject), pendingSuggestions: batch(snapshot.pendingSuggestions), parkedSuggestions: parked(snapshot.parkedSuggestions), archivedPending: batch(snapshot.archivedPending), archivedSession: snapshot.archivedSession && { ...snapshot.archivedSession, parkedSuggestions: parked(snapshot.archivedSession.parkedSuggestions) }, revision: snapshot.project ? planRevision(snapshot.project) : null };
});
query('plan.export', noInput, 'Export the full raw plan JSON backup, including independent criteria, exactly as the explicit UI export. Requires the same project read authority.', (_input, projectId) => { const project = readPlanner(projectId!).project; if (!project) throw new Error('planMissing'); return { project, mediaIds: collectVisualMediaIds(project) }; });
query('tasks', pageInput, 'Read project tasks.', (input, projectId) => page(Object.values(ws().tasks).filter(record => record.projectId === projectId), input));
query('sprints', pageInput, 'Read project sprints.', (input, projectId) => page(Object.values(ws().sprints).filter(record => record.projectId === projectId), input));
query('comments', pageInput, 'Read project task comments.', (input, projectId) => page(Object.values(ws().comments).filter(record => record.projectId === projectId), input));
query('notes', pageInput, 'Read project notes, blocks, ink and notebook documents.', (input, projectId) => page(Object.values(ws().notes).filter(record => record.projectId === projectId), input));
query('personal_notes', pageInput, 'Read personal notes. Requires account-wide access.', input => page(Object.values(ws().notes).filter(record => record.projectId === null), input), 'account');
query('folders', pageInput, 'Read the personal folder library.', input => page(Object.values(ws().folders), input), 'account');
query('boards', pageInput, 'Read independent boards and their complete documents.', input => page(Object.values(ws().boards), input), 'account');
query('attachments', pageInput, 'Read extracted project source attachments; original binaries are not stored in this collection.', (input, projectId) => page(projectFiles(projectId), input));
query('visuals', noInput, 'Read validated visual documents, drafts and original media references without executing generators.', (_input, projectId) => getVisualWorkspace(readPlanner(projectId!).project));

action('project.create', z.object({ name: short, objective: text.optional(), appearance: projectAppearanceSchema.optional() }).strict(), 'Create a managed project.', input => ({ id: ws().createProject(input.name, input.objective, input.appearance) }), 'account');
action('project.update', z.object({ patch: z.object({ name: short.optional(), objective: text.optional(), archived: z.boolean().optional(), appearance: projectAppearanceSchema.optional() }).strict() }).strict(), 'Rename, edit objective, archive/restore or change project appearance.', (input, projectId) => ws().updateProject(projectId!, input.patch));
action('task.create', taskInput, 'Create a project task using the UI task validation.', (input, projectId) => ({ id: ws().createTask(projectId!, input as { title: string }) }));
action('task.update', z.object({ id, patch: taskInput.partial() }).strict(), 'Update a task; completed sprint reopening returns unfinished work to backlog.', (input, projectId) => { scopedRecord(ws().tasks, input.id, projectId); ws().updateTask(input.id, input.patch); });
action('task.delete', recordTarget, 'Delete a task, its comments and detach its notes.', (input, projectId) => { scopedRecord(ws().tasks, input.id, projectId); ws().deleteTask(input.id); });
action('task.import_plan', noInput, 'Import actionable leaf steps once per source plan/node from the authoritative planner.', (_input, projectId) => { const planner = readPlanner(projectId!); if (JSON.stringify(managed(projectId).planner) !== JSON.stringify(planner)) ws().savePlanner(projectId!, planner); return { added: ws().importPlanTasks(projectId!) }; });
action('comment.create', z.object({ taskId: id, body: text.min(1) }).strict(), 'Add an external-assistant comment to a task.', (input, projectId) => { scopedRecord(ws().tasks, input.taskId, projectId); return { id: ws().addComment(input.taskId, input.body, 'assistant') }; });
action('comment.update', z.object({ id, body: text.min(1) }).strict(), 'Edit a task comment.', (input, projectId) => { scopedRecord(ws().comments, input.id, projectId); ws().updateComment(input.id, input.body); });
action('comment.delete', recordTarget, 'Delete a task comment.', (input, projectId) => { scopedRecord(ws().comments, input.id, projectId); ws().deleteComment(input.id); });
action('sprint.create', z.object({ name: short, goal: text, startDate: z.string().max(10), endDate: z.string().max(10) }).strict(), 'Create a planned sprint with valid ordered calendar dates.', (input, projectId) => ({ id: ws().createSprint(projectId!, input as { name: string; goal: string; startDate: string; endDate: string }) }));
for (const [name, description, execute] of [
  ['sprint.start', 'Start the project sprint; only one active sprint is allowed.', (recordId: string) => ws().startSprint(recordId)],
  ['sprint.complete', 'Complete a sprint; unfinished tasks return to backlog.', (recordId: string) => ws().completeSprint(recordId)],
] as const) action(name, recordTarget, description, (input, projectId) => { scopedRecord(ws().sprints, input.id, projectId); execute(input.id); });

function notePatch(input: Input) {
  const { text: content, blocks, ...rest } = input;
  if (content !== undefined && blocks !== undefined) throw new Error('invalid_input');
  const next = blocks?.map((block: NoteBlock) => ({ ...block, id: block.id ?? nanoid(10) }));
  if (next && new Set(next.map((block: NoteBlock) => block.id)).size !== next.length) throw new Error('invalid_input');
  return { ...rest, ...(content !== undefined ? { blocks: [{ id: nanoid(10), type: 'text', text: content }] } : {}), ...(next ? { blocks: next } : {}) };
}
const notePatchSchema = noteText.extend({ canvas: noteCanvasSchema.optional(), ink: noteInkSchema.optional() }).strict();
for (const personal of [false, true]) {
  const prefix = personal ? 'personal_note' : 'note', scope = personal ? 'account' : 'project';
  const resolveProject = (projectId: string | null) => personal ? null : projectId;
  action(`${prefix}.create`, noteText, 'Create a note with validated block IDs and ownership.', (input, projectId) => {
    const patch = notePatch(input), noteId = ws().createNote({ projectId: resolveProject(projectId), ...Object.fromEntries(Object.entries({ title: input.title, taskId: input.taskId, folderId: input.folderId }).filter(([, value]) => value !== undefined)) });
    ws().updateNote(noteId, patch); return { id: noteId };
  }, scope);
  action(`${prefix}.update`, z.object({ id, patch: notePatchSchema }).strict(), 'Edit note blocks, pin/folder/task, notebook or anchored ink using the UI schemas and image budgets.', (input, projectId) => { scopedRecord(ws().notes, input.id, resolveProject(projectId)); ws().updateNote(input.id, notePatch(input.patch)); }, scope);
  action(`${prefix}.append_block`, z.object({ id, block: noteText.shape.blocks.unwrap().element }).strict(), 'Append a note block while preserving existing content.', (input, projectId) => {
    const existing = scopedRecord(ws().notes, input.id, resolveProject(projectId));
    ws().updateNote(input.id, notePatch({ blocks: [...existing.blocks, input.block] }));
  }, scope);
  action(`${prefix}.trash`, recordTarget, 'Move a note to trash.', (input, projectId) => { scopedRecord(ws().notes, input.id, resolveProject(projectId)); ws().trashNote(input.id); }, scope);
  action(`${prefix}.restore`, recordTarget, 'Restore a trashed note.', (input, projectId) => { scopedRecord(ws().notes, input.id, resolveProject(projectId)); ws().restoreNote(input.id); }, scope);
}
action('note.move', z.object({ id, projectId: id.nullable(), taskId: id.nullable().optional() }).strict(), 'Move a note between personal/project ownership. Requires account-wide access.', input => { if (!Object.hasOwn(ws().notes, input.id)) throw new Error('noteMissing'); ws().updateNote(input.id, { projectId: input.projectId, taskId: input.taskId ?? null }); }, 'account');
action('folder.create', z.object({ name: short }).strict(), 'Create a note folder.', input => ({ id: ws().createFolder(input.name) }), 'account');
action('folder.delete', recordTarget, 'Delete a folder while preserving its notes as unfiled.', input => { if (!Object.hasOwn(ws().folders, input.id)) throw new Error('folderMissing'); ws().deleteFolder(input.id); }, 'account');

action('board.create', z.object({ title: short.optional() }).strict(), 'Create an independent board.', input => ({ id: ws().createBoard(input.title) }), 'account');
action('board.update', z.object({ id, patch: z.object({ title: short.optional(), archived: z.boolean().optional(), attachments: canvasAttachmentsSchema.optional() }).strict() }).strict(), 'Rename/archive/restore a board or edit its attachment library.', input => { board(input.id, false); ws().updateBoard(input.id, input.patch); }, 'account');
action('board.document.set', z.object({ id, document: boardDocumentSchema }).strict(), 'Replace a board document with validated items, links, ink and viewport; identity and timestamps remain owned by the store.', input => { board(input.id); ws().updateBoard(input.id, { document: input.document }); }, 'account');
action('board.item.put', z.object({ id, item: boardItemSchema }).strict(), 'Insert or update one validated board item preserving other items.', input => { const value = board(input.id); const found = value.document.items.some(item => item.id === input.item.id); ws().updateBoard(input.id, { document: { ...value.document, items: found ? value.document.items.map(item => item.id === input.item.id ? input.item : item) : [...value.document.items, input.item] } }); }, 'account');
action('board.item.delete', z.object({ id, itemIds: z.array(id).min(1).max(200) }).strict(), 'Delete board items and their incident links.', input => { const value = board(input.id); ws().updateBoard(input.id, { document: removeBoardItems(value.document, input.itemIds) }); }, 'account');
action('board.items.paste', z.object({ id, items: z.array(boardItemSchema).min(1).max(200), edges: z.array(boardEdgeSchema).max(500), point: point.optional() }).strict(), 'Duplicate/paste board items with fresh IDs and relink internal edges.', input => { const value = board(input.id); const snapshot = boardDocumentSchema.parse({ ...value.document, items: input.items, edges: input.edges }); ws().updateBoard(input.id, { document: pasteBoardItems(value.document, snapshot, input.point) }); }, 'account');
action('board.edge.put', z.object({ id, edge: boardEdgeSchema }).strict(), 'Connect board items using a validated edge.', input => { const value = board(input.id); ws().updateBoard(input.id, { document: { ...value.document, edges: [...value.document.edges.filter(edge => edge.id !== input.edge.id), input.edge] } }); }, 'account');
action('board.edge.delete', z.object({ id, edgeId: id }).strict(), 'Remove a board connection.', input => { const value = board(input.id); ws().updateBoard(input.id, { document: { ...value.document, edges: value.document.edges.filter(edge => edge.id !== input.edgeId) } }); }, 'account');
action('board.viewport.set', z.object({ id, viewport: boardDocumentSchema.shape.viewport }).strict(), 'Persist board pan and zoom.', input => { board(input.id); ws().openBoard(input.id); ws().updateBoardViewport(input.id, input.viewport); }, 'account');

const plannerAction = (name: string, schema: z.ZodType, description: string, execute: Definition['execute']) => action(name, schema, description, execute, 'project', true);
plannerAction('plan.create', z.object({ plan: planInput, name: short.optional(), objective: text.optional(), rules: z.array(short).max(100).optional() }).strict(), 'Materialize a complete externally supplied plan using the actual UI store. Existing plans require plan.new first.', (input, projectId) => {
  if (graph().project) throw new Error('plan_exists');
  const value = input.plan as AIPlan;
  for (const category of value.tree.categorias) for (const child of category.children) child.decisionOptions = child.decisionOptions?.map(option => ({ ...option, id: option.id ?? nanoid(10) }));
  graph().createProjectFromPlan(input.objective ?? (graph().objectiveDraft.objective || managed(projectId).objective), input.name ?? managed(projectId).name, value, input.rules ?? graph().objectiveDraft.rules);
  return { planId: graph().project!.id, rootId: graph().project!.rootId };
});
plannerAction('plan.import', z.object({ json: z.string().min(1).max(16 * 1024 * 1024) }).strict(), 'Import a strict bounded UI plan backup, preserving archive/restore and demoting unsupported done claims through the actual import parser.', (input, projectId) => {
  let raw: unknown; try { raw = JSON.parse(input.json); } catch { throw new Error('invalid_input'); }
  // Validate authored attributes before the UI parser applies compatibility defaults.
  const checked = importedPlan.safeParse(raw); if (!checked.success) throw new Error('invalid_input');
  const value = parseImportedProject(checked.data); if (!value) throw new Error('invalid_input');
  for (const mediaId of collectVisualMediaIds(value)) scopedMedia(mediaId, projectId);
  for (const node of Object.values(value.nodes)) for (const sourceId of node.sourceAttachmentIds ?? []) if (!projectFiles(projectId).some(file => file.id === sourceId)) throw new Error('attachmentMissing');
  const visuals = getVisualWorkspace(value);
  const prompts = [...Object.values(visuals.drafts), ...visuals.proposals.map(proposal => proposal.input), ...visuals.artifacts.flatMap(artifact => artifact.revisions.flatMap(revision => revision.input ? [revision.input] : []))];
  for (const prompt of prompts) for (const mention of prompt.mentions) {
    if (mention.kind === 'node' && !value.nodes[mention.id]) throw new Error('nodeMissing');
    if (mention.kind === 'note') scopedRecord(ws().notes, mention.id, projectId);
    if (mention.kind === 'image' && !visuals.artifacts.some(artifact => artifact.id === mention.id && artifact.kind === 'image')) throw new Error('visualSourceMissing');
  }
  const result = graph().importProject(value); if (!result.ok) throw new Error('invalid_input');
  return { planId: value.id, rootId: value.rootId };
});
plannerAction('plan.outlines.set', z.object({ plans: z.array(planInput).min(1).max(20) }).strict(), 'Store complete externally supplied alternatives and their paid expansion cache; selecting an alternative never invokes an internal model.', (input, projectId) => {
  if (graph().project) throw new Error('plan_exists');
  if (new Set(input.plans.map((value: AIPlan) => value.id)).size !== input.plans.length) throw new Error('invalid_input');
  const current = graph().objectiveDraft;
  graph().setObjectiveDraft({ objective: (current.objective || managed(projectId).objective).trim(), rules: mergeRules(current.rules, parseRules(current.ruleDraft)), ruleDraft: '' });
  const draft = graph().objectiveDraft, attachmentsFingerprint = projectFiles(projectId).map(file => `${file.id}:${file.fingerprint}`).join('|');
  const outlines = (input.plans as AIPlan[]).map(({ tree, ...value }) => ({ ...value, outline: { categorias: tree.categorias.map(category => ({ name: category.name, kind: category.kind, nodes: category.children.map(child => ({ name: child.name, kind: child.kind })) })) } }));
  graph().setOutlines(outlines, { objective: draft.objective, rules: draft.rules, attachmentsFingerprint, planApproach: draft.planApproach, referenceTarget: draft.referenceTarget });
  for (const value of input.plans as AIPlan[]) graph().setExpandedPlan(value.id, value);
  return { ids: outlines.map(value => value.id) };
});
plannerAction('plan.outline.select', z.object({ outlineId: id }).strict(), 'Materialize a cached external alternative with the UI alternative/history behavior.', (input, projectId) => {
  if (graph().project) throw new Error('plan_exists');
  const draft = graph().objectiveDraft;
  if (!draft.outlines?.some(value => value.id === input.outlineId) || !draft.expanded[input.outlineId]) throw new Error('outlineMissing');
  const saved = draft.plansFor, rules = mergeRules(draft.rules, parseRules(draft.ruleDraft));
  if ((saved && (saved.objective !== draft.objective.trim() || !sameRules(saved.rules, rules)))
    || (saved?.attachmentsFingerprint ?? '') !== projectFiles(projectId).map(file => `${file.id}:${file.fingerprint}`).join('|')
    || (saved?.planApproach ?? 'new_creation') !== (draft.planApproach ?? 'new_creation')
    || (saved?.referenceTarget ?? '').trim() !== (draft.referenceTarget ?? '').trim()) throw new Error('planContextChanged');
  if (!graph().createProjectFromOutline(saved?.objective ?? draft.objective.trim(), draft.name.trim() || managed(projectId).name, input.outlineId, saved?.rules ?? rules)) throw new Error('outlineMissing');
  return { planId: graph().project!.id, rootId: graph().project!.rootId };
});
plannerAction('plan.draft.update', z.object({ name: text.optional(), objective: text.optional(), rules: z.array(short).max(100).optional(), ruleDraft: text.optional(), planApproach: z.enum(['reverse_engineering', 'new_creation']).optional(), referenceTarget: z.string().max(2000).optional() }).strict(), 'Edit a provider-free new-plan draft.', input => { if (graph().project) throw new Error('plan_exists'); graph().setObjectiveDraft(input); });
plannerAction('plan.draft.clear', noInput, 'Clear the new-plan draft.', () => graph().clearObjectiveDraft());
plannerAction('plan.new', noInput, 'Archive the current plan and its staged/draft session, then open a new draft.', () => graph().resetProject());
plannerAction('plan.restore', noInput, 'Restore the previous archived plan and session.', () => ({ changed: graph().undoReset() }));
plannerAction('plan.node.update', z.object({ nodeId: id, patch: nodePatch }).strict(), 'Edit allowed node prose with committed UI history. Identity, evidence, state and parentage cannot be patched.', input => { node(input.nodeId); graph().updateNode(input.nodeId, input.patch, { commit: true }); });
plannerAction('plan.node.delete', nodeTarget, 'Delete a node subtree and prune related drafts, suggestions and visual links.', input => { node(input.nodeId); graph().deleteNode(input.nodeId); });
plannerAction('plan.node.confirm', nodeTarget.extend({ force: z.boolean().optional() }).strict(), 'Confirm a node using UI evidence/failure gates. Force is an explicit audited opt-out and never overrides an open failure.', input => { node(input.nodeId); graph().confirmNode(input.nodeId, { force: input.force }); });
plannerAction('plan.node.unconfirm', nodeTarget, 'Reopen a confirmed node.', input => { node(input.nodeId); graph().unconfirmNode(input.nodeId); });
plannerAction('plan.node.known', nodeTarget, 'Toggle the UI already-known recursion floor.', input => { node(input.nodeId); graph().toggleTakenAsKnown(input.nodeId); });
plannerAction('plan.node.choose', nodeTarget.extend({ optionId: id }).strict(), 'Choose a real existing decision option through the UI domain gate.', input => { const value = node(input.nodeId); if (!value.decisionOptions?.some(option => option.id === input.optionId)) throw new Error('optionMissing'); graph().pickDecisionOption(input.nodeId, input.optionId); });
plannerAction('plan.node.history', nodeTarget.extend({ text: text.min(1) }).strict(), 'Append a manual history observation, with server-owned entry identity and time.', input => { node(input.nodeId); graph().addManualHistory(input.nodeId, input.text); });
plannerAction('plan.node.explanation', nodeTarget.extend({ text }).strict(), 'Store externally supplied explanatory prose; does not create observed evidence.', input => { node(input.nodeId); graph().setNodeExplanation(input.nodeId, input.text); });
plannerAction('plan.criterion.set', nodeTarget.extend({ text: text.trim().min(1) }).strict(), 'Lock the criterion actually supplied by the human; never invent physical evidence.', input => { node(input.nodeId); graph().setUserCriterion(input.nodeId, input.text); });
plannerAction('plan.criterion.unlock', nodeTarget, 'Unlock only within the UI ten-second grace window, before attestation or criterion reveal.', input => { node(input.nodeId); return { changed: graph().unlockCriterion(input.nodeId) }; });
plannerAction('plan.criterion.attest', nodeTarget.extend({ observation: text.trim().min(1) }).strict(), 'Record the human observation against their locked criterion. The runtime must supply observed evidence, never an inference.', input => { node(input.nodeId); graph().attestCriterion(input.nodeId, input.observation); });
plannerAction('plan.critique.set', nodeTarget.extend({ critique: z.object({ fraquezas: z.array(text).max(100), premissasOcultas: z.array(text).max(100), criterioAlternativo: text, fontes: z.array(source).max(100).optional() }).strict() }).strict(), 'Store an externally produced critique; the server supplies its timestamp.', input => { node(input.nodeId); graph().setCritica(input.nodeId, { ...input.critique, generatedAt: Date.now() }); });
plannerAction('plan.critique.clear', nodeTarget, 'Remove a stored critique.', input => { node(input.nodeId); graph().clearCritica(input.nodeId); });
plannerAction('plan.research.set', nodeTarget.extend({ query: short, findings: text, sources: z.array(source).max(100) }).strict(), 'Store external research and unverified source anchors using UI deduplication; research is not observation.', input => { node(input.nodeId); graph().applyWebResearch(input.nodeId, { query: input.query, findings: input.findings, sources: input.sources, searchedAt: Date.now() }); });
plannerAction('plan.reference.add', nodeTarget.extend({ reference: hint, origin: z.enum(['human', 'external']).default('external') }).strict(), 'Add an unverified anchor. External-origin references require observations before they count as evidence.', input => { node(input.nodeId); graph().addGroundTruthRef(input.nodeId, { ...input.reference, verificado: false, addedByAI: input.origin !== 'human' }); });
const refTarget = nodeTarget.extend({ refId: id }).strict();
function reference(input: Input) { const value = node(input.nodeId).groundTruthRefs?.find(ref => ref.id === input.refId); if (!value) throw new Error('referenceMissing'); return value; }
plannerAction('plan.reference.verify', refTarget.extend({ observation: text.trim().min(1) }).strict(), 'Record the human source-check observation and verify the anchor.', input => { reference(input); graph().verifyGroundTruthRef(input.nodeId, input.refId, input.observation); });
plannerAction('plan.reference.unverify', refTarget, 'Unverify an anchor and demote any conclusion that loses its evidence.', input => { if (reference(input).verificado) graph().toggleGroundTruthVerified(input.nodeId, input.refId); });
plannerAction('plan.reference.opened', refTarget, 'Record that the source was opened; this does not count as evidence.', input => { reference(input); graph().markRefOpened(input.nodeId, input.refId); });
plannerAction('plan.reference.delete', refTarget, 'Remove an anchor and recalculate evidence-supported status.', input => { reference(input); graph().removeGroundTruthRef(input.nodeId, input.refId); });
plannerAction('plan.failure.report', nodeTarget.extend({ text: text.trim().min(1) }).strict(), 'Record a real failure and invalidate successful confirmation.', input => { node(input.nodeId); graph().reportFailure(input.nodeId, input.text); });
plannerAction('plan.failure.clear', nodeTarget, 'Explicitly resolve/clear a recorded failure using UI rules.', input => { node(input.nodeId); graph().clearFailure(input.nodeId); });
plannerAction('plan.rule.add', z.object({ text: short }).strict(), 'Add a project rule and audit it on the root history.', input => graph().addRule(input.text));
plannerAction('plan.rule.remove', z.object({ text: short }).strict(), 'Remove a project rule and audit it on the root history.', input => graph().removeRule(input.text));
const stageSchema = z.object({ parentId: id, nodes: z.array(suggested).min(1).max(100), edges: z.array(suggestedEdge).max(300).default([]), reason: text.optional() }).strict().superRefine((input, ctx) => {
  const keys = new Set(input.nodes.map(value => value.tempId));
  if (keys.size !== input.nodes.length || input.edges.some(edge => !keys.has(edge.sourceTempId) || !keys.has(edge.targetTempId))) ctx.addIssue({ code: 'custom', message: 'invalidSuggestionGraph' });
});
plannerAction('plan.stage', stageSchema, 'Stage externally supplied decomposition/replanning proposals for explicit acceptance. Preserves UI failure and staging behavior.', input => {
  const parent = node(input.parentId); if (parent.confirmado || parent.takenAsKnown || parent.state === 'done') throw new Error('parentResolved');
  const children = (input.nodes as AISuggestedNode[]).map(value => ({ ...value, decisionOptions: value.decisionOptions?.map(option => ({ ...option, id: option.id ?? nanoid(10) })) }));
  graph().stageSuggestions(input.parentId, buildStagedNodes(parent, children, { notes: input.reason }), input.edges);
});
plannerAction('plan.suggestion.accept', z.object({ tempId: id }).strict(), 'Accept one staged proposal through the UI implementation.', input => { if (!graph().pendingSuggestions?.nodes.some(value => value.tempId === input.tempId)) throw new Error('suggestionMissing'); graph().acceptSuggestion(input.tempId); });
plannerAction('plan.suggestion.reject', z.object({ tempId: id }).strict(), 'Reject one staged proposal.', input => { if (!graph().pendingSuggestions?.nodes.some(value => value.tempId === input.tempId)) throw new Error('suggestionMissing'); graph().rejectSuggestion(input.tempId); });
plannerAction('plan.suggestion.accept_all', noInput, 'Accept all active proposals using UI history, failure-resolution and layout behavior.', () => graph().acceptAllSuggestions());
plannerAction('plan.suggestion.reject_all', noInput, 'Reject all active proposals.', () => graph().rejectAllSuggestions());
plannerAction('plan.suggestion.resume', z.object({ parentId: id }).strict(), 'Resume a parked proposal batch.', input => { node(input.parentId); return { changed: graph().resumeSuggestions(input.parentId) }; });
plannerAction('plan.structure', planStructureSchema.omit({ projectId: true }), 'Apply up to 24 atomic add/update/move operations at the exact plan revision using existing tree-cycle, parent, duplicate and attachment checks.', (input, projectId) => { const { undoId: _undoId, ...result } = applyPlanStructure({ ...input, projectId }); return result; });
plannerAction('plan.layout.node', nodeTarget.extend({ position: point }).strict(), 'Move one node and preserve manual-layout mode.', input => { node(input.nodeId); graph().updateNodePosition(input.nodeId, input.position); });
plannerAction('plan.layout.set', z.object({ positions: z.record(id, point).refine(value => Object.keys(value).length <= 5000) }).strict(), 'Apply a validated bulk layout and return to automatic layout mode.', input => { for (const key of Object.keys(input.positions)) node(key); graph().applyLayoutPositions(input.positions); });
plannerAction('plan.node_draft.set', nodeTarget.extend({ field: z.enum(['criterion', 'met', 'failure']), value: text }).strict(), 'Persist a node criterion/observation/failure draft.', input => { node(input.nodeId); graph().setDraft(input.nodeId, input.field, input.value); });
plannerAction('plan.node_draft.clear', nodeTarget.extend({ field: z.enum(['criterion', 'met', 'failure']).optional() }).strict(), 'Clear one or all draft fields for a node.', input => { node(input.nodeId); graph().clearDraft(input.nodeId, input.field); });
plannerAction('plan.ink.set', z.object({ ink: canvasInkSchema }).strict(), 'Persist a validated planner ink document.', input => mutateVisualWorkspace(value => ({ ...value, ink: input.ink })));
plannerAction('plan.attachments.set', z.object({ attachments: canvasAttachmentsSchema }).strict(), 'Persist the canvas attachment/resource library with UI schema limits and project-owned media references.', (input, projectId) => { for (const resource of input.attachments.resources) if (resource.mediaId) scopedMedia(resource.mediaId, projectId); mutateVisualWorkspace(value => ({ ...value, attachments: input.attachments })); });
action('attachment.add', z.object({ files: z.array(planFileSchema).min(1).max(12) }).strict(), 'Add already-extracted project sources using the same fingerprint, collision, deduplication and count rules.', (input, projectId) => ({ files: addProjectFiles(projectId!, input.files).map(file => ({ id: file.id, name: file.name })) }));
action('attachment.delete', recordTarget, 'Remove an extracted project source attachment.', (input, projectId) => { if (!projectFiles(projectId).some(value => value.id === input.id)) throw new Error('attachmentMissing'); removeProjectFile(projectId!, input.id); });

plannerAction('visual.insert', z.object({ kind: z.enum(['model', 'diagram']), label: short, scene: sceneSchema.optional(), diagram: diagramSchema.optional(), linkedNodeId: id.nullable().optional(), position: point.optional(), width: z.number().finite().min(24).max(10000).optional(), height: z.number().finite().min(24).max(10000).optional() }).strict(), 'Insert an externally supplied validated illustrative model or diagram. Never invokes an internal model or creates evidence.', input => {
  if (input.linkedNodeId) node(input.linkedNodeId);
  if (input.kind === 'diagram' ? !input.diagram || input.scene : !input.scene || input.diagram) throw new Error('invalid_input');
  const diagram = input.kind === 'diagram' ? parseDiagram(input.diagram, Object.keys(graph().project!.nodes)) : undefined;
  const now = Date.now(), artifactId = nanoid(12), scene = input.kind === 'model' ? input.scene : null;
  const artifact = artifactSchema.parse({ id: artifactId, kind: input.kind, label: input.label, linkedNodeId: input.linkedNodeId ?? null, x: input.position?.x ?? 0, y: input.position?.y ?? 0, width: input.width ?? 360, height: input.height ?? 280, scene, mediaId: null, source: null, ...(diagram ? { diagram, diagramValues: {} } : {}), revisions: [{ scene, mediaId: null, createdAt: now, ...(diagram ? { diagram, diagramValues: {} } : {}) }], revisionIndex: 0 });
  mutateVisualWorkspace(value => normalizeVisualWorkspace({ ...value, artifacts: [...value.artifacts, artifact] }));
  return { id: artifactId };
});
plannerAction('visual.image.insert', z.object({ mediaId: id, label: short, linkedNodeId: id.nullable().optional(), position: point.optional(), width: z.number().finite().min(24).max(10000).optional(), height: z.number().finite().min(24).max(10000).optional(), source: artifactSchema.shape.source.unwrap().optional() }).strict(), 'Insert an image referencing an existing project-owned encrypted original. Binary upload is a separate media operation.', (input, projectId) => {
  const media = scopedMedia(input.mediaId, projectId); if (!['image/png', 'image/jpeg', 'image/webp'].includes(media.mime)) throw new Error('invalid_input');
  if (input.linkedNodeId) node(input.linkedNodeId);
  const artifact = artifactSchema.parse({ id: nanoid(12), label: input.label, kind: 'image', linkedNodeId: input.linkedNodeId ?? null, x: input.position?.x ?? 0, y: input.position?.y ?? 0, width: input.width ?? 280, height: input.height ?? 220, scene: null, mediaId: input.mediaId, source: input.source ?? null, revisions: [{ scene: null, mediaId: input.mediaId, createdAt: Date.now() }], revisionIndex: 0 });
  mutateVisualWorkspace(value => normalizeVisualWorkspace({ ...value, artifacts: [...value.artifacts, artifact] })); return { id: artifact.id };
});
plannerAction('visual.revise', z.object({ id: z.string().min(1).max(200), scene: sceneSchema, assembly: modelAssemblySchema.optional() }).strict(), 'Apply externally supplied declarative model geometry using the same UI revision/revert boundary; never executes code.', (input, projectId) => {
  if (input.assembly) { for (const nodeId of input.assembly.selectedNodeIds) node(nodeId); for (const imageId of input.assembly.selectedImageIds) { const image = getVisualWorkspace(graph().project).artifacts.find(value => value.id === imageId && value.kind === 'image'); if (!image?.mediaId) throw new Error('visualSourceMissing'); scopedMedia(image.mediaId, projectId); } }
  return { id: applyVisualModelRevision(input.id, { scene: input.scene, assembly: input.assembly }).id };
});
plannerAction('visual.decomposition.set', z.object({ id: z.string().min(1).max(200), research: decompositionResearchSchema }).strict(), 'Store externally researched parts only when quoted source excerpts support each documented claim; supplies dossier provenance.', input => {
  const dossier = applyDecompositionResearch(input.id, input.research); return { dossier, dossierFingerprint: decompositionHash(dossier), researchFingerprint: researchFingerprint(dossier) };
});
plannerAction('visual.decomposition.apply', z.object({ id: z.string().min(1).max(200), proposal: z.object({ dossier: decompositionSchema, assembly: decompositionSchema.shape.assembly.unwrap(), baseDossierFingerprint: z.string().min(1).max(200) }).strict() }).strict(), 'Apply a documented external decomposition with the UI stale-context, geometry-reuse and non-overlap checks.', input => ({ id: applyStoredDecompositionAssembly(input.id, input.proposal).id }));
query('visual.decomposition.export', z.object({ id: z.string().min(1).max(200) }).strict(), 'Export the documented decomposition and declarative geometry as the same UI text artifact.', (input, projectId) => { openPlanner(projectId!); return { text: portableDecompositionTxt(input.id) }; });
plannerAction('visual.update_geometry', z.object({ id: z.string().min(1).max(200), patch: z.object({ x: point.shape.x.optional(), y: point.shape.y.optional(), width: z.number().finite().positive().max(100000).optional(), height: z.number().finite().positive().max(100000).optional() }).strict() }).strict(), 'Move or resize a visual artifact using UI geometry validation.', input => { if (!getVisualWorkspace(graph().project).artifacts.some(value => value.id === input.id)) throw new Error('visualArtifactMissing'); updateVisualArtifact(input.id, input.patch); });
plannerAction('visual.link', z.object({ id: z.string().min(1).max(200), nodeId: id.nullable() }).strict(), 'Link/unlink a visual to an existing plan node without a positional constraint.', input => setVisualArtifactLink(input.id, input.nodeId));
plannerAction('visual.parameter.set', z.object({ id: z.string().min(1).max(200), parameterId: id, value: z.number().finite() }).strict(), 'Adjust an exploratory diagram parameter using its UI range clamp.', input => setDiagramParameter(input.id, input.parameterId, input.value));
plannerAction('visual.delete', z.object({ id: z.string().min(1).max(200) }).strict(), 'Remove a visual artifact and clean draft image mentions.', input => removeVisualArtifact(input.id));
plannerAction('visual.revert', z.object({ id: z.string().min(1).max(200) }).strict(), 'Revert a visual artifact to its previous persisted revision.', input => revertVisualArtifact(input.id));
plannerAction('visual.mode.set', z.object({ mode: z.enum(['approval', 'automatic']) }).strict(), 'Set the persisted visual proposal application mode.', input => setVisualMode(input.mode));
const prompt = z.object({ text: z.string().max(12000), references: z.array(z.object({ kind: z.enum(['node', 'note', 'image']), id }).strict()).max(20).default([]), analyzeImages: z.boolean().optional(), generationMode: z.enum(['standard', 'advanced']).optional(), artifactKind: z.enum(['model', 'diagram']).optional() }).strict();
function visualPrompt(input: Input, projectId: string | null): VisualPromptInput {
  const mentions = input.references.map((reference: { kind: string; id: string }) => {
    if (reference.kind === 'node') return { ...reference, label: node(reference.id).name, detail: 'node', fingerprint: planRevision(graph().project!) };
    if (reference.kind === 'note') { const value = scopedRecord(ws().notes, reference.id, projectId); return { ...reference, label: value.title, detail: 'note', fingerprint: `${value.updatedAt}` }; }
    const value = getVisualWorkspace(graph().project).artifacts.find(value => value.id === reference.id && value.kind === 'image'); if (!value) throw new Error('visualSourceMissing');
    return { ...reference, label: value.label, detail: 'image', fingerprint: `${value.revisionIndex}` };
  });
  const { references: _references, ...values } = input;
  return { ...values, text: input.text, mentions, attachments: [] } as VisualPromptInput;
}
plannerAction('visual.draft.set', z.object({ kind: z.enum(['search', 'model']), prompt }).strict(), 'Save visual prompt prose and project-scoped reference selections without generation.', (input, projectId) => {
  saveVisualDraft(input.kind, visualPrompt(input.prompt, projectId));
});
plannerAction('visual.proposal.create', z.object({ kind: z.enum(['model', 'diagram']), label: short, prompt, scene: sceneSchema.optional(), diagram: diagramSchema.optional(), assembly: modelAssemblySchema.optional() }).strict(), 'Prepare an externally supplied model/diagram as a context-bound UI proposal. Honors the persisted approval/automatic mode and server-owned provenance.', (input, projectId) => {
  if (input.kind === 'diagram' ? !input.diagram || input.scene || input.assembly : !input.scene || input.diagram) throw new Error('invalid_input');
  const values = visualPrompt({ ...input.prompt, artifactKind: input.kind }, projectId);
  const context = resolveVisualContext(values), scope = currentVisualScope(), proposalId = nanoid(12);
  const diagram = input.kind === 'diagram' ? parseDiagram(input.diagram, Object.keys(graph().project!.nodes)) : undefined;
  const candidate = { id: proposalId, projectId: scope.projectId, label: input.label, input: values, contextFingerprint: context.fingerprint, contextSnapshot: context.text, createdAt: Date.now(), status: 'ready', ...(diagram ? { kind: 'diagram', scene: null, diagram } : { kind: 'model', scene: input.scene, ...(input.assembly ? { assembly: input.assembly } : {}) }) };
  const validated = normalizeVisualWorkspace({ ...getVisualWorkspace(graph().project), proposals: [candidate] }).proposals[0];
  if (input.assembly) { for (const nodeId of input.assembly.selectedNodeIds) node(nodeId); for (const imageId of input.assembly.selectedImageIds) if (!getVisualWorkspace(graph().project).artifacts.some(value => value.id === imageId && value.kind === 'image')) throw new Error('visualSourceMissing'); }
  storeVisualProposal(validated, scope);
  if (getVisualWorkspace(graph().project).mode === 'automatic') return { id: proposalId, artifactId: applyVisualProposal(proposalId).id, status: 'applied' };
  return { id: proposalId, status: 'ready' };
});
plannerAction('visual.proposal.apply', recordTarget, 'Apply an existing proposal only while its source context remains current.', input => ({ id: applyVisualProposal(input.id).id }));
plannerAction('visual.proposal.reject', recordTarget, 'Reject an existing unapplied visual proposal.', input => rejectVisualProposal(input.id));
plannerAction('visual.proposal.delete_history', recordTarget, 'Remove a completed/rejected visual proposal history entry while preserving artifacts.', input => removeVisualProposalHistory(input.id));

action('preference.language', z.object({ locale: z.enum(['en', 'pt-BR']) }).strict(), 'Persist the user language preference.', input => useLocaleStore.getState().setLocale(input.locale), 'account');
action('preference.theme', z.object({ theme: z.enum(['oled', 'dark', 'light']) }).strict(), 'Persist the UI theme without accessing a browser DOM.', input => writePreference('dynamic_diary-theme', input.theme), 'account');
action('preference.sidebar', z.object({ collapsed: z.boolean() }).strict(), 'Persist the sidebar collapsed preference.', input => writePreference('dynamic_diary-sidebar-collapsed', JSON.stringify(input.collapsed)), 'account');

export function getDomainCatalog() {
  return definitions.map(({ name, kind, description, schema, permission, projectRequired, scope }) => ({ name, kind, description, inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }), permission, projectRequired, scope }));
}
const operationInput = z.object({
  snapshot: z.object({ documents: z.array(z.object({ key: z.string().min(1).max(200), value: z.string().max(48 * 1024 * 1024), revision: z.number().int().nonnegative() }).strict()).max(100), media: z.array(z.record(z.string(), z.unknown())).max(100000) }).strict(),
  projectId: id.nullish(), operation: z.object({ kind: z.enum(['query', 'action']), name: z.string().min(1).max(100), input: z.unknown().optional() }).strict(),
}).strict();
function envelope(snapshot: CloudSnapshot, key: string) { const document = snapshot.documents.find(value => value.key === key); return document ? JSON.parse(document.value) as { state: Record<string, unknown>; version: number } : null; }
function workspaceDomain() { const value = ws(); return useWorkspaceStore.persist.getOptions().partialize!(value); }
export async function runDomainOperation(raw: unknown) {
  const parsed = operationInput.safeParse(raw); if (!parsed.success) throw new Error('invalid_input');
  const input = parsed.data, snapshot = input.snapshot as unknown as CloudSnapshot;
  snapshotMedia = snapshot.media;
  mediaInScope = createMediaScopeResolver(snapshot);
  if (new Set(snapshot.documents.map(value => value.key)).size !== snapshot.documents.length) throw new Error('invalid_snapshot');
  const definition = definitions.find(value => value.name === input.operation.name && value.kind === input.operation.kind); if (!definition) throw new Error('unknown_operation');
  const validated = definition.schema.safeParse(input.operation.input ?? {}); if (!validated.success) throw new Error('invalid_input');
  const projectId = input.projectId ?? null;
  if (definition.projectRequired && !projectId) throw new Error('project_required');
  if (definition.scope === 'account' && projectId !== null) throw new Error('account_scope');
  const originalGraph = envelope(snapshot, 'cellproject-graph');
  seedMemory(snapshot);
  await useWorkspaceStore.persist.rehydrate();
  await useGraphStore.persist.rehydrate();
  await useLocaleStore.persist.rehydrate();
  // Initialization establishes the editor ownership bridge. Its UI migrations
  // must not rewrite unrelated projects during a scoped server operation.
  const hydratedProjects = ws().projects, hydratedLegacyImported = ws().legacyImported;
  initializeWorkspace();
  useWorkspaceStore.setState({ projects: hydratedProjects, legacyImported: hydratedLegacyImported });
  if (definition.projectRequired) managed(projectId);
  if (definition.kind === 'query') return { result: definition.execute(validated.data as Input, projectId), snapshot };
  const before = JSON.stringify(workspaceDomain()), initialGraphOwner = getPlannerOwnerId();
  const originalOwnerProject = initialGraphOwner ? ws().projects[initialGraphOwner] : undefined;
  if (definition.planner) {
    openPlanner(projectId!);
    // The UI bridge saves the editor it leaves. A headless operation must not
    // edit another granted/ungranted project as a side effect of that switch.
    if (initialGraphOwner && initialGraphOwner !== projectId && originalOwnerProject) {
      useWorkspaceStore.setState({ projects: { ...ws().projects, [initialGraphOwner]: originalOwnerProject } });
    }
    useWorkspaceStore.setState({ activeProjectId: projectId });
    if (!graph().project && !['plan.create', 'plan.import', 'plan.outlines.set', 'plan.outline.select', 'plan.draft.update', 'plan.draft.clear', 'plan.new', 'plan.restore'].includes(definition.name)) throw new Error('planMissing');
  }
  const result = await definition.execute(validated.data as Input, projectId);
  if (definition.planner) ws().savePlanner(projectId!, capturePlanner());
  await flushWorkspacePersistence();
  await flushGraphPersistence();
  const documents = new Map(snapshot.documents.map(value => [value.key, value]));
  const update = (key: string, value: string) => { const previous = documents.get(key); if (previous?.value !== value) documents.set(key, { key, value, revision: previous?.revision ?? 0 }); };
  const nextWorkspace = workspaceDomain();
  if (JSON.stringify(nextWorkspace) !== before) update('cellproject-workspace', JSON.stringify({ ...(envelope(snapshot, 'cellproject-workspace') ?? {}), state: nextWorkspace, version: 2 }));
  // Switching the isolated worker editor is never a request to move the user's active editor.
  if (definition.planner && originalGraph && initialGraphOwner === projectId) update('cellproject-graph', JSON.stringify({ ...originalGraph, state: { ...capturePlanner(), plannerOwnerId: projectId }, version: 6 }));
  if (definition.name === 'preference.language') update('cellproject-locale', JSON.stringify({ state: { locale: (validated.data as Input).locale }, version: 1 }));
  if (definition.name === 'preference.theme') update('dynamic_diary-theme', (validated.data as Input).theme);
  if (definition.name === 'preference.sidebar') update('dynamic_diary-sidebar-collapsed', JSON.stringify((validated.data as Input).collapsed));
  for (const key of CONTENT_DOCUMENT_KEYS) { const value = readPreference(key); if (value !== null) update(key, value); }
  const changed = [...documents.values()].some(document => snapshot.documents.find(previous => previous.key === document.key)?.value !== document.value);
  return { result: result === undefined ? { changed } : { ...(typeof result === 'object' && result !== null ? result : { value: result }), changed }, snapshot: { documents: [...documents.values()], media: snapshot.media } };
}
