# Cellproject

> Framework visual de planejamento por decomposição. Você declara um objetivo, a IA propõe caminhos completos em árvore, e você valida nó a nó até realizar.

**Local-first · BYOK · open-source · MIT**

- 🌳 **Planejamento como árvore tipada.** Nós são `recurso`, `passo`, `decisao`, `categoria` — não lista plana.
- 📚 **Plano = material didático.** Cada nó traz *o que é*, *por que precisa*, *como confirmar*. Tutor guia execução um passo por vez.
- 🔒 **Ground truth de verdade.** Quatro mecanismos ortogonais quebram o loop fechado IA→IA: critério travado do usuário, crítica adversarial, replan a partir de falha real, âncoras verificáveis no mundo.
- 🧠 **Multi-provider BYOK.** Você traz a chave (OpenRouter, OpenAI, Anthropic). Ela mora só no seu navegador.
- 💾 **Sem backend.** Projetos vivem no IndexedDB do seu navegador. Reload sobrevive, ninguém mais lê.

---

## Como funciona

1. Você escreve um objetivo concreto.
2. A IA propõe 1–3 planos alternativos via streaming.
3. Você escolhe um → vira uma árvore navegável em React Flow.
4. Detalha cada nó com IA quando precisar (`Detalhar com AI`).
5. Executa em modo tutor, confirmando passo a passo.
6. Anexa PDFs ao **repositório de conhecimento** pra IA usar seu material como base.

Conceito completo: [`docs/CONCEITO.md`](docs/CONCEITO.md) · panorama: [`docs/cellproject-overview.html`](docs/cellproject-overview.html).

---

## Rodando local

```bash
git clone https://github.com/SEU-USER/cellproject.git
cd cellproject
npm install
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173). Na primeira vez, vai aparecer a tela de configuração de API — escolha um provider e cole sua chave. Ela fica salva no IndexedDB deste navegador.

### Providers suportados

| Provider | Como obter chave | Modelo padrão |
|----------|------------------|---------------|
| **OpenRouter** *(recomendado)* | https://openrouter.ai/keys | `z-ai/glm-5` |
| **OpenAI** | https://platform.openai.com/api-keys | `gpt-4o` |
| **Anthropic** | https://console.anthropic.com/settings/keys | `claude-sonnet-4-5` |

**Por que OpenRouter é recomendado:** funciona como gateway pra dezenas de modelos sem dor de CORS de browser, e você troca de modelo sem trocar de provider. Anthropic direto do navegador pode dar problema dependendo da política CORS atual deles — se acontecer, use OpenRouter.

---

## Privacidade

Cellproject é **local-first**:

- ✅ A chave da API é guardada em `IndexedDB` (`cellproject-config`) — só neste navegador.
- ✅ Seus projetos ficam em `IndexedDB` (`cellproject-graph`) — só neste navegador.
- ✅ PDFs do repositório de conhecimento são processados localmente via `pdf.js`; só o texto extraído é enviado ao modelo (escolha sua) pra resumir.
- ✅ Nenhum servidor proprietário entra no meio. Suas requisições vão **direto** do seu navegador ao provider que você configurou.
- ⚠️ Por ser uma SPA, qualquer XSS no domínio onde você roda o app pode ler a chave. Hospede em domínio confiável e mantenha a árvore de dependências saudável.

Para apagar tudo: F12 → Application → IndexedDB → exclua `cellproject-config` e `cellproject-graph`.

---

## Deploy

### Railway

```bash
# 1. Conecte o repo no painel do Railway
# 2. Railway detecta automaticamente via railway.json + nixpacks.toml
# 3. Pronto — Railway expõe a URL pública
```

A configuração já vem pronta:

- [`railway.json`](railway.json) — builder e start command
- [`nixpacks.toml`](nixpacks.toml) — Node 20 + serve estático com SPA fallback

O build roda `npm ci && npm run build` e serve `dist/` via `serve -s` (single-page-app mode com fallback pro `index.html`).

### Outros estáticos (Cloudflare Pages, Netlify, Vercel)

Funciona em qualquer host de SPA estática:

- Build command: `npm run build`
- Output directory: `dist`
- Rewrite: `/*` → `/index.html` (modo SPA)

Não há nenhuma env var obrigatória — a chave de API é configurada por usuário no navegador dele.

---

## Stack

- **Vite + React 18 + TypeScript** — SPA pura.
- **@xyflow/react 12** — grafo interativo com lentes (estrutura, fluxo, risco, estado, conexões).
- **Zustand + idb-keyval** — store persistido em IndexedDB.
- **Vercel AI SDK** — `streamObject`, `generateObject`, `generateText`.
- **@ai-sdk/openai · @ai-sdk/anthropic · @openrouter/ai-sdk-provider** — clients dos três providers.
- **Zod** — validação rigorosa de toda resposta do modelo antes de hidratar.
- **Tailwind 3** — paleta própria.
- **pdfjs-dist** — extração de texto de PDF 100% no navegador.

---

## Estrutura

```
src/
├── App.tsx                   # ApiKeyGate → ObjectiveScreen → Tutor|Graph
├── config/
│   └── store.ts              # BYOK: provider + chave + modelos em IDB
├── ai/
│   ├── client.ts             # Multi-provider (OpenAI/Anthropic/OpenRouter)
│   ├── schemas.ts            # Zod schemas
│   └── service.ts            # generatePlans / decomposeNode / explainNode /
│                             # critiqueNode / replanFromFailure
├── kb/                       # Repositório de conhecimento (PDFs)
├── store.ts                  # Zustand graph store
├── types.ts                  # ConceptNodeData, Project, AIPlan, …
└── components/               # ObjectiveScreen, TutorMode, GraphCanvas, etc.
```

Detalhes em [`docs/cellproject-overview.html`](docs/cellproject-overview.html).

---

## Contribuir

PRs bem-vindas. Por favor:

1. `npm run lint` (TypeScript estrito sem erro).
2. `npm test` (vitest verde).
3. Commit mensagens curtas, em português ou inglês — o tom do projeto é direto e prático.
4. Não adicione backend nem telemetria sem discussão antes. O contrato do produto é local-first.

Áreas com baixo hanging fruit:

- Multi-projeto local (hoje o store guarda um projeto por vez).
- KB em `critiqueNode` e `explainNode` (já está em `generatePlans` / `decomposeNode` / `replanFromFailure`).
- Onboarding mínimo explicando "escreva seu critério antes de ver o da IA".
- Templates de domínio (marcenaria, cozinha, etc.).

---

## Licença

MIT — veja [LICENSE](LICENSE).
