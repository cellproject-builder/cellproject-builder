# dynamic_diary design system

The local Linear references in `docs/design/new_design` informed density, hierarchy and interaction states. They are saved HTML/CSS, with incomplete runtime CSS-in-JS state; this is an adaptation rather than a pixel-for-pixel clone. No downloaded scripts, remote fonts or reference application code are executed or copied into the product.

## Measured reference patterns

All paths below refer to `Thedevxeazy › Backlog_files/` unless stated otherwise.

| Pattern | Verified measurement | Application |
| --- | --- | --- |
| Typography | `Root-huwtNLMs.css`: 11, 12, 13, 15, 18, 20, 24 and 36px tokens; weights 450/500/600/700 | Workspace text uses 12/13/14px, 11px only for secondary captions, and 16px page titles. Existing editor text retains its separate hierarchy. |
| Sidebar | Saved Backlog HTML: `--sidebar-width:244px`; sidebar link rules in Root: radius 8px and 1px vertical margins | 244px desktop navigation, 72px collapsed rail, 8px navigation radius. The existing mobile drawer stays expanded. |
| Header | Root `HeaderTitle` classes: 13px, weight 500, ellipsis; header tabs gap 8px/min-width 300px; `NewContentViewHeader--o1TJJ4s.css`: 14px icons, 6px tabs gap | Projects, overview, Kanban and Scrum integrate breadcrumb, title and tools into one 32px `PageHeader` row. Notes and planner retain a 44px shell header. These heights are app choices, not measured reference header heights. |
| Frame and surfaces | Saved HTML `#appBorders`: radius 12px, inset 8px, 1px border (0.5px on HiDPI) | Panels use a 12px radius. Navigation and note working areas use 16px islands. Page headers have no separate island surface. |
| Controls | Root icon button: 28px square, 12px/500 text; `Button-DU3VfWVC.css`: 14/16px icons, 150ms transitions. Saved HTML fallback action button: 32px high, 12px horizontal padding | Shared controls are 32px high with 6px corners and 12px text. Mobile navigation rows are at least 40px. |
| Rows | `ListCell-CGrm5qb7.css`: 8px radius, horizontal background inset 8px, 1px inset keyboard border, joined corners for adjacent selected rows | Lists use restrained state fills, visible keyboard focus and shared radius tokens; execution cards retain native drag and select actions. |
| Dialog rhythm | `ConfirmationDialog-DCU_rQ2K.css`: 12px paragraph spacing | Forms use 16px field spacing and 8px label/control gaps. Dialogs use 16px corners and shared controls, including when rendered in a portal. |
| Palette | Saved HTML bootstrap: dark sidebar/base/border `#090909/#0f0f11/#1c1e21`; light `#f5f5f5/#fcfcfd/#e0e0e0` | Preserve the app's OLED, gray and white palettes; derive semantic surfaces/borders from existing global theme colors. No gradients in gray/OLED. |

`Input-DxSL0lOB.css` only suppresses a password-manager decoration; it does not establish field dimensions. Do not infer input sizing from that file. The `useSidebarDesktop` CSS only establishes icon sizing through a variable; sidebar width above comes from the saved HTML.

## Ownership and tokens

Import order: `design-system.css`, `workspace.css`, then `PageHeader.css`. Tokens live on `:root` so forms and dialogs portaled into `body` receive the same values.

- `design-system.css`: semantic tokens and shared buttons, icon buttons, search, select, segmented control, form, card, panel, sidebar and breadcrumb primitives.
- `workspace.css`: project/task/note content geometry, responsive navigation and editor-specific text. Do not append a second shared primitive definition here.
- `NotesLibrary.tsx` / `NotesLibrary.css`: a single note navigation column with search, filters, expandable folders and previews. `Notes` owns selection, project scope and mutations; the library owns presentation and local group collapse.
- `PageHeader.tsx` / `PageHeader.css`: one header row for navigation, title and controls/actions, plus page gutters. Use it for each project, overview, Kanban and Scrum page. `PageHeaderContext` supplies shell navigation/breadcrumb/status slots without moving screen state or using portals. Do not add a separate shell header above these pages. Notes and the planner retain their own shell header.
- `SprintTimeline.css`, `Comments.css` and chat CSS: component-specific presentation. Consume shared tokens when extending these components.
- `Board.css`: shared issue geometry for board/list. `TaskCard`, `TaskList` and `TaskPresentation` own their respective markup; filtering and view choice stay in `Board`.

Spacing tokens are `--ws-space-1/2/3/4/6/8` for 4/8/12/16/24/32px. Text is `--ws-text-caption/xs/sm/md/title` for 11/12/13/14/16px. Use primary/secondary/muted theme text for readable hierarchy; tiny low-contrast metadata is not a density shortcut.

