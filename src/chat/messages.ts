export const chatPt = {
  rateLimited: 'O provedor de IA pediu uma pausa. As ações já concluídas foram mantidas. Aguarde a liberação do envio antes de continuar.', cooldown: (seconds: number) => `Limite temporário do provedor. Envio disponível em ${seconds}s.`,
  loadError: 'Não foi possível carregar suas conversas.', saveError: 'Esta conversa ainda não foi salva neste dispositivo.', retry: 'Tentar novamente',
  open: 'Conversar com IA', title: 'Seu assistente', close: 'Fechar chat', placeholder: 'O que vamos fazer?', send: 'Enviar', stop: 'Parar', working: 'Trabalhando…', ready: 'Conectado ao seu espaço', greeting: 'O que vamos aprender ou construir?', hint: 'Explore as partes de uma ideia, questione premissas e use @ para conectar suas referências.', settings: 'Configurar IA', noKey: 'Configure um provedor de IA para começar.', newChat: 'Nova conversa', conversations: 'Conversas', current: 'Conversa atual', error: 'Não consegui concluir esta solicitação.', interrupted: 'Solicitação interrompida. As ações já concluídas foram mantidas.', processed: 'Ações processadas. Confira os resultados no registro abaixo.', actionDone: 'Concluído', actionError: 'Não concluído', context: 'Contexto', personal: 'Seu espaço', loading: 'Carregando conversas…', exampleProject: 'Crie um plano para aprender robótica', exampleNote: 'Registre minhas premissas em uma nota', exampleReview: 'Revise meu plano e sugira o que testar', actions: 'Ações nesta solicitação',
};
export const chatEn: typeof chatPt = {
  rateLimited: 'The AI provider requested a pause. Completed actions have been kept. Wait until sending is available before continuing.', cooldown: (seconds: number) => `Temporary provider limit. Sending available in ${seconds}s.`,
  loadError: 'Your conversations could not be loaded.', saveError: 'This conversation has not been saved on this device yet.', retry: 'Try again',
  open: 'Chat with AI', title: 'Your assistant', close: 'Close chat', placeholder: 'What shall we do?', send: 'Send', stop: 'Stop', working: 'Working…', ready: 'Connected to your workspace', greeting: 'What shall we learn or build?', hint: 'Explore the parts of an idea, question assumptions and use @ to connect your references.', settings: 'Configure AI', noKey: 'Configure an AI provider to begin.', newChat: 'New conversation', conversations: 'Conversations', current: 'Current conversation', error: 'I could not finish this request.', interrupted: 'Request stopped. Completed actions have been kept.', processed: 'Actions processed. Check the results in the activity below.', actionDone: 'Completed', actionError: 'Not completed', context: 'Context', personal: 'Your workspace', loading: 'Loading conversations…', exampleProject: 'Create a plan to learn robotics', exampleNote: 'Record my assumptions in a note', exampleReview: 'Review my plan and suggest what to test', actions: 'Actions in this request',
};
const labels: Record<string, [string, string]> = {
  note_research: ['Pesquisar sobre a nota', 'Research this note'], note_diagram: ['Gerar diagrama na nota', 'Generate a note diagram'],
  list_references: ['Consultar referências do canvas', 'Read canvas references'], search_images: ['Buscar imagens', 'Find images'], generate_model: ['Gerar modelo 3D', 'Generate 3D model'],
  workspace_read: ['Consultando seu espaço', 'Reading your workspace'], read_plan: ['Consultando o plano', 'Reading the plan'], planner_read: ['Consultando o plano', 'Reading the plan'],
  create_project: ['Criar projeto', 'Create project'], update_project: ['Atualizar projeto', 'Update project'], navigate: ['Abrir tela', 'Open screen'], open_settings: ['Abrir configurações', 'Open settings'], set_appearance: ['Alterar aparência', 'Change appearance'], set_language: ['Alterar idioma', 'Change language'], set_sidebar_collapsed: ['Recolher ou expandir menu', 'Collapse or expand sidebar'], load_demo_data: ['Carregar demonstração', 'Load demo data'],
  create_task: ['Criar tarefa', 'Create task'], update_task: ['Atualizar tarefa', 'Update task'], delete_task: ['Excluir tarefa', 'Delete task'], import_plan_tasks: ['Criar tarefas do plano', 'Import plan tasks'],
  create_sprint: ['Criar sprint', 'Create sprint'], start_sprint: ['Iniciar sprint', 'Start sprint'], complete_sprint: ['Encerrar sprint', 'Complete sprint'],
  create_note: ['Criar nota', 'Create note'], update_note: ['Atualizar nota', 'Update note'], append_note_block: ['Acrescentar à nota', 'Append to note'], trash_note: ['Mover nota à lixeira', 'Trash note'], restore_note: ['Restaurar nota', 'Restore note'], create_folder: ['Criar pasta', 'Create folder'], delete_folder: ['Excluir pasta', 'Delete folder'],
  add_comment: ['Comentar na tarefa', 'Comment on task'], update_comment: ['Editar comentário', 'Edit comment'], delete_comment: ['Excluir comentário', 'Delete comment'],
  generate_plans: ['Construir alternativas de plano', 'Build plan alternatives'], select_plan: ['Expandir plano escolhido', 'Expand chosen plan'], explain_node: ['Explicar parte do plano', 'Explain plan node'], decompose_node: ['Decompor parte do plano', 'Decompose plan node'], critique_node: ['Revisar parte do plano', 'Critique plan node'],
};
export const actionLabel = (action: string, english: boolean) => labels[action]?.[english ? 1 : 0] ?? (english ? 'Update the plan' : 'Atualizar o plano');

