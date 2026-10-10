import { expect, it } from 'vitest';
import { parseDiagram, evaluateDiagram, resolveDiagramElements } from './model';
import { torqueDiagram } from './fixture';

it('uses opaque real plan IDs and updates torque, reach, load and force together', () => {
  const diagram = parseDiagram(torqueDiagram('9_A-bZ', '-T_est'), ['9_A-bZ', '-T_est']);
  expect(evaluateDiagram(diagram, {}).torque).toBeCloseTo(.1962);
  const elements = resolveDiagramElements(diagram, { reach: .2, mass: .4 });
  expect(elements.find(e => e.id === 'arm')?.x2).toBe(270);
  expect(elements.find(e => e.id === 'load')?.x).toBe(255);
  expect(elements.find(e => e.id === 'force')?.x1).toBe(270);
  expect(elements.find(e => e.id === 'result')?.text).toBe('0.785 N·m');
  expect(() => parseDiagram(diagram, ['9_A-bZ'])).toThrow('diagramUnknownNode');
});
it('accepts a static relation map without artificial sliders', () => {
  const diagram = torqueDiagram(); diagram.parameters = []; diagram.calculations = []; diagram.bindings = [];
  expect(parseDiagram(diagram).parameters).toEqual([]);
});
it.each([
  ['required geometry', (d: any) => { delete d.elements.find((e: any) => e.type === 'rect').width; }],
  ['incompatible binding', (d: any) => { d.bindings[0].attribute = 'r'; }],
  ['negative radius at a control extreme', (d: any) => { d.bindings.push({ ...d.bindings[0], elementId: 'joint', attribute: 'r', valueId: 'mass', multiplier: -100, offset: 50 }); }],
  ['geometry outside its viewport', (d: any) => { d.bindings[0].multiplier = 10000; }],
  ['division crossing zero', (d: any) => { d.parameters[0].min = -1; d.calculations[0] = { id: 'torque', op: 'quotient', inputs: ['gravity', 'mass'] }; }],
  ['cyclic arithmetic', (d: any) => { d.calculations[0].inputs = ['torque', 'mass']; }],
  ['duplicate binding', (d: any) => { d.bindings.push(d.bindings[0]); }],
  ['nonfinite SVG path', (d: any) => { d.elements.push({ id: 'bad', type: 'path', d: 'M 1e999 0 L 1 1' }); }],
  ['missing path coordinates', (d: any) => { d.elements.push({ id: 'bad', type: 'path', d: 'M0 0 C10 10' }); }],
  ['executable attribute', (d: any) => { d.elements[0].onClick = 'fetch("https://evil.invalid")'; }],
] as const)('rejects %s before rendering', (_label, change) => {
  const diagram = torqueDiagram(); change(diagram); expect(() => parseDiagram(diagram)).toThrow();
});
