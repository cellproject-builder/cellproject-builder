# Local Three.js compositor comparison

Synthetic, production-built React/ReactFlow fixture using the real `VisualCanvasLayer`, model factories and WebGL renderer. No application account, API, database or user project is loaded. Runtime `fetch` is blocked. The image/decomposition storage imports of the compositor are replaced by explicit throwing boundaries because these paths are not exercised by the synthetic scenes.

## Prepare and run

Use the repository's already installed dependencies; no packages or browser need to be installed. Run from the repository root:

```powershell
# Prepare sources only: no Vite build, server or browser.
npm run bench:three -- --baseline 36bf93e --prepare-only

# New comparison, instrumented WebGL. Use an unused local port.
npm run bench:three -- --baseline 36bf93e --serve --port 5198

# Separate new comparison with WebGL wrappers disabled.
npm run bench:three -- --baseline 36bf93e --off --serve --port 5199
```

The baseline ref is required. `git show` freezes its compositor and complete local runtime dependency closure. The candidate is a snapshot of current worktree sources, including uncommitted changes, captured before building. Source hashes, fixture hashes, lockfile hash, Node version and baseline commit are saved in `preparation.json`; each built variant also saves hashes from its actual source map. Installed dependencies are shared by the two variants and must match the lockfile for a controlled comparison. The runner does not check out a branch, overwrite source files, install packages or delete anything.

Each invocation creates a unique directory inside ignored `.codex-audit-three-repro/`. Frozen sources, bundles, source maps and manifests stay there. It never modifies `.codex-audit-three/`, which holds the earlier measured experiment. The small tracked fixture contains no generated bundles or frozen snapshots. The optional static server binds only `127.0.0.1`; ports 5190 and 5197 are protected to avoid disturbing existing development/measurement servers. Stop it with Ctrl+C. A conflicting port causes an error; it never terminates another listener.

This runner enables a **new experiment**. It does not recreate the exact instrumentation, source mixture, browser, GPU, concurrent load or thermal conditions of the historical experiment. In particular, both fresh variants freeze their own compositor; the historical off bundles shared an intermediate compositor version. Do not merge results from those comparisons.

## Browser procedure

Close CPU-heavy builds/tests first. Keep the compared tab foreground, use equal viewport/DPR and load, and record GPU/browser information in the results. Warmup/allocation is separate from interaction. Start with one model, then compare 8 or 20 models and 32/64/128/512 objects per model. Avoid automatically starting the largest load. Geometries are boxes or mixed box/cylinder/sphere/torus; 512 objects remain inside the real per-model geometry budget.

Run short `idle`, `pan`, `zoom`, `orbit-one` and `irrelevant-ui` rounds; repeat A/B/A to expose machine variability. Orbit changes only the first artifact. The UI case toggles the real ReactFlow `selectionKeyPressed` state. Results stay in memory; download JSON before navigation. Optional controller: `window.__threeAudit.ready()`, `.configure({models:20,objects:512,geometry:'boxes'})`, `.measure('orbit-one',1800)`, `.measureAll()` and `.results`.

The URL can override instrumentation before context creation: `?instrument=off` or `?instrument=on`. Without wrappers, renderer draw-call/triangle/resource/CPU fields are explicitly null; display rAF intervals and Long Tasks remain available. For an exact-source instrumentation control, change the query parameter on the **same bundle** rather than rebuilding.

## What is measured

- Public WebGL draw methods count real calls and triangles across all compositor viewports, avoiding per-render resets of `renderer.info`. No fake renderer, private Three fields, `gl.finish` or blocking pixel capture is used.
- The rAF wrapper measures CPU of callbacks issuing draw calls. Display rAF p50/p95 intervals describe browser thread cadence; neither metric is GPU duration or proof of actual frame presentation.
- Wrappers add per-call overhead. Absolute instrumented timings are not uninstrumented application timings. Use the off control and report both.
- Buffers/programs/textures are observed live resources. Buffer capacities are not total VRAM; driver/framebuffer/texture memory is not fully represented. JS heap and Long Tasks depend on browser support.
- This fixture exercises synthetic models, not images, documentary decomposition, remote sync, attachments, stylus physics, user projects, external assets or production. Canvas height is capped at 600 CSS px and the real renderer caps DPR at 2.

Relative source imports outside `src/visuals/` and dynamic imports/require are rejected during preparation so future dependency changes require deliberate review of fixture boundaries. A new source API incompatible with this fixture may need a small fixture update before comparison. Validate `--prepare-only` and inspect its manifest before starting new builds or browser measurements.
