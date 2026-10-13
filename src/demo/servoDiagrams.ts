import type { DiagramV1 } from '@/visuals/diagram/model';

/** Portable local data: the native React renderer owns controls and plan links. */
export function servoSignalDiagram(planId: string): DiagramV1 {
  const elements: DiagramV1['elements'] = [];
  const box = (id: string, x: number, y: number, title: string, detail: string, nodeId?: string) => {
    elements.push({ id, type: 'rect', x, y, width: 142, height: 83, rx: 8, fill: '#13242d', stroke: '#80daca', strokeWidth: 1, ...(nodeId ? { nodeId } : {}) },
      { id: `${id}-title`, type: 'text', x: x + 13, y: y + 32, text: title, fontSize: 15, fill: '#e8f3f2' },
      { id: `${id}-detail`, type: 'text', x: x + 13, y: y + 58, text: detail, fontSize: 11, fill: '#b3c8cf' });
  };
  box('command', 36, 95, 'Comando', 'Posição solicitada', `${planId}:step:3`);
  box('control', 321, 95, 'Controlador', 'Comparar e corrigir');
  box('motor', 538, 95, 'Motor + redução', 'Elétrico → mecânico', `${planId}:step:6`);
  box('feedback', 251, 233, 'Sensor de posição', 'A posição retorna');
  elements.push({ id: 'sum', type: 'circle', cx: 256, cy: 137, r: 20, fill: '#122932', stroke: '#80daca', strokeWidth: 2 },
    { id: 'sum-label', type: 'text', x: 250, y: 142, text: '+', fontSize: 18, fill: '#e8f3f2' },
    { id: 'output', type: 'circle', cx: 609, cy: 274, r: 42, fill: '#13242d', stroke: '#80daca', strokeWidth: 2 },
    { id: 'output-label', type: 'text', x: 582, y: 279, text: 'Saída', fontSize: 15, fill: '#e8f3f2' });
  ['M178 137H236', 'M276 137H321', 'M463 137H538', 'M609 178V232', 'M567 274H394', 'M256 233V157'].forEach((d, i) => elements.push({ id: `connection-${i}`, type: 'path', d, stroke: '#80daca', strokeWidth: 2, fill: 'none' }));
  elements.push({ id: 'heading', type: 'text', x: 36, y: 38, text: 'DA INTENÇÃO AO MOVIMENTO', fontSize: 20, fill: '#e8f3f2' },
    { id: 'scope', type: 'rect', x: 36, y: 356, width: 688, height: 145, rx: 8, fill: '#0b1920', stroke: '#426170', strokeWidth: 1 },
    { id: 'scope-title', type: 'text', x: 54, y: 382, text: 'PWM / EXEMPLO ILUSTRATIVO', fontSize: 13, fill: '#b3c8cf' },
    { id: 'scope-baseline', type: 'line', x1: 54, y1: 466, x2: 700, y2: 466, stroke: '#426170', strokeWidth: 1 },
    { id: 'pulse', type: 'rect', x: 54, y: 408, width: 45, height: 58, fill: '#80daca' },
    { id: 'pulse-value', type: 'text', x: 576, y: 382, text: '1.50 ms', fontSize: 17, fill: '#e8f3f2' },
    { id: 'period', type: 'text', x: 603, y: 489, text: '20 ms', fontSize: 13, fill: '#b3c8cf' });
  return { version: 1, title: 'Servo · sinal e malha de controle', explanation: 'Exemplo fictício para a decisão sobre comando e alimentação no robô. A largura de pulso representa uma posição solicitada; a posição real sob carga ainda precisa ser observada.',
    assumptions: ['Mapeamento hipotético: 1–2 ms para 0–180°, período ilustrativo de 20 ms. Calibrar no servo real.', 'Malha idealizada, sem atraso, erro ou corrente. O desenho não substitui um esquema de montagem.'],
    viewBox: [0, 0, 760, 540], parameters: [{ id: 'position', label: 'Posição solicitada', min: 0, max: 180, step: 1, value: 90, unit: '°' }],
    constants: { span: 180, base: 1 }, calculations: [{ id: 'fraction', op: 'quotient', inputs: ['position', 'span'] }, { id: 'pulse', op: 'sum', inputs: ['fraction', 'base'] }],
    elements, bindings: [{ elementId: 'pulse', attribute: 'width', valueId: 'pulse', multiplier: 30, offset: 0, decimals: 2, suffix: '' }, { elementId: 'pulse-value', attribute: 'text', valueId: 'pulse', multiplier: 1, offset: 0, decimals: 2, suffix: ' ms' }] };
}
