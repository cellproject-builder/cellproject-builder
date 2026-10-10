# Senha única e acesso privado — 10/10/2026

## Resultado e situação da entrega

O Dynamic Diary passa a usar a senha da conta para abrir o cofre em seus aparelhos. O fluxo normal não pede frase separada nem download de chave. Um link temporário por e-mail permite redefinir a senha em um aparelho já autorizado, preservando a chave e o conteúdo atuais.

**Implementação, testes locais e publicação concluídos; reinício vazio da conta autorizado e executado posteriormente.** A migration foi aplicada no Supabase P&D preservando o cofre existente. Depois, o usuário confirmou explicitamente “Apagar cofre e começar vazio”, e foi executado o reset descrito abaixo. Os testes usam credenciais e dados fabricados; o usuário deve concluir o novo login sem compartilhar sua senha com agentes.

### Reset autorizado do cofre

Em 10/10/2026, a conferência anterior ao reset encontrou um cofre, uma operação de ativação, cinco sessões de Auth e nenhum arquivo no Storage. Uma transação administrativa restrita ao proprietário e ao ID exato do cofre, com o advisory lock utilizado pelo produto, apagou o cofre e seu ledger de ativação, encerrou as sessões da conta e conferiu a ausência de dados legados. Os envelopes adicionais seriam removidos por cascata; estavam vazios. Nenhuma tabela, função, política, conta ou senha foi removida.

A consulta posterior confirmou zero cofres, envelopes, operações, catálogos de anexos, documentos legados, objetos do Storage e sessões antigas para essa conta. A identidade continuou admitida, com a senha de login preservada. A tela publicada voltou a “Entrar”. A remoção de chaves e preparações locais do Chrome ficou pendente da ação manual do usuário, pois o controle do navegador não permite excluir IndexedDB nem abrir configurações internas. Foi solicitado excluir somente os dados de `builder.cellprojectdiary.com`; o localhost permanece separado e não foi apagado.

Railway: projeto `externo` (`38067bb4-755b-4caa-b005-e5eee0b9640d`), environment `production` (`499d99a5-a4e8-4224-9b71-1b2768023c65`), service `cellproject-builder` (`cf9b32e5-21a2-4b2f-8e9c-d1ba11562fb8`). Deploy `3a7264e8-b285-4d4e-8d13-04b4017a1984`: **SUCCESS**. Fonte: snapshot validado do workspace com alterações locais sobre `ab793fd7328e35057c97efb46f282cacdeabc3d9`, sem representar um novo commit/merge. Deploy anterior conhecido: `b3a52501-4bd2-492b-91fd-b18fb53783f4`, com suporte ao cofre legado.

Verificação independente: `https://builder.cellprojectdiary.com/healthz` e shell retornaram 200, configuração pública confirmou cofre e Auth direto habilitados, CSP permitiu somente o projeto Supabase fixado. No Chrome, o reload exibiu “Entrar”, e-mail, senha e opções de criação/recuperação, sem campo de frase. A tentativa anterior digitada foi limpa, e o acesso foi reiniciado; a chave de dados e o cofre remoto foram conservados. O localhost `http://127.0.0.1:5190/` continuou respondendo 200 e ficou aberto.

## Fluxo implementado

1. O navegador envia a senha diretamente ao Supabase Auth. O backend próprio recebe tokens, confere a conta autorizada e estabelece seu cookie HttpOnly. A senha não passa pelas rotas novas do backend de armazenamento.
2. Um aparelho autorizado abre a chave não extraível já guardada no seu IndexedDB. Ele lê a recuperação interna cifrada e prepara um envelope protegido pela mesma senha da conta.
3. O cliente prova localmente que essa recuperação corresponde à chave e faz round-trip do envelope pela senha antes de publicá-lo. O PUT e a leitura de confirmação conferem revisão e conteúdo publicado.
4. Em outro aparelho, a senha abre esse envelope; a recuperação interna abre o mesmo cofre, e a abertura autenticada do manifesto confirma o conteúdo. O aparelho guarda o handle não extraível para acessos seguintes.
5. O reset por e-mail faz um preflight com o aparelho autorizado antes de alterar a senha no Auth. Depois atualiza o envelope adicional. Se a senha foi alterada e falta concluir a proteção, a interface conserva o acesso local e permite retomar a confirmação.

O link de e-mail recupera a identidade de acesso, não transporta uma chave que decifra o conteúdo. **Sem a senha que abre o envelope e sem um aparelho autorizado, os dados antigos não podem ser recuperados automaticamente.** Se o envelope ainda não foi criado e também faltam as credenciais anteriores, a conta não pode ser migrada automaticamente apenas por autenticar o e-mail.

## Arquitetura e preservação dos dados

O envelope `dynamic-diary-password-access` v1 usa PBKDF2-HMAC-SHA-256 com 600.000 iterações e salt aleatório de 128 bits. A chave derivada é usada com AES-GCM de 256 bits, nonce de 96 bits, tag de 128 bits e AAD ligado ao formato, conta e ID do cofre. O corpo remoto contém somente a recuperação interna cifrada e os parâmetros públicos necessários para a abertura.

