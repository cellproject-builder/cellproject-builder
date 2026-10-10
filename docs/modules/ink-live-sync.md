# Desenho entre dispositivos e sincronização canônica

> Canal publicado e regressões ampliadas em 10/10/2026. A bateria automatizada inclui clientes, AES-GCM, HTTP e SSE reais com identidades sintéticas. O ensaio simultâneo em tablet e computador físicos continua pendente; veja o [roteiro e registro](../reports/ink-device-validation-2026-10-10.md).

## Finalidade

Exibir o traço que está sendo produzido em outro dispositivo da mesma conta, sem esperar o desenho inteiro terminar. Ao concluir o gesto, o documento salvo substitui essa prévia temporária. Board, desenho sobre a nota, caderno e mapa do plano compartilham o transporte; cada superfície conserva seu próprio documento e coordenadas.

O canal de prévias não é um editor colaborativo de texto nem um mecanismo de resolução automática de conflitos. O documento persistido continua sendo a fonte canônica. Os dois dispositivos precisam ter acesso ao mesmo cofre desbloqueado para trocar prévias cifradas.

## Responsabilidades e contratos

| Camada | Responsabilidade | Código |
| --- | --- | --- |
| Motor de tinta | Ferramentas, pontos, pressão e desenho SVG | [model.ts](../../src/ink/model.ts), [InkStroke.tsx](../../src/ink/InkStroke.tsx) |
| Cliente ao vivo | `LiveInkChannel`, escopos, sequências, cifra, expiração e cancelamento | [live.ts](../../src/ink/live.ts) |
| Relay efêmero | SSE autenticado e POST de envelopes opacos, isolados por conta | [live-ink.mjs](../../server/live-ink.mjs) |
| Snapshot canônico | Revisões confirmadas, rascunhos, fila, refresh e conflitos | [runtime.ts](../../src/cloud/runtime.ts) |
| Transporte do cofre | GET real do cabeçalho, validação, abertura de manifesto e revisão CAS | [transport.ts](../../src/cloud/vault/transport.ts) |
| Ponte para a interface | Aplicar os domínios relevantes preservando a navegação local | [CloudLiveSync.tsx](../../src/cloud/CloudLiveSync.tsx) |
| Bootstrap | Habilitar o canal apenas com capability do servidor e sessão válida; desmontar ao sair | [CloudBootstrap.tsx](../../src/cloud/CloudBootstrap.tsx) |
| Ciclo de autenticação | Pausar o canal expirado e recriá-lo após retomada verificada da mesma conta | [CloudInkConnection.ts](../../src/cloud/CloudInkConnection.ts) |

O escopo da prévia é `{surface: board | note | notebook | planner, documentId}`. O frame aberto contém versão, emissor, identificador de gesto, sequência, fase `preview | commit | cancel` e um traço opcional. `x/y` posicionam o desenho no canvas; âncoras de seção permitem acompanhar o conteúdo das notas. A validação limita pontos, ferramentas e coordenadas antes de renderizar.

## Fluxo de um gesto

1. A superfície registra a atividade local. Enquanto ela está ativa, snapshots remotos não substituem os dados em edição.
2. O cliente mantém a última prévia de cada gesto e envia frames agrupados, aproximadamente a cada 100 ms. Os pontos são cifrados com a `VaultSession` antes do `fetch`; o gateway recebe um envelope AES-GCM.
3. O relay entrega o envelope aos streams SSE autenticados da mesma conta. O destinatário abre e valida o frame, rejeita sequências antigas e o exibe apenas no escopo correspondente.
4. Ao terminar, a superfície salva o desenho pelo caminho normal do domínio e envia `commit`; ao cancelar, envia `cancel`. Prévia não é gravação de documento.
5. Um commit remoto dispara `dynamic-diary:cloud-commit`. A ponte solicita o snapshot imediatamente e repete a leitura em 250, 750 e 1250 ms, porque o commit efêmero pode chegar antes do PUT durável. Polling de 2 s funciona como fallback quando a página está visível e online.
6. O documento validado é aplicado sem reenviá-lo como edição local. Um reconhecimento por superfície, documento e identificador de traço retira somente as prévias concluídas já presentes no documento aplicado. Se o snapshot chegar antes do commit SSE, o mesmo reconhecimento ocorre ao receber o commit. Isso evita duplicação ou reaparecimento de tinta apagada.

