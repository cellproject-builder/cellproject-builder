import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { getPlannerOwnerId } from '@/workspace/planner';
import { registerDataIngestion } from '@/cloud/activity';
import { requestChatReferences } from '@/references/chatHandoff';
import { resolveChatReferenceTarget } from '@/chat/references';
import { TrashIcon, ChevronRightIcon } from '@/components/ui/SoftIcons';
import { CanvasAttachmentLibrary } from './CanvasAttachmentLibrary';
import { CanvasResourcePreview } from './CanvasResourcePreview';
import { availableCanvasResources, getCanvasAttachments, importCanvasResource, updateCanvasAttachments, watchCanvasAttachmentScope, type CanvasAttachmentScope } from './canvasDomain';
import { CANVAS_ATTACHMENT_DRAG_TYPE, placeCanvasResources, removeCanvasResource, resourceLink, type CanvasAttachmentCard, type CanvasResource } from './canvasModel';
import './canvas-resource.css';

const Reader = lazy(() => import('./CanvasAttachmentReader').then(module => ({ default: module.CanvasAttachmentReader })));
export function CanvasAttachmentSurface({ scope, containerRef, english = false }: { scope: CanvasAttachmentScope; containerRef: RefObject<HTMLDivElement>; english?: boolean }) {
  const api = useReactFlow(), owner = scope.kind === 'planner' ? getPlannerOwnerId() : null;
  const project = useGraphStore(state => scope.kind === 'planner' ? state.project : null);
  const workspace = useWorkspaceStore(state => scope.kind === 'board' ? state.boards[scope.id] : state.projects[owner ?? '']);
  const library = getCanvasAttachments(scope);
  const resources = useMemo(() => availableCanvasResources(scope), [scope.kind, scope.id, project, workspace]);
  const resourceMap = useMemo(() => new Map(resources.map(resource => [resource.id, resource])), [resources]);
  const [reading, setReading] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requests = useRef(new Set<AbortController>()), alive = useRef(true);
  const t = (pt: string, en: string) => english ? en : pt;
  useEffect(() => { alive.current = true; return () => { alive.current = false; for (const request of requests.current) request.abort(); }; }, [scope.kind, scope.id]);
  const fail = useCallback(() => setError(english ? 'Could not add the attachment. Check its format, size and connection.' : 'Não foi possível adicionar o anexo. Confira o formato, o tamanho e a conexão.'), [english]);
  const place = useCallback((ids: string[], screen?: { x: number; y: number }) => {
    try {
      if (!ids.length || ids.length > 24 || ids.some(id => !resourceMap.has(id))) throw new Error('attachmentMissingResource');
      const rect = containerRef.current?.getBoundingClientRect();
      const center = api.screenToFlowPosition(screen ?? { x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 });
      updateCanvasAttachments(scope, latest => {
        const merged = new Map(latest.resources.map(resource => [resource.id, resource]));
        for (const id of ids) merged.set(id, resourceMap.get(id)!);
        return placeCanvasResources({ ...latest, resources: [...merged.values()] }, ids, { x: center.x - 120, y: center.y - 145 });
      }); setError('');
    } catch { fail(); }
  }, [scope.kind, scope.id, resourceMap, api, containerRef, fail]);
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes(CANVAS_ATTACHMENT_DRAG_TYPE)) event.preventDefault(); };
    const drop = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData(CANVAS_ATTACHMENT_DRAG_TYPE); if (!raw) return;
      event.preventDefault(); event.stopPropagation();
      try {
        if (raw.length > 10_000) throw new Error('attachmentDragInvalid');
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object' || !('ids' in value) || !Array.isArray(value.ids) || value.ids.some(id => typeof id !== 'string')) throw new Error('attachmentDragInvalid');
        place(value.ids, { x: event.clientX, y: event.clientY });
      } catch { fail(); }
    };
    container.addEventListener('dragover', over); container.addEventListener('drop', drop);
    return () => { container.removeEventListener('dragover', over); container.removeEventListener('drop', drop); };
  }, [containerRef, place, fail]);
  const attach = async (files: File[]) => {
    if (busy || !files.length) return;
    const request = new AbortController(), guard = watchCanvasAttachmentScope(scope), finish = registerDataIngestion();
    requests.current.add(request); setBusy(true); setError('');
    const off = useWorkspaceStore.subscribe(() => { try { guard.assert(); } catch { request.abort(); } });
    try {
      for (const file of files.slice(0, 24)) {
        const resource = await importCanvasResource(file, scope, request.signal);
        request.signal.throwIfAborted(); guard.assert();
        updateCanvasAttachments(scope, latest => ({ ...latest, resources: [...latest.resources, resource] }));
      }
    } catch { if (!request.signal.aborted && alive.current) fail(); }
    finally { off(); guard.dispose(); finish(); requests.current.delete(request); if (alive.current) setBusy(false); }
  };
  const discuss = (resource: CanvasResource) => {
    try {
      // Materialize a legacy source before resolving its durable canvas identity.
      updateCanvasAttachments(scope, latest => ({ ...latest, resources: latest.resources.some(item => item.id === resource.id) ? latest.resources : [...latest.resources, resource] }));
      const target = resolveChatReferenceTarget({ id: `canvas-${resource.id}`, kind: 'file', projectId: owner, planId: `${scope.kind}:${scope.id}` });
      requestChatReferences(owner, [target]);
      setReading([]);
    } catch { setError(t('Não foi possível referenciar este anexo no chat.', 'Could not reference this attachment in chat.')); }
  };
  const readingResources = reading.flatMap(id => resourceMap.has(id) ? [resourceMap.get(id)!] : []);
  return <>
    <div className="canvas-attachment-tools" data-canvas-attachment-tools>
      <CanvasAttachmentLibrary resources={resources} english={english} importing={busy} error={error}
        onImport={files => void attach(files)} onAddLink={value => { try { const resource = resourceLink(value); updateCanvasAttachments(scope, latest => ({ ...latest, resources: [...latest.resources, resource] })); setError(''); } catch { fail(); } }}
        onPlace={ids => place(ids)} onOpen={resource => setReading([resource.id])} onRemove={id => { try { updateCanvasAttachments(scope, latest => removeCanvasResource(latest, id)); setError(''); } catch { fail(); } }} />
    </div>
    {!!library.cards.length && <ViewportPortal><div className="canvas-resource-layer">{library.cards.map(card => <AttachmentCard key={card.id} card={card} resources={card.resourceIds.flatMap(id => resourceMap.has(id) ? [resourceMap.get(id)!] : [])} english={english} visibilityRoot={containerRef}
      onOpen={() => setReading(card.resourceIds)} onUpdate={patch => { try { updateCanvasAttachments(scope, latest => ({ ...latest, cards: latest.cards.map(item => item.id === card.id ? { ...item, ...patch } : item) })); } catch { fail(); } }}
      onRemove={() => { try { updateCanvasAttachments(scope, latest => ({ ...latest, cards: latest.cards.filter(item => item.id !== card.id) })); } catch { fail(); } }} />)}</div></ViewportPortal>}
    {!!readingResources.length && <Suspense fallback={null}><Reader key={reading.join(':')} resources={readingResources} english={english} onClose={() => setReading([])} onDiscuss={discuss} /></Suspense>}
  </>;
}

