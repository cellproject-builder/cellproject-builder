# Cofre privado do Dynamic Diary

## Estado desta entrega

Implementação disponível no código, com testes usando dados fabricados. A migração SQL cria uma estrutura vazia; não ativa nem cifra automaticamente as contas. A ativação real só acontece quando o próprio usuário escolhe sua frase, baixa a chave de recuperação e um backup criptografado, confirma que os guardou e pressiona **Ativar e abrir cofre**. A frase e a chave de recuperação nunca devem ser informadas a desenvolvedores, agentes ou suporte.

A migração `supabase/migrations/20261010130012_dynamic_diary_encrypted_vault.sql` foi aplicada no projeto P&D em 10/10/2026. O timestamp corresponde ao histórico remoto gerado pelo conector. O rollout mantém **uma réplica** do backend Railway e habilita `CLOUD_VAULT_ENABLED=1`. O localhost Vite continua local, com dados locais intactos e sem migração automática. Para conferir a interface sem serviços reais, usar uma página de prévia isolada com `CloudBootstrap` e fetch fabricado.

Depois da primeira ativação, **não desligar a flag nem reverter para um build sem suporte ao cofre**. O banco recusa as escritas legadas, mas versões antigas da interface não conseguem abrir os dados cifrados. Um rollback exige conservar o suporte ao desbloqueio; não se deve restaurar os documentos em texto legível para contornar isso.

## Proteção e limites

O navegador cifra conversas, projetos, notas, planos, preferências, documentos e metadados dos arquivos antes do envio a Railway/Supabase. O servidor guarda um manifesto cifrado, arquivos cifrados com identificadores aleatórios e duas cópias cifradas da chave de dados. Nomes, títulos, MIME, IDs privados, relação com projeto e hash dos bytes originais ficam dentro do manifesto. Fora dele ficam identidade da conta, identificador público do cofre, salt/KDF, revisão, horários, tamanhos, quantidade de objetos e hashes do conteúdo **cifrado**.

Quem possui apenas o banco, Storage, JWT ou senha de login não recebe a chave que abre esse conteúdo. Essa proteção não cobre um dispositivo comprometido, extensões maliciosas, XSS, nem código alterado por quem publica a aplicação enquanto o cofre está aberto. Não é uma garantia absoluta contra um desenvolvedor que controle futuras versões do cliente. JavaScript não oferece garantia de zerar todas as cópias de memória; o bloqueio descarta as chaves e caches sob nosso controle e recarrega a página.

**IA, busca e TypeSafe têm outra fronteira.** O primeiro POST para `/api/ai/*` ou `/api/visuals/*` exige consentimento explícito para compartilhar contexto durante a sessão desbloqueada. Ao aceitar, o servidor e os provedores recebem o contexto necessário, que pode incluir textos e anexos. Não prometemos processamento de IA sem acesso do operador. Bloquear/reabrir exige consentimento novamente; chamadas de leitura de capacidades não compartilham o conteúdo do cofre.

Exportações individuais JSON/TXT/JavaScript e arquivos baixados por ação explícita do usuário continuam sendo arquivos legíveis. O backup **global** e o resgate passam a ser `.ddvault` cifrados por padrão quando o cofre está ativo.

## Chaves, recuperação e múltiplos dispositivos

- Chave de dados aleatória de 256 bits; AES-GCM com nonce aleatório de 96 bits, tag de 128 bits e chave de uso não extraível após criação/desbloqueio.
- Frase exclusiva do cofre, diferente da senha de login: mínimo de 12 caracteres, máximo de 1.024 bytes UTF-8. Preferir uma frase longa e imprevisível. PBKDF2-HMAC-SHA-256 com 600.000 iterações e salt aleatório de 128 bits protege uma cópia da chave de dados.
- Recuperação: segredo aleatório independente de 256 bits protege outra cópia da mesma chave. O arquivo TXT de recuperação é uma credencial; deve ser guardado fora da aplicação e separado dos backups.
- AAD vincula cada cifra à versão do formato, conta, cofre e finalidade. O manifesto inclui a revisão; arquivos usam seu UUID opaco; exports incluem um UUID único por pacote, tipo, índice e quantidade de blocos.
- Novo dispositivo: autenticar na conta e desbloquear com a frase ou chave de recuperação. Alterar a senha de login não altera nem recupera o cofre.
- Esta versão oferece desbloqueio por recuperação. Alteração/rotação da frase e colaboração entre usuários ainda não estão implementadas.

O `.ddvault` contém owner, cabeçalho e blocos autenticados suficientes para a recuperação criptográfica futura, mas **a interface atual só importa o backup quando o cofre original está desbloqueado**. Ainda não existe um assistente independente/offline para restaurar depois de perder a conta ou o registro remoto do cofre. Portanto, este release não deve ser apresentado como recuperação de desastre autônoma; preservar a chave e o backup é necessário, e o fluxo independente de restauração é uma frente pendente.

## Ativação e dados anteriores

