# Kanban and task list review — 2026-10-09

## Sources and scope

- Source truth: `docs/design/new_design/Thedevxeazy › All issues.html` and `Thedevxeazy › Backlog.html`, plus their local Root/ListCell CSS.
- Sanitized reference captures: `http://localhost:5190/.vite/linear-reference/backlog.html` (temporary server). The capture was opened, but runtime CSS-in-JS is missing: original geometry cannot be visually reconstructed in full from the saved HTML. Original files were preserved.
- Supplementary public reference: https://linear.app/docs/board-layout and its linked board illustration. The illustration is abstract, so it cannot replace a complete application screenshot for a pixel comparison.
- Implementation: `http://localhost:5173/`, demo product project, Kanban with board/list toggle. Desktop screenshots were captured and visually inspected through the browser; the tool does not supply an artifact file path.
- Intent: reproduce the available issue-view structure and density while retaining dynamic_diary's navigation, single header, themes, existing task data and actions.

## Browser evidence

Desktop CSS width 1860px; original browser sizing/zoom retained. Browser capture and live DOM were used together; no precise cross-source pixel/density equivalence is claimed. Both board and list were inspected at this viewport. Mobile layout/controls were inspected at 390 CSS pixels; mobile screenshot capture timed out, so mobile evidence is DOM geometry and interaction checks rather than a rendered image.

- Board: 348px columns, 50px headings, 13px group names, 12px references/metadata. Cards no longer display descriptions or a separated status footer. Priority/plan chips and actual comment/date metadata remain.
- List: 44px rows, 36px group headings, 13px titles, compact priority/reference/status/title/date order. Groups expand/collapse; shared filtering survives view changes.
- Mobile: list width/scroll width 340/340px inside a 390px page; board width/scroll width 340/1440px, with page width remaining 390px.
- Gray card: background rgb(44,44,46), text rgb(245,245,247), no gradient. OLED list uses black canvas and contrasting group surfaces. Light screenshots show consistent controls/surfaces.
- Real interactions checked: search then switch layout, open/cancel editor, collapse/expand groups, mobile navigation, theme changes. Live project data was not reset or reseeded.

## Findings and iteration

- Fixed: global typography/padding overrode local issue geometry. Scoped selectors now retain 13px group headings and the intended zero bottom page padding.
- Fixed: changing status remounted the focused select. Focus now follows the task, or its collapsed destination group. Three regression cases cover this behavior.
- Fixed: group heading was nested inside a button. The heading now contains the collapse button.
- Typography/assets: shared app font retained; Radix 15px library icons supply the new view/status/priority/metadata icons. No owners, avatars or issue labels were invented. Short references derive from existing IDs.
- Expected adaptations: existing four workflow states and app palettes; measured board/list geometry; 12px card padding/8px radius are inferred because their source declarations are unavailable. Descriptions stay accessible in the existing editor.

## Validation

315 tests passed; 8 opt-in live tests skipped. Production build and diff checks passed. Browser console error log was empty. No remaining functional or responsive blocker was found in the tested states.

## Remaining evidence gap

A strict full-view and focused-region pixel comparison remains blocked by the incomplete saved reference styles. Source and implementation screenshots are not equivalent rendered states, and no combined same-state image comparison was possible. A complete source screenshot would resolve this visual-fidelity check; this report does not claim a pixel-perfect clone.

final result: blocked
