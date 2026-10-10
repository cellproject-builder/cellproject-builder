# Anexos conectados ao plano e ao chat

O campo de objetivo e o clipe do chat usam o mesmo leitor local de arquivos. No projeto, os anexos ficam disponíveis pelo `@`, inclusive antes de existir uma árvore. Enviar uma instrução junto de um arquivo permite adaptar o plano existente; enviar apenas um arquivo pede ao assistente uma interpretação e esclarecimento do uso desejado.

## Leitura e persistência

- PDF com texto, até 100 páginas e 8 MB; DOCX, até 8 MB.
- Markdown, texto, JSON, CSV, YAML e arquivos de programação, até 1 MB.
- Até 12 fontes por projeto. Até 24 mil caracteres por arquivo, com sinalização de recorte.
- A aplicação guarda texto extraído e metadados no armazenamento local e no backup JSON do espaço. **Não arquiva os binários originais**, formatação do Word ou programas executáveis. PDF escaneado precisa de OCR externo. `.doc` deve ser convertido para DOCX.
- O modelo recebe trechos limitados, identificados como fontes não confiáveis. Código é lido como texto e nunca executado.

## Classificação e edição

O gateway local usa o `Choice` do TypeSafe (`jev-latest`) para classificar o pedido: consultar referências, complementar, revisar, reorganizar ou esclarecer. A interface mostra a categoria recebida ou a indisponibilidade do classificador. Confiança e probabilidades são estatísticas do modelo, sem equivalência com precisão medida ou autorização humana. Contrato: [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice).

No chat, `planner_action/read_plan` devolve o plano atual, sua revisão e fontes. `planner_structure` aplica um lote de até 24 operações de adicionar, editar e mover. Ele exige a revisão atual, rejeita ciclos, pais inexistentes/resolvidos e fontes de outro projeto, e preserva identidade, observações e critérios humanos. A alteração não confirma nem conclui uma etapa.

As partes alteradas podem guardar `sourceAttachmentIds`. As fontes aparecem junto às notas e ao histórico da parte. O chat mostra o motivo, a lista de mudanças e **Desfazer estrutura**. O desfazer só vale durante a sessão e enquanto o plano, os rascunhos e as sugestões em revisão não receberem outra edição; não sobrescreve trabalho posterior. Uma falha de gravação mantém a auditoria e o desfazer visíveis, com aviso e opção de tentar salvar sem repetir a alteração.

Na criação, anexos entram nas alternativas e na expansão. Uma troca de fontes invalida a escolha de alternativas anteriores e pede nova geração. Edições de rascunho pelo chat são refletidas no formulário.

## Verificação

Testes cobrem leitura de Markdown/código/DOCX, recorte de PDF, cancelamento na troca de projeto, persistência do chat, isolamento de fontes com `@`, alterações atômicas, ciclos, revisão desatualizada, proteção de rascunhos humanos no desfazer e contrato/autorização do gateway TypeSafe. Os testes com mocks verificam a integração, sem demonstrar qualidade semântica do modelo.

Validação em 9 de outubro de 2026: 811 testes da aplicação e 81 do gateway passaram; oito testes externos ficaram ignorados. O build de produção passou.

No navegador local, com TypeSafe e OpenRouter reais, um Markdown sintético foi enviado pelo chat para acrescentar somente “Estudar o controle PWM” a “Experimentos práticos”. O TypeSafe retornou “Complementar o plano”; a etapa foi incluída com a fonte nas notas e no histórico, sem confirmação nem evidência de ensaio. O desfazer restaurou a árvore anterior. [Captura do chat](design/screenshots/2026-10-09-plan-attachments-chat.png).

Na criação do projeto “QA · Anexos conectados”, PDF, DOCX, Markdown e código `.ino` foram anexados pelo seletor de arquivos. O texto do PDF foi conferido no preview. Após recarregar, os quatro anexos continuaram no formulário e disponíveis pelo `@` no chat antes de existir uma árvore. A geração inicial de alternativas com esses quatro arquivos não foi executada nesse teste manual. [Captura da criação](design/screenshots/2026-10-09-plan-attachments-creation.png). As amostras estão em `docs/design/samples/plan-attachment-qa.*`.
