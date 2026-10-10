import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/).refine(v => !['constructor', 'prototype', '__proto__'].includes(v));
const number = z.number().finite().min(-10000).max(10000);
const color = z.string().regex(/^(none|currentColor|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?)$/);
const parameter = z.object({ id, label: z.string().min(1).max(80), min: number, max: number, step: z.number().finite().positive().max(100), value: number, unit: z.string().max(16) }).strict();
const element = z.object({
  id, type: z.enum(['rect', 'circle', 'line', 'path', 'polyline', 'text']),
  x: number.optional(), y: number.optional(), x1: number.optional(), y1: number.optional(), x2: number.optional(), y2: number.optional(),
  cx: number.optional(), cy: number.optional(), r: z.number().finite().min(0).max(1000).optional(),
  width: z.number().finite().min(0).max(2000).optional(), height: z.number().finite().min(0).max(2000).optional(), rx: z.number().finite().min(0).max(100).optional(),
  d: z.string().max(4000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.eE+ ,\-]*$/).optional(),
  points: z.string().max(2000).regex(/^[0-9.eE+ ,\-]*$/).optional(), text: z.string().max(240).optional(),
  fill: color.optional(), stroke: color.optional(), strokeWidth: z.number().finite().min(0).max(12).optional(), fontSize: z.number().finite().min(8).max(48).optional(),
  // Plan IDs are opaque nanoids, not the restricted internal arithmetic IDs.
  nodeId: z.string().min(1).max(200).nullable().optional(),
}).strict();
const rawDiagramSchema = z.object({
  version: z.literal(1), title: z.string().min(1).max(120), explanation: z.string().max(1200), assumptions: z.array(z.string().max(400)).min(1).max(8),
  viewBox: z.tuple([z.literal(0), z.literal(0), z.number().min(100).max(1200), z.number().min(100).max(800)]),
  parameters: z.array(parameter).max(6), constants: z.record(id, number),
  calculations: z.array(z.object({ id, op: z.enum(['product', 'sum', 'difference', 'quotient']), inputs: z.array(id).min(2).max(8) }).strict()).max(16),
  elements: z.array(element).min(1).max(100),
  bindings: z.array(z.object({ elementId: id, attribute: z.enum(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'text']), valueId: id, multiplier: number, offset: number, decimals: z.number().int().min(0).max(4), suffix: z.string().max(24) }).strict()).max(60),
}).strict();
export type DiagramV1 = z.infer<typeof rawDiagramSchema>;
export type DiagramElement = DiagramV1['elements'][number];
type Interval = [number, number];
const required = { rect: ['x', 'y', 'width', 'height'], circle: ['cx', 'cy', 'r'], line: ['x1', 'y1', 'x2', 'y2'], path: ['d'], polyline: ['points'], text: ['x', 'y', 'text'] } as const;

