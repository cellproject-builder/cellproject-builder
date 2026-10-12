import type { Project } from '@/types';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { parseDiagram, type DiagramV1 } from '@/visuals/diagram/model';
import { normalizeVisualWorkspace } from '@/visuals/normalize';
import type { VisualArtifact, VisualWorkspace } from '@/visuals/types';

export type DemoDiagramKey = 'robot' | 'garden' | 'workshop';

function gardenDiagram(planId: string): DiagramV1 {
  return {
    version: 1, title: 'Volume de rega · exemplo fictício',
    explanation: 'Modelo ilustrativo: volume = vazão × tempo. Os valores são sintéticos; a saída não mede consumo nem dimensiona uma bomba ou instalação real.',
    assumptions: [
      'A vazão permanece constante durante todo o intervalo ilustrado.',
      'Não considera perdas, pressão, distribuição entre vasos ou necessidade das plantas.',
      'O desenho ajuda a formular uma pergunta; qualquer decisão de rega exige observações e condições reais.',
    ],
    viewBox: [0, 0, 520, 240],
    parameters: [
      { id: 'flow', label: 'Vazão ilustrativa', min: .2, max: 3, step: .1, value: 1, unit: 'L/min' },
      { id: 'duration', label: 'Tempo de rega', min: 1, max: 10, step: 1, value: 5, unit: 'min' },
    ],
    constants: {}, calculations: [{ id: 'volume', op: 'product', inputs: ['flow', 'duration'] }],
    elements: [
      { id: 'heading', type: 'text', x: 25, y: 25, text: 'VAZÃO × TEMPO', fontSize: 17, fill: '#dcfce7' },
      { id: 'source', type: 'rect', x: 30, y: 60, width: 100, height: 130, rx: 8, fill: 'none', stroke: '#86efac', strokeWidth: 3, nodeId: `${planId}:step:4` },
      { id: 'source-water', type: 'rect', x: 40, y: 80, width: 80, height: 100, rx: 3, fill: '#67e8f9' },
      { id: 'pipe', type: 'line', x1: 130, y1: 135, x2: 310, y2: 135, stroke: '#86efac', strokeWidth: 6 },
      { id: 'arrow-top', type: 'line', x1: 300, y1: 125, x2: 310, y2: 135, stroke: '#86efac', strokeWidth: 3 },
      { id: 'arrow-bottom', type: 'line', x1: 300, y1: 145, x2: 310, y2: 135, stroke: '#86efac', strokeWidth: 3 },
      { id: 'container', type: 'rect', x: 330, y: 70, width: 160, height: 120, rx: 8, fill: 'none', stroke: '#86efac', strokeWidth: 3, nodeId: `${planId}:step:7` },
      { id: 'volume-bar', type: 'rect', x: 343, y: 88, width: 134, height: 14, rx: 3, fill: '#67e8f9', nodeId: `${planId}:step:7` },
      { id: 'source-label', type: 'text', x: 28, y: 216, text: 'Reservatório ilustrativo', fontSize: 12, fill: '#dcfce7' },
      { id: 'result', type: 'text', x: 317, y: 220, text: '5.0 L no exemplo', fontSize: 17, fill: '#dcfce7' },
      { id: 'container-label', type: 'text', x: 334, y: 55, text: 'Volume previsto', fontSize: 13, fill: '#dcfce7' },
    ],
    bindings: [
      { elementId: 'volume-bar', attribute: 'height', valueId: 'volume', multiplier: 2.7, offset: 0, decimals: 1, suffix: '' },
      { elementId: 'result', attribute: 'text', valueId: 'volume', multiplier: 1, offset: 0, decimals: 1, suffix: ' L no exemplo' },
    ],
  };
}

