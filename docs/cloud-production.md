# Backend de produção e contrato de sincronização

O servidor Node é iniciado por `npm start` (Node 22.9+), serve `dist`, expõe `/healthz` e compõe o gateway visual existente com autenticação Supabase. O Vite mantém o fluxo local BYOK; seu `/api/cloud/config` retorna `enabled:false`. Nenhuma Edge Function participa deste caminho.

## Configuração

Variáveis somente do servidor: `CELLPROJECT_CLOUD_ENABLED=true`, `APP_ORIGIN=https://builder.cellprojectdiary.com`, `SUPABASE_URL=https://wxfootrnfiqpzhmjwgck.supabase.co` e `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_ALLOWED_USER_ID` é um reforço opcional após o primeiro cadastro autorizado; o UUID é confirmado pela allowlist privada e a sessão ativa do banco em cada requisição. O email admitido é fixo: `wylgnerbossman@gmail.com`.

`APP_ALTERNATE_ORIGINS=https://cellproject-builder-production.up.railway.app` habilita redirect 308 de GET/HEAD públicos para o domínio canônico. APIs nunca redirecionam e exigem o Host/origem canônicos. `/healthz` aceita o Host do healthchecker. Outras origens alternativas precisam ser configuradas explicitamente, separadas por vírgula.

Provedores disponíveis vêm de `OPENROUTER_API_KEY` (alternativa local legada `OPENROUTER`), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` (alternativa `TYPESAFE`). Nenhuma chave recebe prefixo `VITE_`, entra no bundle ou é devolvida por `/api/cloud/config`.

Com a allowlist atual, a conta do criador usa essas credenciais automaticamente após entrar. Chat, construção de planos, reescrita de notas e ferramentas visuais consultam a configuração efetiva do servidor; a interface salva somente as preferências de modelo. O acesso exclusivo é garantido pela allowlist do e-mail, sem conceder privilégios administrativos do Supabase ou distribuir chaves aos clientes.

`npm start` carrega `.env` se existir. Para o arquivo privado preparado pelo coordenador, usar `node --env-file=.env.cloud.local server/production.mjs`. Railway recebe as variáveis pelo ambiente. Nunca publicar os arquivos privados; `.env.*.local` é ignorado pelo Git.

## Sessão e rotas

- `GET /api/cloud/config` → `{enabled,authenticated,authMethod?:'email_link',passwordAuth?:true,passwordSetup?:boolean,user?:{id,email},providers:{openrouter,openai,anthropic}}`. As capacidades de autenticação são informadas no modo cloud; `passwordSetup` só aparece para a sessão autenticada.
- `POST /api/auth/password/sign-in` com `{email,password}` → `{authenticated:true,user}`. Troca a senha por uma sessão Supabase no servidor e aplica as mesmas verificações de identidade, conta confirmada e autorização usadas pelo acesso por link. A resposta e o cookie nunca contêm a senha nem tokens do provedor.
- `POST /api/auth/password/setup-link` com `{email}` → `{sent:true}`. Envia um link de recuperação Supabase por PKCE para criar a primeira senha ou redefini-la. A allowlist é verificada antes do envio. O propósito do fluxo fica exclusivamente no servidor; um acesso normal não autoriza alterar a senha.
- `POST /api/auth/password` com `{password}` → `{saved:true}`. Exige a sessão confirmada pelo link de configuração de senha, dentro de uma janela de 15 minutos. A nova senha deve ter pelo menos 10 caracteres e no máximo 72 bytes em UTF-8, preservando espaços. O Supabase armazena a credencial; o aplicativo não a grava em seus documentos, preferências ou logs. Após salvar, a autorização temporária para definir senha é consumida.
- `POST /api/auth/request-code` com `{email}` → `{sent:true}`. Mantém a alternativa de acesso por link. A allowlist é checada antes do envio. O template padrão `{{ .ConfirmationURL }}` funciona com link por email e PKCE.
- `GET /api/auth/callback?code=...` é o retorno fixo do link. Após verificar fluxo, trocar código no servidor e validar identidade/autorização, retorna `303 /` com cookie `__Host-cellproject_session`, HttpOnly, Secure, SameSite=Strict, Path=/. Falhas retornam `303 /?auth_error=link_invalid`, uma flag fixa sem código ou erro do provedor.
- `POST /api/auth/verify-code` com `{email,token}` → `{authenticated:true,user}` permanece disponível para um futuro template com `{{ .Token }}` e usa a mesma validação e sessão. O template padrão atual não exibe código numérico.
- `POST /api/auth/logout` invalida o handle local, limpa o cookie e tenta revogar a sessão Supabase correspondente.
- Toda mutação exige Origin exata e `X-Cellproject-Request: 1`; Fetch Metadata incompatível é recusado. Não há CORS público.

O link deve ser aberto no **mesmo navegador** que fez o pedido. O servidor mantém o verifier PKCE em memória por até 15 minutos e envia apenas um handle aleatório no cookie `__Host-cellproject_auth_flow` (HttpOnly, Secure, SameSite=Lax, Path=/). Lax permite a navegação de retorno do email. Cada callback consome o fluxo antes de qualquer chamada assíncrona, inclusive quando falha; um novo pedido no mesmo navegador substitui o anterior. Logout, substituição do fluxo e encerramento do servidor também cancelam callbacks em voo, com nova conferência após exchange e identidade antes de emitir sessão. Cookies ausentes, forjados, duplicados ou expirados são recusados sem troca do código. O fluxo PKCE e os códigos do Supabase têm suas próprias expirações; o código emitido pelo provedor vale cinco minutos após a autenticação.

A entrada principal usa e-mail e senha. Em **Criar ou recuperar senha**, o usuário solicita a confirmação por e-mail e define a senha pessoalmente no retorno à aplicação. A tela de criação aparece antes de carregar o workspace ou iniciar uma importação. O menu do indicador de nuvem oferece **Criar ou alterar senha**, usando a mesma confirmação. Os campos de senha usam somente estado local do formulário e são limpos ao concluir ou alternar o modo de entrada. A criação da senha não altera a allowlist, a propriedade dos dados ou as chaves de IA do servidor.

O fluxo segue a [autenticação por senha do Supabase](https://supabase.com/docs/guides/auth/passwords). O endpoint de recuperação permite redefinir a senha sem depender da configuração que exige a senha atual em alterações normais; não requer mudanças no template de e-mail ou na Site URL existentes.

Somente o callback GET admite navegação de outro site: Host canônico obrigatório e, quando presentes, Fetch Metadata de navegação para documento. Pedidos por iframe/fetch são recusados. O callback usa `no-store` e `Referrer-Policy: no-referrer`; o app não registra a URL/código nem devolve erros brutos. A configuração de logs da infraestrutura também deve omitir query strings de autenticação. Não há uso do código como sessão: a troca exige o verifier do fluxo iniciado pelo navegador. O redirect de email é enviado sempre na query `redirect_to` com `https://builder.cellprojectdiary.com/api/auth/callback`, cadastrado exatamente na allowlist Supabase, sem alterar Site URL.

