# Edição offline cifrada

O usuário confirmou que o Dynamic Diary está instalado no Samsung S9 e escolheu editar notas, planos e desenhos sem rede e sincronizar ao reconectar. A aplicação continua usando a mesma senha e os aparelhos autorizados, sem frase adicional ou arquivo de recuperação obrigatório.

## Contrato

- Somente um aparelho que já abriu o cofre com conta confirmada pode preparar uma cópia offline. Um primeiro acesso precisa de internet.
- A cópia e os rascunhos ficam cifrados no IndexedDB, vinculados à conta, ao cofre e ao cabeçalho. Nunca usar o armazenamento legado legível como fallback de uma falha remota.
- A reabertura offline usa a autorização local previamente estabelecida e a chave desse aparelho. Não equivale a confirmar a sessão no servidor; ao reconectar, confirmar novamente a mesma conta antes de enviar alterações.
- Sair da conta revoga a abertura offline deste navegador. Não apagar rascunhos pendentes para fazer logout.
- Gravar o diário local antes de enviar uma operação. Uma resposta perdida deve repetir o mesmo identificador e o mesmo ciphertext. Confirmar a gravação local antes de sinalizar que está salva no aparelho.
- Um único editor por conta/cofre em abas da mesma origem protege o diário. Sem exclusão mútua disponível, não habilitar persistência offline silenciosamente.
- Reconectar retoma o envio. Conflitos de revisão preservam o rascunho e interrompem a substituição; nenhuma política de último escritor vence é introduzida.
- Arquivos já consultados podem ser guardados cifrados. Arquivos ainda não baixados, novos uploads, IA e pesquisa exigem conexão nesta entrega.
- Falha ou falta de espaço local deixa aviso claro, preserva o conteúdo em memória e não afirma que está salvo no aparelho.
- A exclusão dos dados do site ou o descarte do armazenamento pelo navegador pode remover alterações ainda não enviadas.

## Critérios

Testar fechamento/reabertura com edição pendente, resposta perdida após commit remoto, corrupção/troca de conta ou cofre, logout, duas abas, quota e conflito com outro aparelho. Testes sintéticos não substituem o ensaio físico S9/computador.
