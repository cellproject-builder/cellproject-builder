# Cellproject — Conceito

## Pitch em uma frase

Cellproject é um **framework visual de planejamento por decomposição**: o usuário declara um objetivo concreto, a IA propõe caminhos completos em forma de árvore, e o usuário valida nó a nó até realizar.

## Problema que resolve

Planejar algo novo (construir, montar, aprender) trava em dois pontos:

1. **Paralisia inicial** — não sei por onde começar, não sei o que existe, não sei o que vem antes do quê.
2. **Perda de contexto durante a execução** — o plano vira uma lista opaca, cada item vira uma tarefa cega, a razão de cada passo se perde.

Ferramentas tradicionais (to-do lists, kanban, mapas mentais livres) resolvem metade: ou estruturam mal ou estruturam sem ensinar. Cellproject assume que planejar e aprender são a mesma atividade — a árvore que guia a execução é também o material didático.

## Princípios

- **Objetivo primeiro, sempre.** Nada começa sem um `f(X) = ?` escrito. O objetivo é a raiz.
- **Decomposição por tipos.** Todo nó tem um dos papéis bem definidos: `recurso`, `passo`, `decisao`, `categoria`, `concept`. O tipo determina como a IA o decompõe.
- **Cada nó é validável isoladamente.** Um nó carrega `oQue`, `porQue`, `comoConfirmar`. Se o usuário consegue confirmar, avança. Senão, decompõe mais.
- **A IA é co-autora, não dona.** Ela propõe planos e sub-árvores em streaming; o usuário aceita/rejeita por nó ou em lote. Sugestões ficam em staging até confirmação.
- **O loop nunca pode ser fechado só na IA.** Critério gerado pela mesma IA que gerou o plano é teatro. Todo nó precisa de pelo menos uma âncora fora da IA: critério escrito pelo usuário, crítica adversarial, referência verificável no mundo real, ou falha reportada. Sem isso, não há validação real.
- **Mesma estrutura, duas visões.** `graph` pra ver o todo e conectar peças; `tutor` pra mergulhar em um nó e executar.
- **Tom direto, pt-BR, sem rodeio.** Herdado do system prompt do modelo e refletido na UI — "2 varetas de bambu de 40cm", não "alguns materiais".

## Modelo mental

Um **projeto** é uma árvore com metadados:

```
Projeto (objetivo)
└── root
    ├── categoria: Recursos
    │   ├── recurso A
    │   └── recurso B
    ├── categoria: Execução
    │   ├── passo 1
    │   ├── passo 2
    │   └── passo 3
    └── categoria: Decisões            (opcional, só se houver tradeoff real)
        └── decisão X (opção A | B | C)
```

### Tipos de nó (`NodeKind`)

| Tipo        | Papel                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `root`      | O objetivo em si.                                                     |
| `categoria` | Agrupador. Sempre um dos três: Recursos, Execução, Decisões.          |
| `recurso`   | Algo que precisa estar disponível antes da execução.                  |
| `passo`     | Ação concreta, ordenada cronologicamente (`order`).                   |
| `decisao`   | Escolha entre caminhos mutuamente exclusivos (`decisionOptions`).     |
| `concept`   | Nó auxiliar — usar só quando os outros não cabem.                     |

### Estado de um nó (`NodeState`)

`concept` → `validated` → `executing` → `done`
Ou, em qualquer momento: `problem`, `discarded`.

O booleano `confirmado` é ortogonal: marca se o usuário já passou pelo `comoConfirmar`.

### Arestas (`EdgeKind`)

- `direct` — A precede B diretamente (passo N → passo N+1).
- `middleware` — A influencia B via um nó intermediário.
- `independent` — ligação informativa, sem dependência.
- `optional` — caminho alternativo.

### Campos-chave de cada nó

- **Conceituais**: `fx` (função/propósito), `problem`, `pros`, `cons`, `confidence` (0–100 + `confidenceSource`, `confidenceReason`).
- **Didáticos**: `oQue`, `porQue`, `comoConfirmar`, `explicacao` (gerada sob demanda pelo tutor).
- **Ground truth** (ver seção própria): `comoConfirmarUsuario` + `comoConfirmarUsuarioAt`, `critica`, `groundTruthRefs`, `failureContext` + `failureReportedAt`.
- **Execução**: `confirmado`, `order`.
- **Decisão**: `decisionOptions`, `decisionPickedId`.
- **Auditoria**: `history` (linha do tempo de mudanças), `aiSuggested`.

