# External runtime API and MCP

User authorization: expose the application's actions to an external runtime, independent of the internal AI. Authorized server access to the encrypted vault is an explicit part of this request. The database must retain encrypted content.

## Contract

- `/api/v1/capabilities` advertises deterministic operations and their input schemas; `/api/v1/query` reads authorized project state; `/api/v1/actions` executes a validated operation.
- Requests use a dedicated, high-entropy bearer credential, never browser cookies or model-provider keys. A signed-in user enrolls, lists and revokes credentials from the application. Grants include explicit projects (or all projects), read/write permissions and expiration.
- Browser enrollment wraps the vault key to a server enrollment public key without exporting the active nonextractable CryptoKey or sending passwords/recovery secrets. The server seals the delegated key with a separate configured encryption key. Plain vault content and delegated keys never enter SQL or logs.
- Every request validates a live credential and current ownership. Each mutation supplies a vault revision and operation ID. A single SQL transaction checks authorization, compares the vault revision, commits the encrypted manifest and stores an encrypted logical receipt. Replays cannot apply an operation twice; mismatched payloads cannot reuse an ID. Conflicts require a fresh read.
- Domain actions run in isolated workers using the same graph/workspace stores as the UI, with memory-only environment ports. No browser hydration, global user state, internal AI or arbitrary HTTP forwarding is permitted. Inactive project operations must preserve the active editor; active graph operations update both canonical graph and workspace checkpoint atomically.
- Strict allowlisted schemas protect identity, history, evidence, relationships and project boundaries. UI business gates remain in force. Provider-free plan drafts and externally supplied artifacts allow runtimes to bring their own intelligence.
- MCP is a local stdio bridge to this API, with credentials supplied through environment variables. It exposes the same catalog and results. Stdout contains protocol messages only. Remote HTTP MCP/OAuth is outside this transport release.
- Domain parity means persistent project content and operations, including plan editing/workflows, tasks/sprints, notes and boards. Browser navigation, microphone capture, account login/password changes and internal model generation are not remote domain operations. Any unsupported persistent action must be explicitly listed in the coverage documentation; do not claim complete parity while a gap remains.

## Delivery and verification

Implement domain execution, durable authorization/transactions, HTTP routing, enrollment UI and MCP in parallel with explicit file ownership. Preserve existing uncommitted plan repairs. Add tests before implementation for access isolation, revision conflicts, replay/revocation, evidence gates, active/inactive project consistency and actual stdio transport. Run full frontend and gateway suites, build and repository checks, then obtain independent review. Configuration and migrations are delivered locally; production activation requires deployment configuration and applying the migration.