O transporte segue o [fluxo PKCE documentado pelo Supabase](https://supabase.com/docs/guides/auth/sessions/pkce-flow) e o contrato oficial do [auth-js](https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts): challenge SHA-256, método `s256`, troca `/token?grant_type=pkce` com `auth_code` e `code_verifier`. Templates futuros podem escolher [link ou OTP numérico](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Tokens Supabase permanecem em memória no servidor, com refresh serializado. O handle tem validade absoluta de oito horas. Cada API privada verifica `/auth/v1/user`, emissor, expiração, identidade verificada e a RPC `cellproject_authorized()`, que confere allowlist e `auth.sessions` ativos. A configuração inicial admite apenas o email fixo; o banco controla a admissão e a autorização do primeiro UUID.

O servidor começa com **uma réplica**. Reinício/deploy invalida sessões e fluxos PKCE em memória e exige novo pedido/login; não perde documentos ou mídias já confirmados. Escala horizontal exige um armazenamento compartilhado de sessões cifradas, fluxos PKCE e coordenação de rate limits antes de aumentar as réplicas.

## Persistência

`GET /api/cloud/snapshot` retorna `{documents:[{key,value,revision}],media:[{id,mime,name,projectId?,createdAt?,sha256,size}]}` numa RPC consistente. `value` mantém a string exata dos envelopes Zustand. As três preferências localStorage mantêm suas strings originais.

Chaves aceitas: `cellproject-workspace`, `cellproject-graph`, `dynamic_diary-chat`, `cellproject-kb`, `cellproject-config`, `cellproject-locale`, `dynamic_diary-theme`, `dynamic_diary-sidebar-collapsed`, `dynamic_diary:task-view`. Credenciais estruturadas dos provedores são recusadas no documento de configuração; texto escrito pelo usuário não é classificado como segredo por heurísticas.

`PUT /api/cloud/documents/:key` recebe `{value,baseRevision,operationId}` e retorna `{revision}`. Documento ausente usa base 0; respostas têm revisão >=1. CAS e ledger ficam na mesma transação SQL. Um retry usa o mesmo ID e payload; conflito retorna 409 e não escolhe pelo relógio do dispositivo.

`POST /api/cloud/import` recebe `{documents:[{key,value}],manifestHash,operationId}` e retorna `{documents:[{key,revision}]}` apenas das chaves importadas. O SQL recusa valores divergentes existentes e publica as alterações atomicamente. O hash identifica o manifesto, mas não substitui a conferência dos documentos e bytes. Não existe remoção automática dos dados locais.

Documento: até 32 MiB UTF-8; importação: até 64 MiB de valores, com margem no transporte JSON. Cabeçalhos, contagem de chaves, formatos e concorrência também têm limites. Erros são respostas JSON sem payload de erro dos provedores nem tokens; writes/pedidos pagos não recebem retries automáticos do servidor.

## Mídia

`POST /api/cloud/media` recebe JSON `{id,mime,name,projectId?,createdAt?,sha256,base64,operationId}` e retorna `{id,sha256,size}`. MIME aceito: PNG, JPEG, WebP, PDF, texto e Markdown; arquivo até 10 MiB, imagem até 5 MiB, body até 14 MiB. IDs originais são mantidos. O servidor calcula SHA-256, tamanho e caminho privado `ownerId/sha256(mediaId)/sha256(bytes)` no bucket `cellproject-media`; nomes não viram caminhos.

Upload é imutável (`x-upsert:false`). O backend lê de volta e confere todos os bytes antes de registrar o catálogo por RPC. Repetição dos mesmos bytes verifica o objeto existente; nunca sobrescreve um objeto com conteúdo diferente. A quota é validada na transação do catálogo: 50 MiB por projeto e 500 MiB por conta.

`GET /api/cloud/media/:id` resolve o catálogo do proprietário autenticado e retorna bytes conferidos por hash/tamanho, com `no-store`, `nosniff` e disposição de anexo. `DELETE /api/cloud/media/:id` recebe `{operationId}` e remove somente o catálogo. Storage e SQL são serviços diferentes: uploads interrompidos podem deixar objetos órfãos. Bytes não são apagados na requisição; a coleta com retenção e backup é operação futura administrada.

## Proxy de IA

Rotas POST fixas: `/api/ai/openrouter/chat/completions`, `/api/ai/openai/chat/completions`, `/api/ai/openai/responses` e `/api/ai/anthropic/messages`. O cliente SDK usa o prefixo correspondente com o header de mutação. O backend constrói os headers de autorização, ignora credenciais/cookies do cliente, mantém streaming e aborta ao desconectar. Cada chamada fica limitada a 24 MiB de entrada e 65.536 tokens de saída; sem orçamento explícito, aplica 16.384. Limites de concorrência/frequência e timeout de dez minutos protegem chamadas longas. Não há retry de chamada paga no backend.

O HTML público tem CSP para scripts próprios, WebAssembly e worker próprio/blob; imagens podem usar blob/data/HTTPS. `.mjs` do worker PDF é servido como JavaScript. APIs privadas, tokens e bytes não são conteúdo estático nem fallback da SPA.

## Verificação e limites

`npm run test:gateway` cobre o gateway local e testes offline de autenticação, PKCE (challenge/verifier, cookie, expiração, outro navegador, callbacks paralelos, consumo único), revogação, refresh, origem/CSRF, conflitos, envelopes, upload/readback, paths estáticos, redirects, erros sem segredos e streaming/cancelamento. Supabase e provedores são simulados nesses testes, sem email enviado ou chamadas pagas. O teste SQL de RLS/CAS é coordenado separadamente. Antes de declarar operação remota concluída, conferir login real pelo template padrão no mesmo navegador, round trip dos documentos/mídias, refresh/logout, compatibilidade dos SDKs, backup/importação e restauração no domínio final.
