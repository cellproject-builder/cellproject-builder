import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readVisualMedia } from '@/visuals/media';
import { getCloudRuntime } from '@/cloud/runtime';
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type LoadedPdf = { mediaId: string; owner: ReturnType<typeof getCloudRuntime>; document: pdfjs.PDFDocumentProxy; disposed: boolean };
type PageRender = { source: LoadedPdf; cancelled: boolean; task?: ReturnType<pdfjs.PDFPageProxy['render']> };
function cancelRender(render: PageRender | null) {
  if (!render || render.cancelled) return;
  render.cancelled = true; render.task?.cancel();
}

/** One visible page, bounded raster size; no PDF scripts, links or remote fonts execute. */
export function AttachmentPdfPage({ mediaId, page = 1, width = 640, onPages, english = false }: {
  mediaId: string; page?: number; width?: number; english?: boolean; onPages?(count: number): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null), rendering = useRef<PageRender | null>(null);
  const owner = getCloudRuntime();
  const countCallback = useRef(onPages); countCallback.current = onPages;
  useEffect(() => {
    let disposed = false, task: ReturnType<typeof pdfjs.getDocument> | undefined, source: LoadedPdf | undefined;
    setLoaded(null); setLoading(true); setError(false);
    void (async () => {
      const blob = await readVisualMedia(mediaId); if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      if (!blob || blob.type !== 'application/pdf' || blob.size > 10 * 1024 * 1024) throw new Error('attachmentPdfMissing');
      const data = await blob.arrayBuffer(); if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
      const doc = await task.promise; if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      if (!Number.isInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > 100) throw new Error('visualPdfPageLimit');
      source = { mediaId, owner, document: doc, disposed: false };
      countCallback.current?.(doc.numPages);
      setLoaded(source);
    })().catch(() => { if (!disposed) { setError(true); setLoading(false); } });
    return () => {
      disposed = true;
      if (source) { source.disposed = true; if (rendering.current?.source === source) cancelRender(rendering.current); }
      if (task) void task.destroy().catch(() => {});
    };
  }, [mediaId, owner]);
  const source = loaded?.mediaId === mediaId && loaded.owner === owner && !loaded.disposed ? loaded : null;
  useEffect(() => {
    if (!source) return;
    const previous = rendering.current, current: PageRender = { source, cancelled: false };
    rendering.current = current;
    const live = () => !current.cancelled && !source.disposed && getCloudRuntime() === source.owner;
    setLoading(true); setError(false);
    void (async () => {
      // pdf.js must release its previous render before this canvas is reused.
      if (previous?.task) await previous.task.promise.catch(() => {});
      if (!live()) return;
      const doc = source.document;
      const pdfPage = await doc.getPage(Math.min(doc.numPages, Math.max(1, page))); if (!live() || !canvas.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      if (![natural.width, natural.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('attachmentPdfDimensions');
      const scale = Math.min(2, Math.max(140, Math.min(1400, width)) / natural.width,
        4096 / natural.width, 4096 / natural.height, Math.sqrt(4_000_000 / (natural.width * natural.height)));
      const viewport = pdfPage.getViewport({ scale });
      if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0 && value <= 4096)
        || Math.ceil(viewport.width) * Math.ceil(viewport.height) > 4_010_000) throw new Error('attachmentPdfDimensions');
      const element = canvas.current, context = element.getContext('2d'); if (!context) throw new Error('attachmentCanvasUnavailable');
      element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      current.task = pdfPage.render({ canvas: element, canvasContext: context, viewport });
      await current.task.promise; if (live()) setLoading(false);
    })().catch(() => { if (live()) { setError(true); setLoading(false); } });
    return () => { cancelRender(current); };
  }, [source, page, width]);
  return <div className="attachment-pdf-page" aria-busy={loading}>
    {loading && <span role="status">{english ? 'Loading page…' : 'Carregando página…'}</span>}
    {error ? <p role="alert">{english ? 'Could not open this PDF. Try downloading or importing it again.' : 'Não foi possível abrir este PDF. Tente baixar ou importar novamente.'}</p>
      : <canvas ref={canvas} hidden={loading || !source} aria-label={`${english ? 'PDF page' : 'Página do PDF'} ${page}`} />}
  </div>;
}
