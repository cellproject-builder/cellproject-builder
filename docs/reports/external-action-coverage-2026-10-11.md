# External action coverage

Implementation date: 2026-10-11; final verification continued on 2026-10-12.

The external domain worker exposes deterministic persistent operations through a strict catalog. It runs the existing graph/workspace stores in a fresh isolated worker, using memory persistence ports. It does not import an AI provider or invoke internal generation, web search, PDF extraction, a browser, or a user's configured API keys. External runtimes supply generated plans, critiques, research, declarative geometry, extracted text, and knowledge summaries.

The domain catalog contains **126 operations: 18 queries and 108 actions**. Original encrypted media adds eight operations and global backup adds six operations in the transport catalog: **140 operations in total**.

| UI data/action family | Domain entries | Reused validation and execution |
| --- | ---: | --- |
| Managed projects and project list | 4 | Workspace create/update, appearance schema, archive/restore |
| Tasks, comments and sprints | 13 | Actual task/date/sprint validators, comment ownership, task import deduplication, completion/backlog rules |
| Project/personal notes and folders | 16 | Workspace note ownership, block identity, notebook and anchored ink schemas, aggregate raster budgets, trash/restore/move |
| Independent boards | 10 | Board document/item/edge schemas, paste/relink and remove helpers, viewport persistence, archive gates |
| Planner | 46 | Actual graph store: complete plan creation, backup import/export, externally supplied alternatives/cache/selection, drafts, archive/restore, node edits/history, evidence/criteria, failure/replan, staging/accept/reject/resume, structural edits and layout, ink and attachment library |
| Extracted project source attachments | 3 | Existing file schema, text/fingerprint deduplication, collision/count checks, deletion |
| Visuals | 18 | Declarative model/diagram schemas, image insertion from owned media, geometry/link/parameters, revision/revert, documented decomposition/apply/text export, context-bound approval/automatic proposals and history |
| User display preferences | 3 | Locale persistence and bounded theme/sidebar values |
| Conversations | 9 | Stable sessions, UI normalization and deletion tombstones, lifecycle, externally supplied messages, current reference picker/fingerprint resolution, exact selected passages and extracted file snapshots |
| Knowledge library | 4 | Shared reading limit/fingerprint, structured summary schema, deduplication and usage/cache invalidation |
| Original media (transport) | 8 | Shared scope resolution, byte/format/image limits, integrity checks, authenticated encryption and atomic catalog publication |
| Global backup (transport) | 6 | Shared UI archive hash/document/notebook/board/credential validation, paginated export, encrypted original/document chunk staging and atomic nonoverwriting import |

## Authority and persistence

- Project operations require an existing managed project and an explicit project grant. Entity IDs, source attachments, node parents, note ownership and media references are checked against that project. Independent boards, personal notes, conversation/knowledge operations, preferences and project creation require account-wide access.
- Original-media ownership uses the shared resolver. Unique historical plan aliases and archived plan owners are supported; ambiguous reused plan IDs fail closed. A forged reference cannot override another known owner.
- The worker preserves snapshot media and unrelated document bytes/revisions. Revision advancement and encrypted atomic manifest commits belong to the transport. A failed worker request publishes no snapshot.
- A mutation of an inactive planner preserves the active graph checkpoint byte for byte and preserves unrelated project records. An explicitly empty canonical editor remains authoritative. UI initialization does not migrate or clear unrelated projects as a side effect of a project-scoped operation.
- Normal plan reads retain the UI independent-criterion visibility gate, including parked and archived batches. `plan.export` is an explicit raw backup operation, matching the UI export authority.
- Alternative selection checks the current objective, merged rules, attachment fingerprints and planning intent against its cached generation context. Task import reads the authoritative canonical editor through the shared planner bridge before using the existing workspace import/deduplication handler.
- Each request uses a fresh worker and bounded memory/deadline/input size. The immutable catalog may be cached without vault/account data. Generated JSON schemas currently have no `$ref` or `$defs`.

## Exact boundaries

Persistent project, planner, task, sprint, note, board, visual and extracted-source actions listed above are supported. Provider-backed UI buttons are represented by commands accepting the external runtime's validated result; the API does not trigger internal AI.

