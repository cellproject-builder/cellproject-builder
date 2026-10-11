# Implementação — chat contextual

**Objetivo:** tornar o assistente preciso sobre a tela, reutilizar a conversa em modo expandido, administrar histórico e compactar contexto aos 60% sem apagar o transcript.

**Arquitetura:** React/Zustand existentes, fotografia de contexto no envio, estado visual independente da rota, sessões compatíveis com persistência v1 e helper de compactação multiprovedor.

1. Contexto e referências (agente): `turnContext`, foco da nota, fontes com origem, prompt canônico e usage do último passo. Testes de escopo e snapshots.
2. Histórico (agente): identidade/metadata, migração, título/arquivo/exclusão e integração do helper no store. Testes de persistência, recuperação e conflito.
3. Compactação (agente): orçamento estimado, limite 60%, resumo incremental sem ferramentas, retenção de turnos íntegros e troca transacional. Testes com summarizer simulado.
4. Interface (root): botão lateral, expandir/recolher, histórico pesquisável, contexto visível e indicador discreto de orçamento. Preservar instância/rascunho. Testes de interação e avaliação local desktop/mobile.
5. Revisão cruzada: critérios ocultos, referências obsoletas, chamadas abortadas, custo de re-render e exclusão concorrente. Documentar resultados e limites, executar suites/build/checks apropriados.
6. Integrar em main e publicar somente com verificações aprovadas; manter localhost 5190 disponível.
