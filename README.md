# Dynamic Diary

> Aprender, compreender e construir com IA, tornando explícitas as premissas de um plano e revisando-as a partir do que acontece no mundo real.

O objetivo principal do artigo do SENAI é desenvolver e avaliar um método de desconstrução de planos gerados por IA orientado por evidências físicas. O aplicativo apoia o ciclo **premissa explícita → previsão/critério próprio antes do ensaio → ensaio → observação real → revisão justificada** e continua geral para diferentes usuários e projetos; o robô de dois braços é o estudo de caso, sem pressupor sua conclusão.

O [objetivo aprovado do artigo](docs/OBJETIVO_DO_ARTIGO.md) é a referência canônica de propósito, contribuição candidata, direção da avaliação e limites. Gestão de projetos, tarefas e diário dão suporte a esse processo.

**Evidence-grounded planning · local development and private cloud · open-source · MIT**

> ⚠ **Beta.** Dynamic Diary is under active development. Local development keeps data in the browser. Configured cloud deployments use private Supabase persistence and a server session; see [production setup](docs/cloud-production.md).

- **Projects first.** Open on your projects, with an overview of tasks, execution progress, notes and the scope builder.
- **A quiet workshop inside the starting panel.** A small pixel engineer moves between a desk, board, robot workbench and telescope. The restrained scene blends into the panel, supports pause and respects reduced motion.
- **Shared execution.** Kanban and Scrum use the same tasks. Scrum shows sprints on a timeline with start/end markers and today's position; closing a sprint returns unfinished work to the backlog.
- **Consistent workspace UI.** Compact page headers, shared controls and theme-aware design tokens follow the local Linear reference. See [the design system](docs/design/system.md) for component ownership and extension rules.
- **Personal diary.** Notes support folders, search, pinning, text blocks, headings, lists, checklists, bold/italic, autosave, trash and restoration. Project and task links are optional.
- **Three appearances.** OLED (black, default), dark (gray, without gradients) and light. Switch in the sidebar; your preference survives reload. Components retain translucency and reduced-transparency fallbacks. The current identity uses text only.
- **Islands in key areas.** Navigation and note working areas use rounded, separated surfaces; the top bar blends into the page and project content remains on an open canvas.
- **Collapsible navigation.** The desktop sidebar can become a compact icon rail and remembers the preference; mobile keeps its full drawer menu.
- **Local demonstration.** “Carregar demonstração” in Projects adds three editable example projects with plans, boards, sprints, notes and comments, preserving existing records and edits when loaded again.
- **An assistant that acts.** Open the floating chat to create and update projects, tasks, sprints, notes, folders and task comments, or work on a scoped plan. Actions use the same domain validation as the interface. Conversations and an action audit persist locally; stopping a request keeps completed changes.
- **Explicit shared references.** Type `@` in workspace or planner chat to select notes, plan parts or canvas photos. Photos and the 3D studio can bring selected references to the same chat while preserving its draft; this action never sends a message or generates a model.
- **Contextual component research.** Ask the chat for a component list with images, compare grouped alternatives and choose references for the canvas. Retrieved product specifications are compared with current project requirements, with citations, conflicts and missing information. TypeSafe textual relevance and documentary checks do not certify physical compatibility. See [the flow and validation limits](docs/chat-component-research.md).
- **Private cloud persistence.** Exact versioned documents and immutable media use Supabase RLS, checked revisions and idempotent writes. A global ZIP backup moves local data between browser origins without including AI credentials. See [production setup](docs/cloud-production.md).

