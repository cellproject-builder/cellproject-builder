import { memo, useEffect, useCallback, useState, useRef, lazy, Suspense, type RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useLocaleStore } from '@/i18n';
import { toast } from '@/components/ui/Toast';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { requestChatReferences } from '@/references/chatHandoff';
import { CanvasAttachmentSurface } from '@/attachments/CanvasAttachmentSurface';
import { getPlannerOwnerId } from '@/workspace/planner';
import type { Project } from '@/types';
import { TabbedVisualExplorer as VisualExplorer } from './ui/TabbedVisualExplorer';
import { useVisualPopupStore } from './ui/uiStore';
import { useVisualSessionStore } from './ui/sessionStore';
import { getVisualWorkspace, listMentionTargets, findMentionTarget, saveVisualDraft, setVisualMode, watchVisualScope, mutateVisualWorkspace, rejectVisualProposal, removeVisualProposalHistory } from './domain';
import { addLocalImage, addReferenceImage, attachVisualFile, readVisualMedia } from './media';
import { applyModelAtViewport, runVisualGeneration, runVisualSearch, setVisualPlacementResolver, useVisualSearchStore } from './controller';
import type { ImageReference, VisualArtifact } from './types';
import { copyVisualReference, referenceFromClipboard } from './clipboard';
import { reviewVisualReference } from './search';
import { isModelRefinementCurrent, refineVisualPrompt } from './refinement';
import { REFERENCE_DRAG_TYPE, type ReferenceDragAnchor, type ReferenceDragPayload } from './drag';
import { anchoredImagePosition } from './imagePlacement';
import { useArtifactClipboard } from './useArtifactClipboard';
import './rendering/visual-canvas.css';
import './visual-drop.css';

const VisualCanvasLayer = lazy(() => import('./rendering/VisualCanvasLayer').then(module => ({ default: module.VisualCanvasLayer })));

