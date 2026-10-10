# Edição offline cifrada

O modo cloud com cofre conserva uma cópia cifrada e uma fila durável no aparelho previamente autorizado. Notas, planos e desenhos usam as mesmas ações e documentos existentes. A nuvem continua canônica; rascunhos não confirmados são preservados para envio posterior.

## Abertura e reconexão

O primeiro acesso precisa de internet, login e cofre aberto. [CloudBootstrap](../src/cloud/CloudBootstrap.tsx) prepara checkpoints de transporte/runtime antes de registrar a autorização offline. A PWA guarda somente o shell público; documentos privados nunca entram no Cache Storage do service worker.

[OfflineRepository](../src/cloud/offline/repository.ts) grava checkpoints, recibos e mídia consultada em IndexedDB cifrado com contexto de conta/cofre e versão. Web Locks limita a edição a uma aba por perfil. A cópia é validada antes de importar os stores; uma falha não abre o legado local de outra modalidade.

[OfflineWorkspace](../src/cloud/offline/session.ts) verifica a mesma conta e o cabeçalho remoto ao reconectar. Operações ambíguas repetem ciphertext, revisão base e identidade originais. Recibos só são descartados após checkpoint confirmado. Sem fila pendente, adota o head canônico mais recente; durante edição, espera o canvas ficar ocioso. Reconexão não resolve conflito por relógio nem substitui rascunhos silenciosamente.

O status diferencia salvo neste aparelho, pendente na nuvem, erro local/quota e conflito. Logout revoga a autorização offline antes de encerrar o acesso; não limpa silenciosamente os rascunhos pendentes. Entrar novamente verifica a mesma conta antes de retomá-los.

## Limites

- IA, pesquisa, transcrição e novos uploads precisam de internet e conta confirmada. Gravação de voz pode ficar na prévia aberta, sem persistir o áudio.
- Só arquivos já consultados e presentes no cache cifrado ficam disponíveis offline. O aplicativo não baixa toda a biblioteca antecipadamente.
- O navegador pode apagar dados por quota, limpeza do site ou perda do perfil. Salvo neste aparelho não é backup externo.
- O aplicativo precisa permanecer aberto para reconectar e transmitir. Não há serviço de sincronização em segundo plano com a aplicação fechada.
- Conflitos interrompem a fila e preservam o trabalho para decisão explícita. Não há colaboração simultânea sobre o mesmo documento offline com merge automático.
- Web Locks, IndexedDB e WebCrypto são requisitos. Perda da chave/aparelho e restauração independente são outros contratos; este recurso não redefine a senha nem cria uma chave de recuperação nova.

## Evidência

[repository.test.ts](../src/cloud/offline/repository.test.ts), [session.test.ts](../src/cloud/offline/session.test.ts), [runtime.test.ts](../src/cloud/runtime.test.ts), [transport.test.ts](../src/cloud/vault/transport.test.ts) e [CloudBootstrap.offline.test.tsx](../src/cloud/CloudBootstrap.offline.test.tsx) exercitam criptografia real no runtime de teste e armazenamento/rede fabricados: reload, replay, conflito, head recente, quota, autorização e respostas perdidas.

O usuário confirmou anteriormente instalação como aplicativo e transmissão durante um traço no S9/Chrome, com atraso. Isso não comprova esta nova fila offline. Ainda é necessário ensaiar no S9: abrir online, ficar offline, desenhar/editar, conferir salvo no aparelho, fechar/reabrir e reconectar; conferir no computador sem conflito. O resultado físico não é presumido a partir das suítes.