## Fluxos

### 1. Criação do projeto — `ObjectiveScreen`

1. Usuário dá nome e escreve o objetivo.
2. `generatePlans(objective)` pede 1–3 planos alternativos, do mais simples ao mais ambicioso, com streaming (`streamObject`).
3. A tela mostra o plano se montando ao vivo (fase `connecting` → `streaming` → `finalizing` → `done`).
4. Usuário escolhe um plano. `createProjectFromPlan` materializa a árvore no store.

### 2. Exploração e expansão — `GraphCanvas` + `DetailPanel`

1. Visão em grafo (React Flow) com lentes: `structure`, `flow`, `risk`, `state`, `connections` (teclas 1–5).
2. Clique num nó → `DetailPanel` mostra metadados, notas, histórico.
3. Decompor um nó → `decomposeNode(ctx)` gera filhos + arestas conforme o tipo do nó (ver `decomposeGuidance` em `src/ai/service.ts`).
4. Sugestões ficam em **staging** (`pendingSuggestions`): `accept`/`reject` por nó ou em lote. Só entram no grafo após aceite.

### 3. Execução guiada — `TutorMode`

1. Tecla `t` entra no modo tutor; `g` volta ao grafo.
2. Tutor mostra um nó por vez com `oQue` / `porQue` / `comoConfirmar`.
3. `explainNode(ctx)` gera, sob demanda, uma explicação longa em markdown (profundidade de engenheiro sênior, estrutura com títulos em **NEGRITO MAIÚSCULO**).
4. Usuário confirma → `confirmNode` atualiza estado e avança.

### 4. Decisões

Quando um nó é `decisao`, o usuário escolhe uma das `decisionOptions`. A escolha vira histórico (`kind: 'decision'`) e define `decisionPickedId`, que pode condicionar próximos passos.

## Fechando o loop — ground truth

> O maior risco conceitual do Cellproject é o **loop fechado IA→IA**: a mesma IA gera o plano e o critério de confirmação, o usuário confirma, e nenhum sinal da realidade entra. Em troca, quatro mecanismos ortogonais garantem que cada nó possa ser ancorado fora da IA. Nenhum é obrigatório sozinho, mas um nó sem nenhum deles é teatro.

### (a) Critério do usuário, travado antes de ver o da IA

Campo `comoConfirmarUsuario` + timestamp `comoConfirmarUsuarioAt`. O usuário escreve como ele saberia que o nó está concluído, **antes** de a UI revelar o `comoConfirmar` da IA. Após escrever, o campo é travado (`setUserCriterion` recusa sobrescrita quando `comoConfirmarUsuarioAt` já existe). Isso impede que a pessoa copie retroativamente o critério da IA e acredite que os dois concordam.

### (b) Crítica adversarial — segunda passada cética

Função `critiqueNode(ctx)` em `src/ai/service.ts`, com `CRITIC_SYSTEM` distinto do `BASE_SYSTEM` usado pelo planejador. Retorna `{ fraquezas, premissasOcultas, criterioAlternativo }`. O valor real está no `criterioAlternativo`: um critério independente, escrito como se quem avalia fosse cético — se coincidir com o `comoConfirmar` original, o plano é robusto; se divergir, o usuário tem um sinal de que algo merece atenção.

### (c) Replan a partir de falha real

Quando a execução não funciona, o usuário chama `reportFailure(id, context)` — o nó vira estado `problem`, `confirmado` volta pra `false`, e `failureContext` guarda o que deu errado na prática. A UI então pode chamar `replanFromFailure(ctx)` em `src/ai/service.ts`, que devolve uma nova decomposição **sabendo** da falha e com instrução explícita de não repetir a premissa quebrada. A saída passa pelo mesmo staging que `decomposeNode` — o usuário aceita/rejeita.

### (d) Âncoras verificáveis no mundo real

Campo `groundTruthRefs: GroundTruthRef[]`. Cada âncora tem `kind` (`link`, `spec`, `medida`), `label`, `value`, `verificado`, e `addedByAI`. A IA já sugere âncoras via `groundTruthHints` ao gerar planos ou decompor nós — mas elas entram com `verificado: false` e `addedByAI: true`. Só viram verdade depois que o usuário confere no mundo e chama `toggleGroundTruthVerified`. O usuário também pode adicionar âncoras próprias (`addedByAI: false`) via `addGroundTruthRef`. Exemplos: `spec: "Phyllostachys aurea, 40cm ± 2cm, Ø 5-8mm"`, `medida: "peso < 15g"`, `link: URL de tutorial conhecido`.

