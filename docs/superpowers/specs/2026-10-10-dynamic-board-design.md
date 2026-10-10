# Dynamic Board

Espaço livre para rascunhar ideias, desenhar e explorar analogias antes de existir um plano. Entrada própria na navegação; vários quadros nomeados. Os cartões pertencem somente ao quadro e não criam notas nem projetos.

O canvas ocupa a área disponível, com pan/zoom, maximização e ferramentas compactas flutuantes. Aceita cartões, texto formatado, desenho livre, imagens coladas/importadas, diagramas React/SVG interativos e modelos Three.js transparentes. Cada objeto pode ser movido, redimensionado, copiado e removido com desfazer. Conexões opcionais entre objetos ajudam a organizar ideias sem impor hierarquia.

Uma ferramenta de IA permite escolher diagrama, 3D, busca de imagens ou aprimorar o texto selecionado. Usa somente o contexto autorizado do quadro, sem ler implicitamente o plano ativo ou outras notas. A prévia exige aplicação explícita. Minimizar preserva a geração; fechar cancela. Conteúdo alterado invalida a proposta; posicionamento não. O primeiro motor 3D usa a geometria detalhada existente, sem simular decomposição física validada.

Persistência no envelope de workspace existente, incluindo nuvem/cofre e backups. Imagens raster são processadas localmente e armazenadas inline com limites; não passam pelo coletor de mídia específico do planner. Schemas validam conteúdo declarativo, limites e relações. Não executar código fornecido por IA. Sem dependências novas, alteração de credenciais ou migração remota.

Validação: independência de projetos/notas, CRUD/arquivo recuperável, roundtrip de documentos, mídia e backups, colagem e duplicação, edição e formatação, desenho, relações, rejeição de respostas inválidas e cancelamento. Conferir navegador em desktop e celular. A conversão de um quadro em plano fica para uma ação explícita futura; criar um quadro não inicia planejamento.
