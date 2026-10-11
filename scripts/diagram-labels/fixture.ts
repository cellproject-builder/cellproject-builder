import type { DiagramV1, DiagramElement } from '../../src/visuals/diagram/model';

/** Hand-written renderer capability fixture. This is not an AI response or wiring specification. */
export function diagramLabelsFixture(): DiagramV1 {
  const elements: DiagramElement[] = [];
  const text = (id: string, x: number, y: number, value: string, fontSize = 14, fill = 'currentColor') => elements.push({ id, type: 'text', x, y, text: value, fontSize, fill });
  const box = (id: string, x: number, y: number, width: number, height: number, stroke: string) => elements.push({ id, type: 'rect', x, y, width, height, rx: 5, fill: '#20232c', stroke, strokeWidth: 1.5 });
  const path = (id: string, d: string, stroke: string) => elements.push({ id, type: 'path', d, fill: 'none', stroke, strokeWidth: 1.5 });
  const joints = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'Garra'];

  // Paint illustrative routes first, so bodies and visible labels remain on top.
  for (let index = 0; index < 7; index++) {
    const y = 230 + index * 32;
    path(`wire-a-${index}`, `M${218 + index * 3} 136 C${196 - index * 4} 164 ${12 + index * 2} 168 ${12 + index * 2} ${y - 16} Q${12 + index * 2} ${y} 30 ${y}`, '#e8b96e');
    path(`wire-b-${index}`, `M${342 - index * 3} 136 C${364 + index * 4} 164 ${548 - index * 2} 168 ${548 - index * 2} ${y - 16} Q${548 - index * 2} ${y} 530 ${y}`, '#e8b96e');
  }
  path('logical-control', 'M158 105 L207 105', '#81d5df');
  path('power-relation', 'M402 105 L353 105', '#ee979f');
  path('capacitor-relation', 'M474 136 C474 148 450 146 450 156', '#ee979f');

  text('title', 18, 26, 'Controle funcional · dois braços', 20);
  text('subtitle', 18, 46, 'Estudo visual · conexões ilustrativas, conferir documentação', 11);
  box('esp32', 18, 70, 140, 66, '#81d5df');
  text('esp32-label', 30, 96, 'ESP32', 20); text('esp32-role', 30, 118, 'controle lógico', 13);
  box('pca9685', 207, 70, 146, 66, '#e8b96e');
  text('pca9685-label', 219, 96, 'PCA9685', 20); text('pca9685-role', 219, 118, '14 canais de exemplo', 12);
  box('source', 402, 70, 140, 66, '#ee979f');
  text('source-label', 414, 96, 'Fonte', 20); text('source-role', 414, 118, 'dimensionar', 13);
  text('control-label', 156, 61, 'I²C lógico', 11, '#81d5df');
  text('power-label', 356, 61, 'energia', 11, '#ee979f');
  elements.push({ id: 'capacitor', type: 'circle', cx: 450, cy: 170, r: 14, fill: '#20232c', stroke: '#ee979f', strokeWidth: 1.5 });
  text('capacitor-symbol', 445, 175, 'C', 14); text('capacitor-label', 470, 169, 'Capacitor', 16); text('capacitor-role', 470, 185, 'selecionar', 11);
  text('group-a', 30, 205, 'Braço A · juntas e garra', 14); text('group-b', 332, 205, 'Braço B · juntas e garra', 14);
  for (let index = 0; index < joints.length; index++) {
    const y = 218 + index * 32;
    box(`servo-a-${index}`, 30, y, 198, 27, '#e8b96e');
    text(`servo-a-${index}-label`, 38, y + 20, `Servo A-${joints[index]} · CH${index}`, 18);
    box(`servo-b-${index}`, 332, y, 198, 27, '#e8b96e');
    text(`servo-b-${index}-label`, 340, y + 20, `Servo B-${joints[index]} · CH${index + 7}`, 18);
  }
  text('legend-title', 18, 463, 'Legenda', 13);
  text('legend-control', 88, 463, 'ciano: controle', 12, '#81d5df');
  text('legend-pwm', 252, 463, 'âmbar: canais', 12, '#e8b96e');
  text('legend-energy', 405, 463, 'rosa: energia', 12, '#ee979f');
  text('limits', 18, 487, 'Cores/canais são exemplos; sem pinagem ou ratings de montagem.', 11);
  return {
    version: 1, title: 'Fixture manual · controle funcional de dois braços',
    explanation: 'Fixture escrita manualmente para verificar nomes, legenda e renderização. Não é resposta de IA, especificação elétrica ou circuito executável.',
    assumptions: ['Canais e cores são exemplos sintéticos; conexões representam relações funcionais.', 'Fonte, capacitor, interfaces e compatibilidade precisam ser dimensionados e conferidos na documentação.'],
    viewBox: [0, 0, 560, 500], parameters: [], constants: {}, calculations: [], bindings: [], elements,
  };
}
