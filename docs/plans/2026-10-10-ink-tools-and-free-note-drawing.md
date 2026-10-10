# Ferramentas de tinta e desenho livre nas notas

## Objetivo e referência

Ampliar as ferramentas do Dynamic Board, das notas e do mapa do Construtor de Planos. Nas notas, o desenho livre fica sobre o conteúdo sem esconder a escrita; o caderno separado continua opcional. A referência de interação é a [barra de Marcação da Apple](https://support.apple.com/pt-br/guide/ipad/ipad6350b8dc/ipados): instrumentos distintos, espessura, opacidade, borracha, seleção e régua numa paleta compacta. Não inclui OCR, Apple Pencil SDK ou funcionalidades de Apple Intelligence.

Este registro foi atualizado contra o código em 10/10/2026. Descreve os contratos implementados nesta rodada, sem afirmar implantação remota, teste com tablet físico ou conclusão da revisão de layout mobile, que está em andamento.

## Contratos

- O núcleo puro de `src/ink` reúne tipos, geometria e validação; `InkStroke` e `InkToolbar` cuidam da apresentação. `PlannerInkLayer` adapta o domínio do plano e `live.ts` possui o transporte efêmero. O núcleo de geometria não acessa stores, IA, rede ou dados de conta.
- Cinco instrumentos: caneta com pressão quando disponível, bico de pena de orientação fixa, monoline uniforme, lápis com textura e marca-texto translúcido. `tool` e `opacity` são opcionais nos documentos legados, sem sintetizar campos nem alterar sua aparência. Não há simulação de inclinação física da caneta.
- Board mantém desenhos como objetos individuais. Seleção, apagar e laço usam as operações e o histórico existentes; cada gesto concluído é uma operação. Cancelamento não salva um traço parcial.
- O mapa do plano conserva tinta em `project.visuals.ink`, com coordenadas próprias do canvas e o mesmo pan/zoom dos nós. Desenhar, apagar ou desfazer tinta não altera a árvore, suas relações ou evidências. O histórico de tinta da sessão é separado do histórico estrutural.
- `Note.ink` guarda exclusivamente a camada livre. `Note.canvas` continua sendo o caderno opcional de imagens, textos e diagramas. As duas estruturas não se substituem.
- A camada livre cobre o corpo da nota, passa eventos ao texto fora do modo de desenho e mantém o mesmo layout ao ativar a caneta.
- Cada traço pode registrar a seção de origem (título ou bloco) e seu retângulo no momento do desenho. No reflow, acompanha a seção; se ela for removida, mantém coordenadas de fallback. Isso não é ancoragem a caracteres individuais de texto.
- Validação estrita: até 2.000 traços, 4.096 pontos por traço e 100.000 pontos por documento; números finitos, limites de coordenadas e estilos. Backups, hidratação, migração e exportação devem conservar a camada.
- Escritas consultam a nota atual e respeitam exclusão/desmontagem. Desfazer tinta não desfaz edições de texto ou anexos concorrentes.
- As paletas mostram instrumentos, cor e ações; espessura e opacidade aparecem no ajuste aberto pela pessoa. Nas notas, as ferramentas ficam junto ao topo do editor, inclusive as do caderno opcional, sem flutuar no meio do documento.
- Notas de projeto aparecem no agrupamento virtual `Projetos → projeto`. Pastas pessoais e seus IDs não são migrados. A biblioteca oferece recentes dos últimos sete dias e ordenação por atualização ou nome.
- A família compartilhada de ícones é Lucide, com traço de espessura consistente e cantos arredondados. A aparência de projetos conserva IDs persistidos e catálogo compatível. Ver [personalização de projetos](../project-appearance.md).

## Entre dispositivos

O [canal de tinta ao vivo](../modules/ink-live-sync.md) separa a prévia do gesto do documento canônico:

- Board, nota livre, caderno e plano usam escopos independentes por documento. Prévias são cifradas no cliente com a sessão do cofre e passam por SSE/POST autenticados no servidor Node existente, destinado ao Railway. O relay não usa Supabase Broadcast e não persiste frames.
- Prévias exigem a mesma conta, o mesmo cofre desbloqueado e a capability `liveInkAvailable`. Ao bloquear ou sair, o canal descarta seu estado efêmero. O relay atual opera em um processo; múltiplas réplicas exigem pub/sub compartilhado.
- Ao concluir o gesto, o caminho normal salva o documento e o canal emite `commit`. A ponte `CloudLiveSync` busca revisões confirmadas, preserva navegação/viewport local e evita eco de persistência. Polling visível/online de dois segundos é o fallback.
- O refresh é bloqueado durante edição local, ingestão, IA, rascunhos, gravações e conflitos. Revisões CAS continuam protegendo os documentos completos; não há CRDT ou união automática de edições simultâneas.
- Sem cofre, documentos já salvos podem atualizar por polling, mas os pontos do gesto não são enviados legíveis pelo relay. Offline não há prévia entre dispositivos nem fila cloud durável.

## Execução e responsabilidades

| Frente | Fronteira implementada |
| --- | --- |
| Motor de tinta | `src/ink/model.ts`, `geometry.ts`, `InkStroke.tsx`, `InkToolbar.tsx` e schemas de documento. |
| Board | Gestos e objetos individuais em `src/boards`, com histórico e cotas do próprio quadro. |
| Notas | `NoteInkOverlay`, `NoteCanvas`, biblioteca, modelos e caminhos existentes de backup/hidratação/exportação. |
| Planner | `PlannerInkLayer`, validação de tinta no workspace visual e guard de contexto do plano. |
| Transporte e sincronização | `server/live-ink.mjs`, `src/ink/live.ts`, runtime cloud, transporte do cofre e `CloudLiveSync`. |
| Aparência | `SoftIcons`, paletas compactas e estilos das superfícies; revisão mobile em andamento. |

As frentes preservam os domínios existentes. A dependência `lucide-react` foi adicionada para os ícones; desenho não exige outra chave de IA. A ativação remota do canal depende da configuração e publicação do servidor, não apenas do build local.

## Verificação

Exercitar estilos/pressão, legado sem mudanças, limites, roundtrip, undo/redo, cancelamento, borracha em movimentos rápidos, seleção, resize e preservação de texto/caderno. As suítes de transporte devem cobrir cifra real, isolamento por conta, sequências, reconexão, cancelamento e encerramento; as de snapshot devem verificar corrida com escrita local, revisão CAS, aplicação sem eco e navegação preservada.

Consolidar TypeScript, suíte, build e verificações do repositório após as frentes terminarem. Conferir renderização e controles em desktop e tela estreita no localhost, mantido aberto. Os resultados finais pertencem ao relatório da rodada; este plano não transforma testes disponíveis em testes executados. Testes de mouse não comprovam qualidade de pressão, latência ou ergonomia de uma caneta física.