export const VisualWorkspaceBridge = memo(function VisualWorkspaceBridge({ project, containerRef, selectedArtifactId = null, onSelectArtifact }: { project: Project; containerRef: RefObject<HTMLDivElement>; selectedArtifactId?: string | null; onSelectArtifact?: (id: string | null) => void }) {
  const api = useReactFlow();
  const workspace = getVisualWorkspace(project);
  // Selection is only context for an interactive studio. Closed tools must not
  // rebuild their context on every canvas selection or parent hover render.
  const studioVisible = useVisualSessionStore(state => state.windows.some(window => !window.hidden && !window.minimized));
  const selectedNodeId = useGraphStore(state => studioVisible ? state.selectedNodeId : null);
  const en = useLocaleStore(state => state.locale) === 'en';
  useArtifactClipboard({ containerRef, projectId: project.id, selectedArtifactId, onSelectArtifact, english: en });
  const search = useVisualSearchStore(state => state.search);
  const [dropHint, setDropHint] = useState<{ x: number; y: number } | null>(null);
  const pendingReferences = useRef(new Map<string, Promise<VisualArtifact>>());
  const point = useCallback((clientPoint?: { x: number; y: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return api.screenToFlowPosition(clientPoint ?? { x: (rect?.left ?? 0) + (rect?.width ?? 600) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 400) / 2 });
  }, [api, containerRef]);
  const onAdd = useCallback((reference: ImageReference, clientPoint?: { x: number; y: number }, anchor?: ReferenceDragAnchor) => {
    const key = `${project.id}:${reference.imageUrl}`;
    const pending = pendingReferences.current.get(key);
    if (pending) return pending;
    const operation = (async () => {
      const guard = watchVisualScope();
      try {
        if (guard.scope.projectId !== project.id) throw new Error('visualProjectChanged');
        const artifacts = getVisualWorkspace(useGraphStore.getState().project).artifacts;
        const existing = artifacts.find(a => a.source?.id === reference.id && a.source?.sessionId === reference.sessionId);
        if (existing) return existing;
        const center = point(clientPoint);
        const artifact = await addReferenceImage(reference, center);
        guard.assert();
        // The media layer can also deduplicate by URL. Never move an existing image.
        if (artifacts.some(item => item.id === artifact.id)) return artifact;
        // Decoded artifact bounds are authoritative; source dimensions may describe a different thumbnail.
        const position = anchoredImagePosition(center, artifact, undefined, anchor);
        mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(item => item.id === artifact.id ? { ...item, ...position } : item) }), guard.scope);
        return { ...artifact, ...position };
      } finally { guard.dispose(); }
    })();
    pendingReferences.current.set(key, operation);
    void operation.finally(() => {
      if (pendingReferences.current.get(key) === operation) pendingReferences.current.delete(key);
    }).catch(() => {});
    return operation;
  }, [point, project.id]);
  const availability = useCallback((available: boolean) => { if (containerRef.current) containerRef.current.dataset.visualGpu = String(available); }, [containerRef]);
  useEffect(() => { setVisualPlacementResolver(() => point()); return () => setVisualPlacementResolver(null); }, [point]);
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    const fail = (error: unknown) => toast.show({ message: `${en ? 'Could not insert image' : 'Não foi possível inserir a imagem'}: ${error instanceof Error ? error.message : ''}`, tone: 'warn' });
    const isEditor = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,[contenteditable="true"],[data-visual-popup]');
    const clearHint = () => setDropHint(null);
    const acceptsImage = (data: DataTransfer | null) => !!data && (
      Array.from(data.types).includes(REFERENCE_DRAG_TYPE)
      || Array.from(data.items ?? []).some(item => item.kind === 'file' && /^image\/(png|jpeg|webp)$/.test(item.type))
      || Array.from(data.files ?? []).some(file => /^image\/(png|jpeg|webp)$/.test(file.type))
    );
    const addFile = async (file: File, center: { x: number; y: number }) => {
      const guard = watchVisualScope();
      try {
        if (guard.scope.projectId !== project.id) throw new Error('visualProjectChanged');
        const artifact = await addLocalImage(file, center); guard.assert();
        const position = anchoredImagePosition(center, artifact);
        mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(item => item.id === artifact.id ? { ...item, ...position } : item) }), guard.scope);
        return { ...artifact, ...position };
      } finally { guard.dispose(); }
    };
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditor(event.target)) return;
      const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file' && /^image\/(png|jpeg|webp)$/.test(item.type)).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (!files.length) return;
      event.preventDefault();
      const center = point();
      const guard = watchVisualScope();
      void (async () => { try {
        for (const [i, file] of files.slice(0, 8).entries()) {
          const source = await referenceFromClipboard(file, project.id); guard.assert();
          const artifact = await addFile(file, { x: center.x + i * 24, y: center.y + i * 24 }); guard.assert();
          if (source) mutateVisualWorkspace(workspace => ({ ...workspace, artifacts: workspace.artifacts.map(item => item.id === artifact.id ? { ...item, label: source.title, source } : item) }), guard.scope);
        }
      } finally { guard.dispose(); } })().catch(fail);
    };
    const dragover = (event: DragEvent) => {
      if (isEditor(event.target) || !acceptsImage(event.dataTransfer)) { clearHint(); return; }
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      const rect = container.getBoundingClientRect();
      setDropHint({ x: Math.max(8, Math.min(rect.width - 248, event.clientX - rect.left + 16)), y: Math.max(8, Math.min(rect.height - 56, event.clientY - rect.top + 16)) });
    };
    const outsideDrag = (event: DragEvent) => { if (!container.contains(event.target as Node) || isEditor(event.target)) clearHint(); };
    const dragleave = (event: DragEvent) => { if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) clearHint(); };
    const drop = (event: DragEvent) => {
      clearHint();
      if (isEditor(event.target)) return;
      const data = event.dataTransfer; if (!data) return;
      const payload = data.getData(REFERENCE_DRAG_TYPE);
      if (payload) {
        event.preventDefault(); event.stopPropagation();
        try {
          const parsed = JSON.parse(payload) as ReferenceDragPayload;
          if (parsed.projectId !== project.id || typeof parsed.reference?.id !== 'string' || typeof parsed.reference.title !== 'string' || typeof parsed.reference.imageUrl !== 'string') throw new Error('visualProjectChanged');
          const anchor = parsed.anchor && typeof parsed.anchor === 'object' ? parsed.anchor : undefined;
          void onAdd(parsed.reference, { x: event.clientX, y: event.clientY }, anchor).catch(fail);
        } catch (error) { fail(error); }
      } else {
        const files = Array.from(data.files).filter(file => /^image\/(png|jpeg|webp)$/.test(file.type)); if (!files.length) return;
        event.preventDefault();
        const center = point({ x: event.clientX, y: event.clientY });
        const guard = watchVisualScope();
        void (async () => { try { for (const [i, file] of files.slice(0, 8).entries()) { guard.assert(); await addFile(file, { x: center.x + i * 24, y: center.y + i * 24 }); } } finally { guard.dispose(); } })().catch(fail);
      }
    };
    const hintScope = watchVisualScope();
    const checkScope = () => { try { hintScope.assert(); } catch { clearHint(); } };
    const offGraph = useGraphStore.subscribe(checkScope), offWorkspace = useWorkspaceStore.subscribe(checkScope);
    window.addEventListener('paste', paste); container.addEventListener('dragover', dragover); container.addEventListener('drop', drop);
    window.addEventListener('dragover', outsideDrag, true); window.addEventListener('dragend', clearHint); window.addEventListener('drop', clearHint); container.addEventListener('dragleave', dragleave);
    return () => {
      hintScope.dispose(); offGraph(); offWorkspace();
      window.removeEventListener('paste', paste); container.removeEventListener('dragover', dragover); container.removeEventListener('drop', drop);
      window.removeEventListener('dragover', outsideDrag, true); window.removeEventListener('dragend', clearHint); window.removeEventListener('drop', clearHint); container.removeEventListener('dragleave', dragleave);
    };
  }, [containerRef, en, onAdd, point, project.id]);
  return <>
    <CanvasAttachmentSurface key={`attachments:${project.id}`} scope={{kind:'planner',id:project.id}} containerRef={containerRef} english={en}/>
    {dropHint && <div className="visual-drop-feedback" role="status"><span style={{ left: dropHint.x, top: dropHint.y }}><b aria-hidden>＋</b>{en ? 'Drop to add to the plan' : 'Solte para adicionar ao plano'}</span></div>}
    {workspace.artifacts.length > 0 && <Suspense fallback={null}><VisualCanvasLayer artifacts={workspace.artifacts} onAvailability={availability} /></Suspense>}
    <div className="visual-canvas-actions" aria-label={en ? 'Visual tools' : 'Ferramentas visuais'}>
      <button type="button" aria-label={en ? 'Find images' : 'Buscar imagens'} title={en ? 'Find images' : 'Buscar imagens'} aria-haspopup="dialog" onClick={() => {
        // Capture selection at the user's action, without subscribing closed tools.
        const id = useGraphStore.getState().selectedNodeId;
        const node = id ? findMentionTarget(id, 'node') : undefined;
        useVisualPopupStore.getState().open('search', { text: '', mentions: node ? [node] : [], attachments: [] });
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg>
      </button>
      <button type="button" aria-label={en ? 'Generate 3D' : 'Gerar 3D'} title={en ? 'Generate 3D' : 'Gerar 3D'} aria-haspopup="dialog" onClick={() => useVisualPopupStore.getState().open('model')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>
      </button>
    </div>
    <VisualExplorer projectId={project.id} workspace={workspace} listMentions={listMentionTargets} selectedNode={selectedNodeId ? findMentionTarget(selectedNodeId, 'node') : undefined} onDraft={saveVisualDraft}
      onAttach={attachVisualFile} onSearch={(input, signal, onDetails) => runVisualSearch(input, { signal, openPopup: false, onDetails })}
      onGenerate={(input, signal, onProgress) => runVisualGeneration(input, { signal, onProgress, openPopup: false })} onAdd={onAdd}
      onRefine={(input, request, signal) => refineVisualPrompt(input, request, { signal })} isRefinementCurrent={isModelRefinementCurrent}
      onApply={applyModelAtViewport} onReject={rejectVisualProposal} onRemoveHistory={removeVisualProposalHistory} onMode={setVisualMode} onMedia={readVisualMedia} externalSearch={search}
      onAssess={(reference, input, signal) => reviewVisualReference(reference, input, { signal })}
      onDiscuss={references => requestChatReferences(getPlannerOwnerId(), references)}
      onCopyImage={reference => copyVisualReference(reference, project.id)} />
  </>;
});