A prévia concluída aguarda essa passagem por até dois minutos, em vez de desaparecer após 1,5 s enquanto um campo de texto bloqueia o refresh. O limite impede reter indefinidamente traços cuja gravação nunca foi confirmada; não transforma a prévia em persistência. Uma memória efêmera de até 8192 IDs reconhecidos por escopo, também com expiração de dois minutos, impede que um frame atrasado ressuscite um traço salvo e depois apagado. Ao sair de um editor, a ponte verifica novamente os guards e tenta atualizar o documento. Trocar diretamente entre campos mantém a proteção da edição.

Prévia inacabada expira em 8 s. O canal mantém buffers e filas limitados, descarta intermediários offline e não cria um histórico de frames no banco. Ao bloquear/sair, encerra streams, timers, requests e conteúdo temporário em memória.

No SSE, `response.write(false)` significa que o frame foi aceito pelo buffer e exige aguardar `drain`; não significa desconexão. O relay pausa novas escritas nesse destinatário, sem acumular outra fila de frames efêmeros, e retoma ao receber `drain`. Se o bloqueio durar cinco segundos, ou ocorrer fechamento/erro real, encerra a conexão. Frames efêmeros posteriores podem ser omitidos durante essa pausa, inclusive o aviso de commit: expiração e polling do documento durável continuam sendo os caminhos de recuperação. O relay não garante entrega de cada frame.

## Atualização segura do documento

`CloudRuntime.refreshRemote()` não roda enquanto existe fila, gravação ativa, upload, rascunho ou conflito de escrita. Também consulta o guard da interface: gesto de tinta, ingestão de arquivos, IA em andamento, chat, persistência do grafo e campos de texto em foco. Uma escrita iniciada durante a leitura muda o epoch e invalida aquela atualização remota.

O refresh valida o snapshot antes de trocar valores confirmados. Revisão menor, documento existente desaparecido ou conteúdo diferente sob a mesma revisão são recusados. Somente as chaves solicitadas pela ponte são adotadas: `cellproject-workspace` e `cellproject-graph`. Outros domínios, como chat e configurações, não são reidratados incidentalmente.

No cofre, `VaultTransport.refreshSnapshot()` faz `GET /api/cloud/vault`, serializado com suas mutações. Não tenta resolver uma gravação ambígua durante um refresh. Confere cabeçalho e revisão e abre/valida manifestos novos antes de adotá-los. Um cabeçalho inalterado precisa ter a mesma cifra já autenticada; ela não é novamente decifrada e interpretada a cada tick.

Falhas temporárias de leitura aparecem no status e podem recuperar no próximo poll. Uma falha de escrita ou resultado ambíguo conserva sua identidade e seu rascunho; polling não repete mutações. Revisões novas são adotadas antes da próxima edição local, mantendo o controle de concorrência existente.

GET SSE ou POST de prévia com 401/403 notifica o runtime proprietário e encerra o canal. Após o usuário renovar o login e retomar o salvamento na mesma aba, `CloudRuntime.resumeAfterAuthentication()` verifica a mesma conta e `CloudInkConnection` abre um canal novo com o cofre ainda desbloqueado. Gestos e filas antigos não são reenviados. Respostas tardias de uma conexão descartada não podem expirar um runtime ou cofre novo; logout remove a assinatura de status e impede reabertura.

## Estado local que permanece local

A ponte aplica dados de domínio por setters síncronos, com os adaptadores de persistência suspensos apenas durante essa chamada. Isso impede eco de gravação e evita que o debounce do grafo transforme um refresh em nova escrita. Ao retornar, os adaptadores normais estão restaurados; uma edição posterior segue o caminho comum.