### Como os quatro se relacionam

| Mecanismo            | Quem inicia     | Quando roda                | Quebra o loop porque…                                |
| -------------------- | --------------- | -------------------------- | ---------------------------------------------------- |
| Critério do usuário  | Usuário         | Antes de ver o da IA       | A pessoa não está só validando — ela também afirma.  |
| Crítica adversarial  | Usuário → IA    | Sob demanda, por nó        | Persona distinta gera um critério independente.      |
| Replan por falha     | Usuário → IA    | Quando a realidade recusa  | O contexto de falha real é o input que a IA não tem. |
| Âncoras verificáveis | IA + Usuário    | No plano, continuamente    | Cada `verificado: true` é um bit de realidade entrando. |

## Arquitetura

- **Frontend puro** (sem backend próprio). Vite + React 18 + TypeScript.
- **Grafo**: `@xyflow/react`.
- **Estado**: Zustand com `persist` + IndexedDB (`idb-keyval`) — projetos sobrevivem a reloads sem servidor.
- **IA**: Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider`. Modelo configurável via env (padrão atual: GLM-5 via OpenRouter).
- **Schemas**: Zod (`PlansResponseSchema`, `DecomposeResponseSchema`) garantem que a resposta do modelo cabe no domínio antes de hidratar.
- **IDs**: `nanoid` em todo lugar que precisa de identidade local.
- **Estilo**: Tailwind com paleta própria (`bg-primary`, `ai-accent`, etc.).

### Contrato com o modelo

Cinco funções públicas em `src/ai/service.ts`. Todas usam `BASE_SYSTEM` exceto `critiqueNode`, que usa `CRITIC_SYSTEM` (persona cética distinta — é o que torna a segunda passada realmente adversarial).

| Função               | System        | Retorno                                 | Uso                                             |
| -------------------- | ------------- | --------------------------------------- | ----------------------------------------------- |
| `generatePlans`      | BASE          | `AIPlan[]` (streaming via callback)     | Tela inicial — 1 a 3 planos alternativos        |
| `decomposeNode`      | BASE          | `{ nodes, edges }` validados por schema | Expandir um nó existente                        |
| `explainNode`        | BASE + tutor  | `string` (markdown)                     | Conteúdo do modo tutor                          |
| `critiqueNode`       | **CRITIC**    | `AdversarialCritique`                   | Ground truth (b) — quebrar o nó como cético     |
| `replanFromFailure`  | BASE          | `{ nodes, edges }` validados por schema | Ground truth (c) — re-decompor com falha real   |

O modelo **nunca** recebe ids reais do projeto — usa `tempId`s curtos que são mapeados para `nanoid`s via `idMap` na hidratação. Isolamento total entre a linguagem do modelo e o domínio interno.

O planejador (`generatePlans` / `decomposeNode` / `replanFromFailure`) é instruído a preencher `groundTruthHints` quando houver âncora natural (medida com unidade, spec concreta, link conhecido). Hints entram no nó como `groundTruthRefs` com `verificado: false` — é o usuário que transforma cada hint em verdade ao conferir no mundo.

## O que Cellproject **não** é

- Não é um gerenciador de tarefas genérico — a estrutura é árvore com tipos fixos, não lista livre.
- Não é uma ferramenta de brainstorming aberta — tudo ancora no objetivo-raiz.
- Não é um chat — a IA responde em objetos validados, não em texto livre (exceto o tutor).
- Não tem multi-usuário, colaboração em tempo real, nem backend. Um projeto vive no IndexedDB do navegador.

## Glossário rápido

- **f(X)** — jargão interno para "qual a função deste nó", herdado do campo `fx`. No topo, é o objetivo; dentro, é a contribuição do nó.
- **Lens** — modo de visualização do grafo. Mesma árvore, ênfases diferentes.
- **Staging** — área onde sugestões da IA aguardam aceite antes de virar parte do projeto.
- **Breadcrumb** — caminho do root até o nó atual, passado pra IA como contexto em `decomposeNode` e `explainNode`.
