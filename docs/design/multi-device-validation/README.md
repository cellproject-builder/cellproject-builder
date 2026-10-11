# Ensaio isolado de concorrência

Com Vite local ativo, abrir `/docs/design/multi-device-validation/`. A página importa o runtime, o transporte cifrado e o painel reais do aplicativo, mas usa registros sintéticos e CAS em memória. Não acessa a conta ou os documentos de produção.

1. Fechar o aviso pelo botão; o indicador deve permanecer disponível.
2. Executar a edição simultânea. Esperar `passed: true`, nota e quadro preservados e `pending: 0` nos dois clientes.
3. Reabrir pelo indicador. Com foco dentro do painel, pressionar Escape; o aviso deve fechar e o foco voltar ao indicador.

Resultado conferido no navegador em 10/10/2026: uma rejeição por revisão, conciliação concluída e segunda edição do quadro preservada junto da nota. Este ensaio não mede rede de produção nem substitui teste em dois aparelhos físicos. A [análise da correção](../../reports/multi-device-conflict-fix-2026-10-10.md) registra contratos e limites.
