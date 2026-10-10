import type { DiagramV1 } from './model';
/** Synthetic golden fixture for software tests; no servo rating or physical observation. */
export function torqueDiagram(servoId = 'servo', testId = 'test'): DiagramV1 {
  return {
    version: 1, title: 'Carga e distância ao eixo', explanation: 'Torque estático idealizado: τ = m × g × r. Valores sintéticos; não estima a capacidade de um servo.',
    assumptions: ['Carga pontual e braço horizontal; valores sintéticos.', 'Sem massa do braço, aceleração, perdas ou atrito.', 'Explorar parâmetros não comprova compatibilidade nem substitui um ensaio.'],
    viewBox: [0, 0, 460, 220], parameters: [
      { id: 'mass', label: 'Carga', min: .05, max: 1, step: .05, value: .2, unit: 'kg' },
      { id: 'reach', label: 'Distância ao eixo', min: .05, max: .3, step: .01, value: .1, unit: 'm' },
    ], constants: { gravity: 9.81 }, calculations: [{ id: 'torque', op: 'product', inputs: ['mass', 'gravity', 'reach'] }],
    elements: [
      { id: 'joint', type: 'circle', cx: 70, cy: 100, r: 20, fill: '#25232c', stroke: '#bba2ed', strokeWidth: 2, nodeId: servoId },
      { id: 'arm', type: 'line', x1: 70, y1: 100, x2: 170, y2: 100, stroke: '#bba2ed', strokeWidth: 7 },
      { id: 'load', type: 'rect', x: 155, y: 76, width: 30, height: 48, rx: 4, fill: '#73658c', nodeId: testId },
      { id: 'force', type: 'line', x1: 170, y1: 132, x2: 170, y2: 170, stroke: '#8ecfc2', strokeWidth: 2 },
      { id: 'arrow-left', type: 'line', x1: 162, y1: 162, x2: 170, y2: 170, stroke: '#8ecfc2', strokeWidth: 2 },
      { id: 'arrow-right', type: 'line', x1: 178, y1: 162, x2: 170, y2: 170, stroke: '#8ecfc2', strokeWidth: 2 },
      { id: 'result', type: 'text', x: 60, y: 205, fontSize: 18, fill: '#e8e1f0', text: '0.196 N·m' },
      { id: 'axis-label', type: 'text', x: 42, y: 54, fontSize: 13, fill: '#b5aabc', text: 'eixo' },
    ], bindings: [
      ...[['arm', 'x2', 70], ['load', 'x', 55], ['force', 'x1', 70], ['force', 'x2', 70], ['arrow-left', 'x1', 62], ['arrow-left', 'x2', 70], ['arrow-right', 'x1', 78], ['arrow-right', 'x2', 70]].map(([elementId, attribute, offset]) => ({ elementId: elementId as string, attribute: attribute as 'x' | 'x1' | 'x2', valueId: 'reach', multiplier: 1000, offset: offset as number, decimals: 0, suffix: '' })),
      { elementId: 'result', attribute: 'text', valueId: 'torque', multiplier: 1, offset: 0, decimals: 3, suffix: ' N·m' },
    ],
  };
}
