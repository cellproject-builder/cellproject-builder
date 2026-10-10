# Cloud persistence implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate before hydration and migrate complete local envelopes/media into remote canonical storage without deleting the local legacy.

**Architecture:** Bootstrap fetches cloud capabilities before dynamically importing App. A shared memory adapter serializes revision-controlled writes; a global status surfaces conflicts/errors. Legacy migration exports every store and blob, excludes provider credentials, hashes and verifies import/readback.

**Tech Stack:** Existing React/Zustand/idb-keyval, Web Crypto, same-origin own backend with HttpOnly sessions.

**Spec:** `docs/supabase-migration-plan.md` and coordinator's API contract of 10/10/2026.

## Global constraints

- Backend own API, mutations `X-Cellproject-Request: 1`; no browser cloud API secrets.
- No remote mutation by the coding agent, deploy, commit or deletion of local data.
- Local development retains existing adapters when cloud is disabled.
- Preserve full envelopes, IDs, references, proposals, archives and all blobs.
- Auth/config/snapshot failures fail closed; no automatic local fallback.

## Review focus

- Hydration before auth must not read or write local/cloud data.
- Conflict and ambiguous network failure must preserve current data and operation identity.
- Backup/import must not drop new fields or binary originals.
- Secret config and unverified bytes must not enter cloud snapshots.
- Logout/account change must clear memory and prevent pending writes from crossing sessions.

## Tasks

- [x] Test and implement transport/runtime: config, snapshot, CAS queue, retry/conflict, byte hashing and memory-only media.
- [x] Test and implement full legacy backup/import/readback, sanitizing config, preserving local keys and bytes.
- [x] Route all store and preference adapters through selected runtime without changing local behavior.
- [x] Add login/bootstrap/migration/status UI; dynamically load App after authentication and snapshot.
- [x] Verify directed suites/typecheck; report integration limits and server contract to coordinator.

## Verification checkpoint

Final directed checkpoint on 10/10/2026: `npx vitest run src/cloud src/ai/transport.test.ts` passed 41 tests in 12 files (38 cloud tests and 3 transport tests). `npx tsc -b` passed after the session-recovery changes. Earlier compatibility checks passed 39 existing workspace/chat/repository/theme/sidebar tests; an 87-test directed run also covered attachments, visual search, decomposition research and the knowledge base before the final recovery additions. The coordinator runs the full build and deployment verification.

Additional review fixes include first-login import even on a clean origin; document/media conflict preflight before uploads; complete current backup before later imports; adjacent unsent draft coalescence in runtime and store adapters; immutable retry bodies; and email-link authentication with optional numeric code. Shared 401/403 notifications preserve drafts without retrying paid calls; active chat/AI/file ingestion blocks data transitions; logout keeps the cloud adapter closed until navigation. Expired sessions can reauthenticate in another tab and resume the original persistence queue after verifying the same user ID, without replacing drafts with a remote snapshot. An explicitly partial rescue package preserves documents and available media if complete backup or reauthentication is unavailable.

No live user migration or physical validation is claimed by these automated tests. No local data, credentials, deployment or Supabase configuration was changed by this implementation front.
