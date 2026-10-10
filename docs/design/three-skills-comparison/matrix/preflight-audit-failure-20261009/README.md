# Registro de bloqueio local, anterior à inferência

Em 2026-10-09, o primeiro despacho foi bloqueado pela auditoria local de payload: 16 células registraram `request-audit-failed`, e 16 ficaram bloqueadas pela reserva de custo desconhecido. **Nenhuma requisição passou desse guard para o fetch remoto; nenhuma resposta de modelo foi obtida.** Portanto, não são 16 tentativas de inferência nem 16 falhas do modelo.

O [manifesto original](manifest.json) e os arquivos de `runs/` foram preservados integralmente. A causa foi reproduzida com o SDK e provider instalados, schema completo e transporte simulado: o provider serializa `system.content` como uma lista de um bloco de texto, enquanto a auditoria esperava uma string. A correção aceita as duas representações e exige o mesmo texto integral, sem blocos adicionais. Os seis testes de fronteira passaram, incluindo mensagens com e sem pixels reais das fixtures; nenhuma rede foi usada nesses testes.

A matriz principal foi preparada novamente com ID `three-skills-matrix-v2` após essa correção. Isso não repete nem seleciona respostas do modelo, pois nenhuma foi enviada ou recebida nesta pré-execução. Uma nova falha de auditoria local também passa a interromper o dispatcher imediatamente, após preservar o bloqueio.

Os campos de custo originais permanecem `null`; a ausência de envio remoto é conhecida pela posição do guard no fluxo, e não deduzida desses campos.