- 🌳 **Planning as a typed tree.** Nodes are `recurso` (resource), `passo` (step), `decisao` (decision), `categoria` (category) — not a flat list.
- 📚 **Plan = teaching material.** Every node ships *what it is*, *why it's needed*, *how to confirm*. Tutor mode walks execution one step at a time.
- 🔒 **Real ground truth.** Four orthogonal mechanisms break the closed AI→AI loop: locked user-written criterion, adversarial critique, replan from real failure, verifiable real-world anchors.
- 🧠 **Multiple providers.** Local development supports BYOK (OpenRouter, OpenAI, Anthropic); private cloud deployments keep provider keys on the server.
- 💾 **Portable persistence.** Local development uses IndexedDB. The private cloud stores versioned documents and immutable media in Supabase, with global ZIP export/import.
- 🌍 **Bilingual UI.** English and Brazilian Portuguese, selectable from the API key gate or via the language selector. Defaults to your browser locale.

---

## Project status

| Area | State |
|------|-------|
| Multi-provider BYOK (OpenAI · Anthropic · OpenRouter) | ✅ working |
| Local persistence (IndexedDB) for projects + KB + config | ✅ working |
| 4 ground-truth mechanisms (user criterion, critique, replan, anchors) | ✅ working |
| Knowledge base (PDF ingestion + summarization + AI judge) | ✅ working |
| Graph with 5 lenses + tree-walking tutor (confirm · decompose · already-known) | ✅ working |
| Bilingual UI (en / pt-BR) | ✅ working |
| Multi-project local management + overview + archive | ✅ working |
| Shared Kanban tasks and Scrum sprints | ✅ working |
| Personal/project notes and folders | ✅ working |
| Floating AI chat with workspace and scoped planner actions | ✅ working |
| Internal task/issue comments with human and assistant authors | ✅ working |
| Supabase private persistence, login and global migration | Implemented; production login/data migration require end-to-end verification |
| Responsive mobile/tablet and installable PWA | Implemented and viewport-tested; real-device installation not yet verified |
| Onboarding tour | ⏳ planned |
| Public deploy templates beyond Railway | ⏳ planned |
| Real-time collaboration / multi-user | ❌ explicitly out of scope for v0 |

---

## How it works

1. Create a project and define its objective. Management and notes work without an AI key.
2. Create tasks directly or open the scope builder, configure a provider, and explore alternative plans with AI. Graph and tutor views remain available inside the builder.
3. Import actionable plan steps as tasks. Imports retain their origin and do not duplicate existing imported steps.
4. Move shared tasks through Kanban or assign them to Scrum sprints. Task completion does not certify the plan's real-world validation criteria.
5. Record decisions and progress in your diary; optionally link a note to a project and task.
6. Open **Chat with AI** and ask it to work across these areas. Use your configured provider and a model that supports tool calling. Comments refer to internal tasks/issues; GitHub is not connected.
7. Reload to recover local projects, planner drafts, execution, notes and conversations. A running AI request stops on reload; its action audit is recovered so the assistant checks existing records before continuing.

Concept dive: [`docs/CONCEPT.md`](docs/CONCEPT.md) · panorama: [`docs/cellproject-overview.html`](docs/cellproject-overview.html).

Attach PDF, DOCX, Markdown or source code in the objective form or chat. Project sources are available with `@`; the assistant can add, revise and reorganize plan parts with source links, a visible change audit and session undo. TypeSafe classifies intent as advisory context. Files are stored as extracted text and metadata, not original binary archives. See [attachments, safeguards and validation](docs/plan-attachments.md).

### Visual canvas

Open a plan in the graph view and use **Buscar imagens / Find images** or **Gerar 3D / Generate 3D**. The two pop-ups move independently and retain their drafts. Type `@` to select personal/project notes, plan nodes or canvas images; attach PDF/TXT/MD/PNG/JPEG/WebP files without sending a request. Submit the prompt to start search or generation. You can also paste or drop photos onto the canvas.

Use **Maximizar canvas / Maximize canvas** beside the graph controls to dedicate the workspace to the canvas. Restore with the same button or Escape; an open visual pop-up closes first. Navigation, detail panels and chat return with their previous state and draft. The canvas and its visual tools remain mounted.

