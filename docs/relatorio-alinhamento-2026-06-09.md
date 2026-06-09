# Relatório — Alinhamento do Cellproject à essência · 2026-06-09

> Pergunta respondida aqui: **o projeto está melhor? em quê, com que provas? quão perto ele está da ideia ideal ("decompor o objetivo até o átomo, até entender todas as partes, com `done` só contra a realidade")? e a estrutura/arquitetura sustenta o que ele entrega?**
>
> Método: duas ondas de refatoração commitadas e pushadas hoje (`9d0907c`, `38115c4`), validadas por testes automatizados + teste E2E com IA real no navegador, seguidas de uma auditoria por **3 agentes independentes**: (A) fidelidade à essência, (B) arquitetura, (C) ataque adversarial ao gate anti-loop.

---

## 1. TL;DR

| Pergunta | Resposta |
|---|---|
| Está melhor? | **Sim, mensuravelmente** — 4 bugs de fidelidade eliminados (com mecanismo descrito e teste pinando cada um), o fork do conceito virou a interface do tutor, estado deixou de ser pintável, suite foi de 18 → **23 testes verdes**, e o fluxo inteiro foi provado de ponta a ponta com IA real. |
| Quão perto da essência? | **84/100** (auditoria independente, evidência por file:line). 6 dos 7 princípios do CONCEPT.md estão *incorporados*; o princípio central (P5, anti-loop IA→IA) está *parcial*: o núcleo do gate é real e testado, mas vaza nas bordas (detalhe na §5). |
| O gate anti-loop aguenta ataque? | **Íntegro com ressalvas.** Todo confirm da UI passa pelo gate; sem sinal cai em âmbar com fricção. Mas o que conta como "sinal" ainda é auto-atestável a custo ~zero num caminho específico (âncora sugerida pela IA + checkbox), e o no-peek vaza no zoom do grafo. |
| A arquitetura está certa pro que entrega? | **Correta com ressalvas** — fronteiras de módulo limpas, isolamento IA↔domínio exemplar (tempId/Zod), gate em um único lugar, persistência que nunca dropa dado do usuário. Ressalvas: erro de IA silencioso no decompose, O(n²) num seletor do canvas, texto de PDF inteiro serializado no IndexedDB, ausência de CSP. |
| Faz sentido? | **Sim.** O produto agora *é* a tese, não só descreve a tese. O que falta não é conceito — é endurecer as bordas do que conta como realidade. |

---

## 2. O que foi feito hoje

### Onda 1 — `9d0907c` · "realinha interface e fluxo ao conceito" (11 arquivos, +942/−542)

A essência declarada no `docs/CONCEPT.md` — *"se consegue confirmar, avança; se não consegue, decompõe; se já sabe, é axioma; `done` só com sinal real"* — existia nos documentos e parcialmente no store, mas **a interface não a encarnava**. Agora:

- **O card do tutor é o fork do conceito**, literalmente três ações: ✓ confirmar (gate + fricção em 2 passos sem âncora) · "Não dá pra confirmar ainda → decompor em partes" · "⊢ Já sei isso" (chão da recursão — não existia no tutor).
- **Decisão é decidível no tutor**: as opções aparecem com pitch + consequências e escolher *é* o confirmar da decisão (antes dava pra "confirmar" uma decisão sem escolher opção nenhuma).
- **A sidebar virou a árvore de decomposição real**: grupos com progresso próprio, todas as kinds (recurso/passo/decisão/conceito), ordem da decomposição, navegável (clicar mergulha no nó). Antes: lista plana só de recursos+passos, com containers marcáveis e decisões invisíveis.
- **Estado é ganho, não pintado**: removidos os botões manuais de estado (`problem` só via falha real reportada com contexto) e o slider de confiança (virou display do sinal da IA: valor + fonte + razão).
- **Sinal visível consistente**: zoom próximo do grafo não mostra mais ✓ verde pra confirmado sem âncora; critério do usuário disponível pra kind `concept` ("como vou saber que entendi?"); checkbox da sidebar só confirma em 1 clique quem JÁ tem sinal — sem sinal, roteia pro card com fricção.
- **i18n de verdade**: toda string que o store grava (histórico de auditoria, seeds de projeto, mensagens do gate) passa por `t()` — projeto criado em inglês não sai mais com português fixo no meio.

### Onda 2 — `38115c4` · "canvas do grafo" (5 arquivos, +256/−38)

