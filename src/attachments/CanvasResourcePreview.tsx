import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { FileTextIcon, Link1Icon, ImageIcon } from '@/components/ui/SoftIcons';
import { readVisualMedia } from '@/visuals/media';
import type { CanvasResource } from './canvasModel';
const PdfPage = lazy(() => import('./AttachmentPdfPage').then(module => ({ default: module.AttachmentPdfPage })));

export function CanvasResourcePreview({ resource, english = false, expanded = false, page = 1, onPages, visibilityRoot }: {
  resource: CanvasResource; english?: boolean; expanded?: boolean; page?: number; onPages?(count: number): void; visibilityRoot?: RefObject<HTMLElement>;
}) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(expanded), [imageUrl, setImageUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (expanded || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    let offscreenTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        clearTimeout(offscreenTimer); offscreenTimer = undefined; setVisible(true);
      } else if (offscreenTimer === undefined) {
        // A short pan should reuse its raster; settled offscreen cards release it.
        offscreenTimer = setTimeout(() => { offscreenTimer = undefined; setVisible(false); }, 750);
      }
    }, { root: visibilityRoot?.current ?? null, rootMargin: '160px' });
    if (host.current) observer.observe(host.current);
    return () => { clearTimeout(offscreenTimer); observer.disconnect(); };
  }, [expanded, visibilityRoot]);
  useEffect(() => {
    setImageUrl(''); setFailed(false);
    if (!visible || resource.kind !== 'image' || !resource.mediaId) return;
    let alive = true, url = '';
    void readVisualMedia(resource.mediaId).then(blob => {
      if (!alive) return;
      if (!blob || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) { setFailed(true); return; }
      url = URL.createObjectURL(blob); setImageUrl(url);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [resource.mediaId, resource.kind, visible]);
  return <div ref={host} className={`canvas-resource-preview${expanded ? ' is-expanded' : ''}`}>
    {visible && resource.kind === 'pdf' && resource.mediaId ? <Suspense fallback={<FileTextIcon />}><PdfPage mediaId={resource.mediaId} page={page} width={expanded ? 1000 : 240} english={english} onPages={onPages} thumbnail={!expanded} /></Suspense>
      : resource.kind === 'image' ? imageUrl ? <img src={imageUrl} alt={resource.name} draggable={false} /> : <ImageIcon />
        : resource.kind === 'link' ? <div className="canvas-resource-link"><Link1Icon /><span>{resource.url ? new URL(resource.url).hostname : ''}</span></div>
          : expanded ? resource.kind === 'pdf' ? null : <pre>{resource.text ?? (english ? 'No text available.' : 'Nenhum texto disponível.')}</pre> : <div className="canvas-resource-excerpt"><FileTextIcon /><p>{resource.text?.slice(0, 700)}</p></div>}
    {expanded && resource.kind === 'pdf' && !resource.mediaId && <div className="canvas-resource-legacy"><p>{english ? 'Only the extracted text is available. Import the original PDF to view its pages.' : 'Este anexo antigo tem apenas o texto extraído. Reanexe o PDF original para ler as páginas.'}</p><pre>{resource.text}</pre></div>}
    {failed && <p role="alert">{english ? 'Image unavailable.' : 'Imagem indisponível.'}</p>}
  </div>;
}
