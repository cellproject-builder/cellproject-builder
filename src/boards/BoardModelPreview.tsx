import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { modelItem, type RenderItem } from '@/visuals/rendering/modelItem';
import type { SceneV1 } from '@/visuals/types';

/** Standalone transparent preview; it never reads or changes the planner. */
export function BoardModelPreview({ scene, english = false }: { scene: SceneV1; english?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), view = useRef({ yaw: 0, pitch: 0, zoom: 1 });
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null), [available, setAvailable] = useState(true);
  const invalidateRef = useRef<() => void>(() => {}), [restored, setRestored] = useState(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof WebGL2RenderingContext === 'undefined') { setAvailable(false); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: element, alpha: true, antialias: true }); }
    catch { setAvailable(false); return; }
    let item: RenderItem;
    try { item = modelItem(scene); } catch { renderer.dispose(); setAvailable(false); return; }
    setAvailable(true); renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    let frame = 0, alive = true, contextLost = false;
    const invalidate = () => { if (alive && !contextLost && !document.hidden && !frame) frame = requestAnimationFrame(draw); };
    const draw = () => {
      frame = 0;
      if (!alive || contextLost) return;
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height || document.hidden) return;
      if (element.width !== Math.round(width * renderer.getPixelRatio()) || element.height !== Math.round(height * renderer.getPixelRatio())) renderer.setSize(width, height, false);
      item.fitAspect?.(width / height); item.setView?.(view.current.yaw, view.current.pitch, view.current.zoom);
      renderer.render(item.scene, item.camera);
    };
    invalidateRef.current = invalidate;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight || 240 : 1);
      view.current.zoom = Math.max(.4, Math.min(4, view.current.zoom * Math.exp(-delta * .003))); invalidate();
    };
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else invalidate(); };
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; setAvailable(false); cancelAnimationFrame(frame); frame = 0; };
    const restore = () => setRestored(value => value + 1);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null; observer?.observe(element);
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restore);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', invalidate); invalidate();
    return () => {
      alive = false; invalidateRef.current = () => {}; cancelAnimationFrame(frame); observer?.disconnect();
      element.removeEventListener('wheel', wheel); element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restore);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', invalidate);
      const current = gesture.current; gesture.current = null;
      if (current && element.hasPointerCapture?.(current.id)) element.releasePointerCapture(current.id);
      item.dispose(); renderer.dispose();
    };
  }, [scene, restored]);
  return <div className="board-model-preview">
    <canvas ref={canvas} aria-label={english ? '3D preview: drag to rotate' : 'Prévia 3D: arraste para girar'} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return; view.current.yaw += (event.clientX - drag.x) * .012; view.current.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.current.pitch + (event.clientY - drag.y) * .012)); gesture.current = { id: drag.id, x: event.clientX, y: event.clientY }; invalidateRef.current(); }}
      onPointerUp={event => { gesture.current = null; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { gesture.current = null; }}
      onKeyDown={event => { const step = .12; if (event.key === 'ArrowLeft') view.current.yaw -= step; else if (event.key === 'ArrowRight') view.current.yaw += step; else if (event.key === 'ArrowUp') view.current.pitch -= step; else if (event.key === 'ArrowDown') view.current.pitch += step; else if (event.key === 'Home') view.current = { yaw: 0, pitch: 0, zoom: 1 }; else return; event.preventDefault(); event.stopPropagation(); invalidateRef.current(); }} />
    {!available && <span role="status">{english ? '3D preview needs WebGL 2. The model can still be inserted.' : 'A prévia 3D precisa de WebGL 2. O modelo pode ser inserido.'}</span>}
  </div>;
}
