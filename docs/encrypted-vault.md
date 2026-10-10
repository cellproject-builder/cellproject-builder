# Cofre privado do Dynamic Diary

## Estado desta entrega

O fluxo atualizado oferece **Proteger meus dados neste navegador**: um botão cria a chave, confirma sua persistência neste perfil do navegador e ativa o armazenamento cifrado. Não exige outra senha, frase, backup ou download para entrar. Recuperação e backup podem ser baixados depois em **Dados e backup**. Esta atualização está validada no código e em navegador com dados fabricados; sua publicação é uma etapa separada. As migrações SQL criam estruturas vazias e não ativam contas automaticamente.

A migração `supabase/migrations/20261010130012_dynamic_diary_encrypted_vault.sql` foi aplicada no projeto P&D em 10/10/2026. O timestamp corresponde ao histórico remoto gerado pelo conector. A correção aditiva `20261010131431_dynamic_diary_vault_safe_writes.sql` acrescenta condições explícitas aos DELETEs: a configuração gerenciada recusava o DELETE de limpeza sem WHERE, causando erro 502 na ativação. Também restringe as permissões padrão das tabelas do cofre. A conferência após a correção preservou os dois documentos legados, sem ativar cofre. O rollout mantém **uma réplica** do backend Railway e habilita `CLOUD_VAULT_ENABLED=1`. O localhost Vite continua local, com dados locais intactos e sem migração automática.

Depois da primeira ativação, **não desligar a flag nem reverter para um build sem suporte ao cofre**. O banco recusa as escritas legadas, mas versões antigas da interface não conseguem abrir os dados cifrados. Um rollback exige conservar o suporte ao desbloqueio; não se deve restaurar os documentos em texto legível para contornar isso.

## Proteção e limites

O navegador cifra conversas, projetos, notas, planos, preferências, documentos e metadados dos arquivos antes do envio a Railway/Supabase. O servidor guarda um manifesto cifrado, arquivos cifrados com identificadores aleatórios e duas cópias cifradas da chave de dados. Nomes, títulos, MIME, IDs privados, relação com projeto e hash dos bytes originais ficam dentro do manifesto. Fora dele ficam identidade da conta, identificador público do cofre, salt/KDF, revisão, horários, tamanhos, quantidade de objetos e hashes do conteúdo **cifrado**.

Quem possui apenas o banco, Storage, JWT ou senha de login não recebe a chave que abre esse conteúdo. A chave permanece neste perfil do navegador. O login controla sua abertura pela interface, mas não é um segredo criptográfico nem protege contra quem acessa o perfil do navegador diretamente. A proteção não cobre dispositivo comprometido, extensões maliciosas, XSS ou código alterado por quem publica a aplicação. Não é uma garantia absoluta contra um desenvolvedor que controle futuras versões do cliente, nem uma promessa de proteção por hardware. JavaScript não oferece garantia de zerar todas as cópias de memória; sair descarta as chaves e caches em memória sob nosso controle, conservando a chave lembrada no navegador.

A aplicação online continua restrita à identidade única autorizada. **Esta entrega não está pronta para liberar múltiplas contas simultaneamente.** Antes dessa liberação, activate/write/blob devem receber um `expectedOwnerId` validado no servidor: a conferência atual da conta antes de abrir a interface não elimina uma troca de cookie entre snapshot e POST. Esse vínculo adicional é uma frente registrada, não uma garantia já entregue.

**IA, busca e TypeSafe têm outra fronteira.** O primeiro POST para `/api/ai/*` ou `/api/visuals/*` exige consentimento explícito para compartilhar contexto durante a sessão desbloqueada. Ao aceitar, o servidor e os provedores recebem o contexto necessário, que pode incluir textos e anexos. Não prometemos processamento de IA sem acesso do operador. Bloquear/reabrir exige consentimento novamente; chamadas de leitura de capacidades não compartilham o conteúdo do cofre.

