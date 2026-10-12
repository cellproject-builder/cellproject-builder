import { z } from 'zod';
import { safeHref } from '@/safeHref';

export const id = z.string().regex(/^[\w-]{1,100}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
export const text = z.string().max(100_000);
export const short = z.string().trim().min(1).max(240);
export const noInput = z.object({}).strict();
export const pageInput = z.object({ offset: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export const nodeTarget = z.object({ nodeId: id }).strict();
export const recordTarget = z.object({ id }).strict();
export const point = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
export const source = z.object({ url: z.string().max(4000).refine(url => safeHref(url) !== null), title: short }).strict();
export const hint = z.object({ kind: z.enum(['link', 'spec', 'medida']), label: short, value: z.string().min(1).max(8000) }).strict().refine(ref => ref.kind !== 'link' || safeHref(ref.value) !== null);
const option = z.object({ id: id.optional(), label: short, pitch: text, consequences: text.optional() }).strict();
export const suggested = z.object({
  tempId: id, kind: z.enum(['categoria', 'recurso', 'passo', 'decisao', 'concept']), name: short,
  fx: text.default(''), problem: text.default(''), confidence: z.number().finite().min(0).max(100).default(50), confidenceReason: text.default(''),
  pros: z.array(text).max(50).default([]), cons: z.array(text).max(50).default([]), oQue: text.default(''), porQue: text.default(''), comoConfirmar: text.default(''),
  order: z.number().int().min(0).max(10000).optional(), decisionOptions: z.array(option).min(2).max(8).optional(), groundTruthHints: z.array(hint).max(20).optional(), ruleConflict: text.optional(),
}).strict();
export const suggestedEdge = z.object({ sourceTempId: id, targetTempId: id, kind: z.enum(['direct', 'middleware', 'independent', 'optional']), note: text.optional() }).strict();
export const planInput = z.object({
  id, title: short, pitch: text, approach: text, strategy: z.enum(['reaproveitar', 'hibrido', 'do_zero']), archetype: z.enum(['construir', 'entender']),
  rank: z.number().int().min(1).max(100), rankReason: text, planApproach: z.enum(['reverse_engineering', 'new_creation']).optional(), referenceTarget: z.string().max(2000).optional(),
  tree: z.object({ categorias: z.array(z.object({ tempId: id, name: short, kind: z.enum(['recursos', 'execucao', 'decisoes']), oQue: text, porQue: text, children: z.array(suggested).max(100) }).strict()).min(1).max(12) }).strict(),
  estimates: z.object({ custo: text, tempo: text, dificuldade: z.enum(['iniciante', 'intermediario', 'avancado']) }).strict().optional(),
  rulesCheck: z.array(z.object({ rule: text, status: z.enum(['cumpre', 'risco', 'viola']), nota: text }).strict()).max(100).optional(),
}).strict().superRefine((plan, ctx) => {
  const keys = plan.tree.categorias.flatMap(cat => [cat.tempId, ...cat.children.map(node => node.tempId)]);
  if (new Set(keys).size !== keys.length || keys.length > 512) ctx.addIssue({ code: 'custom', message: 'invalidPlanKeys' });
});
export const nodePatch = z.object({ name: short.optional(), fx: text.optional(), oQue: text.optional(), porQue: text.optional(), notes: text.optional(), pros: z.array(text).max(50).optional(), cons: z.array(text).max(50).optional() }).strict();
export const taskInput = z.object({ title: short, description: text.optional(), status: z.enum(['todo', 'doing', 'review', 'done']).optional(), priority: z.enum(['low', 'medium', 'high']).optional(), dueDate: z.string().max(10).optional(), sprintId: id.nullable().optional() }).strict();
export const block = z.object({ id: id.optional(), type: z.enum(['text', 'heading', 'bullet', 'check']), text, checked: z.boolean().optional(), bold: z.boolean().optional(), italic: z.boolean().optional() }).strict();
export const noteText = z.object({ title: z.string().max(500).optional(), text: text.optional(), blocks: z.array(block).min(1).max(500).optional(), taskId: id.nullable().optional(), folderId: id.nullable().optional(), pinned: z.boolean().optional() }).strict();
export const outlineInput = z.object({ ...planInput.shape }).omit({ tree: true }).extend({
  outline: z.object({ categorias: z.array(z.object({ name: short, kind: z.enum(['recursos', 'execucao', 'decisoes']), nodes: z.array(z.object({ name: short, kind: suggested.shape.kind }).strict()).max(100) }).strict()).min(1).max(12) }).strict(),
}).strict();
const timestamp = z.number().finite().nonnegative().max(8.64e15);
const groundTruthRef = z.object({ ...hint.shape, id, verificado: z.boolean(), addedAt: timestamp, verifiedAt: timestamp.optional(), addedByAI: z.boolean(), observacao: text.optional(), openedAt: timestamp.optional() }).strict().refine(ref => ref.kind !== 'link' || safeHref(ref.value) !== null);
export const persistedNode = z.object({
  id, parentId: id.nullable(), kind: z.enum(['root', 'categoria', 'recurso', 'passo', 'decisao', 'concept']), name: text,
  fx: text, problem: text, confidence: z.number().finite().min(0).max(100), confidenceSource: z.enum(['data', 'experience', 'intuition', 'ai']).optional(), confidenceReason: text.optional(),
  pros: z.array(text).max(100), cons: z.array(text).max(100), oQue: text, porQue: text, comoConfirmar: text, explicacao: text.optional(),
  comoConfirmarUsuario: text.optional(), comoConfirmarUsuarioAt: timestamp.optional(), aiCriterionSeenAt: timestamp.optional(), ruleConflict: text.optional(),
  comoConfirmarAtendido: z.object({ observacao: text, at: timestamp }).strict().optional(),
  critica: z.object({ fraquezas: z.array(text).max(100), premissasOcultas: z.array(text).max(100), criterioAlternativo: text, fontes: z.array(source).max(100).optional(), generatedAt: timestamp }).strict().optional(),
  groundTruthRefs: z.array(groundTruthRef).max(1000).optional(),
  webResearch: z.object({ query: text, findings: text, sources: z.array(source).max(100), searchedAt: timestamp }).strict().optional(),
  failureContext: text.optional(), failureReportedAt: timestamp.optional(), planReplacedAt: timestamp.optional(), confirmado: z.boolean(), confirmedWithoutSignal: z.boolean().optional(), takenAsKnown: z.boolean().optional(),
  order: z.number().int().min(0).max(10000), decisionOptions: z.array(option.extend({ id })).max(100).optional(), decisionPickedId: id.optional(),
  state: z.enum(['concept', 'validated', 'executing', 'done', 'problem', 'discarded']), notes: text,
  history: z.array(z.object({ id, timestamp, kind: z.enum(['created', 'confidence', 'state', 'rename', 'note', 'child_added', 'manual', 'confirmed', 'unconfirmed', 'decision', 'criterio_usuario', 'critica', 'ground_truth', 'failure', 'replan', 'edit']), message: text, field: z.enum(['oQue', 'porQue']).optional(), prevValue: text.optional() }).strict()).max(10000),
  aiSuggested: z.boolean(), position: point, sourceAttachmentIds: z.array(id).max(100).optional(),
}).strict();
export const importedPlan = z.object({
  id, name: text, objective: text, createdAt: timestamp, updatedAt: timestamp, rootId: id,
  nodes: z.record(id, persistedNode).refine(value => Object.keys(value).length <= 5000),
  edges: z.record(id, z.object({ id, source: id, target: id, kind: z.enum(['direct', 'middleware', 'independent', 'optional']), middlewareNodeId: id.optional(), note: text.optional() }).strict()).refine(value => Object.keys(value).length <= 10000),
  rules: z.array(text).max(100).optional(), constructionStrategy: z.enum(['reaproveitar', 'hibrido', 'do_zero']).optional(), archetype: z.enum(['construir', 'entender']).optional(),
  alternativePlans: z.array(z.union([planInput, outlineInput])).max(20).optional(), manualLayout: z.boolean().optional(),
  planApproach: z.enum(['reverse_engineering', 'new_creation']).optional(), referenceTarget: z.string().max(2000).optional(), visuals: z.unknown().optional(),
}).strict().superRefine((project, ctx) => {
  if (Object.entries(project.nodes).some(([key, node]) => key !== node.id || node.kind === 'root' && key !== project.rootId || node.decisionPickedId && !node.decisionOptions?.some(option => option.id === node.decisionPickedId)) ||
      Object.entries(project.edges).some(([key, edge]) => key !== edge.id || !project.nodes[edge.source] || !project.nodes[edge.target] || edge.middlewareNodeId && !project.nodes[edge.middlewareNodeId])) ctx.addIssue({ code: 'custom', message: 'invalidPlanRelations' });
});