function AttachmentCard({ card, resources, english, visibilityRoot, onOpen, onUpdate, onRemove }: { card: CanvasAttachmentCard; resources: CanvasResource[]; english: boolean; visibilityRoot: RefObject<HTMLDivElement>; onOpen(): void; onUpdate(patch: Partial<CanvasAttachmentCard>): void; onRemove(): void }) {
  const api = useReactFlow(), [live, setLive] = useState<Partial<CanvasAttachmentCard>>({});
  const gesture = useRef<{ id: number; x: number; y: number; resize: boolean; release(): void } | null>(null), pending = useRef<Partial<CanvasAttachmentCard>>({});
  const resource = resources[0], t = (pt: string, en: string) => english ? en : pt;
  useEffect(() => () => { gesture.current?.release(); }, []);
  if (!resource) return null;
  const start = (event: ReactPointerEvent<HTMLDivElement>, resize = false) => {
    if (event.button !== 0 || !resize && (event.target as Element).closest('button,a,input,select')) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current?.release(); gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, resize, release: registerDataIngestion() }; pending.current = {};
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = gesture.current; if (!action || action.id !== event.pointerId) return;
    event.stopPropagation(); const zoom = api.getViewport().zoom, dx = (event.clientX - action.x) / zoom, dy = (event.clientY - action.y) / zoom;
    pending.current = action.resize ? { width: Math.max(140, Math.min(1600, card.width + dx)), height: Math.max(120, Math.min(1600, card.height + dy)) } : { x: Math.max(-100000, Math.min(100000, card.x + dx)), y: Math.max(-100000, Math.min(100000, card.y + dy)) };
    setLive(pending.current);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const action = gesture.current; if (!action || action.id !== event.pointerId) return;
    event.stopPropagation(); gesture.current = null;
    try { if (!cancelled && Object.keys(pending.current).length) onUpdate(pending.current); } finally { action.release(); pending.current = {}; setLive({}); }
  };
  return <div className={`canvas-resource-card nodrag nopan${resources.length > 1 ? ' is-deck' : ''}`} data-canvas-resource-card={card.id} role="group" aria-label={resource.name} tabIndex={0}
    style={{ left: live.x ?? card.x, top: live.y ?? card.y, width: live.width ?? card.width, height: live.height ?? card.height }}
    onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
    onKeyDown={event => {
      if ((event.target as Element).closest('button,a,input,select')) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onOpen(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onRemove(); }
      const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
      if (direction) { event.preventDefault(); event.stopPropagation(); onUpdate({ x: card.x + direction[0] * (event.shiftKey ? 40 : 10), y: card.y + direction[1] * (event.shiftKey ? 40 : 10) }); }
    }}>
    <div className="canvas-resource-grip" title={t('Arrastar cartão', 'Drag card')} aria-hidden="true"><i/></div>
    <button className="canvas-resource-open" aria-label={`${t('Abrir', 'Open')} ${resource.name}`} onClick={onOpen}><CanvasResourcePreview resource={resource} english={english} visibilityRoot={visibilityRoot} /><span><b>{resource.name}</b><small>{resources.length > 1 ? `${resources.length} ${t('anexos', 'attachments')}` : resource.kind.toUpperCase()}</small><ChevronRightIcon /></span></button>
    <button className="canvas-resource-remove" aria-label={t('Remover cartão do canvas', 'Remove card from canvas')} title={t('Remover cartão do canvas', 'Remove card from canvas')} onClick={onRemove}><TrashIcon /></button>
    <div className="canvas-resource-resize" role="button" tabIndex={0} aria-label={t('Redimensionar cartão', 'Resize card')} onPointerDown={event => start(event, true)} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); event.stopPropagation(); onUpdate({ width: Math.max(140, Math.min(1600, card.width + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0))), height: Math.max(120, Math.min(1600, card.height + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0))) }); } }} />
  </div>;
}