function workshopDiagram(planId: string): DiagramV1 {
  return {
    version: 1, title: 'Tempo para investigar · exemplo fictício',
    explanation: 'Cronograma sintético: o tempo total soma previsão, protótipo e revisão. Varie cada etapa para explorar o espaço reservado à revisão da ideia; nenhuma duração foi observada em participantes reais.',
    assumptions: [
      'As três etapas acontecem em sequência, sem sobreposição.',
      'Não inclui chegada, instruções, pausas, apresentação ou necessidades individuais.',
      'Durações inventadas demonstram o planejamento; não comprovam eficácia nem adequação de uma oficina real.',
    ],
    viewBox: [0, 0, 520, 240],
    parameters: [
      { id: 'prediction', label: 'Previsão', min: 5, max: 15, step: 1, value: 10, unit: 'min' },
      { id: 'build', label: 'Protótipo', min: 5, max: 30, step: 1, value: 10, unit: 'min' },
      { id: 'revision', label: 'Revisão', min: 5, max: 20, step: 1, value: 10, unit: 'min' },
    ],
    constants: {}, calculations: [
      { id: 'revision-start', op: 'sum', inputs: ['prediction', 'build'] },
      { id: 'total', op: 'sum', inputs: ['prediction', 'build', 'revision'] },
    ],
    elements: [
      { id: 'heading', type: 'text', x: 24, y: 27, text: 'ETAPAS DE INVESTIGAÇÃO', fontSize: 17, fill: '#fef3c7' },
      { id: 'timeline', type: 'line', x1: 24, y1: 118, x2: 349, y2: 118, stroke: '#b5aabc', strokeWidth: 2 },
      { id: 'prediction-block', type: 'rect', x: 24, y: 68, width: 50, height: 44, rx: 3, fill: '#c4b5fd', nodeId: `${planId}:step:3` },
      { id: 'prototype-block', type: 'rect', x: 74, y: 68, width: 50, height: 44, rx: 3, fill: '#67e8f9', nodeId: `${planId}:step:8` },
      { id: 'revision-block', type: 'rect', x: 124, y: 68, width: 50, height: 44, rx: 3, fill: '#fcd34d', nodeId: `${planId}:step:9` },
      { id: 'prediction-key', type: 'circle', cx: 30, cy: 150, r: 6, fill: '#c4b5fd' },
      { id: 'prediction-label', type: 'text', x: 44, y: 155, text: 'Previsão', fontSize: 14, fill: '#fef3c7' },
      { id: 'prototype-key', type: 'circle', cx: 170, cy: 150, r: 6, fill: '#67e8f9' },
      { id: 'prototype-label', type: 'text', x: 184, y: 155, text: 'Protótipo', fontSize: 14, fill: '#fef3c7' },
      { id: 'revision-key', type: 'circle', cx: 310, cy: 150, r: 6, fill: '#fcd34d' },
      { id: 'revision-label', type: 'text', x: 324, y: 155, text: 'Revisão', fontSize: 14, fill: '#fef3c7' },
      { id: 'result', type: 'text', x: 24, y: 211, text: '30 min no exemplo', fontSize: 22, fill: '#fef3c7' },
    ],
    bindings: [
      { elementId: 'prediction-block', attribute: 'width', valueId: 'prediction', multiplier: 5, offset: 0, decimals: 0, suffix: '' },
      { elementId: 'prototype-block', attribute: 'x', valueId: 'prediction', multiplier: 5, offset: 24, decimals: 0, suffix: '' },
      { elementId: 'prototype-block', attribute: 'width', valueId: 'build', multiplier: 5, offset: 0, decimals: 0, suffix: '' },
      { elementId: 'revision-block', attribute: 'x', valueId: 'revision-start', multiplier: 5, offset: 24, decimals: 0, suffix: '' },
      { elementId: 'revision-block', attribute: 'width', valueId: 'revision', multiplier: 5, offset: 0, decimals: 0, suffix: '' },
      { elementId: 'result', attribute: 'text', valueId: 'total', multiplier: 1, offset: 0, decimals: 0, suffix: ' min no exemplo' },
    ],
  };
}

/** Local declarative examples use the same validated React/SVG artifacts as the planner. */
export function demoVisualWorkspace(key: DemoDiagramKey, project: Project, now: number): VisualWorkspace {
  const raw = key === 'robot'
    ? { ...torqueDiagram(`${project.id}:step:4`, `${project.id}:step:8`), title: 'Torque do braço · exemplo fictício' }
    : key === 'garden' ? gardenDiagram(project.id) : workshopDiagram(project.id);
  const diagram = parseDiagram(raw, Object.keys(project.nodes));
  const root = project.nodes[project.rootId].position;
  const width = 520, height = 360;
  const artifact: VisualArtifact = {
    id: `${project.id}:diagram`, label: diagram.title, kind: 'diagram',
    linkedNodeId: `${project.id}:step:${key === 'workshop' ? 1 : 4}`,
    // The demo's saved manual layout reserves this band under the root, inside the concept bounds.
    x: root.x + (300 - width) / 2, y: root.y + 220, width, height,
    diagram, diagramValues: {}, scene: null, mediaId: null, source: null,
    revisions: [{ scene: null, mediaId: null, createdAt: now, diagram, diagramValues: {} }], revisionIndex: 0,
  };
  return normalizeVisualWorkspace({
    version: 1, mode: 'approval', artifacts: [artifact], proposals: [],
    drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [], artifactKind: 'diagram' } },
  });
}
