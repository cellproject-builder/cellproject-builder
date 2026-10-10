interface CanvasItemSummary { id: string; kind: 'text' | 'image' | 'diagram'; label?: string; text?: string; title?: string }
export interface NoteCanvasSummary {
  strokeCount: number;
  itemCount: number;
  imageCount: number;
  textCount: number;
  diagramCount: number;
  items?: CanvasItemSummary[];
  omittedItems?: number;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Deliberate text context only. Raster data, drawing points, diagram internals and code stay out. */
export function summarizeNoteCanvas(value: unknown, detailed = false): NoteCanvasSummary | undefined {
  if (!record(value)) return undefined;
  const items = Array.isArray(value.items) ? value.items.filter(record) : [];
  const summary: NoteCanvasSummary = {
    strokeCount: Array.isArray(value.strokes) ? value.strokes.length : 0,
    itemCount: items.length,
    imageCount: items.filter(item => item.kind === 'image').length,
    textCount: items.filter(item => item.kind === 'text').length,
    diagramCount: items.filter(item => item.kind === 'diagram').length,
  };
  if (!detailed) return summary;
  let remaining = 4000;
  const excerpt = (text: unknown) => {
    if (typeof text !== 'string' || !remaining) return undefined;
    const result = text.slice(0, Math.min(500, remaining)); remaining -= result.length;
    return result || undefined;
  };
  summary.items = [];
  for (const item of items) {
    if (summary.items.length >= 30) break;
    if (item.kind !== 'text' && item.kind !== 'image' && item.kind !== 'diagram') continue;
    const detail: CanvasItemSummary = { id: typeof item.id === 'string' ? item.id.slice(0, 100) : '', kind: item.kind };
    if (item.kind === 'text') detail.text = excerpt(item.text);
    if (item.kind === 'image') detail.label = excerpt(item.label);
    if (item.kind === 'diagram') detail.title = excerpt(record(item.diagram) ? item.diagram.title : undefined);
    summary.items.push(Object.fromEntries(Object.entries(detail).filter(([, content]) => content !== undefined)) as unknown as CanvasItemSummary);
  }
  summary.omittedItems = items.length - summary.items.length;
  return summary;
}
