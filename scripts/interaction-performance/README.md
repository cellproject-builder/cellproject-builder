# Application interaction benchmark

The fixture mounts the actual production App and stores on an isolated local origin. It contains only synthetic data (500 nodes, a note with 100,000 ink points, and a Board with 100,000 ink points plus 20 offscreen models of 128 shapes). It does not import account state; CSP blocks all network connections. No LLM requests are made.

Freeze a baseline by explicit commit, then build both variants. For Windows PowerShell, from the repository root:

```powershell
New-Item -ItemType Directory -Force .codex-audit-interaction/baseline | Out-Null
git archive --format=zip --output=.codex-audit-interaction/baseline.zip 73e337432ef6cb7bbb8ba4352c5045e3a2197dc0 src
Expand-Archive -LiteralPath .codex-audit-interaction/baseline.zip -DestinationPath .codex-audit-interaction/baseline -Force
npx vite build --config scripts/interaction-performance/vite.config.ts --mode baseline
npx vite build --config scripts/interaction-performance/vite.config.ts --mode candidate
npx serve -l tcp://127.0.0.1:5198 .codex-audit-interaction/dist
```

Serve on a separate localhost port, never 5190. Each mode has its own URL path. Use a fresh origin/profile for runs; the fixture replaces synthetic state in its own origin. Keep the candidate source stable while compiling and measuring; save asset SHA-256 hashes with the results. The benchmark's entry/chunk configuration differs from the main application build, so its bundle size is not a startup-size comparison.

The buttons exercise actual store actions, React rendering and persistence over 60 animation frames, then flush persistence. Values are synchronous update CPU time, frame intervals, and browser long tasks. These are synthetic application-path measurements, not physical device results, GPU timings or an end-to-end latency SLA. Baseline viewport action uses its existing full-document update; candidate uses the narrow viewport action when available. Warm each case, alternate variants, run at least three samples, and stop other heavy processes. Normal UI interactions remain available for a separate CPU profile and visual check.

## Encrypted production pipeline

The separate `encrypted.html` fixture mounts the actual App and keeps the workspace's default production storage adapter. `configureCloud` connects that adapter to the real `CloudRuntime`, `VaultTransport`, AES-GCM `VaultSession` and `OfflineRepository` with strict IndexedDB writes/readback. It generates a random synthetic owner, vault and key in the browser, without authorizing an account or storing an offline authorization. Its fake fetch accepts only configuration/vault routes and keeps the remote ciphertext and operation receipts in memory. CSP still blocks native network access. Unrelated application stores use memory storage to isolate the workspace path.

Build with `npx vite build --config scripts/interaction-performance/encrypted.vite.config.ts --mode baseline` and `--mode candidate`. This uses the same frozen baseline `src` alias as the application benchmark and writes separate directories under the existing static root: `/encrypted-baseline/encrypted.html` and `/encrypted-candidate/encrypted.html`. Neither build overwrites `/baseline/` or `/candidate/`.

The initial workspace is exactly 3 MiB of UTF-8 JSON, including a small editable note, ASCII padding in another note, and 20 offscreen models of 128 objects. `poll` performs three identical remote refreshes and rejects unexpected document changes/PUTs; checkpoint counts are reported for comparison. `write` performs ten synchronous `updateNote` calls, leaves the natural scheduling window intact for 250 ms, then awaits workspace/runtime/repository flushes. Checkpoint generation, encryption, base64, strict IDB and confirmation work remain inside the measured window. Key derivation/setup, warmup and final verification of the encrypted runtime checkpoint are outside it. The result includes frame intervals, LongTasks, synchronous action times, total elapsed time and counters for runtime/transport checkpoints, workspace backend writes, fake GET/PUT requests and large base64 operations. Compare counters as well as time: coalescing can change the number of wire operations.

The automation API is `window.__encryptedInteractionFixture`: wait for `ready`, call `run('poll')` or `run('write')`, and retain each returned result. Run at least three alternating samples per variant/scenario on a fresh isolated origin/profile. Finish with `cleanup()` or the **Limpar cofre sintético** button before leaving; cleanup deletes only the runtime/transport slots for the owner/vault created by that page, never a database or authorization. Reloading without cleanup can leave inaccessible encrypted synthetic records, so do not use reload as the cleanup procedure.

This closes the local fixture's crypto/IDB omission, while real network latency, production account state, cross-device traffic, physical input and tablet performance still require separate evidence. A fake server's JSON work runs in the measured browser process; these samples are not production network timings.
