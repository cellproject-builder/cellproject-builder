import { useEffect, useId, useRef, useState, memo, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/react';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { requestChatReferences } from '@/references/chatHandoff';
import { getPlannerOwnerId } from '@/workspace/planner';
import { listMentionTargets, removeVisualArtifact, revertVisualArtifact, setVisualArtifactLink, updateVisualArtifact, setDiagramParameter } from '../domain';
import { readVisualMedia } from '../media';
import { decompositionAssemblyCurrent } from '../decompositionState';
import { modelAssemblyCurrent } from '../modelAssembly';
import type { VisualArtifact } from '../types';
import { useVisualPopupStore } from '../ui/uiStore';
import { useVisualViewStore } from './viewStore';
import { containedImageRect } from './geometry';
import { ModelArtifactEditor } from '../ui/ModelArtifactEditor';
import { DiagramView } from '../diagram/DiagramView';
import './visual-canvas.css';

export const VisualArtifactNode = memo(function VisualArtifactNode({ data, selected, dragging, width, height }: NodeProps) {
  const artifact = data.artifact as VisualArtifact;
  const projectId = useGraphStore(state => state.project?.id);
  const { zoom } = useViewport();
  const en = useLocaleStore(state => state.locale) === 'en';
  const conceptNodes = useGraphStore(state => state.project?.nodes);
  const visualArtifacts = useGraphStore(state => state.project?.visuals?.artifacts);
  const linkedNode = artifact.linkedNodeId ? conceptNodes?.[artifact.linkedNodeId] : undefined;
  const isChild = !!artifact.sourceArtifactId;
  const linkedChild = !isChild ? visualArtifacts?.find(item => item.sourceArtifactId === artifact.id && (!artifact.decomposition?.assemblyArtifactId || item.id === artifact.decomposition.assemblyArtifactId) && decompositionAssemblyCurrent(item)) : undefined;
  const advancedAssembly = modelAssemblyCurrent(artifact);
  const hasAssembly = advancedAssembly || isChild && artifact.kind === 'model' && decompositionAssemblyCurrent(artifact);
  const decompositionLabel = isChild || advancedAssembly ? (en ? 'Inspect components' : 'Inspecionar componentes') : linkedChild ? (en ? 'Open decomposition' : 'Abrir decomposição') : artifact.kind === 'image' ? (en ? 'Decompose image' : 'Decompor imagem') : (en ? 'Decompose model' : 'Decompor modelo');
  const exploded = useVisualViewStore(state => (state.explosions[artifact.id] ?? 0) > .5);
  const freeLabel = artifact.kind === 'image' ? (en ? 'Free image' : 'Imagem livre') : (en ? 'Free object' : 'Objeto livre');
  const linkLabel = en ? 'Link to a node' : 'Vincular a um node';
  const movementHint = en ? 'The link is a reference. You can move this object freely.' : 'O vínculo é uma referência. Você pode mover este objeto livremente.';
  const [rotating, setRotating] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const linkToggleRef = useRef<HTMLButtonElement>(null);
  const linkSelectRef = useRef<HTMLSelectElement>(null);
  const linkPanelId = useId();
  useEffect(() => { if (linkOpen) linkSelectRef.current?.focus(); }, [linkOpen]);
  useEffect(() => { if (!selected) { setLinkOpen(false); setEditOpen(false); } }, [selected]);
  useEffect(() => { setLinkOpen(false); }, [artifact.id]);
  const orbitActive = rotating && selected && artifact.kind === 'model';
  const quickOrbit = controlHeld && artifact.kind === 'model';
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; shortcut: boolean } | null>(null);
  const suppressOrbitClick = useRef(false);
  const releaseGesture = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current && surfaceRef.current?.hasPointerCapture?.(current.id)) surfaceRef.current.releasePointerCapture(current.id);
  };
  const orbitHintId = useId();
  const orbitHint = en ? 'Drag or swipe to rotate · Arrow keys · Esc to move' : 'Arraste ou deslize para girar · Setas · Esc para mover';
  const shortcutHint = en ? 'Ctrl + drag to rotate · Ctrl + scroll to zoom without selecting' : 'Ctrl + arrastar para girar · Ctrl + rolar para aproximar sem selecionar';
  useEffect(() => {
    const surface = surfaceRef.current; if (artifact.kind !== 'model' || !surface) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      event.preventDefault(); event.stopPropagation();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight || 240 : 1);
      useVisualViewStore.getState().zoomBy(artifact.id, pixels);
    };
    surface.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => surface.removeEventListener('wheel', wheel, true);
  }, [artifact.id, artifact.kind]);
  useEffect(() => {
    if (artifact.kind !== 'model') return;
    const modifier = (event: KeyboardEvent) => {
      const held = event.key === 'Control' ? event.type === 'keydown' : event.ctrlKey;
      setControlHeld(held);
      if (!held && gesture.current?.shortcut) releaseGesture();
    };
    const blur = () => { setControlHeld(false); releaseGesture(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', modifier);
    window.addEventListener('keyup', modifier);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      releaseGesture();
    };
  }, [artifact.id, artifact.kind]);
  useEffect(() => {
    if (!orbitActive) { gesture.current = null; return; }
    surfaceRef.current?.focus({ preventScroll: true });
    return () => {
      const current = gesture.current, surface = surfaceRef.current;
      gesture.current = null;
      if (current && surface?.hasPointerCapture?.(current.id)) surface.releasePointerCapture(current.id);
    };
  }, [orbitActive]);
  useEffect(() => { if (!selected) setRotating(false); }, [selected]);
  const startOrbit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shortcut = artifact.kind === 'model' && event.ctrlKey;
    if (event.button !== 0 || event.isPrimary === false || gesture.current) return;
    suppressOrbitClick.current = false;
    if (!orbitActive && !shortcut) return;
    event.preventDefault(); event.stopPropagation();
    if (shortcut) setControlHeld(true);
    suppressOrbitClick.current = true;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, shortcut };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!shortcut) event.currentTarget.focus({ preventScroll: true });
  };
  const moveOrbit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (artifact.kind === 'model') setControlHeld(event.ctrlKey);
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (current.shortcut ? !event.ctrlKey : !orbitActive) { releaseGesture(); return; }
    event.preventDefault(); event.stopPropagation();
    useVisualViewStore.getState().orbit(artifact.id, (event.clientX - current.x) * .012, (event.clientY - current.y) * .012);
    gesture.current = { ...current, x: event.clientX, y: event.clientY };
  };
  const endOrbit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    event.stopPropagation(); releaseGesture();
  };
  const orbitKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!orbitActive) return;
    const step = Math.PI / 24;
    const direction = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!direction && event.key !== 'Escape' && event.key !== 'Home') return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') setRotating(false);
    else if (event.key === 'Home') useVisualViewStore.getState().reset(artifact.id);
    else useVisualViewStore.getState().orbit(artifact.id, direction![0], direction![1]);
  };
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [imageSize, setImageSize] = useState<{ projectId: string | undefined; mediaId: string; width: number; height: number } | null>(null);
  useEffect(() => {
    let alive = true, objectUrl: string | null = null;
    setUrl(null); setMissing(false); setImageSize(null);
    if (artifact.mediaId) void readVisualMedia(artifact.mediaId).then(blob => {
      if (!alive) return;
      if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } else setMissing(true);
    }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifact.mediaId, projectId]);
  useEffect(() => {
    if (artifact.kind !== 'image' || !imageSize || dragging || resizing || imageSize.projectId !== projectId || imageSize.mediaId !== artifact.mediaId) return;
    const project = useGraphStore.getState().project;
    const current = project?.visuals?.artifacts.find(item => item.id === artifact.id);
    // Load can finish after a move, revision, removal or project switch. Use the
    // current stored rectangle, preserving the bitmap's visible position.
    if (project?.id !== imageSize.projectId || current?.kind !== 'image' || current.mediaId !== imageSize.mediaId) return;
    const fitted = containedImageRect(current, imageSize.width, imageSize.height);
    if (Math.abs(fitted.width - current.width) < .01 && Math.abs(fitted.height - current.height) < .01) return;
    updateVisualArtifact(current.id, fitted);
  }, [artifact, imageSize, projectId, dragging, resizing]);
  const imageAspect = (width ?? artifact.width) / (height ?? artifact.height);
  const useAsBase = () => {
    const target = listMentionTargets('').find(item => item.kind === 'image' && item.id === artifact.id);
    if (target) useVisualPopupStore.getState().useAsBase(target);
  };
  const discuss = () => {
    const target = listMentionTargets('').find(item => item.kind === 'image' && item.id === artifact.id);
    if (!target) return;
    requestChatReferences(getPlannerOwnerId(), [target]);
    useVisualPopupStore.getState().close('search');
    useVisualPopupStore.getState().close('model');
  };
  return <div className={`visual-artifact ${artifact.kind === 'image' ? 'is-image' : ''} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${orbitActive ? 'is-orbiting' : ''} ${quickOrbit ? 'is-quick-orbit' : ''}`} style={{ width: width ?? artifact.width, height: height ?? artifact.height }}>
    <Handle type="target" id="visual-link" position={Position.Left} isConnectable={false} className="visual-link-handle" />
    <Handle type="source" id="visual-origin" position={Position.Right} isConnectable={false} className="visual-link-handle" />
    <NodeResizer isVisible={selected && !quickOrbit} minWidth={artifact.kind === 'image' ? Math.min(40, 40 * imageAspect) : artifact.kind === 'diagram' ? 240 : 100} minHeight={artifact.kind === 'image' ? Math.min(40, 40 / imageAspect) : artifact.kind === 'diagram' ? 160 : 80} keepAspectRatio={artifact.kind === 'image'}
      onResizeStart={() => setResizing(true)}
      onResizeEnd={(_event, params) => { updateVisualArtifact(artifact.id, { x: params.x, y: params.y, width: params.width, height: params.height }); setResizing(false); }} />
    <div ref={surfaceRef} className={`visual-drag-surface ${orbitActive || quickOrbit ? 'nodrag nopan nowheel' : ''}`} role="group"
      aria-label={`${orbitActive || quickOrbit ? (en ? 'Rotate 3D' : 'Girar 3D') : (en ? 'Move' : 'Mover')}: ${artifact.label}`}
      aria-describedby={orbitActive ? orbitHintId : undefined} tabIndex={orbitActive ? 0 : undefined}
      title={orbitActive ? orbitHint : quickOrbit ? shortcutHint : `${linkedNode ? movementHint : (en ? 'Drag the object to move it' : 'Arraste o objeto para movê-lo')}${artifact.kind === 'model' ? ` · ${shortcutHint}` : ''}`}
      onPointerDown={startOrbit} onPointerMove={moveOrbit} onPointerUp={endOrbit} onPointerCancel={endOrbit}
      onPointerEnter={event => { if (artifact.kind === 'model') setControlHeld(event.ctrlKey); }}
      onLostPointerCapture={() => { gesture.current = null; }} onKeyDown={orbitKeys}
      onMouseDownCapture={event => {
        // Capture runs before XYFlow's native mousedown listener on the node.
        if (event.button === 0 && (orbitActive || gesture.current || (artifact.kind === 'model' && event.ctrlKey))) { event.preventDefault(); event.stopPropagation(); }
      }}
      onClickCapture={event => {
        // The compatibility click can arrive after pointerup and Control release.
        if (suppressOrbitClick.current || orbitActive || (artifact.kind === 'model' && event.ctrlKey)) {
          event.preventDefault(); event.stopPropagation();
        }
      }}
      onTouchStart={orbitActive ? event => event.stopPropagation() : undefined}
      onDoubleClickCapture={event => { if (suppressOrbitClick.current || orbitActive || (artifact.kind === 'model' && event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); } }}>
      {artifact.kind === 'image' && url && <img className="visual-image-fallback" src={url} alt={artifact.label} draggable={false}
        onLoad={event => {
          const image = event.currentTarget;
          if (image.src !== url || !artifact.mediaId || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
          setImageSize({ projectId, mediaId: artifact.mediaId, width: image.naturalWidth, height: image.naturalHeight });
        }} />}
      {missing && <span className="visual-missing">{en ? 'Image file unavailable' : 'Arquivo da imagem indisponível'}</span>}
      {artifact.kind === 'model' && <span className="visual-model-fallback">{en ? '3D preview needs WebGL 2' : 'Prévia 3D precisa de WebGL 2'}</span>}
      {artifact.kind === 'diagram' && artifact.diagram && <DiagramView diagram={artifact.diagram} values={artifact.diagramValues} english={en} nodeNames={Object.fromEntries(Object.values(conceptNodes ?? {}).map(n => [n.id, n.name]))}
        onParameter={(id, value) => setDiagramParameter(artifact.id, id, value)} onSelectNode={id => { if (Object.hasOwn(useGraphStore.getState().project?.nodes ?? {}, id)) useGraphStore.getState().selectNode(id); }} />}
    </div>
    <NodeToolbar isVisible={selected && !quickOrbit && !dragging && !resizing} position={Position.Bottom} offset={6} style={{ zIndex: 10 }}>
    <div className={`visual-artifact-controls nodrag nopan nowheel ${zoom < .7 ? 'is-compact' : ''}`} role="group" aria-label={artifact.label}
      onKeyDown={event => { if (event.key !== 'Escape') return;
        if (linkOpen) { event.preventDefault(); event.stopPropagation(); setLinkOpen(false); linkToggleRef.current?.focus(); }
        else orbitKeys(event);
      }}>
      <span className="visual-artifact-label" title={artifact.label}>{artifact.label}</span>
      {artifact.kind === 'image' && <button className="nodrag" onClick={useAsBase} title={en ? 'Use as 3D reference' : 'Usar como base 3D'} aria-label={en ? 'Use as 3D reference' : 'Usar como base 3D'}>◇</button>}
      {artifact.kind === 'image' && <button className="nodrag visual-discuss" onClick={discuss} title={en ? 'Discuss' : 'Conversar sobre'} aria-label={`${en ? 'Discuss' : 'Conversar sobre'}: ${artifact.label}`}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 3h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M6 7h8M6 10h5"/></svg></button>}
      {artifact.kind === 'model' && <button className="nodrag visual-orbit-toggle" onClick={() => setRotating(value => !value)}
        aria-pressed={orbitActive} title={orbitActive ? (en ? 'Return to moving the object' : 'Voltar a mover o objeto') : (en ? 'Rotate the 3D view with a mouse or touch' : 'Girar a vista 3D com mouse ou toque')}
        aria-label={orbitActive ? (en ? 'Move object' : 'Mover objeto') : (en ? 'Rotate 3D' : 'Girar 3D')}>
        <span aria-hidden="true">{orbitActive ? '↔' : '↻'}</span>
      </button>}
      {(artifact.kind === 'model' || artifact.kind === 'diagram') && <button className="nodrag" aria-label={artifact.kind === 'diagram' ? (en ? 'Edit diagram' : 'Editar diagrama') : (en ? 'Edit 3D model' : 'Editar modelo 3D')} title={artifact.kind === 'diagram' ? (en ? 'Edit diagram' : 'Editar diagrama') : (en ? 'Edit 3D model' : 'Editar modelo 3D')} aria-expanded={editOpen} onClick={() => { setRotating(false); setEditOpen(value => !value); }}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m12.5 3.5 4 4M3 13l10-10a2.8 2.8 0 0 1 4 4L7 17l-4 1z"/></svg></button>}
      {orbitActive && <button className="nodrag" onClick={() => useVisualViewStore.getState().reset(artifact.id)} title={en ? 'Reset view' : 'Restaurar vista'} aria-label={en ? 'Reset view' : 'Restaurar vista'}>⌂</button>}
      {artifact.kind !== 'diagram' && <button className="nodrag visual-orbit-toggle" onClick={() => useVisualPopupStore.getState().inspectArtifact(linkedChild?.id ?? artifact.id)}
        title={decompositionLabel} aria-label={decompositionLabel}>
        <span aria-hidden="true">◈</span> {zoom >= .7 && (isChild || linkedChild || advancedAssembly ? (en ? 'Components' : 'Componentes') : (en ? 'Decompose' : 'Decompor'))}
      </button>}
      {hasAssembly && <button className="nodrag visual-orbit-toggle" onClick={() => useVisualViewStore.getState().setExplosion(artifact.id, exploded ? 0 : 1)}
        aria-pressed={exploded} title={en ? 'Separate parts or return them to their assembly positions' : 'Separar peças ou retorná-las às posições de montagem'}
        aria-label={exploded ? (en ? 'Assemble model' : 'Montar modelo') : (en ? 'Show exploded view' : 'Ver visão explodida')}>
        <span aria-hidden="true">{exploded ? '▣' : '◇'}</span> {zoom >= .7 && (exploded ? (en ? 'Assemble' : 'Montar') : (en ? 'Explode' : 'Explodir'))}
      </button>}
      {isChild && <button className="nodrag" onClick={() => useVisualPopupStore.getState().inspectArtifact(artifact.sourceArtifactId!)}
        title={en ? 'Back to original' : 'Voltar ao original'} aria-label={en ? 'Back to original' : 'Voltar ao original'}>↶</button>}
      {!isChild && artifact.revisionIndex > 0 && <button className="nodrag" onClick={() => revertVisualArtifact(artifact.id)}
        title={en ? 'Previous revision' : 'Revisão anterior'} aria-label={en ? 'Previous revision' : 'Revisão anterior'}>↶</button>}
      <button ref={linkToggleRef} className={`nodrag visual-link-toggle ${linkedNode ? 'is-linked' : ''}`} aria-label={en ? 'Edit node link' : 'Editar vínculo'} aria-expanded={linkOpen} aria-controls={linkPanelId}
        title={linkedNode ? `${en ? 'Linked to' : 'Vinculado a'}: ${linkedNode.name}` : linkLabel} onClick={() => setLinkOpen(value => !value)}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 12 4-4M7 9l-2 2a3 3 0 0 0 4 4l2-2M9 7l2-2a3 3 0 0 1 4 4l-2 2"/></svg>
      </button>
      <button className="nodrag" onClick={() => removeVisualArtifact(artifact.id)} aria-label={en ? 'Remove object' : 'Remover objeto'}>×</button>
      {orbitActive && <span id={orbitHintId} className="visual-orbit-hint">{orbitHint}</span>}
      {linkOpen && <div id={linkPanelId} className={`visual-artifact-link ${linkedNode ? 'is-linked' : ''}`} title={movementHint} data-linked-node-id={linkedNode?.id}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 12 4-4M7 9l-2 2a3 3 0 0 0 4 4l2-2M9 7l2-2a3 3 0 0 1 4 4l-2 2"/></svg>
        <select ref={linkSelectRef} className="nodrag nopan nowheel" aria-label={linkLabel} value={linkedNode?.id ?? ''}
          onChange={event => { setVisualArtifactLink(artifact.id, event.currentTarget.value || null); setLinkOpen(false); linkToggleRef.current?.focus(); }}>
          <option value="">{freeLabel}</option>
          {Object.values(conceptNodes ?? {}).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
        </select>
        {linkedNode && <button className="nodrag visual-unlink" onClick={() => { setVisualArtifactLink(artifact.id, null); setLinkOpen(false); linkToggleRef.current?.focus(); }} title={en ? 'Unlink from node' : 'Desvincular do node'} aria-label={en ? 'Unlink from node' : 'Desvincular do node'}>×</button>}
      </div>}
    </div>
    {selected && editOpen && (artifact.kind === 'model' || artifact.kind === 'diagram') && <ModelArtifactEditor key={`${projectId}:${artifact.id}`} artifact={artifact} onClose={() => setEditOpen(false)}/>}
    </NodeToolbar>
  </div>;
});
