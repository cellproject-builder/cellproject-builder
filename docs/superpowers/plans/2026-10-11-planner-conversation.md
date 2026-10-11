# Planner conversation implementation plan

> **For agentic workers:** Use subagent-driven development for the independent engine and editor guards; the coordinator owns presentation and final verification.

**Goal:** Edit a plan through a centered, contextual conversation while preserving manual edits, drafts and access to the canvas.

**Architecture:** Reuse the existing mounted AssistantChat and its history, references and validated tools. Add a portal host inside the untransformed planner viewport; keep expanded chat separate. Capture private plan baselines for tool execution and reject stale writes, including uncommitted inspector drafts.

**Tech stack:** React, Zustand, React Flow, AI SDK, Vitest.

**Spec:** User request in this conversation; reference is Mega-Vale-Transportes/workspace-megavale at f3be27e9b4dc96153af46062ec8e22be9f4375e9, AiCommandBar and ai-surface. Advanced means centered entry; expanded means full conversation. Adapt conversation placement above the entry to keep it with this canvas.

## Constraints and review focus

- One conversation, composer and draft; no new persisted presentation format.
- Canvas host outside the React Flow transform, with pointer events only on controls.
- Preserve references, attachments, history, keyboard accessibility and expanded mode.
- Cover plan replacement, asynchronous stale results and dirty inspector fields.
- Cover focus restoration, narrow screens, fullscreen canvas and save-retry receipts across portal changes.
- Deterministic SDK tests prove tool behavior, not a paid model's semantic planning quality.

## Tasks

1. Presentation (`AssistantChatDock.tsx`, `AssistantChat.tsx`, `chat.css`, `GraphCanvas.tsx`, `Workspace.tsx`, `App.tsx`): first add failing AssistantChat tests for the canvas host, single composer, draft/history survival, shortcut and suspension. Implement a centered pill and bounded conversation; keep desktop inspector accessible and narrow conversation collapsible. Verify focused Vitest and browser desktop/tablet/mobile.
2. Engine (agent; `plannerTools.ts`, assistant context pipeline, `plannerConversation.integration.test.ts`): reproduce concurrent mutation failures with real stores and deterministic SDK responses, capture immutable plan identity/revision, reject stale writes, refresh only after explicit reads/own writes. Verify create/update/move/delete, staging/rejection, undo, switching project and cancellation.
3. Manual drafts/shortcuts (agent; `plannerEdits.ts`, `DetailPanel.tsx`, `App.shortcuts.test.ts`): ephemeral owner-scoped dirty registry, cleared on blur/unmount, checked by engine. Prevent planner shortcuts from interacting with chat controls or hidden planner. Test real editor and neutral canvas behavior.
4. Receipts and verification (coordinator): persist successful retry status in action receipt; verify across expand/collapse. Run full client/gateway tests, build and repository/bundle checks, review diff, document evidence and limits, then integrate the authorized change and leave localhost running.
