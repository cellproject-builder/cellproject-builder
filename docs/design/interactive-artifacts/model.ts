import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/).refine(v => !['constructor', 'prototype', '__proto__'].includes(v));
const number = z.number().finite().min(-10000).max(10000);
const color = z.string().regex(/^(none|currentColor|#[0-9a-fA-F]{3,8})$/);
const parameter = z.object({ id, label: z.string().max(80), min: number, max: number, step: z.number().positive().max(100), value: number, unit: z.string().max(16) }).strict();
const element = z.object({
  id, type: z.enum(['rect', 'circle', 'line', 'path', 'polyline', 'text']),
  x: number.optional(), y: number.optional(), x1: number.optional(), y1: number.optional(), x2: number.optional(), y2: number.optional(),
  cx: number.optional(), cy: number.optional(), r: z.number().min(0).max(1000).optional(),
  width: z.number().min(0).max(2000).optional(), height: z.number().min(0).max(2000).optional(),
  rx: z.number().min(0).max(100).optional(),
  d: z.string().max(4000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.eE+ ,\-]*$/).optional(),
  points: z.string().max(2000).regex(/^[0-9.eE+ ,\-]*$/).optional(),
  text: z.string().max(240).optional(), fill: color.optional(), stroke: color.optional(),
  strokeWidth: z.number().min(0).max(12).optional(), fontSize: z.number().min(8).max(48).optional(),
  nodeId: id.nullable().optional(),
}).strict();
export const diagramSchema = z.object({
  title: z.string().min(1).max(120), explanation: z.string().max(1200),
  assumptions: z.array(z.string().max(400)).min(1).max(8),
  viewBox: z.tuple([z.literal(0), z.literal(0), z.number().min(100).max(1200), z.number().min(100).max(800)]),
  parameters: z.array(parameter).min(1).max(6), constants: z.record(id, number),
  calculations: z.array(z.object({ id, op: z.enum(['product', 'sum', 'difference', 'quotient']), inputs: z.array(id).min(2).max(8) }).strict()).max(16),
  elements: z.array(element).min(1).max(100),
  bindings: z.array(z.object({ elementId: id, attribute: z.enum(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'text']), valueId: id, multiplier: number, offset: number, decimals: z.number().int().min(0).max(4), suffix: z.string().max(24) }).strict()).max(60),
}).strict();
export type Diagram = z.infer<typeof diagramSchema>;
// Provider transport accepts homogeneous array items, not JSON Schema tuple items.
// Local parsing still checks the exact [0, 0, width, height] tuple.
export const generationDiagramSchema = diagramSchema.extend({ viewBox: z.array(z.number().min(0).max(1200)).length(4) });

export function parseDiagram(raw: unknown, allowedNodes: string[]): Diagram {
  const result = diagramSchema.parse(raw);
  const ids = [...result.parameters.map(p => p.id), ...Object.keys(result.constants), ...result.calculations.map(c => c.id)];
  if (new Set(ids).size !== ids.length || Object.keys(result.constants).length > 16) throw new Error('Duplicate or excessive values');
  if (new Set(result.elements.map(e => e.id)).size !== result.elements.length) throw new Error('Duplicate elements');
  for (const p of result.parameters) if (p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min) throw new Error('Invalid parameter range');
  const available = new Set([...result.parameters.map(p => p.id), ...Object.keys(result.constants)]);
  for (const c of result.calculations) {
    if (c.inputs.some(input => !available.has(input)) || (['difference', 'quotient'].includes(c.op) && c.inputs.length !== 2)) throw new Error('Unknown or cyclic calculation');
    available.add(c.id);
  }
  for (const e of result.elements) {
    if (e.nodeId && !allowedNodes.includes(e.nodeId)) throw new Error('Unknown plan link');
    if (e.type === 'path' && !e.d || e.type === 'polyline' && !e.points) throw new Error('Missing geometry');
  }
  for (const b of result.bindings) if (!available.has(b.valueId) || !result.elements.some(e => e.id === b.elementId)) throw new Error('Unknown binding');
  evaluateDiagram(result, {});
  return result;
}

export function evaluateDiagram(diagram: Diagram, overrides: Record<string, number>) {
  const values: Record<string, number> = Object.assign(Object.create(null), diagram.constants);
  for (const p of diagram.parameters) {
    const value = overrides[p.id] ?? p.value;
    if (!Number.isFinite(value)) throw new Error('Nonfinite input');
    values[p.id] = Math.max(p.min, Math.min(p.max, value));
  }
  for (const c of diagram.calculations) {
    const inputs = c.inputs.map(id => values[id]);
    const value = c.op === 'product' ? inputs.reduce((a, b) => a * b, 1) : c.op === 'sum' ? inputs.reduce((a, b) => a + b, 0) : c.op === 'difference' ? inputs[0] - inputs[1] : inputs[0] / inputs[1];
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('Invalid arithmetic');
    values[c.id] = value;
  }
  return values;
}