In the 3D studio, **Refinar pedido com IA / Refine request with AI** optionally helps define an existing object or an original concept before generation. Review its interpretation, answer essential questions and adjust the modeling request in the same flow. Confirm the intended object and references, then explicitly generate from that interpretation. Selected `@` sources and attachments remain available. Changes to the draft, sources or generation mode invalidate earlier refinements.

Select a 3D object and use the rotation icon to drag or swipe its view inside the canvas. The move icon returns to moving the object; **Restaurar vista / Reset view** or Home restores the initial view. Arrow keys rotate and Escape exits rotation first. The pencil opens a compact contextual editor with `@` references and attachments; submitting an adjustment creates a revision of the artifact.

Hold **Ctrl and drag** a 3D object for temporary rotation without selecting it or opening editing controls. While Ctrl is held, selection outlines, resize handles and the object toolbar are hidden; releasing Ctrl restores the previous interaction mode. Images retain their existing behavior.

Hold **Ctrl and scroll** over a 3D object to zoom its view without enlarging its canvas frame or zooming the plan. Use the same studio's **Diagrama / Diagram** selector for interactive transparent SVG artifacts, including parameters and links to existing plan nodes. See [the production contract and portable example](docs/design/interactive-artifacts/PRODUCTION.md).

Choose **Decompor modelo / Decompose model** on an existing 3D object to inspect its documented composition in the same studio. Confirm the real product and variant, research specifications, inspect source excerpts and download a related TXT containing the original geometry, components and citations. Select up to eight documented parts for individual research and grouped generation, then apply the result according to the existing application mode. Applying creates a **separate linked artifact beside the original**, which remains visible. Existing source meshes are reused with their original geometry and transforms; parts absent from the source may receive newly generated illustrative geometry. **Montado / Assembled** and **Explodido / Exploded** animate the component artifact reversibly; selecting a part in the list highlights it in the canvas. A subset is labeled as a partial view. Geometry and spacing are illustrative; this does not validate manufacturing dimensions, electrical connections or physical disassembly. See the [decomposition contract](docs/design/object-decomposition.md).

Image search resolves the requested objects from selected references before searching the web, and displays the interpreted subject and any missing model information. Multiple components receive independent queries, visible in the search details, with a shared six-page source budget. Image captions, product names and filenames filter the gallery; an explicitly requested model remains a required match. Compatibility names on accessories do not count as the component itself. The gallery balances available references across the requested objects, and Commons supplements objects not covered by the source pages. When TypeSafe is configured, one batch scores up to 12 candidates by textual relevance, removing only confidently irrelevant results and preserving coverage among the retained candidates. This evaluates metadata, not image pixels or physical compatibility. If review is unavailable, the gallery identifies its metadata-only fallback.

**Approval** keeps a generated scene as a proposal until you apply it. **Automatic** applies an eligible result only while the project and selected sources remain current. Generation uses your configured BYOK provider. Images provide textual metadata by default; enable **Analisar pixels das imagens com IA / Analyze image pixels with AI** to send selected local images to a compatible model during refinement or generation. This accepts up to eight images and 20 MiB total, without inferring calibrated dimensions or physical correctness. Unsupported image input produces an explicit error instead of a silent text-only fallback. The existing export/import menu preserves visuals and originals in portable JSON.

