/** Run: node scripts/ink-rendering.bench.mjs (React/JSDOM CPU, not browser paint or FPS). */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url), ts = require('typescript');
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const moduleUrl = name => pathToFileURL(require.resolve(name)).href;
function compile(file, replacements, instrument = false) {
  let source = readFileSync(resolve(file), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`'${from}'`, `'${to}'`);
  if (instrument) {
    if (!source.includes('const grainId =') || !source.includes('() => inkGeometry(stroke, legacyMode)')) throw new Error('Update benchmark instrumentation for InkStroke.');
    source = source.replace('const grainId =', 'globalThis.__inkMetrics.renders++; const grainId =')
      .replace('() => inkGeometry(stroke, legacyMode)', '() => (globalThis.__inkMetrics.geometry++, inkGeometry(stroke, legacyMode))');
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return dataUrl(compiled.replaceAll('"react/jsx-runtime"', JSON.stringify(moduleUrl('react/jsx-runtime'))));
}

// Compile actual source into memory. Instrumentation never enters product files.
const model = compile('src/ink/model.ts', { zod: moduleUrl('zod') });
const geometry = compile('src/ink/geometry.ts', { './model': model });
const component = compile('src/ink/InkStroke.tsx', { './geometry': geometry, react: moduleUrl('react') }, true);
const { InkStroke } = await import(component);
const { JSDOM } = require('jsdom'), dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react'), { createRoot } = require('react-dom/client'), { flushSync } = require('react-dom');
const frames = 30, rows = [];
for (const count of [100, 1000]) for (const tool of ['pen', 'pencil']) {
  const strokes = Array.from({ length: count }, (_, index) => ({ id: String(index), width: 3, color: '#a78bfa', tool, opacity: .65,
    points: Array.from({ length: 32 }, (_, point) => ({ x: index % 30 * 20 + point * 2, y: Math.floor(index / 30) * 15 + Math.sin(point * .3) * 8, pressure: .5 })) }));
  for (const mode of ['unmemoized-baseline', 'current-memo']) {
    const Component = mode === 'unmemoized-baseline' ? InkStroke.type ?? InkStroke : InkStroke;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    globalThis.__inkMetrics = { renders: 0, geometry: 0 };
    const view = frame => React.createElement('svg', { viewBox: '0 0 1200 1200' },
      ...strokes.map(stroke => React.createElement(Component, { key: stroke.id, stroke })), React.createElement('path', { d: `M0 0L${frame} ${frame}`, stroke: '#ffffff' }));
    React.act(() => flushSync(() => root.render(view(0)))); globalThis.__inkMetrics = { renders: 0, geometry: 0 };
    const samples = [];
    for (let frame = 1; frame <= frames; frame++) {
      const start = performance.now(); React.act(() => flushSync(() => root.render(view(frame)))); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const row = { strokes: count, pointsPerStroke: 32, tool, mode, updates: frames, completedStrokeRenders: globalThis.__inkMetrics.renders,
      geometryRecomputations: globalThis.__inkMetrics.geometry, updateMedianMs: +samples[Math.floor(frames * .5)].toFixed(3), updateP95Ms: +samples[Math.floor(frames * .95)].toFixed(3), svgFilters: container.querySelectorAll('filter').length };
    rows.push(row); console.log(JSON.stringify(row)); React.act(() => root.unmount()); container.remove();
  }
}
const output = resolve('.codex-audit-planning-performance/ink-rendering-latest.json');
mkdirSync(resolve('.codex-audit-planning-performance'), { recursive: true });
writeFileSync(output, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, host: { platform: platform(), cpu: cpus()[0]?.model },
  limits: ['Development React + JSDOM: JS reconciliation and DOM only; no browser paint, GPU, hardware stylus or FPS measurement.', 'The 1000-stroke fixture exercises the shared renderer used by notes/planner; Board currently permits 200 items.'], rows }, null, 2));
console.log(`Report: ${output}`); dom.window.close();
