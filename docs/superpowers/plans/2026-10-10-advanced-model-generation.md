# Advanced 3D generation implementation plan

**Goal:** Generate a complete assembled model whose parts can already be inspected and exploded, using an intelligently selected branch of the plan.

**Architecture:** Extend the existing model input with an optional advanced mode. Build a bounded outline of explicitly selected nodes, their descendants, ancestors and incoming dependencies, including linked image metadata. A first AI pass selects relevant references and up to two documentation searches; only selected bodies and actually retrieved document text reach assembly planning. That planning produces two to eight module-specific prompts sharing units, bounding envelopes and interface anchors. Generate each module separately, validate bounds and shared anchors, namespace primitive IDs and merge into one assembled scene. Persist this contract and complete part ownership with the proposal and artifact. Reuse the renderer, view store and inspector instead of a new module or duplicate artifact.

**Execution:** Inline in the current workspace. No commits or new dependencies. QA preserves existing artifacts and may add an explicitly identified sample through the normal application flow.

**Constraints:** All geometry remains declarative SceneV1 JSON (128 objects for standard generation; up to 512 total in advanced generation, at most 96 per module). Extend the contract with extruded contours/holes/bevels, lathe profiles, curved tubes and indexed custom meshes. Validate coordinates, topology and tessellation before rendering. Every shape belongs to exactly one named part. AI grouping and interface anchors are illustrative, independent of an evidence-grounded decomposition dossier. No invented measurements, source URLs or electrical connections. Preserve approval/automatic application, cancellation, scope changes, image-analysis consent, export/import and copy/paste.

## Tasks

- [x] Add failing tests for branch discovery, bounded selection, freshness, exact coverage and persistence of assemblies.
- [x] Implement advanced context selection, retrieved-document research and validated generation using existing AI and gateway paths.
- [x] Expand geometry across generation, rendering, bounds, decomposition reuse and portable schemas; preserve old primitive scenes.
- [x] Integrate a compact Standard/Advanced choice, progress stages and provenance summary into the existing studio.
- [x] Reuse mounted/exploded controls and part highlighting on advanced artifacts; retain documentary research as an optional next step.
- [x] Verify cancellation/context changes, legacy inputs, copy/export, renderer and UI; run the full frontend suite and build, inspect localhost, document limitations.

## Review focus

- A parent node discovers its descendants and relevant prerequisites without absorbing unrelated branches.
- A related node changes while AI runs or before applying: the old proposal cannot silently apply.
- Unknown/duplicated object IDs, unassigned shapes or invented references: reject the entire generated assembly.
- A concept has no documentary basis: still label it illustrative; a failed search is visible, never fabricated evidence.
- Standard generation and existing researched decompositions remain compatible with old saved plans.
- Partial module failures never leave half a generated assembly in the plan; anchors and budgets are checked before merging.

## Verification

892 frontend tests passed, eight external tests skipped; TypeScript/Vite build completed with 571 modules. A focused follow-up also passed all 12 advanced tests after adding a real portable export/import roundtrip. Review regressions cover relinking images inside the same branch, combined retained-context geometry budgets and preservation of all 32 historical benchmark prompts/schema.

The real UI trial generated and applied a new 69-object, three-module MG90S sample, using 20 extrusions, nine lathe profiles and three curved tubes. Minimization preserved progress; the inspector exercised explosion and part highlighting. Exported TXT validates exact coverage, disjoint exploded module bounds, reversibility and unchanged source geometry. The sample has no readable documentary sources: physical dimensions and fit remain unverified. See [implementation and limits](../../design/advanced-model-generation.md) and [interactive sample](http://127.0.0.1:5190/docs/design/mg90s-advanced/).
