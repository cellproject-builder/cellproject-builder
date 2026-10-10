# Sincronização de desenhos — ensaio entre dispositivos

Data: 10/10/2026. Aplicação: Dynamic Diary. Destino: https://builder.cellprojectdiary.com/.

## Estado da evidência

O ensaio começou com um Samsung S9, caneta e Chrome, na mesma conta e no mesmo Board do computador. O usuário confirmou que o traço permanece no tablet, sincroniza e aparece no computador durante o desenho, mas com atraso percebido. Isso confirma o caminho funcional de prévia; fluidez, latência quantitativa, pressão física e a bateria completa continuam sem aprovação.

Regressões automatizadas desta rodada:

- Traço concluído continua visível enquanto um editor focado adia o snapshot; sair do campo permite aplicar o documento sem alterar o texto em edição.
- Reconhecimento de tinta canônica remove a prévia correspondente. Um commit SSE atrasado não recria um traço já recebido pelo snapshot.
- Falha de autenticação do canal informa a sessão expirada; retomada verificada da mesma conta recria a conexão sem reenviar gestos antigos.
- Dois clientes reais trocam envelopes AES-GCM via HTTP e SSE do handler de produção; preview, commit, cancelamento, isolamento, reconexão e encerramento têm cobertura automatizada. Identidades são sintéticas.

## Roteiro físico

Usar um Board descartável identificado como `QA · Tablet e computador · 10-10`, aberto nos dois dispositivos. Repetir depois em uma nota com tinta livre e no mapa de um plano de teste. Não usar localhost para este ensaio: o ambiente Vite não ativa o canal cloud.

| Verificação | Ação | Critério observável | Resultado físico |
| --- | --- | --- | --- |
| Prévia ao vivo | No tablet, desenhar um rabisco lentamente por 5–15 segundos | O computador mostra partes do traço antes de soltar a caneta/dedo | Confirmado pelo usuário no S9, com atraso; fluidez ainda em ajuste |
| Passagem ao salvo | Finalizar o gesto e aguardar o indicador de salvamento | O traço permanece, sem duplicação; recarregar o computador preserva o desenho | Parcial: traço permaneceu no S9 e apareceu salvo no PC; reload deste gesto ainda pendente |
| Caminho inverso | Desenhar no computador com o tablet observando | O tablet recebe a prévia e depois o traço salvo | Pendente |
| Edição textual | No computador, focar um campo de texto enquanto o tablet desenha | A prévia concluída permanece durante o foco; texto e foco são preservados; sair do campo libera o snapshot | Pendente |
| Reconexão | Desconectar e reconectar a rede de um dispositivo sem editar offline | Um novo gesto online volta a aparecer; os desenhos confirmados continuam presentes | Pendente |
| Escopos | Abrir outra nota/Board no computador e desenhar no documento original no tablet | A prévia aparece somente no documento correspondente | Pendente |
| Retomada de login | Quando ocorrer expiração real, entrar na mesma conta e retomar a aba | Novos traços voltam a sincronizar; gestos antigos não são reproduzidos | Pendente — não forçar logout com alterações sem confirmação |

Registrar sistema/navegador dos dois dispositivos, uso de dedo ou caneta, direção do teste e falhas visíveis. Sem relógios sincronizados ou captura dos dois lados, informar apenas latência percebida, sem apresentar um número como medição. Escrita simultânea no mesmo documento ainda pode gerar conflito; esta versão não promete mesclagem automática.

## Registro de execução

Verificação completa do código desta rodada: **1485 testes frontend aprovados, 8 testes externos pulados; 162 testes gateway aprovados**. Build TypeScript/Vite, checagem de organização/links do repositório e auditoria do bundle aprovados. Revisão independente identificou o reaparecimento de traço apagado após commit atrasado; regressão reproduzida, corrigida e conferida novamente.

O usuário confirmou o mesmo quadro aberto no tablet e no computador. Antes de registrar o ensaio, relatou a tela de sessão expirada (`remote-sync`). A reprodução automatizada identificou um defeito: falhas temporárias de Auth/RPC apagavam uma sessão válida e transformavam o pedido seguinte em 401. A correção conserva o handle em 429/5xx/rede e mantém recusas reais protegidas. Não foi capturada a causa exata do evento em produção; deploy/reinício também invalida sessões em memória.

Foi acrescentada retomada por senha na própria aba, com a mesma conta, runtime e rascunhos. A inspeção visual usa uma fixture local com identidade sintética; não equivale a login real. O formulário foi conferido também em 390 × 844, sem transbordamento horizontal. Sessões normais passam a usar registros cifrados no volume Railway, com validade absoluta de 30 dias e nova validação no Supabase após reinício. A primeira transição exige um login; fluxos temporários de redefinição de senha continuam em memória.