function arithmetic(op: DiagramV1['calculations'][number]['op'], inputs: Interval[]): Interval {
  let result: Interval;
  if (op === 'sum') result = inputs.reduce<Interval>((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
  else if (op === 'difference') result = [inputs[0][0] - inputs[1][1], inputs[0][1] - inputs[1][0]];
  else if (op === 'quotient') {
    if (inputs[1][0] <= 0 && inputs[1][1] >= 0) throw new Error('diagramInvalidArithmetic');
    const candidates = inputs[0].flatMap(a => inputs[1].map(b => a / b)); result = [Math.min(...candidates), Math.max(...candidates)];
  } else result = inputs.reduce<Interval>((a, b) => { const v = a.flatMap(x => b.map(y => x * y)); return [Math.min(...v), Math.max(...v)]; }, [1, 1]);
  if (result.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error('diagramInvalidArithmetic');
  return result;
}
function valueIntervals(diagram: DiagramV1, overrides?: Record<string, number>) {
  const values: Record<string, Interval> = Object.create(null);
  for (const [key, value] of Object.entries(diagram.constants)) values[key] = [value, value];
  for (const p of diagram.parameters) {
    if (!overrides) values[p.id] = [p.min, p.max];
    else {
      const supplied = Object.hasOwn(overrides, p.id) ? overrides[p.id] : p.value;
      if (!Number.isFinite(supplied)) throw new Error('diagramInvalidParameter');
      const value = Math.max(p.min, Math.min(p.max, supplied)); values[p.id] = [value, value];
    }
  }
  for (const c of diagram.calculations) {
    if (c.inputs.some(input => !Object.hasOwn(values, input)) || (['difference', 'quotient'].includes(c.op) && c.inputs.length !== 2)) throw new Error('diagramUnknownCalculation');
    values[c.id] = arithmetic(c.op, c.inputs.map(input => values[input]));
  }
  return values;
}
function bindingRange(binding: DiagramV1['bindings'][number], values: Record<string, Interval>): Interval {
  const result = values[binding.valueId].map(v => v * binding.multiplier + binding.offset);
  if (result.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error('diagramInvalidBinding');
  return [Math.min(...result), Math.max(...result)];
}
function validatePath(path: string) {
  const tokens = path.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (!/^[Mm]/.test(tokens[0] ?? '') || path.replace(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?|[\s,]/g, '')) throw new Error('diagramInvalidPath');
  const arities: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++].toLowerCase(), count = arities[command]; const numbers: number[] = [];
    while (index < tokens.length && !/^[a-z]$/i.test(tokens[index])) numbers.push(Number(tokens[index++]));
    if (count === undefined || (count === 0 ? numbers.length !== 0 : !numbers.length || numbers.length % count !== 0) || numbers.some(v => !Number.isFinite(v) || Math.abs(v) > 10000)) throw new Error('diagramInvalidPath');
    if (command === 'a') for (let i = 0; i < numbers.length; i += 7) if (numbers[i] < 0 || numbers[i + 1] < 0 || ![0, 1].includes(numbers[i + 3]) || ![0, 1].includes(numbers[i + 4])) throw new Error('diagramInvalidPath');
  }
}
function validateDiagram(diagram: DiagramV1) {
  const ids = [...diagram.parameters.map(p => p.id), ...Object.keys(diagram.constants), ...diagram.calculations.map(c => c.id)];
  if (new Set(ids).size !== ids.length || Object.keys(diagram.constants).length > 16 || new Set(diagram.elements.map(e => e.id)).size !== diagram.elements.length) throw new Error('diagramDuplicateId');
  for (const p of diagram.parameters) if (p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min) throw new Error('diagramInvalidParameter');
  const values = valueIntervals(diagram), bindings = new Set<string>();
  for (const binding of diagram.bindings) {
    const target = diagram.elements.find(e => e.id === binding.elementId);
    if (!target || !Object.hasOwn(values, binding.valueId) || !(required[target.type] as readonly string[]).includes(binding.attribute) || ['d', 'points'].includes(binding.attribute)) throw new Error('diagramInvalidBinding');
    const key = `${binding.elementId}:${binding.attribute}`; if (bindings.has(key)) throw new Error('diagramDuplicateBinding'); bindings.add(key);
  }
  for (const e of diagram.elements) {
    if (required[e.type].some(attribute => e[attribute as keyof DiagramElement] === undefined)) throw new Error('diagramMissingGeometry');
    if (e.type === 'path') validatePath(e.d!);
    if (e.type === 'polyline') {
      const nums = e.points!.trim().split(/[\s,]+/).map(Number);
      if (nums.length < 4 || nums.length % 2 || nums.some(v => !Number.isFinite(v) || Math.abs(v) > 10000)) throw new Error('diagramInvalidPath');
    }
    const range = (attribute: string): Interval => {
      const binding = diagram.bindings.find(b => b.elementId === e.id && b.attribute === attribute);
      const value = e[attribute as keyof DiagramElement] as number;
      return binding ? bindingRange(binding, values) : [value, value];
    };
    for (const attribute of required[e.type]) {
      if (['text', 'd', 'points'].includes(attribute)) continue;
      const [min, max] = range(attribute);
      const limit = ['y', 'y1', 'y2', 'cy', 'height'].includes(attribute) ? diagram.viewBox[3] : diagram.viewBox[2];
      if (min < 0 || max > limit) throw new Error('diagramBounds');
    }
    if (e.type === 'rect' && (range('x')[1] + range('width')[1] > diagram.viewBox[2] || range('y')[1] + range('height')[1] > diagram.viewBox[3])) throw new Error('diagramBounds');
    if (e.type === 'circle' && (range('cx')[0] - range('r')[1] < 0 || range('cy')[0] - range('r')[1] < 0 || range('cx')[1] + range('r')[1] > diagram.viewBox[2] || range('cy')[1] + range('r')[1] > diagram.viewBox[3])) throw new Error('diagramBounds');
  }
  valueIntervals(diagram, {});
}
export const diagramSchema = rawDiagramSchema.superRefine((diagram, ctx) => { try { validateDiagram(diagram); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'diagramInvalid' }); } });
// Homogeneous arrays avoid the tuple transport rejected in the laboratory. Local parsing enforces exact bounds.
export const generationDiagramSchema = rawDiagramSchema.extend({ viewBox: z.array(z.number()).length(4) });
export function parseDiagram(raw: unknown, allowedNodes?: string[]): DiagramV1 {
  const diagram = diagramSchema.parse(raw);
  if (allowedNodes && diagram.elements.some(e => e.nodeId && !allowedNodes.includes(e.nodeId))) throw new Error('diagramUnknownNode');
  return diagram;
}
export function evaluateDiagram(diagram: DiagramV1, overrides: Record<string, number>) {
  return Object.fromEntries(Object.entries(valueIntervals(diagram, overrides)).map(([id, value]) => [id, value[0]]));
}
export function resolveDiagramElements(diagram: DiagramV1, overrides: Record<string, number>): DiagramElement[] {
  const values = valueIntervals(diagram, overrides);
  return diagram.elements.map(element => {
    const next = { ...element };
    for (const binding of diagram.bindings.filter(b => b.elementId === element.id)) {
      const value = bindingRange(binding, values)[0];
      Object.assign(next, { [binding.attribute]: binding.attribute === 'text' ? `${value.toFixed(binding.decimals)}${binding.suffix}` : Number(value.toFixed(binding.decimals)) });
    }
    return next;
  });
}