A vinculação preserva a chave de dados, o ID, o cabeçalho imutável, o manifesto atual e todos os anexos. O manifesto continua sendo versionado normalmente pelos salvamentos do produto; não é regravado para trocar a senha. Registros locais inválidos só podem ser reparados depois de abrir e autenticar o cofre correspondente.

A migration [20261010163258_dynamic_diary_password_access.sql](../../supabase/migrations/20261010163258_dynamic_diary_password_access.sql) acrescenta uma tabela de acesso e um ledger de operações. RLS restringe leitura ao proprietário admitido; escritas diretas são revogadas. Funções privilegiadas privadas conferem identidade, sessão ativa, proprietário e cofre canônico. Wrappers públicos usam `SECURITY INVOKER`. As atualizações usam CAS, lock por conta e operationId idempotente, sem modificar as estruturas do cofre anterior.

As responsabilidades estão separadas em [autenticação direta](../../src/cloud/passwordAuth.ts), [interface de abertura](../../src/cloud/PasswordVaultGate.tsx), [cifra e confirmação do envelope](../../src/cloud/vault/passwordAccess.ts), [preflight de alteração de senha](../../src/cloud/vault/passwordSetup.ts) e [repositório do gateway](../../server/passwordAccessRepository.mjs).

## Limites que continuam válidos

- Cofres antigos podem ter somente um handle não extraível e não possuir a recuperação interna salva. O sistema conserva os dados e exige migração assistida; não exporta o handle nem cria um cofre substituto para contornar a ausência de credenciais.
- Auth e a tabela de envelopes não pertencem a uma transação única. O preflight, o aparelho autorizado e o retry de confirmação protegem o caminho de recuperação; uma falha entre etapas continua sendo apresentada ao usuário.
- O Supabase Auth recebe a senha para autenticar a conta. A senha correta junto do envelope abre os dados, e senhas fracas estão sujeitas a tentativas offline. Tokens de sessão, banco e Storage isoladamente não fornecem a chave.
- Um dispositivo comprometido, extensões maliciosas, XSS ou uma futura versão maliciosa do cliente podem acessar conteúdo enquanto desbloqueado. A proteção não é uma garantia absoluta contra quem controla a distribuição do cliente.
- IA, busca e TypeSafe continuam recebendo o contexto que o usuário autorizar compartilhar. A mudança de login não transforma esses provedores em processamento sem acesso ao conteúdo.
- `.ddvault` não substitui a chave de abertura nem oferece restauração independente/offline. Recuperações já exportadas em versões anteriores não são revogadas pela retirada dos botões.
- A aplicação permanece restrita à conta autorizada; a liberação de múltiplas contas depende das demais fronteiras documentadas em [Cofre privado](../encrypted-vault.md).

## Evidência de testes

| Bateria | Resultado | Escopo |
| --- | --- | --- |
| Frontend | 1.462 aprovados; 8 ignorados | Integração local, incluindo autenticação, senha, envelope, abertura e regressões existentes |
| Gateway | 160 aprovados | Sessões, rotas, contratos, autorização, erros e regressões existentes |
| SQL em PGlite 0.5.8 | 11 aprovados | Migration adicional sobre fixtures isolados de Auth/Storage |

As 11 verificações SQL cobrem ACLs após os defaults do Supabase; leitura sem envelope; recusa sem cofre; persistência cifrada; replay idempotente; operationId com corpo diferente; CAS obsoleto; owner/cofre incorretos; usuários não admitidos, sessões expiradas e anon; JSON/KDF/bytes inválidos; substituição com preservação byte a byte do cofre original; e impossibilidade de atualizar tabela/ledger diretamente. Algumas verificações agrupam mais de uma asserção.

O PGlite usa uma sessão exclusiva e memória descartável. Não comprova concorrência entre conexões reais nem funcionamento do Supabase Auth/Storage gerenciado. O runner permanente é [test-password-access-sql.mjs](../../scripts/test-password-access-sql.mjs), executado com o runtime temporário e fixado documentado no próprio arquivo. Nenhuma senha real foi capturada ou digitada por agentes.

## Próximas etapas de publicação

1. Concluído: migration adicional aplicada no Supabase P&D; cofre existente preservado.
2. Concluído: cliente e gateway publicados juntos, com suporte ao cofre, CSP para Auth e rotas de sessão novas.
3. O usuário entra no aparelho já autorizado e vincula sua própria senha; conferir abertura e persistência sem acessar os segredos.
4. Conferir outro aparelho e o reset por e-mail com o usuário, incluindo falha/retry e ausência de autorização local.

O deploy e a estrutura adicional de produção estão confirmados. Os números de teste continuam descrevendo fixtures locais; não comprovam abertura em outro aparelho ou recuperação real por e-mail. O cofre antigo foi posteriormente apagado por decisão expressa do usuário. A nova criação vazia e sua vinculação à senha ocorrerão no próximo login, após limpar as preparações locais antigas no navegador.
