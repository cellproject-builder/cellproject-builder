# Cellproject

> Visual planning framework that decomposes objectives into validated trees. Declare a goal, let the AI propose complete paths, and validate node-by-node through a tutor mode that uses the plan itself as didactic material.

**Local-first · BYOK · open-source · MIT**

> ⚠ **Beta.** Cellproject is under active development. Expect rough edges, breaking changes between versions, and IndexedDB resets between releases. Don't put irreplaceable data in it yet.

- 🌳 **Planning as a typed tree.** Nodes are `recurso` (resource), `passo` (step), `decisao` (decision), `categoria` (category) — not a flat list.
- 📚 **Plan = teaching material.** Every node ships *what it is*, *why it's needed*, *how to confirm*. Tutor mode walks execution one step at a time.
- 🔒 **Real ground truth.** Four orthogonal mechanisms break the closed AI→AI loop: locked user-written criterion, adversarial critique, replan from real failure, verifiable real-world anchors.
- 🧠 **Multi-provider BYOK.** Bring your own key (OpenRouter, OpenAI, Anthropic). It lives only in your browser.
- 💾 **No backend.** Projects live in your browser's IndexedDB. Reload survives, nobody else reads.
- 🌍 **Bilingual UI.** English and Brazilian Portuguese, selectable from the API key gate or via the language selector. Defaults to your browser locale.

---

## Project status

| Area | State |
|------|-------|
| Multi-provider BYOK (OpenAI · Anthropic · OpenRouter) | ✅ working |
| Local persistence (IndexedDB) for projects + KB + config | ✅ working |
| 4 ground-truth mechanisms (user criterion, critique, replan, anchors) | ✅ working |
| Knowledge base (PDF ingestion + summarization + AI judge) | ✅ working |
| Graph with 5 lenses + tutor mode | ✅ working |
| Bilingual UI (en / pt-BR) | ✅ working |
| Multi-project local management | 🚧 single project for now — `Reset` discards |
| Mobile polish (drawer, sheet, safe areas) | 🚧 partial |
| Onboarding tour | ⏳ planned |
| Public deploy templates beyond Railway | ⏳ planned |
| Real-time collaboration / multi-user | ❌ explicitly out of scope for v0 |

---

## How it works

1. You write a concrete goal.
2. The AI proposes 1–3 alternative plans via streaming.
3. You pick one → it becomes a navigable tree in React Flow.
4. Detail each node with AI when needed (`Detail with AI`).
5. Execute in tutor mode, confirming step by step.
6. Attach PDFs to the **knowledge base** so the AI grounds plans in your own material.

Concept dive: [`docs/CONCEPT.md`](docs/CONCEPT.md) · panorama: [`docs/cellproject-overview.html`](docs/cellproject-overview.html).

---

## Running locally

```bash
git clone https://github.com/cellproject-builder/cellproject-builder.git
cd cellproject-builder
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). On first run a setup screen appears — pick a provider, paste your key. It lives in this browser's IndexedDB.

### Supported providers

| Provider | Get a key | Default model |
|----------|-----------|---------------|
| **OpenRouter** *(recommended)* | https://openrouter.ai/keys | `z-ai/glm-5` |
| **OpenAI** | https://platform.openai.com/api-keys | `gpt-4o` |
| **Anthropic** | https://console.anthropic.com/settings/keys | `claude-sonnet-4-5` |

**Why OpenRouter is recommended:** it works as a gateway to dozens of models without browser CORS pain, and you can switch model without switching provider. If Anthropic direct-from-browser fails on your network (CORS policy quirks), fall back to OpenRouter.

---

## Privacy

Cellproject is **local-first**:

- ✅ Your API key sits in `IndexedDB` (`cellproject-config`) — only in this browser.
- ✅ Projects live in `IndexedDB` (`cellproject-graph`) — only in this browser.
- ✅ PDFs in the knowledge base are processed locally via `pdf.js`. Only the extracted text is sent to the model you chose, for summarization.
- ✅ No proprietary server in the loop. Your requests go **directly** from your browser to the provider you configured.
- ⚠️ Because this is an SPA, any XSS on the domain hosting it can read the key. Host on a trusted domain and keep dependencies fresh.

To wipe everything: DevTools → Application → IndexedDB → delete `cellproject-config`, `cellproject-graph`, `cellproject-kb`, `cellproject-locale`.

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
- [`nixpacks.toml`](nixpacks.toml) — Node 22 + serve static with SPA fallback

The build runs `npm ci && npm run build` and serves `dist/` via `serve -s` (single-page-app mode with fallback to `index.html`).

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
├── App.tsx                   # ApiKeyGate → ObjectiveScreen → Tutor|Graph
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
