import { z } from 'zod';
import { sessionAwareFetch } from '@/cloud/runtime';
import type { PlanFile } from '@/attachments/files';
import { readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
const choices = ['reference', 'extend', 'revise', 'reorganize', 'clarify'] as const;
export const intakeClassificationSchema = z.object({ choice: z.enum(choices), confidence: z.number().min(0).max(1), probabilities: z.object({ reference: z.number().min(0).max(1), extend: z.number().min(0).max(1), revise: z.number().min(0).max(1), reorganize: z.number().min(0).max(1), clarify: z.number().min(0).max(1) }).strict(), model: z.string().min(1).max(200), assessedAt: z.number().finite(), rubricVersion: z.literal('plan-intake-v1') }).strict().refine(value => Math.abs(Object.values(value.probabilities).reduce((sum, p) => sum + p, 0) - 1) <= .025 + 1e-9 && choices.every(key => value.probabilities[key] <= value.probabilities[value.choice] + 1e-9));
export type IntakeClassification = z.infer<typeof intakeClassificationSchema>;
export type PlanIntake = { status: 'classified'; classification: IntakeClassification } | { status: 'not-configured' | 'unavailable' };
export function intakeLabel(intake: PlanIntake, english: boolean) {
  if (intake.status !== 'classified') return english ? 'TypeSafe classification unavailable' : 'Classificação TypeSafe indisponível';
  const labels = { reference: ['Consultar referências', 'Read references'], extend: ['Complementar o plano', 'Extend the plan'], revise: ['Revisar partes', 'Revise parts'], reorganize: ['Reorganizar estrutura', 'Reorganize structure'], clarify: ['Esclarecer o pedido', 'Clarify request'] };
  return `TypeSafe · ${labels[intake.classification.choice][english ? 1 : 0]}`;
}
/** Advisory classification only. The human request remains the sole authorization. */
export async function classifyPlanRequest(request: string, projectId: string, files: PlanFile[], signal: AbortSignal): Promise<PlanIntake> {
  try {
    signal.throwIfAborted();
    const managed = useWorkspaceStore.getState().projects[projectId]; if (!managed) throw new Error('projectMissing');
    const project = readPlanner(projectId).project;
    const bounded = (text: string, bytes: number) => { let result = text.slice(0, Math.max(0, bytes)); while (result.length && new TextEncoder().encode(JSON.stringify(result)).length > bytes) result = result.slice(0, Math.floor(result.length * .85)); return result; };
    let budget = 6_000;
    const selectedFiles = files.slice(0, 12).map(file => { const text = bounded(file.text, Math.max(0, Math.min(3000, budget))); budget -= new TextEncoder().encode(JSON.stringify(text)).length; return { id: file.id, name: bounded(file.name, 240), text }; });
    const body = { request: bounded(request, 4000), objective: bounded(project?.objective ?? managed.objective, 2000), nodes: Object.values(project?.nodes ?? {}).slice(0, 20).map(({ id, name, kind, parentId }) => ({ id, name: bounded(name, 120), kind, parentId })), files: selectedFiles };
    const cap = await sessionAwareFetch('/api/visuals/capabilities', { credentials: 'same-origin', signal }); if (!cap.ok) throw new Error('gateway');
    const capabilities = await cap.json(); if (capabilities.textualReview !== true) return { status: 'not-configured' };
    const response = await sessionAwareFetch('/api/visuals/plan-intake', { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json', 'X-Cellproject-Request': '1' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('gateway');
    const result = await response.json();
    if (result.status === 'not-configured') return { status: 'not-configured' };
    if (result.status !== 'classified') throw new Error('invalidClassification');
    return { status: 'classified', classification: intakeClassificationSchema.parse(result.classification) };
  } catch (error) { if (signal.aborted) throw error; return { status: 'unavailable' }; }
}
