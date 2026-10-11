# Notes contextual tools implementation plan

**Goal:** Give each note one dictation control and a clear entry into contextual AI, including research and diagram creation.

**Architecture:** Native auto-sizing textareas retain normal editing. An external-target control reuses the shared audio lifecycle. Notes enter the existing chat through an explicit reference handoff; note tools use the frozen submission context and the existing research/diagram services.

**Tech stack:** React, Zustand, AI SDK, existing audio and declarative SVG engines.

## User requirements and boundaries

- One microphone in the note toolbar, using the last focused text field and its selection; no microphone for every line.
- One obvious AI entry, with the note reference visible in the shared chat. Selection rewriting also goes through that composer, without automatic submission.
- Natural research requests work for personal and project notes. Research returns sources; it does not overwrite note contents.
- Requested diagrams append to the originating note, preserve other canvas objects, and respect cancellation/context guards.
- Keep the current editing, drawing, mobile layout, storage and provider choices. No separate agent, new persistence system or server rendering.

## Tasks

- [x] Audio owner: reuse AudioField lifecycle for AudioDictationButton; test selection insertion, stale fields, cancellation and scope changes.
- [x] Chat owner: extend reference handoff with optional composer text; preserve existing drafts; route paragraph/selection actions to the shared composer and test no automatic submission.
- [x] AI owner: add note-scoped research and diagram tools, wire into the workspace agent; test personal notes, sources, aborts and concurrent canvas preservation.
- [x] Integration owner: replace note-line audio fields with native textareas, add one toolbar mic and AI button, retain responsive typography; test actual note insertion/context behavior.
- [x] Verify targeted suites, production build and repository/bundle checks. Inspect desktop, tablet and phone layouts with synthetic content; review the combined diff.
- [x] Document final behavior and actual validation in [the delivery report](../../reports/notes-contextual-tools-2026-10-11.md).

**Release procedure:** Integrate the verified revision into `main`, push for the existing Railway deployment, confirm the source commit, health endpoint and served assets, and keep localhost 5190 available. The live deployment receipt and delivery response record the publication outcome.
