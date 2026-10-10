import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageReference } from '../types';
import { createImageDragPreview, imageDragAnchor, REFERENCE_DRAG_TYPE, type ReferenceDragPayload } from '../drag';
import { useVisualStrings, visualError } from './strings';

export function ImageGallery({ references, projectId, onAdd, onBase, onAssess, onCopyImage }: {
  references: ImageReference[]; projectId: string;
  onAdd: (reference: ImageReference) => Promise<unknown>;
  onBase: (reference: ImageReference) => Promise<void>;
  onAssess?: (reference: ImageReference, signal: AbortSignal) => Promise<ImageReference['assessment']>;
  onCopyImage?: (reference: ImageReference) => Promise<void>;
}) {
  const s = useVisualStrings();
  const [view, setView] = useState<'grid' | 'deck'>('grid');
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedImage, setCopiedImage] = useState(false);
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});
  const [assessments, setAssessments] = useState<Record<string, ImageReference['assessment']>>({});
  const [assessing, setAssessing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragPreview = useRef<(() => void) | null>(null);
  const dragOrigin = useRef<{ referenceId: string; point: { x: number; y: number } } | null>(null);
  const endDrag = useCallback(() => { dragPreview.current?.(); dragPreview.current = null; dragOrigin.current = null; setDragging(null); }, []);
  const review = useRef<AbortController | null>(null);
  const wheel = useRef({ total: 0, time: 0, last: 0 });
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; review.current?.abort(); }; }, []);
  useEffect(() => { window.addEventListener('dragend', endDrag); return () => { window.removeEventListener('dragend', endDrag); dragPreview.current?.(); }; }, [endDrag]);
  useEffect(() => { endDrag(); review.current?.abort(); review.current = null; setAssessing(null); setAssessments({}); setFailedPreviews({}); setIndex(0); setPage(0); setCopied(null); setError(''); }, [references, projectId, endDrag]);
  const active = Math.min(index, Math.max(0, references.length - 1));
  function step(delta: number) { setIndex((i) => Math.max(0, Math.min(references.length - 1, i + delta))); }
  async function action(reference: ImageReference, base = false) {
    if (pending) return;
    setPending(reference.id); setError('');
    try { if (base) await onBase(reference); else await onAdd(reference); }
    catch (reason) { if (mounted.current) setError(visualError(reason, s)); }
    finally { if (mounted.current) setPending(null); }
  }
  async function copy(reference: ImageReference) {
    try {
      if (onCopyImage) await onCopyImage(reference); else await navigator.clipboard.writeText(reference.sourcePageUrl);
      if (mounted.current) { setCopiedImage(Boolean(onCopyImage)); setCopied(reference.id); }
    } catch (reason) { if (mounted.current) setError(visualError(reason, s)); }
  }
  async function assess(reference: ImageReference) {
    if (!onAssess || review.current || reference.assessment || assessments[reference.id]) return;
    const controller = new AbortController(); review.current = controller;
    setAssessing(reference.id); setError('');
    try {
      const assessment = await onAssess(reference, controller.signal);
      if (!mounted.current || controller.signal.aborted || review.current !== controller) return;
      setAssessments((current) => ({ ...current, [reference.id]: assessment ?? null }));
      if (!assessment) setError(s.reviewUnavailable);
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(visualError(reason, s)); }
    finally { if (review.current === controller) { review.current = null; if (mounted.current) setAssessing(null); } }
  }
  function card(reference: ImageReference, className = '') {
    reference = Object.hasOwn(assessments, reference.id) ? { ...reference, assessment: assessments[reference.id] } : reference;
    const source = (() => { try { return new URL(reference.sourcePageUrl).hostname.replace(/^www\./, ''); } catch { return s.source; } })();
    return <article className={`visual-card ${dragging === reference.id ? 'is-dragging' : ''} ${className}`} key={reference.id} draggable={false}>
      <div className="visual-card-image" draggable={!failedPreviews[reference.id]} title={failedPreviews[reference.id] ? s.previewUnavailable : s.drag}
        onPointerDown={(e) => { dragOrigin.current = e.button === 0 ? { referenceId: reference.id, point: { x: e.clientX, y: e.clientY } } : null; }}
        onPointerUp={() => { dragOrigin.current = null; }} onPointerCancel={() => { dragOrigin.current = null; }}
        onDragStart={(e) => {
          if (failedPreviews[reference.id]) { e.preventDefault(); return; }
          const image = e.currentTarget.querySelector('img')!;
          const rect = image.getBoundingClientRect();
          // Native dragstart follows the browser movement threshold, after the
          // cursor has already moved away from the point originally grabbed.
          const origin = dragOrigin.current;
          const point = origin?.referenceId === reference.id ? origin.point : { x: e.clientX, y: e.clientY };
          const anchor = imageDragAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, image.naturalWidth, image.naturalHeight, point);
          const payload: ReferenceDragPayload = { projectId, reference, anchor };
          e.dataTransfer.setData(REFERENCE_DRAG_TYPE, JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy';
          dragPreview.current?.();
          const preview = createImageDragPreview(image, anchor);
          if (preview && e.dataTransfer.setDragImage) { e.dataTransfer.setDragImage(preview.element, preview.offsetX, preview.offsetY); dragPreview.current = preview.dispose; }
          else { preview?.dispose(); e.dataTransfer.setDragImage?.(e.currentTarget, Math.round(rect.width * anchor.x), Math.round(rect.height * anchor.y)); }
          setDragging(reference.id);
        }} onDragEnd={endDrag}>
        <img src={reference.imageUrl} alt={reference.title} loading="lazy" draggable={false} referrerPolicy="no-referrer" data-failed={failedPreviews[reference.id] ? 'true' : undefined} aria-hidden={failedPreviews[reference.id] || undefined} onError={() => setFailedPreviews(current => ({ ...current, [reference.id]: true }))} />
        {failedPreviews[reference.id] && <span role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 8, textAlign: 'center', fontSize: 10 }}>{s.previewUnavailable}</span>}
        <span className="visual-drag-hint" aria-hidden="true">⠿</span>
      </div>
      <div className="visual-card-info"><strong title={reference.title}>{reference.title}</strong>
        <a href={reference.sourcePageUrl} target="_blank" rel="noopener noreferrer" draggable={false} title={[reference.credit, reference.license || s.unknownLicense].filter(Boolean).join(' · ')}>{source}<span aria-hidden="true">↗</span></a>
      </div>
      <div className="visual-card-actions">
        <button type="button" className="visual-card-add" disabled={pending !== null || failedPreviews[reference.id]} aria-label={`${s.addCanvas}: ${reference.title}`} onClick={() => void action(reference)}>{pending === reference.id ? '…' : '+'}<span>{s.add}</span></button>
        <button type="button" disabled={pending !== null || failedPreviews[reference.id]} aria-label={`${s.base}: ${reference.title}`} title={s.base} onClick={() => void action(reference, true)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg><span>3D</span></button>
        <button type="button" disabled={Boolean(onCopyImage && failedPreviews[reference.id])} aria-label={`${onCopyImage ? s.copy : s.copyLink}: ${reference.title}`} title={copied === reference.id ? copiedImage ? s.copied : s.linkCopied : onCopyImage ? s.copy : s.copyLink} onClick={() => void copy(reference)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
      </div>
      {onAssess && !reference.assessment && <div className="visual-card-actions"><button type="button" style={{ width: '100%' }} disabled={assessing !== null || pending !== null} aria-label={`${s.assess}: ${reference.title}`} title={s.textualHint} onClick={() => void assess(reference)}>{assessing === reference.id ? s.assessing : s.assess}</button></div>}
      {reference.assessment && <small title={s.textualHint} style={{ display: 'block', padding: '4px 7px', fontSize: 9, lineHeight: 1.4 }}><span>{'kind' in reference.assessment && reference.assessment.kind === 'textual' ? s.typeSafeScore : s.textualScore}: {reference.assessment.score}/3</span><br/><span>{s.modelConfidence}: {Math.round(reference.assessment.confidence * 100)}%</span></small>}
    </article>;
  }
  const pageCount = Math.ceil(references.length / 9);
  return <div className="visual-gallery">
    <div className="visual-gallery-toolbar"><span>{references.length} {s.resultCount}</span>
      <div className="visual-segmented"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>{s.grid}</button><button type="button" aria-pressed={view === 'deck'} onClick={() => setView('deck')}>{s.deck}</button></div>
    </div>
    {view === 'grid' ? <div className="visual-grid">{references.slice(page * 9, (page + 1) * 9).map((reference) => card(reference))}</div>
      : <div className="visual-deck" style={onAssess ? { height: 360 } : undefined} tabIndex={0} role="region" aria-label={`${s.deck} · ${s.resultCount}`} aria-roledescription="carousel" data-active-index={active}
        onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); } if (e.key === 'Home') { e.preventDefault(); setIndex(0); } if (e.key === 'End') { e.preventDefault(); setIndex(references.length - 1); } }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) + Math.abs(e.deltaY) === 0) return;
          const now = Date.now(); const track = wheel.current;
          if (now - track.time < 240) return;
          const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1);
          if (now - track.last > 180 || Math.sign(delta) !== Math.sign(track.total)) track.total = 0;
          track.total += delta; track.last = now;
          if (Math.abs(track.total) >= 60) { step(track.total > 0 ? 1 : -1); track.total = 0; track.time = now; }
        }}
        onTouchStart={(e) => { const touch = e.touches[0]; swipe.current = { x: touch.clientX, y: touch.clientY }; }}
        onTouchEnd={(e) => { const start = swipe.current; swipe.current = null; if (!start || !e.changedTouches[0]) return; const dx = e.changedTouches[0].clientX - start.x; const dy = e.changedTouches[0].clientY - start.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1); }}>
        {[-1, 0, 1].map((offset) => { const reference = references[active + offset]; return reference ? <div className={`visual-deck-slot visual-deck-${offset === 0 ? 'center' : offset < 0 ? 'left' : 'right'}`} key={reference.id}><div aria-hidden={offset !== 0} ref={(el) => { if (offset !== 0) el?.setAttribute('inert', ''); else el?.removeAttribute('inert'); }}>{card(reference)}</div>{offset !== 0 && <button type="button" aria-label={`${offset < 0 ? s.previousReference : s.nextReference}: ${reference.title}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setIndex(active + offset)} />}</div> : null; })}
      </div>}
    <div className="visual-gallery-footer"><button type="button" className="visual-icon-button" aria-label={s.previous} disabled={view === 'grid' ? page === 0 : active === 0} onClick={() => view === 'grid' ? setPage((p) => p - 1) : step(-1)}>←</button>
      <span aria-live="polite">{view === 'grid' ? `${page + 1} / ${pageCount}` : `${active + 1} / ${references.length}`}</span>
      <button type="button" className="visual-icon-button" aria-label={s.next} disabled={view === 'grid' ? page >= pageCount - 1 : active >= references.length - 1} onClick={() => view === 'grid' ? setPage((p) => p + 1) : step(1)}>→</button>
      {copied && <span className="visual-copy-feedback" role="status">{copiedImage ? s.copied : s.linkCopied}</span>}
    </div>
    {error && <p className="visual-error" role="alert">{error}</p>}
  </div>;
}