export const sampleContext = {
  revision: 'fixture-v1', synthetic: true,
  objective: 'Construir um robô de dois braços aprendendo a testar premissas. Cenário fictício para ensaio do software.',
  selectedNodeId: 'servo',
  nodes: [
    { id: 'root', parentId: null, kind: 'concept', name: 'Robô de dois braços', status: 'unverified' },
    { id: 'servo', parentId: 'root', kind: 'recurso', name: 'Avaliar MG90S na primeira articulação', status: 'unverified' },
    { id: 'power', parentId: 'root', kind: 'recurso', name: 'Conferir alimentação sob carga', status: 'unverified' },
    { id: 'test', parentId: 'servo', kind: 'passo', name: 'Ensaiar uma articulação de bancada', status: 'unverified' },
  ],
  humanPrediction: 'Ainda não registrei um critério quantitativo. Quero comparar alimentação e carga antes de comprar outro motor.',
  observations: [{ id: 'obs-jitter', text: 'O servo tremeu e não sustentou o braço. Não medi tensão, corrente, massa, distância ao eixo ou atrito.', synthetic: true }],
  documents: [],
};
export function isCurrentReview(review: { contextRevision: string }, context: { revision: string }) { return review.contextRevision === context.revision; }

export const reviewSchema = z.object({
  diagnosis: z.string().max(1600), contextRevision: z.string(),
  nodes: z.array(z.object({ nodeId: z.string(), assessment: z.enum(['supported', 'contradicted', 'uncertain', 'needs-decomposition']), reason: z.string().max(1000), evidenceIds: z.array(z.string()).max(8) }).strict()).min(1).max(8),
  alternatives: z.array(z.string().max(300)).max(6),
  hints: z.object({ question: z.string().max(600), detail: z.string().max(1000), suggestedStep: z.string().max(1000) }).strict(),
  proposedChanges: z.array(z.object({ targetNodeId: z.string(), description: z.string().max(600), reason: z.string().max(600) }).strict()).max(5),
  uncertainty: z.array(z.string().max(500)).max(8),
}).strict();

export const demoDiagram: Diagram = {
  title: 'Carga e distância ao eixo', explanation: 'Ilustração do torque estático da carga pontual: τ = m × g × r. Não estima a capacidade do MG90S.',
  assumptions: ['Valores sintéticos e braço horizontal.', 'Desconsidera massa do braço, aceleração, perdas e atrito.', 'O cálculo não comprova capacidade do servo ou encaixe físico.'],
  viewBox: [0, 0, 460, 220],
  parameters: [
    { id: 'mass', label: 'Carga', min: .05, max: 1, step: .05, value: .2, unit: 'kg' },
    { id: 'reach', label: 'Distância ao eixo', min: .05, max: .3, step: .01, value: .1, unit: 'm' },
  ], constants: { gravity: 9.81 }, calculations: [{ id: 'torque', op: 'product', inputs: ['mass', 'gravity', 'reach'] }],
  elements: [
    { id: 'joint', type: 'circle', cx: 70, cy: 100, r: 20, fill: '#25232c', stroke: '#bba2ed', strokeWidth: 2, nodeId: 'servo' },
    { id: 'arm', type: 'line', x1: 70, y1: 100, x2: 220, y2: 100, stroke: '#bba2ed', strokeWidth: 7 },
    { id: 'load', type: 'rect', x: 205, y: 76, width: 30, height: 48, rx: 4, fill: '#73658c', nodeId: 'test' },
    { id: 'force', type: 'path', d: 'M220 130 V170 M212 160 L220 170 L228 160', stroke: '#8ecfc2', strokeWidth: 2, fill: 'none' },
    { id: 'result', type: 'text', x: 60, y: 205, fontSize: 18, fill: '#e8e1f0', text: '0.196 N·m' },
    { id: 'axis-label', type: 'text', x: 42, y: 54, fontSize: 13, fill: '#b5aabc', text: 'eixo' },
  ],
  bindings: [
    { elementId: 'arm', attribute: 'x2', valueId: 'reach', multiplier: 1000, offset: 70, decimals: 0, suffix: '' },
    { elementId: 'load', attribute: 'x', valueId: 'reach', multiplier: 1000, offset: 55, decimals: 0, suffix: '' },
    { elementId: 'result', attribute: 'text', valueId: 'torque', multiplier: 1, offset: 0, decimals: 3, suffix: ' N·m' },
  ],
};
