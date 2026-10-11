# Editor de notas — escrita e ferramentas discretas

O editor oferece um único convite inicial para escrever. Na biblioteca, uma nota sem texto aparece como “Nota vazia” ou “Desenhos e imagens”, sem repetir o placeholder do corpo. Notas antigas com vários parágrafos vazios conservam todos os blocos e IDs; apenas o primeiro mostra o convite inicial.

O botão de inserir parágrafo é um pequeno `+` na margem, com título e nome acessível. Ao usá-lo, o novo parágrafo recebe o foco. Enter, Shift+Enter, listas, checklist e remoção de blocos continuam usando o modelo existente.

A barra principal conserva formatação, um único ditado para a nota, IA contextual, desenho, imagem e maximização. Fixar, vínculos e lixeira ficam em “Opções da nota”. Cada parágrafo tem um menu discreto de formatação/IA; abrir o menu não altera o trecho selecionado. Escape fecha esse menu e devolve o foco ao parágrafo, preservando a seleção. O texto continua sendo entregue ao chat com a referência explícita da nota e do trecho.

Não houve migração nem alteração de `Note`, `NoteBlock`, canvas ou traços. Montar o editor não reescreve notas antigas. Colagem de imagens, diagramas, desenho sobre a nota, backup, lixeira e persistência mantêm seus caminhos existentes.

## Verificação

Os cinco novos testes foram observados falhando antes da implementação. Depois da mudança, passaram os 43 testes de `Notes.editor`, `Notes`, `NoteTextActions`, `Notes.canvas` e `NotesLibrary`. Eles cobrem fluxo/foco, seleção entregue à IA, ditado, desenho/imagens, backup e preservação dos registros antigos. Esses testes DOM não substituem a conferência visual real em desktop e celular.
