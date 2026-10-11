import type { BoardDocument } from './model';

export interface BoardTextSummary {
  itemCount: number;
  connectionCount: number;
  imageCount: number;
  modelCount: number;
  diagramCount: number;
  drawingCount: number;
  items?: Array<{ id: string; kind: string; text?: string; label?: string; title?: string; explanation?: string; objectCount?: number }>;
  omittedItems?: number;
}

/** Deliberate prose only. Never send raster data, geometry, SVG paths, attachments or ink points to the model. */
export function summarizeBoard(document: BoardDocument, detailed = false): BoardTextSummary {
  const summary: BoardTextSummary = { itemCount: document.items.length, connectionCount: document.edges.length,
    imageCount: document.items.filter(item => item.kind === 'image').length,
    modelCount: document.items.filter(item => item.kind === 'model').length,
    diagramCount: document.items.filter(item => item.kind === 'diagram').length,
    drawingCount: document.items.filter(item => item.kind === 'drawing').length };
  if (!detailed) return summary;
  let remaining = 4000;
  const excerpt = (value: string) => { const text = value.slice(0, Math.min(500, remaining)); remaining -= text.length; return text; };
  summary.items = [];
  for (const item of document.items) {
    if (summary.items.length >= 30 || remaining <= 0) break;
    const detail: NonNullable<BoardTextSummary['items']>[number] = { id: item.id, kind: item.kind };
    if (item.kind === 'text' || item.kind === 'card') detail.text = excerpt(item.text);
    if (item.kind === 'image') detail.label = excerpt(item.label);
    if (item.kind === 'diagram') { detail.title = excerpt(item.diagram.title); detail.explanation = excerpt(item.diagram.explanation); }
    if (item.kind === 'model') { detail.label = excerpt(item.scene.label); detail.objectCount = item.scene.objects.length; }
    summary.items.push(detail);
  }
  summary.omittedItems = document.items.length - summary.items.length;
  return summary;
}
