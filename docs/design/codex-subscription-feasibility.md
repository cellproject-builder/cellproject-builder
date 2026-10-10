# Assinatura ChatGPT/Codex no Dynamic Diary

Data da consulta: 2026-10-10. Status: backlog futuro para a edição open-source; integração adiada por decisão do usuário e não implementada. Não houve login, acesso a credenciais ou inferência real.

Decisão atual: manter os provedores de IA existentes nesta release. Retomar SIWC quando o produto tiver sua edição open-source, conferindo novamente elegibilidade e capacidades. Não há trabalho de conexão OpenAI autorizado para a implementação atual.

## Conclusão

Existe uma integração oficial Sign in with ChatGPT (SIWC) que permite requisições elegíveis usando o plano ChatGPT. A documentação pública descreve apps OSS/localmente hospedados e VMs próprias. Apps pagos **ou hospedados remotamente**, como o Dynamic Diary multiusuário no Railway, precisam entrar no programa de parceiros. O acesso comercial está restrito a parceiros selecionados/lista de espera.

A documentação de App Server afirma que sua autenticação nunca foi permitida para serviços comerciais ou hospedados. Executar Codex no Railway com a assinatura pessoal, reutilizar o client ID Codex ou acrescentar um bridge local ao SaaS não constitui autorização comercial.

Fontes: [SIWC para OSS/local](https://developers.openai.com/siwc/token-sharing-open-source), [acesso comercial](https://developers.openai.com/siwc/request-client-id), [App Server — Auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints).

## O que o Hermes demonstra

O provider `openai-codex` do Hermes usa OAuth Codex e o endpoint padrão `chatgpt.com/backend-api/codex`. Seu login próprio usa device code por padrão, com browser/PKCE opcional. Há também um runtime opcional que inicia o Codex App Server local e usa o login Codex. Ferramentas auxiliares de imagem/TTS continuam dependentes dos provedores configurados; assinatura para raciocínio não implica inclusão de toda geração multimodal.

Isso demonstra uma integração local concreta, mas não concede permissão para reproduzi-la como SaaS. Fontes: [constantes do Hermes](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/auth_constants.py), [autenticação Hermes](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/auth_codex.py), [runtime App Server](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/codex-app-server-runtime.md).

## Arquitetura e capacidades

No fluxo OSS oficial, cada registro exige host ID persistente, OAuth com PKCE/state/nonce, validação de identidade e do escopo `chatgpt.tokens.use.direct`, e reutilização do client ID emitido. A inferência usa `api.openai.com/v1/responses`, com `store:false` e `stream:true`; não usa os endpoints `backend-api`. Tokens ficam em armazenamento protegido no runtime, fora do browser storage, logs e analytics. Cada registro precisa de refresh serializado e revogação própria.

O preview aceita texto e entradas de imagens/arquivos conforme o modelo. Não aceita geração nativa de imagens, áudio/vídeo de entrada, transcrição, Files upload API, Code Interpreter ou hosted MCP/connectors. Rejeita, entre outros, `max_output_tokens`, `temperature`, `background` e `previous_response_id` por HTTP. Uso consome plano ou créditos, está sujeito a limites da conta e do app, e não é ilimitado. Saída JSON/schema precisa de validação de capacidade antes de ser anunciada.

Fontes: [registro/login](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [modelos/inferência](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [limitações](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [contas/sessões](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [UX/limites](https://developers.openai.com/siwc/ui-ux-guidelines).

O código atual usa AI SDK, OpenAI `.chat()` e OpenRouter. O proxy `server/cloudAI.mjs` injeta `max_output_tokens` quando nenhum orçamento existe. Portanto, conectar SIWC requer um adaptador Responses específico, histórico do app, normalização dos parâmetros, validação de saída e capacidades por fluxo; não basta trocar chave/URL. O login Supabase permanece responsável pela sessão Dynamic Diary. A conexão ChatGPT deve ser separada e vinculada à identidade validada, sem deduzir autorização somente pelo email.

## Caminhos viáveis

1. **Railway atual:** manter acesso por API no backend nesta release. Uma futura oferta SIWC hospedada dependeria de parceria e do contrato comercial concedido; essa solicitação não foi feita nesta pesquisa.
2. **Backlog da edição local/OSS:** avaliar e implementar SIWC documentado quando essa edição existir, com credenciais protegidas localmente, usando Responses direto ou App Server se ferramentas/threads/aprovações forem necessárias.
3. **Dentro do ChatGPT:** expor ações/dados do Dynamic Diary via plugin/MCP. ChatGPT chama o aplicativo nessa experiência; isso não entrega a assinatura ao frontend Railway. [Autenticação de plugins](https://developers.openai.com/plugins/build/auth).

Não foi instalado SDK, alterado provider ou exibido botão de conexão funcional nesta pesquisa. As condições de acesso e capacidades devem ser verificadas novamente antes da implementação.
