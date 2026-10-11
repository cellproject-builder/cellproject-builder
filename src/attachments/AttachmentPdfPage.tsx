import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readVisualMedia } from '@/visuals/media';
import { getCloudRuntime } from '@/cloud/runtime';
import { acquirePdfThumbnailSlot } from './pdfThumbnailQueue';
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type LoadedPdf = {
  mediaId: string; owner: ReturnType<typeof getCloudRuntime>; document: pdfjs.PDFDocumentProxy;
  disposed: boolean; released: boolean; releaseAfterRender?: () => Promise<void>;
};
type PageRender = {
  source: LoadedPdf; cancelled: boolean; settled: boolean;
  task?: ReturnType<pdfjs.PDFPageProxy['render']>; done?: Promise<void>;
};
function cancelRender(render: PageRender | null) {
  if (!render || render.cancelled) return;
  render.cancelled = true; if (!render.settled) render.task?.cancel();
}
function clearCanvas(element: HTMLCanvasElement | null) {
  if (element) { element.width = 0; element.height = 0; }
}

/** One visible page, bounded raster size; no PDF scripts, links or remote fonts execute. */
export function AttachmentPdfPage({ mediaId, page = 1, width = 640, onPages, english = false, thumbnail = false }: {
  mediaId: string; page?: number; width?: number; english?: boolean; thumbnail?: boolean; onPages?(count: number): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null), rendering = useRef<PageRender | null>(null);
  const owner = getCloudRuntime();
  const countCallback = useRef(onPages); countCallback.current = onPages;
  useEffect(() => {
    let disposed = false, task: ReturnType<typeof pdfjs.getDocument> | undefined, source: LoadedPdf | undefined;
    const controller = new AbortController();
    let destruction: Promise<void> | undefined, releaseSlot: (() => void) | undefined;
    const release = () => { releaseSlot?.(); releaseSlot = undefined; };
    const destroy = () => {
      if (destruction) return destruction;
      if (!task) { release(); return Promise.resolve(); }
      return destruction = task.destroy().catch(() => {}).finally(release);
    };
    setLoaded(null); setLoading(true); setError(false);
    void (async () => {
      if (thumbnail) {
        releaseSlot = await acquirePdfThumbnailSlot(controller.signal);
        if (disposed) { await destroy(); return; }
      }
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      const blob = await readVisualMedia(mediaId); if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      if (!blob || blob.type !== 'application/pdf' || blob.size > 10 * 1024 * 1024) throw new Error('attachmentPdfMissing');
      const data = await blob.arrayBuffer(); if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
      const doc = await task.promise; if (disposed) return;
      if (getCloudRuntime() !== owner) throw new Error('visualProjectChanged');
      if (!Number.isInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > 100) throw new Error('visualPdfPageLimit');
      source = { mediaId, owner, document: doc, disposed: false, released: false };
      if (thumbnail) source.releaseAfterRender = () => { source!.released = true; return destroy(); };
      countCallback.current?.(doc.numPages);
      setLoaded(source);
    })().catch(async () => {
      await destroy();
      if (!disposed && getCloudRuntime() === owner) { setError(true); setLoading(false); }
    });
    return () => {
      disposed = true; controller.abort();
      if (source) { source.disposed = true; if (rendering.current?.source === source) cancelRender(rendering.current); }
      void destroy();
    };
  }, [mediaId, owner, thumbnail, thumbnail ? page : null, thumbnail ? width : null]);
  const source = loaded?.mediaId === mediaId && loaded.owner === owner && !loaded.disposed ? loaded : null;
  useEffect(() => {
    if (!source || source.released) return;
    const element = canvas.current;
    const previous = rendering.current, current: PageRender = { source, cancelled: false, settled: false };
    rendering.current = current;
    const live = () => !current.cancelled && !source.disposed && getCloudRuntime() === source.owner;
    setLoading(true); setError(false);
    current.done = (async () => {
      let pdfPage: pdfjs.PDFPageProxy | undefined;
      try {
        // Coalesce changes while getPage is pending, then release the previous
        // render and page resources before this canvas is reused.
        if (previous?.source === source && previous.done) await previous.done;
        if (!live()) return;
        const doc = source.document;
        pdfPage = await doc.getPage(Math.min(doc.numPages, Math.max(1, page))); if (!live() || !element) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        if (![natural.width, natural.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('attachmentPdfDimensions');
        const scale = Math.min(2, Math.max(140, Math.min(1400, width)) / natural.width,
          4096 / natural.width, 4096 / natural.height, Math.sqrt(4_000_000 / (natural.width * natural.height)));
        const viewport = pdfPage.getViewport({ scale });
        const rasterWidth = Math.max(1, Math.floor(viewport.width)), rasterHeight = Math.max(1, Math.floor(viewport.height));
        if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0 && value <= 4096)
          || rasterWidth * rasterHeight > 4_000_000) throw new Error('attachmentPdfDimensions');
        const context = element.getContext('2d'); if (!context) throw new Error('attachmentCanvasUnavailable');
        element.width = rasterWidth; element.height = rasterHeight;
        current.task = pdfPage.render({ canvas: element, canvasContext: context, viewport });
        await current.task.promise; if (live()) setLoading(false);
      } finally {
        current.settled = true;
        // The bitmap no longer needs pdf.js's operator lists and page images.
        pdfPage?.cleanup();
        await source.releaseAfterRender?.();
      }
    })().catch(() => { if (live()) { clearCanvas(element); setError(true); setLoading(false); } });
    return () => { cancelRender(current); clearCanvas(element); };
  }, [source, page, width]);
  return <div className="attachment-pdf-page" aria-busy={loading}>
    {loading && <span role="status">{english ? 'Loading page…' : 'Carregando página…'}</span>}
    {error && <p role="alert">{english ? 'Could not open this PDF. Try downloading or importing it again.' : 'Não foi possível abrir este PDF. Tente baixar ou importar novamente.'}</p>}
    <canvas ref={canvas} width={0} height={0} hidden={error || loading || !source} aria-label={`${english ? 'PDF page' : 'Página do PDF'} ${page}`} />
  </div>;
}
