import { parsePaint } from './contrast';
import { parseDiagram, resolveDiagramElements, type DiagramV1 } from './model';

export class DiagramLabelsMissingError extends Error {
  constructor() { super('diagramLabelsMissing'); this.name = 'DiagramLabelsMissingError'; }
}

/** A generation-only floor, not a semantic or layout certification. Legacy
 * documents remain readable, and labels are never guessed from internal IDs. */
export function parseGeneratedDiagram(raw: unknown, allowedNodes?: string[]): DiagramV1 {
  const diagram = parseDiagram(raw, allowedNodes);
  const hasLabel = resolveDiagramElements(diagram, {}).some(element => {
    if (element.type !== 'text' || !/[\p{L}\p{N}]/u.test(element.text ?? '')) return false;
    // Text uses SVG's default start anchor and alphabetic baseline in v1.
    if (element.x! >= diagram.viewBox[2] || element.y! <= 0) return false;
    const fill = parsePaint(element.fill ?? 'currentColor', [255, 255, 255]);
    const stroke = element.stroke && (element.strokeWidth ?? 1) > 0 ? parsePaint(element.stroke, [255, 255, 255]) : null;
    return (fill?.alpha ?? 0) > 0 || (stroke?.alpha ?? 0) > 0;
  });
  if (!hasLabel) throw new DiagramLabelsMissingError();
  return diagram;
}