Exportações individuais JSON/TXT/JavaScript e arquivos baixados por ação explícita do usuário continuam sendo arquivos legíveis. O backup **global** e o resgate passam a ser `.ddvault` cifrados por padrão quando o cofre está ativo.

## Chaves, recuperação e múltiplos dispositivos

- Chave de dados aleatória de 256 bits; AES-GCM com nonce aleatório de 96 bits, tag de 128 bits e chave de uso não extraível após criação/desbloqueio.
- O navegador guarda um `CryptoKey` não extraível em IndexedDB, por structured clone; nunca exporta os bytes brutos da chave para persistir. O registro é vinculado à conta, ID do cofre e fingerprint do cabeçalho completo. Um probe autenticado e a abertura do manifesto confirmam que a chave corresponde aos dados. Não extraível impede `exportKey`; código autorizado no mesmo perfil ainda pode usar a chave para decifrar.
- O cabeçalho v1 continua compatível com cofres por frase: PBKDF2-HMAC-SHA-256, 600.000 iterações e salt de 128 bits. Na criação pelo botão, a frase é aleatória e descartada; não existe uma nova frase que o usuário precise memorizar. Cofres antigos continuam aceitando sua frase original (12 caracteres até 1.024 bytes UTF-8) ou recuperação.
- Recuperação: segredo aleatório independente de 256 bits protege outra cópia da mesma chave. A cópia local desse segredo fica cifrada com a chave de dados e finalidade própria. O download TXT é opcional e contém uma credencial legível: guarde fora do navegador e não a informe a agentes, desenvolvedores ou suporte. Lembrar um cofre antigo por frase não inventa uma nova chave de recuperação; nesse caso, a frase ou chave original continua necessária.
- AAD vincula cada cifra à versão do formato, conta, cofre e finalidade. O manifesto inclui a revisão; arquivos usam seu UUID opaco; exports incluem um UUID único por pacote, tipo, índice e quantidade de blocos.
- Neste navegador, a abertura automática só começa depois da configuração remota confirmar autenticação, conta autorizada e ausência de troca obrigatória de senha. Após decifrar, o cliente confere a conta novamente antes de importar os stores da aplicação. Se a chave não corresponde, o navegador solicita recuperação ou a frase antiga.
- Novo dispositivo: autenticar e informar a recuperação ou frase antiga; **Lembrar neste navegador após o login** vem marcado e pode ser desmarcado em perfis compartilhados. Alterar a senha de login não altera nem recupera a chave. Logout mantém o navegador lembrado, mas fecha a sessão em memória. Limpar os dados do site remove a chave lembrada; sem recuperação ou frase antiga, o acesso aos dados será perdido.
- Não há rotação da frase/chave, assistente para esquecer seletivamente este navegador ou colaboração entre usuários nesta versão.

O `.ddvault` contém owner, cabeçalho e blocos autenticados suficientes para a recuperação criptográfica futura, mas **a interface atual só importa o backup quando o cofre original está desbloqueado**. Ainda não existe um assistente independente/offline para restaurar depois de perder a conta ou o registro remoto do cofre. Portanto, este release não deve ser apresentado como recuperação de desastre autônoma. Backup e recuperação são opcionais na interface, mas guardar a recuperação fora do navegador permite reabrir o cofre quando a chave local se perde; o fluxo independente de restauração continua pendente.

## Ativação e dados anteriores

1. O usuário autentica normalmente. Nenhum store da aplicação é importado enquanto um cofre existente estiver bloqueado.
2. Se ainda não há cofre, ele pode continuar sem ativar ou pressionar **Proteger meus dados neste navegador**.
3. O cliente cria a chave, a recuperação e o manifesto inicial. Guarda o handle não extraível, a recuperação cifrada e a preparação cifrada em IndexedDB; leitura de volta, probe e conferência da recuperação são obrigatórios **antes** do POST. Falha nesse armazenamento impede a ativação. Não há download obrigatório nem remoção de IndexedDB/localStorage legados.
4. A preparação conserva o mesmo nonce/corpo/operationId em erro 502, resposta perdida ou reload. Uma tentativa ambígua não cria outra chave. Se o servidor já publicou o cofre, o bootstrap usa a mesma chave lembrada e abre o manifesto; se ainda não publicou, o botão retoma a preparação original após conferir o snapshot. Desmontar a interface cancela callbacks tardios e impede uma recuperação de lembrar a chave depois do cancelamento.
5. A transação SQL compara o conjunto completo de revisões legadas, recusa qualquer mídia legada no catálogo **ou objeto antigo no Storage**, remove os documentos e ledger antigos e publica o manifesto cifrado atomicamente. Divergência aborta a transação inteira.

