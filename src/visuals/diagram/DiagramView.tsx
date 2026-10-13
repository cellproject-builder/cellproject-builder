import { createElement, useMemo, useRef, type ReactNode } from 'react';
import { diagramSchema, resolveDiagramElements, type DiagramV1 } from './model';
import { readableDiagramElements } from './contrast';
import { useDiagramPalette } from './useDiagramPalette';
import './diagram.css';

const attrs = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'rx', 'd', 'points', 'fill', 'stroke', 'strokeWidth', 'fontSize'] as const;
/** React builds only allowlisted SVG elements/attributes; no generated markup or code enters the DOM. */
export function DiagramView({ diagram, values = {}, nodeNames = {}, onParameter, onSelectNode, english = false, illustration }: {
  diagram: DiagramV1; values?: Record<string, number>; nodeNames?: Record<string, string>; onParameter?: (id: string, value: number) => void; onSelectNode?: (id: string) => void; english?: boolean; illustration?: ReactNode;
}) {
  const parsed = useMemo(() => diagramSchema.safeParse(diagram), [diagram]);
  const host = useRef<HTMLDivElement>(null);
  const palette = useDiagramPalette(host, parsed.success);
  if (!parsed.success) return <span role="alert">{english ? 'Invalid diagram' : 'Diagrama inválido'}</span>;
  const valid = parsed.data;
  let elements;
  try { elements = readableDiagramElements(resolveDiagramElements(valid, values), palette); } catch { return <span role="alert">{english ? 'Invalid diagram parameters' : 'Parâmetros do diagrama inválidos'}</span>; }
  return <div className="visual-diagram" ref={host}>
    {illustration ?? <svg viewBox={valid.viewBox.join(' ')} preserveAspectRatio="xMidYMid meet" role="group" aria-label={valid.title} style={{ overflow: 'hidden' }}>
      <title>{valid.title}</title>
      {elements.map(e => {
        const nodeId = e.nodeId && Object.hasOwn(nodeNames, e.nodeId) ? e.nodeId : null;
        const properties = Object.fromEntries(attrs.filter(attribute => e[attribute] !== undefined).map(attribute => [attribute, e[attribute]]));
        return createElement(e.type, { ...properties, key: e.id, 'data-element-id': e.id, ...(nodeId && onSelectNode ? {
          className: 'visual-diagram-node nodrag nopan nowheel', role: 'button', tabIndex: 0, 'aria-label': `${english ? 'Open node' : 'Abrir nó'}: ${nodeNames[nodeId]}`,
          onPointerDown: (event: React.PointerEvent) => event.stopPropagation(), onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
          onClick: (event: React.MouseEvent) => { event.stopPropagation(); onSelectNode(nodeId); },
          onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelectNode(nodeId); } },
        } : {}) }, e.type === 'text' ? e.text : undefined);
      })}
    </svg>}
    <div className="visual-diagram-controls nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      {illustration && onSelectNode && [...new Set(valid.elements.flatMap(element => element.nodeId && Object.hasOwn(nodeNames, element.nodeId) ? [element.nodeId] : []))].map(nodeId => <button type="button" className="visual-diagram-stage-link" key={nodeId} onClick={() => onSelectNode(nodeId)}>{english ? 'View step' : 'Ver etapa'}: {nodeNames[nodeId]} ↗</button>)}
      {valid.parameters.map(p => <label key={p.id}><span>{p.label}<output>{values[p.id] ?? p.value} {p.unit}</output></span><input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={values[p.id] ?? p.value} disabled={!onParameter}
        onChange={event => onParameter?.(p.id, Number(event.target.value))}/></label>)}
      <details><summary>{english ? 'Assumptions and limits' : 'Premissas e limites'}</summary><p>{valid.explanation}</p><ul>{valid.assumptions.map((text, index) => <li key={index}>{text}</li>)}</ul></details>
    </div>
  </div>;
}