Verificação da correção de sessão: **1491 testes frontend aprovados, 8 testes externos pulados; 208 testes gateway aprovados, 1 teste de symlink ignorado no Windows**. A revisão independente conferiu persistência, refresh, logout, concorrência e falhas de disco, sem achados acionáveis. Os **11 testes do armazenamento de sessão passaram sem skips no WSL Ubuntu 24.04 com Node 24.18.0**, usando ambiente sem variáveis de produção e fixtures em `/tmp`. Isso cobre fsync de diretório, permissões e proteção contra symlinks no Linux; não é um ensaio do disco Railway.

A publicação do commit `7d351c8` no deployment Railway `3f83e923-ff07-4ae5-b5b1-6fa281535b3c` terminou com sucesso. `/healthz` e a página responderam 200; o SHA-256 do entrypoint servido correspondeu ao build local. O usuário concluiu um login real por senha no Chrome. A nova aba abriu o quadro com 16 desenhos e indicador de salvamento normal.

Na aba antiga, a retomada revelou `Illegal invocation`: o transporte privado chamava o `fetch` nativo como método da instância. Antes de recarregar, foram comparados os IDs, viewBoxes e paths SVG dos 14 desenhos visíveis com os 16 da nova aba; todos estavam incluídos, sem diferenças. Após a atualização segura e reabertura do quadro, os 16 desenhos reapareceram salvos sem novo login. Esse reload não foi classificado como sucesso da retomada na própria aba.

O receiver foi corrigido na entrada de `VaultTransport` e `LiveInkChannel`. Nove regressões reproduziram a incompatibilidade antes da alteração e passaram depois, incluindo recuperação de rascunho, passagem da configuração, leitura/readback de mídia e GET SSE/POST cifrado. Uma fixture local sintética também passou usando o fetch nativo real do Chromium. A suíte frontend completa ficou em **1500 aprovados e 8 externos pulados**. Revisão independente não encontrou defeitos nos diffs.

O commit `afe25e3` foi publicado no deployment `d99db541-1757-45c6-9d0b-30ce686e2bc1`. O computador atravessou esse deploy, recarregou e abriu o quadro sem pedir senha novamente. Esse resultado comprova continuidade da sessão nesse reinício, sem comprovar todos os cenários de recuperação.

## Primeiro gesto físico e diagnóstico de atraso

O usuário confirmou o mesmo quadro aberto nos dois aparelhos, o rabisco visível depois de levantar a caneta e, em seguida, esclareceu: **"Durante o desenho, mas com atraso"**. O computador mostrou os desenhos canônicos com indicador normal de salvamento. A inspeção do Chrome registrou conexão SSE HTTP/2 com resposta 200, heartbeats de 13 bytes separados por aproximadamente 15 segundos e chunks maiores durante o gesto, sem falha de rede observada. Tamanho de chunk não equivale a contagem de frames.

Não houve captura sincronizada dos dois aparelhos. Portanto, não há medida válida da latência tablet → computador, nem aprovação da fluidez. Contagens de objetos mudaram durante a sessão, mas não foram correlacionadas às ações de apagar/desenhar do usuário; não permitem afirmar perda de dados.

Um novo teste integrado usa `BoardCanvas`, `CloudInkConnection`, `LiveInkChannel`, criptografia e parser SSE reais. Com o gesto ainda ativo, verifica publicação e recepção de prévias com pressão, antes de `pointerUp` ou gravação canônica, e depois a renderização receptora e o isolamento de escopo. Layout React Flow e fronteira HTTP usam fixtures; as duas UIs são montadas sequencialmente porque o canal é global por janela. O teste não mede hardware ou Railway.

A investigação identificou uma pausa adicional no cliente: um POST lento era seguido por outros 100 ms antes da próxima prévia. A correção mantém a primeira espera e o intervalo mínimo entre envios, mas desconta o tempo já consumido pela rede. Não altera autenticação, cifra ou serialização. Também foram identificadas escritas sem alteração de título/viewport, capazes de gerar conflito desnecessário entre abas. O reteste físico após essas correções permanece pendente.

Verificação desta correção: **1512 testes frontend aprovados e 8 externos pulados**; build TypeScript/Vite, organização do repositório, links e auditoria do bundle aprovados. No teste com POST de 250 ms, a prévia pendente iniciou em 350 ms, em vez de 450 ms; com POST de 20 ms, iniciou em 200 ms, em vez de 220 ms. São tempos de um teste controlado do agendador, não medições da rede ou do S9. Regressões cobrem título inalterado, movimentos automáticos, navegação durante callback e persistência dos botões de zoom. Revisão independente não encontrou bloqueadores.
