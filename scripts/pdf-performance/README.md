# PDF canvas performance battery

This fixture mounts the actual shared `CanvasAttachmentSurface`, React Flow, PDF.js worker, file storage and reader. It runs on a separate localhost origin with synthetic stores, no account credentials, no AI calls and no external connections. It is a focused attachment workload, not the complete application or an authenticated cloud transport benchmark.

The deterministic originals have 20 pages: a 2,064,545-byte vector PDF and a 4,724,212-byte image PDF. Cards alternate between these two originals. Default load: 30 cards; `?count=100` exercises the schema ceiling. Reusing two media IDs deliberately tests repeated references; it is not a benchmark of 100 distinct downloads. Originals remain in IDB; card documents contain identifiers/metadata only.

Freeze both source trees before compiling. Do not measure against changing source. From PowerShell at repository root, using a fresh destination for the candidate snapshot:

```powershell
New-Item -ItemType Directory -Force .codex-audit-interaction/pdf-baseline | Out-Null
git archive --format=zip --output=.codex-audit-interaction/pdf-baseline.zip 2d2e20fccc93d23845bd12cc327a13008a75619f src
Expand-Archive -LiteralPath .codex-audit-interaction/pdf-baseline.zip -DestinationPath .codex-audit-interaction/pdf-baseline -Force
New-Item -ItemType Directory -Force .codex-audit-interaction/pdf-candidate | Out-Null
Copy-Item -LiteralPath src -Destination .codex-audit-interaction/pdf-candidate -Recurse
npx vite build --config scripts/pdf-performance/vite.config.ts --mode baseline
npx vite build --config scripts/pdf-performance/vite.config.ts --mode candidate
npx serve -l tcp://127.0.0.1:5197 .codex-audit-interaction/pdf-dist
```

Open `/baseline/` and `/candidate/`. The starting viewport contains no PDFs. Compare three repetitions in each canvas (`board`, `planner`); record the run order. Stop unrelated heavy processes. For each repetition click **Reiniciar amostra**, then:

1. **Medir tour** traverses four viewports, waiting for page work to settle.
2. **Medir dense** zooms out to show every card.
3. **Medir release** moves every card away, waits for delayed disposal, then counts remaining resources.

The visible **Resultado PDF** output contains JSON and a `data-history` DOM attribute with all results. Save this text, the compiled asset hashes, relevant source hashes, environment and baseline revision. The Worker wrapper counts creation/termination. The Blob wrapper counts PDF bytes copied into parsing (not network bytes). Raster bytes are `canvas.width * canvas.height * 4`, not process/GPU/heap memory. Frame/Long Task counters are descriptive, sensitive to browser scheduling and not a device SLA. Counters include loading-task destruction and use actual workers, not mocks. Reader navigation and minimization should also be exercised through the production controls.

After both builds, `node scripts/pdf-performance/manifest.mjs` saves explicit source, fixture, lockfile and asset hashes to `docs/design/pdf-performance/build-manifest.json`. The historical candidate rendering snapshot predates the cloud byte-cache change; those tests are separate. A new full candidate measurement should freeze the current source into a fresh destination and document that revision separately.

`node scripts/pdf-performance/check-results.mjs` validates the saved sample counts, clean starting inventories, completed canvases, errors and candidate retention/concurrency limits. It checks recorded evidence; it does not open a browser or generate new measurements.

Finish each tab using **Limpar fixture**, which unmounts its components and removes only the two media IDs created by that tab. Keep the user's normal localhost on port 5190 running. No real projects are imported or modified. A stopped/closed tab terminates workers, but cannot run the fixture's media cleanup; never use reload as cleanup.

Separate automated regressions exercise 100 queued thumbnails, rapid reader page changes, cancellation, invalid PDFs, resource limits, account changes and cloud byte-cache behavior. Real tablet input, mobile process memory, encrypted cloud network latency and 100 distinct original downloads require separate measurement. HTTP Range is not available in the current whole-file encrypted transport contract.
