import * as THREE from 'three';
import { modelItem } from '../../../src/visuals/rendering/VisualCanvasLayer';
import { decompositionContextScene, layoutDecompositionGroups } from '../../../src/visuals/decompositionLayout';
import { sceneSchema } from '../../../src/visuals/normalize';
import type { DecompositionAssembly, SceneV1 } from '../../../src/visuals/types';

async function start() {
  const response = await fetch('./scene.json');
  if (!response.ok) throw new Error('Não foi possível carregar a cena da comparação.');
  const data = await response.json() as { original: SceneV1; assembly: DecompositionAssembly };
  const original = sceneSchema.parse(data.original), parts = sceneSchema.parse(data.assembly.scene);
  const complete = decompositionContextScene(parts, original);
  const before = modelItem(parts, data.assembly.groups), after = modelItem(complete, layoutDecompositionGroups(complete, data.assembly.groups));
  const items = [before, after];
  // The earlier layout had no guide lines; preserve that condition in this preview.
  before.scene.traverse(node => { if (node.name.startsWith('guide:')) node.layers.set(1); });
  const canvases = ['before', 'after'].map(id => document.getElementById(id) as HTMLCanvasElement);
  const renderers = canvases.map(canvas => {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0); return renderer;
  });
  const amount = document.getElementById('amount') as HTMLInputElement, value = document.getElementById('value')!;
  let yaw = .3, pitch = .05, target = .7;
  const update = () => { target = Number(amount.value) / 100; value.textContent = `${amount.value}%`; };
  amount.addEventListener('input', update);
  document.getElementById('assembled')!.addEventListener('click', () => { amount.value = '0'; update(); });
  document.getElementById('exploded')!.addEventListener('click', () => { amount.value = '100'; update(); });
  document.getElementById('reset')!.addEventListener('click', () => { yaw = .3; pitch = .05; });
  for (const canvas of canvases) {
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => { if (drag?.id !== event.pointerId) return; yaw += (event.clientX - drag.x) * .008; pitch = Math.max(-1.3, Math.min(1.3, pitch + (event.clientY - drag.y) * .008)); drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);
  }
  let previous = performance.now(), frame = 0;
  function draw(now: number) {
    const delta = Math.min(.1, (now - previous) / 1000); previous = now;
    items.forEach((item, index) => {
      const canvas = canvases[index], renderer = renderers[index], rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false); item.fitAspect!(rect.width / rect.height);
      item.setView!(yaw, pitch); item.setInspection!(target, null, matchMedia('(prefers-reduced-motion: reduce)').matches ? undefined : delta);
      renderer.render(item.scene, item.camera);
    }); frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); items.forEach(item => item.dispose()); renderers.forEach(renderer => renderer.dispose()); }, { once: true });
}
start().catch(reason => { document.getElementById('error')!.textContent = reason instanceof Error ? reason.message : 'Prévia indisponível.'; });