- **"✥ Organizar árvore"**: layout tidy-tree calculado da decomposição (pai centrado sobre o slot dos filhos, profundidade no eixo y) — um clique resolve o empilhamento de nós que a decomposição via IA gerava. Posições continuam arrastáveis depois.
- **Legenda das arestas** (colapsável): os 4 tipos + sugestão pendente, com o estilo exato de cada um. Antes as cores não tinham explicação em lugar nenhum.
- **Trocar de lente refaz o enquadramento** (fitView animado) e os espaçamentos das lentes fluxo/risco/estado foram corrigidos pra folga real do card no zoom próximo (não sobrepõem mais).
- **Mobile**: minimap escondido (comia a tela), animação de aresta desligada (bateria/jank), e tocar de novo no MESMO nó reabre o sheet de detalhes que tinha sido dispensado (bug real de navegação touch).

---

## 3. Provas de melhoria (antes → depois)

### 3.1 Bugs de fidelidade eliminados — cada um com mecanismo e teste

| # | Antes (verificado no código) | Mecanismo do bug | Depois (com teste pinando) |
|---|---|---|---|
| 1 | Tutor declarava **"Projeto concluído" com trabalho pendente** | nó `concept` em projeto "construir" não contava no progresso nem aparecia no tutor (`projectProgress` filtrava por arquétipo) | concept conta como folha em QUALQUER arquétipo e o tutor o apresenta — teste `a concept counts as a leaf in a build project too` |
| 2 | **Passo seguinte bloqueado pra sempre** após decompor o anterior | container decomposto nunca vira `confirmado`, e `isBlocked` só olhava `confirmado` do irmão | resolução recursiva: sub-passos todos resolvidos = passo resolvido = próximo desbloqueado — teste `a decomposed step unblocks its next sibling…` |
| 3 | **"Já sei" não fechava a subárvore** — filhos de um nó marcado como sabido continuavam pendentes no tutor | `takenAsKnown` era flag de folha; seletores não tratavam como piso | floor de verdade: a subárvore inteira sai da fronteira e o próprio nó vira a folha resolvida — teste `takenAsKnown on a decomposed node closes the whole subtree` |
| 4 | **Tutor ignorava a ordem da decomposição** (recursos de qualquer lugar primeiro, decisões só no fim, sem mergulho) | `nextPendingForTutor` era 3 listas planas por kind | DFS na ordem da árvore: depois de decompor, os filhos vêm antes do próximo irmão ("desce até o átomo") — teste `walks depth-first…` |

Outros consertos menores com evidência: ✓ verde indevido no zoom próximo (`ConceptNode`), decisão "confirmável" sem pick (tutor agora exibe opções), `confirm` 1-clique na sidebar sem sinal (agora roteia pra fricção), histórico bilíngue, plural "sugestãoes"→"sugestões", script `lint` quebrado na árvore limpa (`tsc -b --noEmit` com project references) consertado.

### 3.2 Testes