Core dimensions: `--ws-control-height:32px`, `--ws-header-height:44px`, `--ws-page-gutter:24px`, `--ws-page-top:12px`. Corner roles are `--ws-radius-control:6px`, `--ws-radius-row:8px`, `--ws-radius-panel:12px` and `--ws-radius-island/dialog:16px`.

## Extension rules

Use an existing primitive before defining another button or field. Keep font inheritance at zero specificity with `:where`; add a component class for deliberate typography instead of overriding it with `!important`. Editor formatting is an explicit exception with its own font and auto-sizing rules.

Use solid panels/cards as the normal content surface. Translucency is selective: navigation, note library/toolbars and dialogs. Backdrop blur has opaque fallbacks for unsupported browsers, reduced transparency and forced colors. Hover changes the background and shadow without moving the card; focus remains visible.

Depth uses centralized `--ws-shadow-control/card/card-hover/island/dialog` roles, with `--ws-shadow-divider` and `--ws-shadow-divider-bottom` for soft internal separation. Each combines small contact and wider ambient shadows, with shared opacity values adjusted for dark/OLED. Decorative borders retain their original transparent width to preserve geometry; semantic outlines for keyboard focus, drag targets and active sprints remain visible. Do not add component-specific shadow values when an existing role fits.

`--ws-surface-hover` mixes the existing solid surface colors to soften hover and group fills, with a plain color fallback. Text/accent tokens and the OLED black canvas stay unchanged; gray/OLED do not gain gradients. Forced colors removes shadows and restores system-color borders/selection outlines. Reduced motion also covers form controls rendered in portals.

`PageHeader` responds to the width of its actual workspace container, not only the browser viewport. At 800px of available page width, controls form a second row; at 480px they may wrap further. This handles both expanded/collapsed navigation and smaller windows. Page content keeps its own overflow rules: Kanban columns and the Scrum timeline scroll within their regions; the notes editor retains its own scrolling and auto-height text areas.

Check new surfaces in all three themes, keyboard navigation, desktop with both sidebar states, mobile drawer, and a narrow page container. Prefer a short visual inspection plus meaningful behavior tests over tests that duplicate CSS declarations.

## Issue board and list

The saved All issues view establishes 348px board columns and 50px column headers. Backlog establishes 44px issue rows and 36px group headers. Titles/group names use 13px/500, card references and metadata use 12px, and list references/counts use 13px. These dimensions are local `--ws-issue-*` tokens in `Board.css` rather than global overrides.

Cards show a short reference, status/title, compact priority/plan chips and actual due date/comment count. Long descriptions remain in the task editor. Card padding (12px), radius (8px) and gradual shadow are adaptations: the saved files omit their runtime CSS-in-JS declarations. The reference previews cannot provide a complete pixel comparison. Native status selects retain keyboard/touch operation behind the visible status icon; focus follows the task when its group changes.

Both views use the same tasks, filters and actions. View choice is a device preference, not project data. `DD-…` is a shortened display reference derived from the existing ID, searchable in the task search; it is not a new persisted sequence. Group collapse is local view state. Do not invent owners, avatars, labels or comment counts to fill the layout.

The 15px [Radix icon set](https://www.radix-ui.com/icons) supplies issue-view icons. The official [Linear board guide](https://linear.app/docs/board-layout) also documents switching between board/list and keeping descriptions out of cards. Preserve the app's OLED/gray/light palettes and single header row rather than copying unrelated navigation or workspace features.

## Contextual note editing

Folders and previews share one library island and scroll region (320px desktop, 280px below 900px). At 600px or less of available notes content, or on mobile, navigation alternates between the full-width library and editor with a back button. This container query accounts for expanded navigation without changing sidebar preferences. All notes are grouped once by folder, with an Unfiled group for notes without a folder. Pinned and deleted views keep their own filters; searching titles/bodies reveals matching groups. A folder's add button creates directly inside it; the global add button creates unfiled notes. Collapse changes presentation only and does not clear the editor. Deleting a folder keeps its notes unfiled. Note/project data and the persistence schema are unchanged.

`NoteTextActions` shows paragraph formatting and AI rewriting on hover or keyboard/text focus. Formatting keeps the existing block-level model. `NoteRewriteDialog` captures the active selection, or the full paragraph when there is no active selection, and requests a suggestion from the configured provider. The user can edit the preview, apply it, discard it or cancel an in-flight request. Application preserves surrounding text, whitespace and other block properties; it refuses to overwrite a changed/deleted paragraph. Provider output stays plain text and never becomes executable HTML or application actions. Closing/unmounting cancels the request; incomplete output is rejected and retries are manual. No note schema or persistence adapter changes are required.