Session-only undo stacks, selections, focused panels, popups, drawing gestures, clipboard access, renderer camera/explosion state and browser downloads are UI state. They are not shared across fresh worker requests. Persistent inverse operations, plan archive/restore and visual revision/revert are available. An external runtime may render/export the supplied declarative geometry itself.

Provider credentials, vault enrollment/revocation and account authentication are separate security flows. There is no arbitrary document writer or raw `Partial<Node>` patch action.

The global ZIP/encrypted `.ddvault` backup flow is available through six account-only transport operations: `backup.manifest`, `backup.document`, `backup.media.read`, `backup.media.stage`, `backup.document.stage` and `backup.import`. The runtime handles archive packaging and local file encryption/decryption. The server shares the UI's portable backup validator, removes provider credentials from exports, verifies original bytes and hashes, and publishes imported documents/media atomically. Existing content must be absent or identical; divergence returns `409`, preserving the current vault. Staging writes encrypted immutable blobs and retains descriptors in encrypted operation receipts without publishing media or documents prematurely.

Backup documents export in chunks of at most 1,048,576 characters. Documents import inline or through `backup.document.stage`: at most 8 MiB of bytes per encrypted chunk, 128 chunks per document and 32 MiB per reconstructed document. Per-chunk/full-document hashes, owner/vault authentication and fatal UTF-8 decoding precede document and archive validation. The final import request contains small descriptors and stays within the HTTP 16 MiB limit even for large documents; the actual serialized final manifest, including its 16-byte encryption tag, must fit the existing 96 MiB vault ceiling. Both a declared-size lower bound and the exact reconstructed byte size are checked before reading originals or publishing content.

Each original is staged separately within the existing 10 MiB original/5 MiB image limits and 500 MiB global media budget. All staged ciphertext consumes the existing 700 MiB encrypted blob quota until retention/cleanup, including abandoned stages. Global backup retains the UI migration budget rather than the separate 50 MiB per-scope upload budget. The shared media ID contract accepts safe colon/dot identities up to 180 characters, including originals created through the external API.

Conversation append supports current references and externally extracted files. The server checks source identity/fingerprint and the exact selected passage, creates reference snapshots, derives file IDs/times/fingerprints, and shares the UI attachment deduplication and localized source-only prompt. Source text enters model history with the shared untrusted-source labels. This remains an account operation even when a referenced project is supplied as context.

## Evidence

- Worker integration coverage verifies strict schemas, real store handlers, project separation, unchanged unrelated encrypted envelopes/revisions, criteria/evidence/failure gates, staged work, structural revision conflicts, import/export/alternative selection, note/task/sprint relationships, visuals, documented decomposition and canonical graph preservation.
- The existing focused model-revision/decomposition suites pass after extracting deterministic mutation helpers into `src/visuals/portableMutations.ts`, used by both the UI and external worker.
- Account conversation/knowledge tests exercise normalization, tombstones, running-turn guards, model-history preservation, fingerprint deduplication and summary budgets without internal providers.
- The worker integration verifies reference resolution and file deduplication across fresh workers, stale-reference rejection and account-scope rejection for rich conversation sources. Targeted cached-alternative/canonical-task regressions pass, and all 27 existing ObjectiveScreen tests pass after the shared pure rule-helper extraction.
- Nine global-backup server tests pass, covering encrypted staging/publication, chunk/hash export, strict account scope, nonoverwriting conflicts, invalid notebook/configuration/hash rejection, corruption/forged descriptors and browser metadata ordering plus colon/dot ID compatibility. Large-document cases cover a full 32 MiB document in four encrypted chunks, split multibyte UTF-8, reordered/repeated/tampered/foreign-owner parts and size rejection before blob reads. Thirteen existing browser migration/vault-backup tests pass with the shared validator.

Core implementation: `src/external/domain/operations.ts`, `schemas.ts`, `contentOperations.ts`, `memoryStorage.ts`, `entry.ts`; runner/build: `server/externalWorker.mjs`, `scripts/build-external-worker.mjs`; shared deterministic helpers: `src/planningRules.ts`, `src/visuals/portableMutations.ts`, `src/cloud/backupValidation.ts`; backup transport/tests: `server/externalBackup.mjs`, `server/externalBackup.test.mjs`; domain integration tests: `server/externalWorker.test.mjs`.