export const chatImagePt = {
  title: 'Referências encontradas', carousel: 'Imagens de referência', previous: 'Imagem anterior', next: 'Próxima imagem',
  choose: 'Escolher', chooseLabel: (title: string) => `Escolher ${title}`, chosen: 'Escolhida',
  use3D: 'Base 3D', use3DLabel: (title: string) => `Usar ${title} como base 3D`,
  view: (title: string) => `Ver ${title}`, preview: (title: string) => `Ampliar ${title}`,
  added: 'Imagem no canvas e selecionada como referência no chat.', prepared: 'Referência preparada no estúdio 3D.',
  adding: 'Preparando imagem…', unavailable: 'Não há prévias disponíveis nesta busca.', noResults: 'Nenhuma imagem encontrada. Tente uma descrição mais específica.', failedPreview: 'Prévia indisponível. Busque novamente.',
  expired: 'Esta referência não está mais disponível. Busque novamente para escolher uma imagem atual.',
  failed: 'Não foi possível adicionar esta imagem. Tente outra referência ou refaça a busca.',
  projectChanged: 'Volte ao projeto de origem para usar estas imagens.', projectRemoved: 'O projeto de origem foi removido. As referências continuam disponíveis para consulta.',
  planChanged: 'O plano mudou desde esta busca. Faça uma nova busca no plano atual.',
  contextChanged: 'Os requisitos ou as referências mudaram desde esta busca. Pesquise novamente para atualizar a avaliação.',
  openProject: 'Voltar ao projeto', source: 'Fonte', searchHint: 'Escolha uma imagem para levar ao canvas e usar nas próximas mensagens.',
};
export const chatImageEn: typeof chatImagePt = {
  title: 'Image references found', carousel: 'Reference images', previous: 'Previous image', next: 'Next image',
  choose: 'Choose', chooseLabel: (title: string) => `Choose ${title}`, chosen: 'Chosen',
  use3D: '3D base', use3DLabel: (title: string) => `Use ${title} as a 3D base`,
  view: (title: string) => `View ${title}`, preview: (title: string) => `Enlarge ${title}`,
  added: 'Image on the canvas and selected as a chat reference.', prepared: 'Reference prepared in the 3D studio.',
  adding: 'Preparing image…', unavailable: 'No previews are available for this search.', noResults: 'No images found. Try a more specific description.', failedPreview: 'Preview unavailable. Search again.',
  expired: 'This reference is no longer available. Search again to choose a current image.',
  failed: 'This image could not be added. Try another reference or search again.',
  projectChanged: 'Return to the original project to use these images.', projectRemoved: 'The original project was removed. You can still browse its references.',
  planChanged: 'The plan changed since this search. Search again in the current plan.',
  contextChanged: 'Requirements or references changed since this search. Search again to update the assessment.',
  openProject: 'Return to project', source: 'Source', searchHint: 'Choose an image to bring to the canvas and use in your next messages.',
};
