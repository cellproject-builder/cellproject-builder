# Entrada por áudio

O áudio é uma forma alternativa de escrever conteúdo no Dynamic Diary. O usuário toca no microfone, fala e confirma no ícone de visto. A transcrição aparece diretamente no campo original, onde pode ser editada e enviada pela ação normal do módulo. O ícone de cancelar descarta o ditado. Não há escolha de modelo/idioma, player, importação ou etapa separada de inserção nessa interação.

## Referência da implementação

O fluxo e a captura foram adaptados do repositório autorizado `Mega-Vale-Transportes/workspace-megavale`, revisão `f3be27e9b4dc96153af46062ec8e22be9f4375e9`: [AiIntakeVoice.tsx](https://github.com/Mega-Vale-Transportes/workspace-megavale/blob/f3be27e9b4dc96153af46062ec8e22be9f4375e9/apps/web/src/components/AiIntakeVoice.tsx), [use-voice-session.ts](https://github.com/Mega-Vale-Transportes/workspace-megavale/blob/f3be27e9b4dc96153af46062ec8e22be9f4375e9/apps/web/src/lib/use-voice-session.ts) e [voice-recording.ts](https://github.com/Mega-Vale-Transportes/workspace-megavale/blob/f3be27e9b4dc96153af46062ec8e22be9f4375e9/apps/web/src/lib/voice-recording.ts). São fontes privadas, acessíveis conforme permissões do GitHub.

A integração conserva o transporte autenticado e o motor STT existente do Dynamic Diary. Diferentemente da transcrição antecipada da referência, os trechos só são enviados após a confirmação do usuário. A revisão também evita descartar uma cauda curta quando há fala audível e conserva os arquivos completos anteriores em uma interrupção, com aviso e confirmação explícita.

## Interface e cobertura

[AudioField.tsx](../../src/audio/AudioField.tsx) expõe `AudioTextarea` e `AudioTextInput`, conservando atributos, refs e eventos React. Eles são usados nos chats, pedidos de imagens/3D/diagramas, refinamentos, notas, texto do Board, campos do plano, evidências, comentários e tarefas. Textos curtos de conteúdo recebem integração explícita; senha, chave de API e demais credenciais ficam nos inputs originais.

O popover permanece dentro do editor e usa a top layer quando disponível. Isso evita perder o foco de um editor que salva ao sair e permite navegar por teclado dentro de diálogos. As referências `@` existentes continuam no pedido. No celular, controles de toque têm pelo menos 44 px e o painel acompanha a área visível do teclado.

`audioScope` associa a operação ao projeto, nó, nota, bloco, item ou sessão de origem. Troca de contexto, desmontagem, campo bloqueado e cancelamento invalidam respostas tardias. A seleção inicial e o valor anterior são conferidos antes da inserção. Se o campo mudou, houver composição de texto em curso ou o resultado exceder `maxLength`, o rascunho permanece intacto e a ferramenta oferece copiar a transcrição já obtida. Sem acesso à área de transferência, mostra texto selecionável. Essa recuperação não retranscreve o áudio. O cursor é posicionado antes do evento `input`, preservando referências `@` dos compositores.

## Captura, IA e limites

[recording.ts](../../src/audio/recording.ts) usa `getUserMedia` e `MediaRecorder` somente após ação do usuário. Negocia WebM/Opus, MP4 ou Ogg conforme o navegador. Um único microfone alimenta gravadores sucessivos de até 50 segundos; a primeira pausa depois de 40 segundos pode antecipar a troca. Cada trecho é um arquivo completo, com seu próprio cabeçalho, não um pedaço intermediário de contêiner. O medidor RMS opcional consulta o áudio a 10 Hz; não mantém um loop de animação permanente. A captura limita o total a cinco minutos ou 12 MiB e encerra tracks, timers e AudioContext. A duração máxima prepara o áudio, sem iniciar transcrição automaticamente. Permissão negada permite tentar novamente ou continuar digitando.

[dictation.ts](../../src/audio/dictation.ts) transcreve os trechos na ordem somente após confirmação. Mantém resultados aprovados em memória: uma tentativa explícita após falha reenvia apenas os trechos restantes. Cancelamento invalida respostas tardias; não existe retry pago automático. O texto completo respeita o limite de 32.000 caracteres.

[transcription.ts](../../src/audio/transcription.ts) identifica o contêiner e chama o endpoint STT do OpenRouter. Ele usa a configuração OpenRouter independentemente do modelo principal de planejamento. O padrão continua `openai/whisper-large-v3-turbo`, já exercitado nos ensaios anteriores. A whitelist do transporte ainda admite `openai/gpt-4o-mini-transcribe`, mas o ditado não exige essa decisão do usuário. O idioma acompanha o campo/interface. Nenhum erro muda o modelo automaticamente.

Na nuvem, [providerTransport](../../src/ai/transport.ts) usa a sessão existente, e [cloudAI.mjs](../../server/cloudAI.mjs) acrescenta a chave no servidor. O proxy tem destino fixo, dois modelos autorizados, formatos e campos restritos, base64 canônico, limite de 12 MiB binários, timeout de 90 s e resposta até 32.000 caracteres. Não aceita URLs de áudio, cookies ou credenciais encaminhados pelo corpo. A validação de cabeçalho não é decodificação do arquivo.

[production.mjs](../../server/production.mjs) permite microfone apenas na própria origem. A permissão normal do navegador e HTTPS continuam necessários. O compartilhamento do cofre precede o envio ao provedor; o áudio não carrega contexto de outros documentos. Transcrição requer internet. Os trechos permanecem na ferramenta após uma falha para tentativa explícita enquanto ela estiver aberta.

## Persistência e privacidade

O áudio é efêmero e não gera URL de reprodução no fluxo de ditado. Só o texto inserido percorre a persistência/criptografia existente. `registerDataIngestion` protege a edição enquanto a ferramenta está aberta, evitando substituição do documento por sincronização remota nesse intervalo.

Guardar voz como mensagem reproduzível é uma ampliação separada: precisa integrar MIME/manifesto, Storage privado e criptografia, sem embutir base64 nos documentos. Esta integração não entrega essa persistência nem interpretação de sons sem fala.

## Verificação e resultados

O [ensaio de ditado direto de 11/10/2026](../reports/simple-dictation-2026-10-11.md) registra a interface compacta, capturas móveis, regressões e limites de verificação.

Testes de captura/cliente: [recording.test.ts](../../src/audio/recording.test.ts), [dictation.test.ts](../../src/audio/dictation.test.ts), [transcription.test.ts](../../src/audio/transcription.test.ts), [AudioField.test.tsx](../../src/audio/AudioField.test.tsx) e [AudioField.clipboard.test.tsx](../../src/audio/AudioField.clipboard.test.tsx). A integração com diálogos e identidade de projeto é exercitada em [Modal.audio.test.tsx](../../src/components/ui/Modal.audio.test.tsx) e [GroundTruth.audioScope.test.tsx](../../src/components/GroundTruth.audioScope.test.tsx). Contratos HTTP e políticas permanecem em [cloudAI.audio.test.mjs](../../server/cloudAI.audio.test.mjs) e [production.test.mjs](../../server/production.test.mjs).

Em 10/10/2026 foram feitas seis primeiras tentativas reais, três amostras sintéticas pt-BR nos mesmos bytes para cada modelo. Whisper retornou três transcrições correspondentes ao texto de origem, normalizando apenas espaços. Mini retornou HTTP 404 nas três solicitações apesar de listado no catálogo; não atribuímos uma causa não demonstrada. O custo informado das três transcrições Whisper foi **US$ 0,00009398592**, com latências até o recebimento dos cabeçalhos de 1,321–4,234 s (o proxy já havia recebido o texto do provedor). Isso justifica o padrão atual, sem provar qualidade com voz humana, ruído, sotaques ou termos inéditos. [Dados do ensaio](../design/audio-input/results/2026-10-10-synthetic-first-attempt.json).

O protocolo é reproduzível com [gerador local de fixtures](../../scripts/generate-audio-fixtures.ps1) e [comparador explícito](../../scripts/compare-audio-transcription.mjs). O comparador padrão não chama APIs; `--live` exige caminhos e limita a três amostras PCM de até 30 segundos por dois modelos, sem sobrescrever o primeiro relatório. A versão atual mede a latência após ler a resposta inteira; os dados históricos foram preservados. Esses limites restringem chamadas e duração, sem estabelecer um teto financeiro do provedor. A autenticação do HTTP local é fixture; a inferência e cobrança do OpenRouter foram reais. Não é um ensaio de login/produção ou microfone físico.

No ensaio histórico de 10/10, duas transcrições Whisper de fixtures sintéticas passaram pela interface local anterior: uma referência técnica e uma frase de planejamento. A segunda foi inserida após um rascunho existente, sem enviá-lo. Esse resultado valida o motor usado, mas não a interface simplificada de 11/10. Esta foi exercitada separadamente no navegador local com `MediaRecorder` real, som sintético gerado em Web Audio e resposta STT simulada, sem microfone pessoal ou requisição paga. Isso não substitui teste de voz humana e caneta/toque no S9.

Referências oficiais: [Speech-to-Text](https://openrouter.ai/docs/guides/overview/multimodal/stt), [Whisper Large V3 Turbo](https://openrouter.ai/openai/whisper-large-v3-turbo), [GPT-4o Mini Transcribe](https://openrouter.ai/openai/gpt-4o-mini-transcribe).
