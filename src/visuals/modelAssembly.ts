import { z } from 'zod';
import { decompositionResearchSchema } from './decompositionSchema';
import type { SceneV1, VisualArtifact, VisualModelAssembly } from './types';

const id = z.string().min(1).max(100);
const triple = z.tuple([z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000)]);
const size = z.number().finite().positive().max(10000);
export const assemblyPlanSchema = z.object({
  units: z.enum(['illustrative', 'mm']), sharedConstraints: z.array(z.string().min(1).max(800)).max(12), unknowns: z.array(z.string().min(1).max(800)).max(16),
  modules: z.array(z.object({ id: id.max(40).regex(/^[a-zA-Z0-9_-]+$/), name: z.string().min(1).max(160), prompt: z.string().min(1).max(2400),
    nodeIds: z.array(id).max(12), sourceIds: z.array(id).max(6), center: triple, size: z.tuple([size, size, size]), primitiveBudget: z.number().int().min(1).max(96),
  }).strict()).min(2).max(8),
  interfaces: z.array(z.object({ id, moduleIds: z.tuple([id, id]), anchor: triple, description: z.string().min(1).max(800) }).strict()).max(24),
}).strict().refine(plan => {
  const ids = new Set(plan.modules.map(module => module.id));
  return ids.size === plan.modules.length && plan.modules.reduce((total, module) => total + module.primitiveBudget, 0) <= 512
    && new Set(plan.interfaces.map(item => item.id)).size === plan.interfaces.length
    && plan.interfaces.every(item => item.moduleIds[0] !== item.moduleIds[1] && item.moduleIds.every(id => ids.has(id)));
}, 'visualAssemblyInvalid');
export const modelAssemblySchema = z.object({
  version: z.literal(1), sceneFingerprint: z.string().min(1).max(200), summary: z.string().min(1).max(1200), plan: assemblyPlanSchema,
  groups: z.array(z.object({ partId: id, name: z.string().min(1).max(160), objectIds: z.array(z.string().min(1).max(100)).min(1).max(96) }).strict()).min(2).max(8),
  selectedNodeIds: z.array(id).max(20), selectedImageIds: z.array(id).max(20), sources: z.array(decompositionResearchSchema.shape.sources.element).max(6), unknowns: z.array(z.string().max(800)).max(32),
}).strict().refine(assembly => {
  const assigned = assembly.groups.flatMap(group => group.objectIds), sources = new Set(assembly.sources.map(source => source.id));
  return sources.size === assembly.sources.length && new Set(assigned).size === assigned.length
    && new Set(assembly.groups.map(group => group.partId)).size === assembly.groups.length
    && assembly.groups.length === assembly.plan.modules.length && assembly.groups.every(group => assembly.plan.modules.some(module => module.id === group.partId && group.name === module.name && group.objectIds.length <= module.primitiveBudget))
    && assembly.plan.modules.every(module => module.nodeIds.every(id => assembly.selectedNodeIds.includes(id)) && module.sourceIds.every(id => sources.has(id)));
}, 'visualAssemblyInvalid');

export function modelSceneFingerprint(scene: SceneV1): string {
  const text = JSON.stringify(scene); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function modelAssemblyMatchesScene(assembly: VisualModelAssembly, scene: SceneV1): boolean {
  const ids = assembly.groups.flatMap(group => group.objectIds);
  return assembly.sceneFingerprint === modelSceneFingerprint(scene) && ids.length === scene.objects.length
    && new Set(ids).size === ids.length && scene.objects.every(object => ids.includes(object.id));
}
export function modelAssemblyCurrent(artifact: Pick<VisualArtifact, 'kind' | 'scene' | 'assembly'>): boolean {
  return artifact.kind === 'model' && !!artifact.scene && !!artifact.assembly && modelAssemblyMatchesScene(artifact.assembly, artifact.scene);
}
export function modelAssemblyTxt(artifact: VisualArtifact): string {
  if (!modelAssemblyCurrent(artifact)) throw new Error('visualAssemblyInvalid');
  return ['CONJUNTO MODULAR 3D · ILUSTRATIVO', artifact.label,
    'Cada módulo foi gerado separadamente. O contrato compartilha escala, envelopes e pontos de contato. Geometria, encaixes e conexões não são fisicamente validados. Documentos lidos não certificam automaticamente o modelo.',
    'CONTRATO E REFERÊNCIAS', JSON.stringify(artifact.assembly, null, 2), 'CENA COMPLETA MONTADA', JSON.stringify(artifact.scene, null, 2),
  ].join('\n\n');
}
