# Sincronização de desenhos — ensaio entre dispositivos

Data: 10/10/2026. Aplicação: Dynamic Diary. Destino: https://builder.cellprojectdiary.com/.

## Estado da evidência

O usuário confirmou possuir um tablet disponível. O ensaio físico depende de abrir a mesma conta e o mesmo documento no tablet e no computador. Até existir observação registrada, não classificar a sincronização física, a pressão da caneta ou a latência da rede como aprovadas.

Regressões automatizadas desta rodada:

- Traço concluído continua visível enquanto um editor focado adia o snapshot; sair do campo permite aplicar o documento sem alterar o texto em edição.
- Reconhecimento de tinta canônica remove a prévia correspondente. Um commit SSE atrasado não recria um traço já recebido pelo snapshot.
- Falha de autenticação do canal informa a sessão expirada; retomada verificada da mesma conta recria a conexão sem reenviar gestos antigos.
- Dois clientes reais trocam envelopes AES-GCM via HTTP e SSE do handler de produção; preview, commit, cancelamento, isolamento, reconexão e encerramento têm cobertura automatizada. Identidades são sintéticas.

## Roteiro físico

Usar um Board descartável identificado como `QA · Tablet e computador · 10-10`, aberto nos dois dispositivos. Repetir depois em uma nota com tinta livre e no mapa de um plano de teste. Não usar localhost para este ensaio: o ambiente Vite não ativa o canal cloud.

| Verificação | Ação | Critério observável | Resultado físico |
| --- | --- | --- | --- |
| Prévia ao vivo | No tablet, desenhar uma espiral lentamente por 5–10 segundos | O computador mostra partes do traço antes de soltar a caneta/dedo | Pendente |
| Passagem ao salvo | Finalizar o gesto e aguardar o indicador de salvamento | O traço permanece, sem duplicação; recarregar o computador preserva o desenho | Pendente |
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

O receiver foi corrigido na entrada de `VaultTransport` e `LiveInkChannel`. Nove regressões reproduziram a incompatibilidade antes da alteração e passaram depois, incluindo recuperação de rascunho, passagem da configuração, leitura/readback de mídia e GET SSE/POST cifrado. Uma fixture local sintética também passou usando o fetch nativo real do Chromium. A suíte frontend completa ficou em **1500 aprovados e 8 externos pulados**. Revisão independente não encontrou defeitos nos diffs. O usuário confirmou o tablet atualizado no mesmo quadro; o traço físico ainda aguarda observação.

Ensaio físico ainda não executado. Preencher com observações reais, sem substituir este registro por resultados de testes emulados.