**Contas com arquivos antigos exigem migração assistida.** Não tentamos apresentar objetos antigos em texto legível como privados. Depois de ativar uma conta sem esse legado, todos os novos anexos e imports passam pelo transporte cifrado. Objetos órfãos de tentativas interrompidas do novo cofre continuam cifrados e privados; coleta/retention não é feita no caminho crítico. Excluir um arquivo do manifesto não remove seus bytes cifrados nem libera a quota registrada nesta versão; a coleta de objetos e liberação de quota exigem uma frente própria.

A remoção das linhas atuais não apaga retroativamente logs, exports, cópias de suporte, PITR ou backups históricos do provedor. Essas cópias seguem suas políticas de retenção. Não afirmamos que dados anteriormente armazenados em texto legível se tornaram retroativamente secretos.

## Concorrência, falhas e bloqueio

O transporte serializa documentos, importação, catálogo e exclusões sobre um manifesto com CAS. Antes de iniciar outra mutação, resolve qualquer commit de resultado ambíguo repetindo exatamente o corpo cifrado e operationId. A cifra dos uploads/UUID é conservada durante a tentativa. Uploads só são publicados no manifesto após leitura e conferência criptográfica dos bytes. Conflitos de outro dispositivo preservam os rascunhos e exigem resolução; não sobrescrevemos pelo relógio local.

O backend reserva a operação legada **antes** da verificação assíncrona do cofre. Ativação retorna 429 se outra operação dessa conta está em andamento; enquanto ativa, novas operações legadas retornam 409. Os triggers SQL de documentos, ledger, catálogo e Storage usam o mesmo advisory lock por proprietário e recusam escritas legadas após ativação, incluindo o upload final sob `service_role`. A barreira Node é por processo: **uma réplica Railway é requisito desta entrega**, também consistente com as sessões Auth atuais em memória. O teste SQL isolado não prova agendamento entre conexões do Supabase gerenciado.

**Sair e bloquear** conclui o salvamento e encerra a sessão de login no servidor antes de descartar a chave em memória e recarregar. A chave lembrada continua no navegador e só abre pela interface após o próximo login. Falha no logout mantém esta sessão e seus rascunhos, mostrando o erro. Se um salvamento falhou, baixar explicitamente o resgate cifrado parcial habilita **Sair após baixar resgate**, inclusive com fila pendente; isso não transforma o pacote parcial em backup completo. Não é um bloqueio offline independente do login. Processos de IA/anexos devem ser concluídos/interrompidos antes de resgatar/sair. O estado protegido é permanente nessa página: uma corrida durante a saída não deve mudar exportação ou IA para modo sem proteção. O descarte do runtime é idempotente, para callbacks antigos não fecharem uma sessão nova.

Limites: manifesto cifrado até 96 MiB (wire até 130 MiB), arquivo original até 10 MiB (imagens até 5 MiB), objeto cifrado até 15 MiB e catálogo até 700 MiB de objetos cifrados registrados. Backup/resgate: até 600 MiB de ZIP/JSON legível antes da cifra, em blocos de 16 MiB autenticados individualmente; import limita o arquivo cifrado a 850 MiB e continua validando os limites do backup original. O uso de memória para arquivos grandes continua relevante em celulares; nenhum conteúdo é truncado silenciosamente.

