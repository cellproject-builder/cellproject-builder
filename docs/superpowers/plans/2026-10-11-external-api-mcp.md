# External runtime implementation plan

This plan implements the user's authorized API/MCP architecture in the existing checkout, preserving the pending plan-core repairs.

1. Domain worker and catalog (`src/external/*`, worker build/runner): define strict query/action schemas, reuse actual stores with memory environment ports, enforce project selection and return changed documents. Test store parity, plan gates, inactive ownership and worker isolation.
2. Delegation and persistence (`server/externalRepository.mjs`, `server/externalVault.mjs`, Supabase migration): dedicated hashed credentials, encrypted delegated vault keys, live grants and revocation, atomic revision-checked encrypted commits and operation receipts. Test crypto, repositories and SQL contracts.
3. API and browser enrollment (`server/externalApi.mjs`, production routing, `src/external` enrollment UI/crypto): dedicated bearer route, scoped reads, validated actions, authenticated enrollment/list/revoke, no provider calls, bounded bodies/workers. Test actual HTTP requests, conflicts and adversarial access.
4. MCP stdio (`server/mcp.mjs` and bridge tests): pin current official SDK, expose API catalog as deterministic tools/resources and verify a real spawned protocol session. Document client setup and action coverage.
5. Run complete suites/build/checks, review integration independently and repair findings. Report tested behavior and deployment prerequisites accurately.

Each owner first writes meaningful failing tests, implements its bounded files, and reports exact verification. Shared integration files and package changes are coordinated by the root agent.
