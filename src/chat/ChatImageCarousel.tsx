import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageReference } from '@/visuals/types';
import { chatReferenceError } from './references';
import { chatImageEn, chatImagePt } from './messages';
import { ImageProjectFit } from './ImageProjectFit';
import type { ComponentFit } from '@/visuals/componentFit';
export interface ChatImageGroup { id: string; label: string; imageIds: string[] }

function httpUrl(value: string) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
function imageUrl(reference: ImageReference) {
  const value = reference.imageUrl;
  if (!value.startsWith('/api/visuals/media?')) return httpUrl(value);
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname === '/api/visuals/media' && Boolean(reference.sessionId)
      && url.searchParams.get('sessionId') === reference.sessionId && url.searchParams.get('candidateId') === reference.id;
  } catch { return false; }
}

export function ChatImageCarousel({ results, projectId, english, unavailable, disabled = false, groups = [], fits = [], searchUncertainty = '', contextPartial = false, onChoose, onOpenProject }: {
  results: ImageReference[]; projectId: string; english: boolean;
  unavailable?: 'projectChanged' | 'projectRemoved' | 'planChanged' | 'contextChanged'; disabled?: boolean;
  groups?: ChatImageGroup[]; fits?: ComponentFit[]; searchUncertainty?: string; contextPartial?: boolean;
  onChoose: (reference: ImageReference, options: { useAs3D: boolean }) => Promise<void>;
  onOpenProject?: () => void;
}) {
  const tr = english ? chatImageEn : chatImagePt;
  const [groupId, setGroupId] = useState('all');
  const allImages = useMemo(() => results.filter(reference => imageUrl(reference) && httpUrl(reference.sourcePageUrl)), [results]);
  const selectedGroup = groups.find(group => group.id === groupId);
  const images = selectedGroup ? allImages.filter(image => selectedGroup.imageIds.includes(image.id)) : allImages;
  const [index, setIndex] = useState(0), [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null), [feedback, setFeedback] = useState('');
  const [chosen, setChosen] = useState<string[]>([]), [failed, setFailed] = useState<string[]>([]);
  const mounted = useRef(true), request = useRef(0), pendingRef = useRef(false);
  const wheel = useRef({ total: 0, last: 0, stepped: 0 }), swipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => {
    request.current++; pendingRef.current = false; setPending(null); setFeedback(''); setError(''); setChosen([]); setFailed([]); setIndex(0);
    wheel.current = { total: 0, last: 0, stepped: 0 }; swipe.current = null;
  }, [results, projectId, unavailable]);
  const active = Math.max(0, Math.min(index, images.length - 1)), reference = images[active];
  const blocked = disabled || Boolean(unavailable) || pending !== null;
  function step(delta: number) { setIndex(current => Math.max(0, Math.min(images.length - 1, current + delta))); }
  async function choose(useAs3D: boolean) {
    if (!reference || blocked || pendingRef.current) return;
    const sequence = ++request.current;
    pendingRef.current = true; setPending(reference.id); setError(''); setFeedback('');
    try {
      await onChoose(reference, { useAs3D });
      if (!mounted.current || sequence !== request.current) return;
      setChosen(current => current.includes(reference.id) ? current : [...current, reference.id]);
      setFeedback(useAs3D ? tr.prepared : tr.added);
    } catch (reason) {
      if (!mounted.current || sequence !== request.current) return;
      const code = reason instanceof Error ? reason.message : '';
      setError(code.startsWith('chatReference') ? chatReferenceError(reason, english)
        : code === 'visualSearchContextChanged' ? tr.contextChanged : code === 'visualPlanChanged' ? tr.planChanged
        : ['visualProjectChanged', 'visualProjectMissing'].includes(code) ? tr.projectChanged
        : ['visualReferenceUnregistered', 'visualImageFetchFailed', 'visualImageInvalid', 'visualMediaMissing'].includes(code) ? tr.expired : tr.failed);
    } finally {
      if (mounted.current && sequence === request.current) { pendingRef.current = false; setPending(null); }
    }
  }
  const groupNav = groups.length > 0 && <div className="dd-chat-image-groups" role="group" aria-label={english ? 'Requested items' : 'Itens solicitados'}>
    <button type="button" aria-pressed={!selectedGroup} onClick={() => { setGroupId('all'); setIndex(0); }}>{english ? 'All' : 'Todos'} <small>{allImages.length}</small></button>
    {groups.map(group => <button type="button" key={group.id} aria-label={`${english ? 'Images of' : 'Imagens de'} ${group.label}`} aria-pressed={group.id === groupId} onClick={() => { setGroupId(group.id); setIndex(0); }}>{group.label} <small>{allImages.filter(image => group.imageIds.includes(image.id)).length}</small></button>)}
  </div>;
  if (!reference) return <section className="dd-chat-image-results" aria-label={tr.title}>{groupNav}<p className="dd-chat-image-empty" role="status">{selectedGroup ? (english ? `No images found for ${selectedGroup.label}. Try a specific model.` : `Nenhuma imagem encontrada para ${selectedGroup.label}. Tente um modelo específico.`) : results.length ? tr.unavailable : tr.noResults}</p></section>;
  const source = new URL(reference.sourcePageUrl).hostname.replace(/^www\./, '');
  return <section className="dd-chat-image-results" aria-label={tr.title}>
    <div className="dd-chat-image-heading"><strong>{tr.title}</strong><span>{images.length}</span></div>
    {groupNav}
    {(searchUncertainty || contextPartial) && <p className="dd-chat-image-hint">{searchUncertainty} {contextPartial ? (english ? 'Project context is partial; some requirements remain unchecked.' : 'Contexto parcial do projeto; alguns requisitos continuam sem avaliação.') : ''}</p>}
    <div className="dd-chat-image-deck" tabIndex={0} role="region" aria-label={tr.carousel} aria-roledescription="carousel" data-active-index={active}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'Home') setIndex(0); else if (event.key === 'End') setIndex(images.length - 1); else step(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
      onWheel={event => {
        if (event.ctrlKey || event.metaKey || !event.deltaX && !event.deltaY) return;
        const track = wheel.current, now = Date.now();
        if (now - track.stepped < 240) return;
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 250 : 1);
        if (now - track.last > 180 || Math.sign(delta) !== Math.sign(track.total)) track.total = 0;
        track.total += delta; track.last = now;
        if (Math.abs(track.total) >= 60) { step(track.total > 0 ? 1 : -1); track.total = 0; track.stepped = now; }
      }}
      onTouchStart={event => { const touch = event.touches[0]; if (touch) swipe.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={event => {
        const start = swipe.current, touch = event.changedTouches[0]; swipe.current = null;
        if (!start || !touch) return;
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1);
      }}>
      {[-1, 0, 1].map(offset => {
        const item = images[active + offset]; if (!item) return null;
        const image = failed.includes(item.id) ? <span className="dd-chat-image-preview-failed">{tr.failedPreview}</span> : <img src={item.imageUrl} alt={offset === 0 ? item.title : ''} loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(current => current.includes(item.id) ? current : [...current, item.id])} />;
        return offset === 0 ? <a key={item.id} className="dd-chat-image-card is-active" href={item.imageUrl} target="_blank" rel="noopener noreferrer" aria-label={tr.preview(item.title)}>{image}<span aria-hidden="true">↗</span></a>
          : <button type="button" key={item.id} className={`dd-chat-image-card ${offset < 0 ? 'is-previous' : 'is-next'}`} aria-label={tr.view(item.title)} onClick={() => step(offset)}>{image}</button>;
      })}
    </div>
    <div className="dd-chat-image-navigation"><button type="button" aria-label={tr.previous} disabled={active === 0} onClick={() => step(-1)}>←</button><span aria-live="polite" aria-atomic="true">{active + 1} / {images.length}</span><button type="button" aria-label={tr.next} disabled={active === images.length - 1} onClick={() => step(1)}>→</button></div>
    <div className="dd-chat-image-caption"><strong title={reference.title}>{reference.title}</strong><a className="dd-chat-image-source" href={reference.sourcePageUrl} target="_blank" rel="noopener noreferrer" title={[reference.credit, reference.license].filter(Boolean).join(' · ') || tr.source}>{source}<span aria-hidden="true"> ↗</span></a></div>
    {reference.assessment && 'kind' in reference.assessment && reference.assessment.kind === 'textual' && <p className="dd-chat-image-relevance">TypeSafe · {english ? 'Textual relevance' : 'Relevância textual'} {reference.assessment.score.toFixed(1)}/3</p>}
    <ImageProjectFit fit={fits.find(fit => fit.imageId === reference.id)} english={english} />
    <div className="dd-chat-image-options"><button type="button" className="is-primary" disabled={blocked} aria-label={tr.chooseLabel(reference.title)} onClick={() => void choose(false)}>{pending === reference.id ? '…' : chosen.includes(reference.id) ? '✓' : '+'} {chosen.includes(reference.id) ? tr.chosen : tr.choose}</button><button type="button" disabled={blocked} aria-label={tr.use3DLabel(reference.title)} onClick={() => void choose(true)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>{tr.use3D}</button></div>
    {unavailable ? <p className="dd-chat-image-hint">{tr[unavailable]}{unavailable === 'projectChanged' && onOpenProject && <button type="button" onClick={onOpenProject}>{tr.openProject} ↗</button>}</p> : <p className="dd-chat-image-hint">{tr.searchHint}</p>}
    {(feedback || pending) && <p className="dd-chat-image-feedback" role="status">{pending ? tr.adding : feedback}</p>}
    {error && <p className="dd-chat-image-error" role="alert">{error}</p>}
  </section>;
}
