# Entrada de áudio compartilhada

Dynamic Diary deve aceitar voz onde hoje aceita conteúdo escrito, mantendo a edição, referências e envio de cada módulo. Implementação autorizada pelo pedido de adicionar áudio; a preferência sobre guardar a gravação está sendo consultada. Esta primeira integração transforma áudio em texto revisável, mantendo a gravação somente em memória enquanto a ferramenta está aberta.

## Interação

Um microfone discreto nos campos de conteúdo abre controles compactos para gravar ou importar arquivo. Gravação exige gesto e permissão do navegador; mostrar duração, parar e cancelar. Antes de compartilhar, permitir ouvir a gravação. Transcrever é explícito. Resultado editável é inserido na seleção original, sem envio automático, sem apagar texto não selecionado, sem perder referências. Campos alterados durante a operação exigem nova inserção; nunca sobrescrever silenciosamente. O botão também funciona por teclado e toque.

Campos de senha, chaves, identidade, URLs de configuração, números e seletores não recebem o recurso. Textareas de conteúdo compartilham um adaptador React que conserva ref, eventos, limite e integração de salvamento. Campos de título/texto curtos recebem opt-in explícito. Editores que encerram ao perder foco devem considerar os controles de áudio como parte da edição e finalizar somente ao sair do conjunto.

## Motor

Gravar com MediaRecorder negociando WebM/Opus, MP4/AAC ou Ogg conforme suporte; enviar o formato real. Arquivos WAV/MP3/MP4/M4A/WebM/Ogg/FLAC/AAC aceitos, máximo 12 MiB; captura até cinco minutos. Sem conversão falsa de extensão. OpenRouter oferece `/audio/transcriptions`, separado do modelo que raciocina sobre o projeto. Padrão Whisper Large V3 Turbo e alternativa explícita GPT-4o Mini Transcribe; ambos constam no catálogo público em 2026-10-10, mas somente Whisper respondeu no ensaio da conta atual. Qualidade em português ainda requer gravações reais. Sem retry pago automático.

Reutilizar providerTransport, autenticação, credencial de servidor e compartilhamento do cofre. Áudio não envia contexto de outros projetos. Microfone somente same-origin; prévias blob permitidas pela CSP. Proxy limitado a modelos, formatos, base64, tamanho, linguagem e campos de transcrição; sem URLs remotas ou parâmetros arbitrários. Resposta é texto limitado, custo opcional e sem headers privados. Mesmo limite de concorrência das outras chamadas IA.

Atualização após ensaio real: usar Whisper Large V3 Turbo como padrão. As três primeiras tentativas com Mini retornaram 404 na configuração atual, apesar de constar no catálogo. Whisper transcreveu três amostras sintéticas pt-BR com termos técnicos; não extrapolar para qualidade geral ou microfone físico. A alternativa Mini permanece uma escolha explícita, sem fallback/retry automático.

## Estado e persistência

AbortController próprio; cancelar, fechar, desmontar e trocar contexto interrompem solicitação e encerram todas as tracks. Respostas tardias não alteram campos novos. Manter registerDataIngestion durante captura/revisão para impedir que sincronização remota substitua o documento sendo editado. Revogar object URLs e liberar atividade sempre. Offline mantém digitação; transcrição exige conexão, com erro claro e gravação disponível enquanto a ferramenta permanece aberta.

Só o texto aceito percorre a persistência existente, incluindo criptografia. Guardar áudio como mensagem reproduzível será uma escolha separada: exige contrato de mídia/Storage e não deve colocar base64 nos documentos.

## Validação

Testar limites, formatos reais, transporte local/cloud, consentimento, cancelamento, rejeição de credenciais/URLs, ausência de retry e resposta inválida. Testar gravação simulada, cleanup/permissão negada, seleção/maxLength, alvo alterado e readonly, controles por teclado, React onChange e editores no blur. Executar build, suites afetadas e inspeção visual desktop/mobile. Teste de microfone físico e precisão dos modelos não será declarado sem execução.

## Execução

1. Motor de captura/transcrição e testes de contrato.
2. Proxy, política do microfone/CSP e regressões de servidor (agente independente).
3. Controles/adaptadores e integração nos campos de conteúdo (agente independente).
4. Revisão cruzada, testes integrados, documentação de uso e limitações.

Trabalho isolado em `codex/audio-input`, preservando as frentes anteriores ainda não integradas.
