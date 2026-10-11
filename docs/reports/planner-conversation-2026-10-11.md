# Conversa e edição do plano — 11/10/2026

Rodada iniciada em `d24b698`, branch `codex/planner-conversation`. Objetivo: integrar a conversa ao canvas e testar edição do plano junto com trabalho manual.

## Referência e adaptação

Repositório privado `Mega-Vale-Transportes/workspace-megavale`, `main` em `f3be27e9b4dc96153af46062ec8e22be9f4375e9`, conferido ao vivo via GitHub CLI. Fontes: `apps/web/src/components/AiCommandBar.tsx`, `apps/web/src/lib/ai-surface.ts`, `apps/web/src/styles/ai-command-bar.css` e `AiAssistant.tsx`. Modo avançado é a entrada central inferior; expandido é a conversa grande. A referência encaminha conversas longas ao canto; aqui a conversa permanece acima da entrada no canvas para atender ao pedido.

`CanvasChatDock` fica fora da transformação dos nós. A área ao redor deixa passar gestos; só os controles recebem eventos. Uma conversa montada conserva rascunho, fontes, anexos, histórico e sessão ao recolher/expandir. A altura é limitada pelo canvas e o teclado móvel; o enquadramento considera a oclusão. Não foi copiado um segundo runtime ou persistência de chat da referência.

## Defeitos reproduzidos e correções

- Explicação, crítica e decomposição atrasadas usavam premissas antigas: baseline privado antes da preparação do turno, conferido novamente após o provedor.
- Mutação comum sobrescrevia edição manual: identidade/revisão verificadas antes de executar ferramentas.
- Importação podia instalar outro editor durante uma análise: dono do singleton conferido antes de aplicar e de salvar.
- Ler um irmão podia liberar escrita baseada em outro nó antigo: leituras parciais atualizam apenas tokens dos registros retornados; ações globais permanecem conservadoras.
- Resumo paginado omitindo notas e outros campos podia liberar um nó alterado: recuperar um token antigo exige detalhe completo, e a leitura global só libera ações globais quando todos os tokens estão atuais.
- Rascunhos locais do inspetor escapavam da revisão persistida: registro efêmero por proprietário, sem copiar o texto, limpo ao concluir/cancelar/desmontar.
- Teclas em controles do chat podiam trocar a lente do plano: atalhos respeitam foco interativo, composição, evento tratado e modo expandido.
- Recibo de falha ao salvar reaparecia ao mudar o portal: confirmação de salvamento e undo persistidas no transcript.
- Digitação reprocessava buscas históricas: componentes memoizados, cache fraco de resultados imutáveis e invalidação pelas fontes reais, inclusive liberação temporal de critérios.
- Enquadrar uma parte podia colocá-la atrás do chat: câmera mede a área ocupada pela conversa a cada enquadramento, sem assinar o streaming.
- Escape em um controle externo ao chat expandido alterava o canvas oculto: listener do grafo respeita o modo expandido.

## Bateria de testes

`src/chat/plannerConversation.integration.test.ts` usa stores, persistência e agendamento de ferramentas do AI SDK reais, com modelo determinístico e fronteiras externas substituídas. Cobre criação/seleção de plano, edição, adição e movimento de ramos, exclusão preservando artefato 3D, aprovação/rejeição de sugestões, undo persistido, troca/importação de plano, cancelamento e conflitos durante preparação/análise. Inclui leitura parcial seguida de escrita e preservação de critérios privados fora do prompt.

`AssistantChat.test.tsx` cobre entrada central, uma instância do compositor, rascunho e histórico através de recolhimento/expansão, teclado/foco, viewport móvel, recibos e invalidação de buscas. `DetailPanel.plannerEdits.test.tsx`, `plannerEdits.test.ts` e `App.shortcuts.test.ts` exercitam campos reais e atalhos. Defeitos concorrentes e regressões históricas tiveram falha observada antes da correção.

Resultados finais: `npm test` passou com **2.496 testes aprovados e 8 testes live omitidos**, em 231 arquivos aprovados. A integração de conversa/plano tem **31 cenários**. A suíte de câmera/organização tem **45 testes**, incluindo oclusão do chat e Escape. `npm run test:gateway` passou com **226 aprovados, 1 omitido e nenhuma falha**. `npm run build`, `check:bundle`, `check:repo` e `git diff --check` passaram. O bundle não carrega estaticamente os módulos pesados proibidos pelo contrato; os avisos existentes de chunks maiores que 500 kB continuam presentes, sem alegação de otimização global nesta rodada.

Ensaio visual local com componentes, AI SDK, ferramentas e stores reais; resposta do provedor substituída por SSE determinístico, sem chamada paga. Foram exercitados envio, adição de um passo (7 → 8 nós), undo (8 → 7), edição manual pelo inspetor, contexto seguindo a seleção, recolhimento/expansão com rascunho preservado, histórico e canvas maximizado. Viewports: desktop 1440 × 900, tablet 1024 × 768 e celular 390 × 844. Sem overflow horizontal ou erros no console. Teclado móvel foi verificado pelo contrato de `visualViewport` em teste automatizado, sem ensaio com teclado físico nesta rodada.

Evidências: [entrada central](assets/planner-conversation-2026-10-11/desktop-entrada.png), [edição aplicada](assets/planner-conversation-2026-10-11/desktop-edicao.png), [tablet maximizado](assets/planner-conversation-2026-10-11/tablet-expandido.png), [celular](assets/planner-conversation-2026-10-11/celular-edicao.png).

## Limites

Testes determinísticos provam contratos de execução, não a qualidade semântica de qualquer modelo real. Esta rodada não mede latência de rede, sincronização física de tablet, fluidez global de todos os módulos ou validade de um plano de engenharia. Desfazer estrutural continua conservador: edições posteriores/recarregamento podem expirar o recibo. O baseline protege conflitos na sessão; não substitui a conciliação de revisões entre aparelhos. Após edição manual concorrente de texto longo, detalhe truncado ou leitura isolada por `textField` não libera o token inteiro: pode ser necessário novo envio. Board e notas continuam com a apresentação anterior do chat.