Na sessão desbloqueada, o transporte conserva fingerprints SHA-256 de método, rota e corpo, em vez de acumular os corpos completos dos autosaves ou o base64 dos anexos. O cache de respostas confirmadas usa uma janela FIFO de até **128 respostas e 512 KiB em UTF-8**. Ao sair dessa janela, a resposta é descartada e fica um recibo compacto: repetir o operationId expirado provoca conflito local antes de criar outra cifra ou enviar outro commit. Uma resposta maior que 512 KiB expira após a entrega inicial.

Operações/arquivos com confirmação ambígua não são podados. Se outra requisição resolve um commit antigo, sua resposta fica fixada, fora desse orçamento, até a tentativa original consumi-la; isso preserva o retry de importações grandes. Fingerprints e recibos compactos permanecem até bloquear/recarregar, portanto seu número ainda cresce com as operações da sessão; este limite reduz o acúmulo de conteúdo pesado e não é um teto absoluto para toda a memória da aplicação. Bloquear limpa todos esses caches.

## Contratos

- `GET /api/cloud/config`: `vaultAvailable:true` apenas com a flag habilitada.
- `GET /api/cloud/vault`: `{vault:null}` ou `{header,manifest,revision}`; nenhum conteúdo privado legível.
- `POST /api/cloud/vault/activate`: `{header,manifest,expectedDocuments:[{key,revision}],operationId}`.
- `PUT /api/cloud/vault`: `{manifest,baseRevision,operationId}`.
- `POST /api/cloud/vault/blobs`: `{id,sha256,base64}`; UUID aleatório, hash e bytes cifrados, content-type octet-stream.
- `GET /api/cloud/vault/blobs/:uuid`: bytes cifrados privados, sem nome/MIME original no response.

As rotas mantêm sessão HttpOnly, same-origin/CSRF, limites de bytes e normalização de erros existentes. Não há chave em env, localStorage, cookie, payloads remotos ou logs da aplicação. IndexedDB guarda o handle não extraível e envelopes cifrados, sem bytes brutos de chave, frase ou recuperação em texto legível. O ledger novo guarda hashes de requisições cifradas e respostas de revisão, sem snapshots em texto legível.

## Verificação e fontes

Testes cobrem chave errada, conta/finalidade/revisão errada, adulteração, recuperação, parâmetros KDF, concorrência, corpo de retry idêntico, upload ambíguo, bootstrap bloqueado, consentimento e export/import. A atualização de dispositivo também cobre IDB indisponível/tamper, contexto autenticado antes da leitura local, recuperação transplantada entre conta/cofre mesmo com o mesmo handle AES, download interrompido por bloqueio, preparação reaproveitada e cancelamento durante awaits. As regressões de ciclo de vida foram reproduzidas em RED antes da correção.

Em Chromium real, um fixture local com conta fabricada confirmou persistência/reload do handle não extraível, recusa de `exportKey`, isolamento por conta e recuperação cifrada. Outro fixture usando `CloudBootstrap` e `VaultGate` reais confirmou o botão único seguido da abertura automática após reload. Nenhuma conta ou segredo real foi usado nesses testes. Na emulação DOM móvel de 390 × 844, a página mediu 390 px e o cartão 362 px, sem overflow horizontal.

`scripts/test-vault-sql.mjs` executa as migrações e **31 verificações** em PostgreSQL WASM isolado com Auth/Storage fabricados. Cobre a correção WHERE, preservação/ativação atômica, ACL/RLS, CAS/retry e o trigger final de Storage sob `service_role` sem `auth.uid()`. A conferência do guard de safeupdate foi feita no código-fonte; não executamos essa extensão compilada no fixture. O teste isolado não substitui a validação dos serviços gerenciados nem prova a concorrência entre conexões reais.

Referências: [armazenamento de chaves WebCrypto](https://www.w3.org/TR/webcrypto/#key-storage), [structured clone e CryptoKey](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm), [WebCrypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), [OWASP PBKDF2](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [limites de segurança do WebCrypto](https://www.w3.org/TR/webcrypto/#security-considerations), [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