Ela conserva superfície ativa, projeto/Board aberto, seleção, lente, modo de visualização, painel e viewport do Board. O planner continua pertencendo ao mesmo projeto local: o grafo global de outro dispositivo não troca o plano que está sendo mostrado. Remoção ou substituição incompatível desse plano gera conflito.

Rascunhos do planner, prompts visuais e propostas locais permanecem preservados. Prompts do Board e do diagrama de nota vivem no estado React e não são apagados pelo refresh. Se um resultado pronto perde sua referência por mudança remota, os componentes existentes o marcam como desatualizado e exigem nova geração; não aplicam silenciosamente o resultado antigo.

## Limites de entrega

- O relay atual funciona em **um processo Node**. Réplicas, workers e regiões diferentes precisam de pub/sub compartilhado; não há Redis, broker ou fanout distribuído nesta versão.
- Prévias exigem `liveInkAvailable`, cofre desbloqueado e a mesma conta/cofre nos dois dispositivos. `PasswordVaultGate` abre um aparelho novo com a senha da conta quando o vínculo cifrado já existe; sem vínculo, a pessoa precisa primeiro de um aparelho autorizado. O acesso por senha/aparelho está em [dados e privacidade](data-and-privacy.md); frase separada é caminho legado/fallback.
- Sem cofre, há atualização de documentos salvos por polling, sem transmitir frames de desenho legíveis pelo relay.
- Não há CRDT, união automática de dois desenhos simultâneos no mesmo documento nem compartilhamento entre contas. Um conflito de revisão preserva o rascunho e exige resolução explícita.
- Offline não há prévia entre dispositivos nem fila durável cloud. Não fechar/recarregar uma aba com alterações ainda sem confirmação sem antes usar o resgate existente.
- O polling ainda lê o snapshot/manifesto remoto inteiro. Não há endpoint de revisão leve/ETag nem download incremental de strokes nesta entrega; documentos muito grandes precisam de medição antes de ampliar a frequência.
- Latência e precisão em Apple Pencil/S Pen dependem do hardware, navegador e rede. Os testes sintéticos não substituem a validação física tablet → computador.

## Verificações e pesquisa

[runtime.test.ts](../../src/cloud/runtime.test.ts) verifica revisões, rascunhos, corridas de escrita/leitura, aplicação sem eco, descarte ao encerrar e recuperação de leitura. [transport.test.ts](../../src/cloud/vault/transport.test.ts) cobre manifestos cifrados novos, stale/invalid, operação ambígua e atalho seguro de revisão inalterada. [CloudLiveSync.test.tsx](../../src/cloud/CloudLiveSync.test.tsx) cobre strokes de Board/caderno, preservação de navegação, guards, polling, commit e teardown.

[CloudLiveSync.integration.test.ts](../../src/cloud/CloudLiveSync.integration.test.ts) aplica tinta livre de nota e desenho do Board nos stores Zustand reais, confirma ausência de gravação de eco e verifica a revisão base da próxima edição local.

O canal e o isolamento HTTP têm testes próprios em [live.test.ts](../../src/ink/live.test.ts) e [live-ink.test.mjs](../../server/live-ink.test.mjs), incluindo pausa por backpressure, retomada em `drain` e encerramento de conexão bloqueada. Para o artigo, a hipótese observável é que a passagem do rascunho ao modelo compartilhado facilita registrar e discutir evidências. Medir latência entre dispositivos, preservação de traços, interrupções, conflitos e interferência com edição textual; não inferir melhoria pedagógica só pela presença da sincronização.

[live.http.test.ts](../../src/ink/live.http.test.ts) atravessa dois `LiveInkChannel`, sessões AES-GCM independentes, fetch HTTP, o handler de produção e SSE reais. Confere preview antes de terminar, commit, cancelamento, reconexão, revogação e isolamento de uma terceira conta também no stream bruto. A autenticação do fixture é sintética, portanto esse teste não comprova login Supabase nem hardware real. [CloudInkConnection.test.ts](../../src/cloud/CloudInkConnection.test.ts) cobre expiração SSE/POST, retomada da mesma conta, recusa de conta diferente, respostas tardias e encerramento definitivo.
