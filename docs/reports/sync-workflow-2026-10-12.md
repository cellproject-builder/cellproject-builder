# Sincronização de ações de workflow entre aparelhos

Depois de conciliar uma edição independente, o runtime já pode conter a tarefa
remota enquanto o editor aguarda uma janela segura para receber esse estado.
Uma nova mudança de status nesse editor era comparada como texto concorrente:
base `todo`, runtime `doing` com descrição remota, nova ação `review`.
O runtime preservava o rascunho, mas bloqueava toda a fila do workspace antes
mesmo de enviar a ação.

## Regra de conciliação

Para tarefas existentes com o mesmo ID e projeto nas três versões, um status
válido alterado pelo comando local é reaplicado sobre a tarefa canônica.
O último comando aceito pelo controle de revisão (CAS) determina o status;
relógios dos aparelhos não escolhem o vencedor. Isso permite também retornar
explicitamente a uma etapa anterior. Um status que não mudou desde a base
acompanha o remoto e não é reaplicado por uma gravação incidental do editor.

Descrição, título e demais conteúdos seguem a comparação de três versões.
Texto incompatível, remoção contra edição e mudança concorrente de projeto
continuam preservados como conflito. Não há sobrescrita integral do documento,
duplicação de projetos para movimentar um cartão ou mudança de criptografia.

Os defaults legados `archivedSession` ausente e `objectiveDraft.expanded`
ausente são comparados como `null` e `{}` nos caminhos exatos do planner.
Isso impede que a hidratação local pareça uma edição concorrente e bloqueie
uma sessão recuperada ou expansão recebida. Valores explícitos são preservados.

## Evidências de regressão

- Comparação de status com relógios divergentes, proteção de texto, identidade,
  mudança de projeto, exclusão e campos fora da coleção de tarefas.
- Dois runtimes com CAS, edição offline, múltiplas alternâncias, checkpoint
  restaurado e recuperação de um rascunho já bloqueado pela versão anterior.
- Dois conjuntos de stores Zustand e bridges reais: edição independente,
  editor defasado, nova ação de status e navegação subsequente sem rollback.
- Dois clientes com WebCrypto e VaultTransport reais, preservação da descrição,
  alternância de status, filas duráveis limpas e restauração do cofre.
- Defaults legados conciliados com sessão arquivada e expansão paga remotas;
  revisões incompatíveis do mesmo texto continuam em conflito.

Os testes usam dados sintéticos e CAS em memória. O ensaio de software não
substitui um novo teste físico simultâneo no PC e no tablet.