- **Antes da onda:** 18 testes — e um deles **pinava o comportamento errado** (afirmava que concept NÃO conta em projeto construir, exatamente o bug #1).
- **Depois:** **23/23 verdes** (`npm test`), incluindo os 4 invariantes novos acima + 2 do layout (`computeTreeLayout` sem overlap de irmãos / pai centrado; `applyLayoutPositions`).
- `tsc -b` e `vite build` verdes nas duas ondas.

### 3.3 Prova de fogo — E2E com IA real (OpenRouter, nesta sessão)

Fluxo completo executado no navegador com chave real, console limpo:

1. Configurar provider → **gerar planos** (streaming; veio 1 plano estratégia "Reaproveitar" — o viés reuse-first funcionando).
2. Criar projeto → tutor abriu no primeiro recurso pendente, **com âncora sugerida pela IA** ("Dimensões internas: 50cm × 30cm ± 2cm", badge IA, não-verificada).
3. **Fork em ação**: "Não dá pra confirmar ainda → decompor" → 3 sugestões de reuso em staging inline → aceitar → a sidebar transformou o recurso em grupo (0/3) e **o card mergulhou DFS no primeiro filho** (breadcrumb `…› RECURSOS › CAIXA 50×30 CM`).
4. **Caminho fiel completo**: critério escrito e travado → **só então** o critério da IA foi revelado → heurística marcou "◇ critérios independentes" → atestado como atendido ("medi com fita: 52×31cm…") → o checkbox da sidebar mudou sozinho de "abrir no tutor" pra "confirmar" (o nó ganhou sinal) → confirm **verde**, progresso 1/8 (13%), zero contagem "sem âncora", card avançou pro próximo pendente.
5. **Fricção do caminho infiel**: checkbox de nó sem sinal roteou pro card; "Já executei este passo" abriu o two-step âmbar ("vai confirmar sem âncora…").
6. Canvas: "Organizar árvore" desfez a sobreposição real (ESP32/Montar circuito/Bomba empilhados → árvore limpa); legenda; mobile 390×844 com minimap oculto e sheet reabrindo no re-toque.

Screenshots entregues na conversa (tutor remodelado; antes/depois do organizar).

---

## 4. Quão perto da essência — auditoria A (agente independente, leitura completa do código)

**Nota: 84/100.** Veredito por princípio do CONCEPT.md (evidência por file:line no código):

| Princípio | Veredito |
|---|---|
| P1 Objetivo primeiro | **Incorporado** — sem projeto, a única tela é o objetivo; raiz É o objetivo; sem auto-seleção de plano |
| P2 Decomposição tipada até o átomo | **Incorporado** — decompose recursivo no fluxo, DFS, fronteira de folhas, chão de recursão (tudo com teste) |
| P3 Todo nó validável sozinho | **Incorporado** — oQue/porQue/comoConfirmar obrigatórios no schema; o fork É a UI do card |
| P4 IA coautora, não dona | **Incorporado** — nada entra na árvore sem aceite; modelo nunca vê ids reais |
| P5 O loop nunca fecha dentro da IA | **Parcial** — núcleo genuíno (gate único, atestação obrigatória, âmbar em toda superfície, fricção universal), mas com vazamentos nas bordas (§5) |
| P6 Mesma estrutura, duas views | **Incorporado** — tutor mergulha, grafo vê o todo, mesmos seletores nas duas |
| P7 Tom direto | **Incorporado** — prompts e strings secos e concretos nas duas línguas |

Justificativa do número (do próprio auditor): *"a implementação é incomumente fiel — os seletores do store falam a língua do conceito, o gate é real, testado e mais estrito que o próprio doc. O que segura abaixo de 90 é exatamente onde dói: P5 vaza nas bordas."*

---

## 5. Teste de estresse — auditoria C (adversarial: tentar fakear um projeto verde)

**Veredito: gate íntegro-com-ressalvas.** A máquina de estados está certa — *"todo confirm da UI passa por `canConcludeNode`; sem sinal cai em âmbar com fricção; crítica e falha deliberadamente não contam como sinal (regressão disso foi revertida e está testada)"*. A tese segura o usuário preguiçoso ingênuo. **Não segura um clique deliberadamente vazio:**

- **[CRÍTICA] O furo operante hoje:** âncora **sugerida pela própria IA** + checkbox "verificada" (1 clique, sem digitar nada) → confirm verde (1 clique). 2 cliques por nó = 100% verde contado como "com sinal", com a IA tendo sido autora do "sinal". Assimetria gritante: o critério (a) exige observação textual de COMO sabe; a âncora (d) não exige nada.
- **[ALTA] No-peek furado no canvas:** o zoom próximo do grafo imprime o `comoConfirmar` da IA sem checar lock — dá pra ler, copiar e travar "seu" critério. (O `explainNode` também entrega "HOW TO VERIFY" antes do lock.)
- **[ALTA] `entender` 100% axioma celebra:** marcar "já sei" em toda folha de um projeto entender dá 100% verde festivo — axioma é piso legítimo pontual, não atestado de projeto inteiro.
- **[ALTA] Verde stale:** `clearFailure` restaura `done` com sinal pré-falha sem re-atestação; desverificar/remover a última âncora não rebaixa o `done`.
- **[MÉDIA]** `force:true` conta como "com sinal" no split (sem chamador na UI hoje — risco latente); `updateNode` aceita patch arbitrário de campos do gate (sem binding na UI hoje — falta defesa em profundidade); **a demo embarca ~11 `done` pintados sem sinal** — a vitrine contradiz a tese que demonstra.

Esses achados são o **roadmap natural da próxima onda** (ranqueado na §8). Nenhum deles desfaz o progresso — todos existiam antes das ondas de hoje; a diferença é que agora estão enumerados com evidência.

---

## 6. Arquitetura — auditoria B (a estrutura sustenta o que o produto entrega?)

**Veredito: CORRETA-COM-RESSALVAS** para um SPA local-first BYOK de árvores de decomposição validadas.

**Pontos fortes (com evidência):**
1. **Isolamento IA↔domínio exemplar**: o modelo nunca vê ids internos (`tempId→nanoid` concentrado no service), todo output passa pelo firewall Zod antes de tocar o domínio, prompts parametrizados por locale, chave nunca entra em prompt.
2. **O gate em exatamente um lugar** (`canConcludeNode`) e todos os caminhos de mutação passam por ele — com testes cobrindo os vetores conhecidos.
3. **Persistência que nunca dropa dado do usuário** (migrate pass-through + campos opcionais, documentado no código).
4. Camadas claras (`App` gating → components → store/seletores → ai/kb/i18n/config), lazy-loading correto (landing, pdf.js), chunking deliberado no Vite, `tsc -b` gateando o build.

**Ressalvas (ranqueadas pelo auditor):**
- **R1 (médio):** texto integral de PDF (`extractedText`) serializado no IndexedDB a cada mutação do KB — payload cresce a MBs com PDFs grandes; basta excluir do `partialize`.
- **R3 (médio):** erro de Zod/IA em `decomposeNode`/`replanFromFailure` é **silencioso** na UI (spinner para, nenhuma mensagem) — padrão de erro já existe no ObjectiveScreen, falta replicar.
- **R5 (médio):** sem CSP no deploy — pra um app BYOK, restringir `connect-src` aos domínios dos providers reduz muito o risco de XSS exfiltrar a chave.
- **R2 (baixo):** `isBlocked` chamado por nó no GraphCanvas reconstrói `childrenByParent` a cada chamada = O(n²) por render (sub-ms até ~100 nós; fix de 3 linhas).
- Menores: `alert()` único em `requireAI`, `idbStorage` triplicado, migrate é cast cego, hydration da IA (`hydratePlan`/`materializeNode`) sem teste unitário.

---

## 7. Faz sentido? — síntese honesta

**Sim, e agora de um jeito verificável.** Antes das ondas de hoje, a tese do produto morava nos documentos e num gate que a interface contornava: o tutor não sabia decompor com fricção certa, decisões não eram decidíveis, conceitos sumiam do progresso, estado era pintável à mão e a confiança era um slider. Hoje o loop central — **olhar UMA parte → confirmar contra a realidade OU decompor OU declarar piso** — é a tela principal, os seletores falam a língua do conceito (fronteira, piso de recursão, DFS), e três auditores independentes confirmam: 84/100 de fidelidade, arquitetura correta, gate íntegro no caminho ingênuo.

A distância restante até o ideal está concentrada num único ponto filosófico: **o que conta como "realidade"**. Hoje, um checkbox auto-atestado numa âncora escrita pela IA passa pelo gate. É o mesmo padrão que o projeto já matou duas vezes (peek-before-lock, critério travado-mas-não-atestado) — a próxima onda é aplicar o mesmo remédio na âncora (exigir observação/evidência) e fechar os dois vazamentos de peek. Nada disso exige re-arquitetura: o gate é um só, então endurecer o sinal é mudança localizada.

---

## 8. Próximos passos (consolidado dos 3 agentes, ranqueado por dano à essência)

1. **Âncora exige evidência como o critério** — `toggleGroundTruthVerified` pedir observação (ao menos para `addedByAI:true`), ou hint da IA verificado não contar como sinal pleno. *(mata o furo CRÍTICO)*
2. **Fechar o peek**: esconder `comoConfirmar` no zoom próximo do canvas até o lock; segurar/limpar o "HOW TO VERIFY" do explain pré-lock.
3. **Invariante de rebaixamento**: remover/desverificar o último sinal (e reportar falha) rebaixa `done→validated` e limpa atestação; `clearFailure` exige re-atestação.
4. **`entender` 100% axioma não celebra** (temperar DoneCard/progresso quando tudo é `takenAsKnown`).
5. **Defesa em profundidade**: `force` conta como sem-sinal no split; `updateNode` blindado contra campos do gate; demo re-flagada pra bater com a tese.
6. **Higiene de arquitetura**: erro visível no decompose (R3), `extractedText` fora do partialize (R1), CSP (R5), `isBlocked` com `byParent` (R2), testes de hydration.
7. Itens herdados do backlog: crítico em modelo independente (Rank 10), critério na raiz (Rank 9), override manual do arquétipo, doc-drift CONCEPT.md "travado vs atestado".

---

*Gerado em 2026-06-09. Ondas: `9d0907c`, `38115c4` (ambas em `origin/main`). Auditorias executadas por 3 agentes independentes com leitura integral do código; evidências citadas por arquivo:linha nos relatórios brutos da sessão.*