1. O usuário autentica normalmente. Nenhum store da aplicação é importado enquanto um cofre existente estiver bloqueado.
2. Se ainda não há cofre, ele pode continuar sem ativar ou preparar sua frase exclusivamente no cliente.
3. O usuário baixa a chave de recuperação e um backup cifrado dos documentos remotos atuais; o cliente não apaga IndexedDB/localStorage legados.
4. A ativação exige confirmação de posse dos arquivos. O cliente conserva o mesmo nonce/corpo/operationId quando uma resposta de ativação se perde.
5. A transação SQL compara o conjunto completo de revisões legadas, recusa qualquer mídia legada no catálogo **ou objeto antigo no Storage**, remove os documentos e ledger antigos e publica o manifesto cifrado atomicamente. Divergência aborta a transação inteira.

**Contas com arquivos antigos exigem migração assistida.** Não tentamos apresentar objetos antigos em texto legível como privados. Depois de ativar uma conta sem esse legado, todos os novos anexos e imports passam pelo transporte cifrado. Objetos órfãos de tentativas interrompidas do novo cofre continuam cifrados e privados; coleta/retention não é feita no caminho crítico. Excluir um arquivo do manifesto não remove seus bytes cifrados nem libera a quota registrada nesta versão; a coleta de objetos e liberação de quota exigem uma frente própria.

A remoção das linhas atuais não apaga retroativamente logs, exports, cópias de suporte, PITR ou backups históricos do provedor. Essas cópias seguem suas políticas de retenção. Não afirmamos que dados anteriormente armazenados em texto legível se tornaram retroativamente secretos.

## Concorrência, falhas e bloqueio

O transporte serializa documentos, importação, catálogo e exclusões sobre um manifesto com CAS. Antes de iniciar outra mutação, resolve qualquer commit de resultado ambíguo repetindo exatamente o corpo cifrado e operationId. A cifra dos uploads/UUID é conservada durante a tentativa. Uploads só são publicados no manifesto após leitura e conferência criptográfica dos bytes. Conflitos de outro dispositivo preservam os rascunhos e exigem resolução; não sobrescrevemos pelo relógio local.

O backend reserva a operação legada **antes** da verificação assíncrona do cofre. Ativação retorna 429 se outra operação dessa conta está em andamento; enquanto ativa, novas operações legadas retornam 409. Os triggers SQL de documentos, ledger, catálogo e Storage usam o mesmo advisory lock por proprietário e recusam escritas legadas após ativação, incluindo o upload final sob `service_role`. A barreira Node é por processo: **uma réplica Railway é requisito desta entrega**, também consistente com as sessões Auth atuais em memória. O teste SQL isolado não prova agendamento entre conexões do Supabase gerenciado.

**Bloquear cofre** conclui o salvamento e recarrega sem persistir a chave. Se a sessão ou rede falhou, é possível baixar o resgate cifrado e bloquear sem concluir uma chamada remota. Processos de IA/anexos em andamento devem ser concluídos/interrompidos antes do resgate/bloqueio para não perder resultados. O estado protegido é permanente nessa página: uma corrida durante o bloqueio nunca deve mudar silenciosamente exportação ou IA para modo sem proteção.

Limites: manifesto cifrado até 96 MiB (wire até 130 MiB), arquivo original até 10 MiB (imagens até 5 MiB), objeto cifrado até 15 MiB e catálogo até 700 MiB de objetos cifrados registrados. Backup/resgate: até 600 MiB de ZIP/JSON legível antes da cifra, em blocos de 16 MiB autenticados individualmente; import limita o arquivo cifrado a 850 MiB e continua validando os limites do backup original. O uso de memória para arquivos grandes continua relevante em celulares; nenhum conteúdo é truncado silenciosamente.

## Contratos

- `GET /api/cloud/config`: `vaultAvailable:true` apenas com a flag habilitada.
- `GET /api/cloud/vault`: `{vault:null}` ou `{header,manifest,revision}`; nenhum conteúdo privado legível.
- `POST /api/cloud/vault/activate`: `{header,manifest,expectedDocuments:[{key,revision}],operationId}`.
- `PUT /api/cloud/vault`: `{manifest,baseRevision,operationId}`.
- `POST /api/cloud/vault/blobs`: `{id,sha256,base64}`; UUID aleatório, hash e bytes cifrados, content-type octet-stream.
- `GET /api/cloud/vault/blobs/:uuid`: bytes cifrados privados, sem nome/MIME original no response.

As rotas mantêm sessão HttpOnly, same-origin/CSRF, limites de bytes e normalização de erros existentes. Não há chave em env, localStorage, IndexedDB, cookie ou logs da aplicação. O ledger novo guarda hashes de requisições cifradas e respostas de revisão, sem snapshots em texto legível.

## Verificação e fontes

Testes cobrem chave errada, conta/finalidade/revisão errada, adulteração, recuperação, parâmetros KDF, concorrência, corpo de retry idêntico, upload ambíguo, bootstrap bloqueado, consentimento, bloqueio durante backup e export/import. `scripts/test-vault-sql.mjs` executa migrações e 29 verificações em PostgreSQL WASM isolado com Auth/Storage fabricados; não usa contas nem segredos reais. Os serviços Auth/Storage gerenciados e a escolha real de frase requerem validação/handoff separado.

Referências: [WebCrypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), [OWASP PBKDF2](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [limites de segurança do WebCrypto](https://www.w3.org/TR/webcrypto/#security-considerations), [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
