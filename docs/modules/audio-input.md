# Entrada por áudio

O áudio é uma forma alternativa de escrever conteúdo no Dynamic Diary. Um adaptador compartilhado oferece gravação, importação, reprodução local, transcrição editável e inserção na seleção do campo. Inserir não envia mensagens, não gera modelos e não executa instruções: a ação normal de cada módulo continua explícita.

## Interface e cobertura

[AudioField.tsx](../../src/audio/AudioField.tsx) expõe `AudioTextarea` e `AudioTextInput`, conservando atributos, refs e eventos React. Eles são usados nos chats, pedidos de imagens/3D/diagramas, refinamentos, notas, texto do Board, campos do plano, evidências, comentários e tarefas. Textos curtos de conteúdo recebem integração explícita; senha, chave de API e demais credenciais ficam nos inputs originais. A transcrição editável dentro da prévia não recebe outro microfone.

O popover permanece dentro do editor e usa a top layer quando disponível. Isso evita perder o foco de um editor que salva ao sair e permite navegar por teclado dentro de diálogos. As referências `@` existentes continuam no pedido. No celular, controles de toque têm pelo menos 44 px e o painel acompanha a área visível do teclado.

`audioScope` associa a operação ao projeto, nó, nota, bloco, item ou sessão de origem. Troca de contexto, desmontagem, campo bloqueado e cancelamento invalidam respostas tardias. A seleção inicial e o valor anterior são conferidos antes da inserção. Se o texto mudou, o usuário escolhe novamente o destino; o componente não substitui o rascunho silenciosamente. `maxLength` continua valendo.

## Captura, IA e limites

[recording.ts](../../src/audio/recording.ts) usa `getUserMedia` e `MediaRecorder` somente após ação do usuário. Negocia WebM/Opus, MP4 ou Ogg conforme o navegador. Grava até cinco minutos ou 12 MiB, encerra todas as tracks e revoga URLs temporárias ao fechar. Permissão negada não impede digitação ou importação de arquivo. Importações são limitadas por bytes; esse limite não comprova duração.

[transcription.ts](../../src/audio/transcription.ts) identifica o contêiner e chama o endpoint STT do OpenRouter. Ele usa a configuração OpenRouter independentemente do modelo principal de planejamento. O padrão é `openai/whisper-large-v3-turbo`; `openai/gpt-4o-mini-transcribe` é uma alternativa explícita com disponibilidade dependente do provedor. Nenhum erro dispara retry pago ou mudança automática de modelo.

Na nuvem, [providerTransport](../../src/ai/transport.ts) usa a sessão existente, e [cloudAI.mjs](../../server/cloudAI.mjs) acrescenta a chave no servidor. O proxy tem destino fixo, dois modelos autorizados, formatos e campos restritos, base64 canônico, limite de 12 MiB binários, timeout de 90 s e resposta até 32.000 caracteres. Não aceita URLs de áudio, cookies ou credenciais encaminhados pelo corpo. A validação de cabeçalho não é decodificação do arquivo.

[production.mjs](../../server/production.mjs) permite microfone apenas na própria origem e `media-src 'self' blob:` para ouvir a prévia. A permissão normal do navegador e HTTPS continuam necessários. O compartilhamento do cofre precede o envio ao provedor; o áudio não carrega contexto de outros documentos. Transcrição requer internet. A gravação permanece na ferramenta após uma falha para tentativa explícita enquanto ela estiver aberta.

## Persistência e privacidade

O áudio e a URL de reprodução são efêmeros. Só o texto inserido percorre a persistência/criptografia existente. `registerDataIngestion` protege a edição enquanto a ferramenta está aberta, evitando substituição do documento por sincronização remota nesse intervalo.

Guardar voz como mensagem reproduzível é uma ampliação separada: precisa integrar MIME/manifesto, Storage privado e criptografia, sem embutir base64 nos documentos. Esta integração não entrega essa persistência nem interpretação de sons sem fala.

## Verificação e resultados

Testes de captura/cliente: [recording.test.ts](../../src/audio/recording.test.ts), [transcription.test.ts](../../src/audio/transcription.test.ts) e [AudioField.test.tsx](../../src/audio/AudioField.test.tsx). Contratos HTTP e políticas: [cloudAI.audio.test.mjs](../../server/cloudAI.audio.test.mjs) e [production.test.mjs](../../server/production.test.mjs).

Em 10/10/2026 foram feitas seis primeiras tentativas reais, três amostras sintéticas pt-BR nos mesmos bytes para cada modelo. Whisper retornou três transcrições correspondentes ao texto de origem, normalizando apenas espaços. Mini retornou HTTP 404 nas três solicitações apesar de listado no catálogo; não atribuímos uma causa não demonstrada. O custo informado das três transcrições Whisper foi **US$ 0,00009398592**, com latências até o recebimento dos cabeçalhos de 1,321–4,234 s (o proxy já havia recebido o texto do provedor). Isso justifica o padrão atual, sem provar qualidade com voz humana, ruído, sotaques ou termos inéditos. [Dados do ensaio](../design/audio-input/results/2026-10-10-synthetic-first-attempt.json).

O protocolo é reproduzível com [gerador local de fixtures](../../scripts/generate-audio-fixtures.ps1) e [comparador explícito](../../scripts/compare-audio-transcription.mjs). O comparador padrão não chama APIs; `--live` exige caminhos e limita a três amostras PCM de até 30 segundos por dois modelos, sem sobrescrever o primeiro relatório. A versão atual mede a latência após ler a resposta inteira; os dados históricos foram preservados. Esses limites restringem chamadas e duração, sem estabelecer um teto financeiro do provedor. A autenticação do HTTP local é fixture; a inferência e cobrança do OpenRouter foram reais. Não é um ensaio de login/produção ou microfone físico.

Na inspeção adicional do navegador, duas transcrições Whisper de fixtures sintéticas passaram pela interface local: uma referência técnica e uma frase de planejamento. A segunda foi inserida após um rascunho existente, sem enviá-lo. O popover foi conferido em layout estreito, com controles de 44 px; isso não substitui teste de gravação no S9.

Referências oficiais: [Speech-to-Text](https://openrouter.ai/docs/guides/overview/multimodal/stt), [Whisper Large V3 Turbo](https://openrouter.ai/openai/whisper-large-v3-turbo), [GPT-4o Mini Transcribe](https://openrouter.ai/openai/gpt-4o-mini-transcribe).