Generation receives a versioned modeling guide adapted from the pinned CloudAI-X Three.js fundamentals, geometry and materials skills. The bounded SceneV1 JSON supports primitives, extrude, lathe, tube and custom BufferGeometry. Advanced mode plans modules with shared dimensions/interfaces and separate prompts, then composes their outputs. The renderer executes validated geometry, not arbitrary generated JavaScript. See [guide provenance and limits](docs/visual-modeling-skills.md) and the [saved with/without comparison](http://127.0.0.1:5190/docs/design/three-skills-comparison/) while the local server runs. The comparison makes no new AI calls.

The [reference experiment](http://127.0.0.1:5190/docs/design/three-skills-comparison/matrix/) expands this to 32 planned first attempts: ESP32 and MG90S, no reference / image / specifications / both, with and without the adapted guide, repeated twice. Its explicit local CLI sends audited image pixels independently of the studio's optional visual analysis. See the [protocol and recorded results](docs/design/three-skills-comparison/matrix/README.md). Browsing the experiment never triggers inference.

Use **Conversar sobre / Discuss** on a canvas photo or **Levar referências ao chat / Bring references to chat** in the studio to continue in the existing chat. References are resolved by identity and merged without duplicates. The visual pop-ups close, the chat draft stays intact, and the studio's text and attachments remain in its own draft. A conflicting project context is rejected rather than replacing the current selection. In chat, Enter selects an open `@` suggestion without sending; send the message explicitly when ready.

Ask the chat to revise existing plan parts and find component images in the same message. Image results appear in a carousel with arrows, keyboard, scroll and swipe navigation. **Escolher / Choose** adds the selected image to the canvas and a real `@` reference to the chat draft; **Base 3D / 3D base** also prepares the studio while preserving its draft. Search alone inserts nothing. Images link only to a node referenced in that search; otherwise they remain free. Results from another project or a replaced plan cannot insert into the current canvas. Expired search sessions require a new search; images already chosen remain stored locally.

Run `npm run dev` locally for image search and its media gateway. For cloud deployment, `npm start` runs the authenticated Node backend and serves `dist`; a static-only host or `npm run preview` does not provide those endpoints. See [delivery, validated flows and limits](docs/visual-canvas-validation.md) and [media limits and JSON portability](docs/design/visual-media-portability.md).

---

## Running locally

```bash
git clone https://github.com/cellproject-builder/cellproject-builder.git
cd cellproject-builder
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The app opens on projects. Configure an AI provider from settings when you want to use the plan builder. Its key lives in this browser's IndexedDB.

For local development, you can also copy `.env.example` to `.env` and set `OPENROUTER` (or `VITE_DEV_OPENROUTER_API_KEY`). Vite seeds OpenRouter after browser storage hydrates when there is no active configured key. Set `TYPESAFE_API_KEY` (or `TYPESAFE`) for automatic textual ranking of image search results; that key stays in the local gateway. Restart Vite after changing `.env`. Start interactive testing with `npm run dev`: `--mode test` intentionally disables OpenRouter seeding, and production builds never include the development key.

### Supported providers

| Provider | Get a key | Default model |
|----------|-----------|---------------|
| **OpenRouter** *(recommended)* | https://openrouter.ai/keys | `openai/gpt-6.1-sol` (reasoning effort medium) |
| **OpenAI** | https://platform.openai.com/api-keys | `gpt-4o` |
| **Anthropic** | https://console.anthropic.com/settings/keys | `claude-sonnet-4-5` |

**Why OpenRouter is recommended:** it works as a gateway to dozens of models without browser CORS pain, and you can switch model without switching provider. If Anthropic direct-from-browser fails on your network (CORS policy quirks), fall back to OpenRouter.

---

## Privacy

In **local development**:

- ✅ Your API key sits in `IndexedDB` (`cellproject-config`) — only in this browser.
- ✅ Projects, tasks, sprints, notes and folders live in `IndexedDB` (`cellproject-workspace`). The legacy graph snapshot remains in `cellproject-graph`; migration preserves existing plans and drafts.
- ✅ PDFs in the knowledge base are processed locally via `pdf.js`. Only the extracted text is sent to the model you chose, for summarization.
- ✅ BYOK model requests go **directly** from your browser to the provider you configured. Visual reference search and downloads pass through the local development gateway; optional TypeSafe review sends selected textual context and reference metadata, without image pixels, using a server-side key.
- ⚠️ Because this is an SPA, any XSS on the domain hosting it can read the key. Host on a trusted domain and keep dependencies fresh.

Storage keys retain the `cellproject-` prefix for compatibility with existing data. In cloud mode, the backend stores provider credentials, the browser uses an opaque HttpOnly session cookie, and Supabase stores private documents/media. The service worker caches only the public application shell, never private API responses. Unsaved/conflicting changes remain visible and can be exported. See [security and deployment limits](docs/cloud-production.md).

When the private vault is activated, documents and new attachments are encrypted in the browser before storage. This browser remembers a non-extractable WebCrypto key and opens the vault after login; recovery downloads are optional. Another browser or cleared site storage requires a recovery key (or an existing vault's original phrase). Browser-profile access, malicious client code and authorized AI processing are outside this storage protection. See [vault behavior and recovery limits](docs/encrypted-vault.md).

---

## Deploy

### Railway

```bash
# 1. Connect this repo in the Railway dashboard
# 2. Railway auto-detects via railway.json + nixpacks.toml
# 3. Public URL is ready
```

Ready-to-go configuration:

- [`railway.json`](railway.json) — builder + start command
- [`nixpacks.toml`](nixpacks.toml) — Node 22 + authenticated Node server and static SPA fallback

The build runs `npm ci && npm run build`. `npm start` serves `dist/` and the authenticated Node APIs. Configure the canonical origin, Supabase and provider environment variables as described in [production setup](docs/cloud-production.md).

### Other static hosts (Cloudflare Pages, Netlify, Vercel)

Works on any static SPA host:

- Build command: `npm run build`
- Output directory: `dist`
- Rewrite: `/*` → `/index.html` (SPA mode)

No mandatory env var — the API key is configured per user, in their browser.

---

## Stack

- **Vite + React 18 + TypeScript** — pure SPA.
- **@xyflow/react 12** — interactive graph with lenses (structure, flow, risk, state, connections).
- **Zustand + idb-keyval** — store persisted in IndexedDB.
- **Vercel AI SDK** — `streamObject`, `generateObject`, `generateText`.
- **@ai-sdk/openai · @ai-sdk/anthropic · @openrouter/ai-sdk-provider** — clients for the three providers.
- **Zod** — strict validation of every model response before hydration.
- **Tailwind 3** — custom palette.
- **pdfjs-dist** — 100% in-browser PDF text extraction.

---

## Layout

```
src/
├── App.tsx                   # Workspace → projects / execution / notes / planner
├── workspace/                # Project/task/sprint/note store, UI and planner bridge
├── config/
│   └── store.ts              # BYOK: provider + key + models in IDB
├── i18n/
│   ├── store.ts              # Locale store (en / pt-BR)
│   ├── messages.ts           # All UI strings, both languages
│   └── index.ts              # useT hook + helpers
├── ai/
│   ├── client.ts             # Multi-provider (OpenAI/Anthropic/OpenRouter)
│   ├── schemas.ts            # Zod schemas
│   └── service.ts            # generatePlans / decomposeNode / explainNode /
│                             # critiqueNode / replanFromFailure
├── kb/                       # Knowledge base (PDFs)
├── store.ts                  # Zustand graph store
├── types.ts                  # ConceptNodeData, Project, AIPlan, …
└── components/               # ObjectiveScreen, TutorMode, GraphCanvas, etc.
```

Architecture details: [`docs/cellproject-overview.html`](docs/cellproject-overview.html).

---

## Contributing

PRs welcome. Please:

1. `npm run lint` (strict TypeScript, no errors).
2. `npm test` (vitest green).
3. Short commit messages, in English or Portuguese — the project tone is direct and practical.
4. Don't add a backend or telemetry without discussion first. The product contract is local-first.
5. If you add user-facing strings, add them to BOTH `en` and `ptBR` in `src/i18n/messages.ts`. TypeScript will yell at you if you don't.

Low-hanging areas:

- Multi-project local management (today the store keeps a single project at a time).
- KB context in `critiqueNode` and `explainNode` (already wired in `generatePlans`, `decomposeNode`, `replanFromFailure`).
- Minimal onboarding explaining "write your criterion before seeing the AI's".
- Domain templates (woodworking, electronics, cooking, …).

---

## License

MIT — see [LICENSE](LICENSE).
