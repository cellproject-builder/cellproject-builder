import { computeTreeLayout, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';
import type { NoteBlock, PlannerSnapshot, TaskInput } from './types';

export const DEMO_PLAN_PREFIX = 'Dynamic Diary-demo-v1:';

const examples = [
  {
    key: 'product', name: '(Demo) Lançamento do produto',
    objective: 'Lançar uma primeira versão do Dynamic Diary que conecte escopo, execução e diário em uma experiência simples e consistente.',
    goal: 'Entregar o fluxo completo de projeto, tarefas e notas para a primeira rodada de uso.',
    phases: ['Descoberta e escopo', 'Construção da experiência', 'Validação e lançamento'],
    tasks: ['Mapear a jornada de planejamento', 'Definir os critérios do primeiro lançamento', 'Organizar os componentes visuais', 'Conectar o Kanban às tarefas do projeto', 'Revisar o fluxo de notas vinculadas', 'Preparar o roteiro de validação', 'Ajustar a experiência em telas pequenas', 'Revisar os estados vazios e mensagens', 'Testar exportação e restauração dos dados', 'Documentar os próximos passos de integração', 'Preparar a apresentação da versão', 'Explorar atalhos de produtividade'],
    decision: 'Manter projetos, tarefas e notas conectados por vínculos explícitos. A árvore organiza o escopo e a execução acontece no Kanban e nas sprints.',
    discovery: 'Ao planejar, preciso enxergar entregas e dependências. Durante a execução, quero registrar decisões sem sair do contexto do projeto.',
    risk: 'Uma tela com muitas informações pode esconder a próxima ação. Validar hierarquia, contraste e navegação em desktop e celular.',
  },
  {
    key: 'studio', name: '(Demo) Estúdio de conteúdo',
    objective: 'Organizar um ciclo editorial de quatro semanas, do levantamento de ideias à publicação, com decisões e aprendizados registrados no diário.',
    goal: 'Preparar a próxima série editorial e concluir a revisão das peças da semana.',
    phases: ['Estratégia editorial', 'Produção das peças', 'Publicação e aprendizado'],
    tasks: ['Mapear as dúvidas do público', 'Definir os temas da série', 'Montar o calendário editorial', 'Escrever o roteiro da primeira peça', 'Revisar o carrossel da semana', 'Preparar os materiais de publicação', 'Editar a versão curta do vídeo', 'Revisar legendas e acessibilidade', 'Agendar a próxima sequência de posts', 'Organizar a biblioteca de referências', 'Consolidar aprendizados do ciclo', 'Explorar um novo formato de bastidores'],
    decision: 'Priorizar uma série curta com um tema por semana. Cada conteúdo deve responder uma pergunta concreta e terminar com uma ação clara.',
    discovery: 'As melhores ideias surgem das dúvidas recorrentes. Registrar essas perguntas junto ao contexto evita produzir conteúdo sem uma necessidade definida.',
    risk: 'A produção pode consumir todo o tempo disponível. Limitar o trabalho em andamento e reservar uma revisão final antes de agendar.',
  },
  {
    key: 'learning', name: '(Demo) Trilha de aprendizado',
    objective: 'Construir uma rotina de estudo aplicada sobre agentes de IA, com experimentos pequenos, evidências e notas de reflexão ao final de cada sessão.',
    goal: 'Concluir um pequeno experimento e transformar as dúvidas em um plano de estudo da próxima semana.',
    phases: ['Fundamentos e perguntas', 'Experimentos práticos', 'Síntese e compartilhamento'],
    tasks: ['Organizar as perguntas de estudo', 'Selecionar as primeiras referências', 'Definir o recorte do experimento', 'Construir um fluxo com ferramentas', 'Revisar os limites de autonomia', 'Preparar o roteiro de observação', 'Registrar falhas e hipóteses', 'Revisar o diário do experimento', 'Comparar duas estratégias de contexto', 'Preparar uma síntese do aprendizado', 'Planejar o próximo experimento', 'Explorar uma visualização do fluxo'],
    decision: 'Estudar por perguntas e experimentos curtos. Cada sessão termina com o que observei, o que ainda não sei e qual será o próximo teste.',
    discovery: 'Uma demonstração funcionando não responde todas as perguntas. Separar o comportamento observado das hipóteses ajuda a escolher o próximo experimento.',
    risk: 'Abrir muitos caminhos de estudo ao mesmo tempo dispersa a atenção. Manter um experimento ativo e estacionar ideias para o próximo ciclo.',
  },
];

function dateFrom(today: Date, offset: number) {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function positionDemoPlan(project: Project): Project {
  const positions = computeTreeLayout(project);
  return { ...project, nodes: Object.fromEntries(Object.values(project.nodes).map((node) => [node.id, { ...node, position: positions[node.id] ?? node.position }])) };
}

// Repair only the exact coordinates shipped by the first demo seed. A moved
// card, a custom graph or a real project must never be rearranged by loading it.
function repairOriginalDemoLayout(snapshot: PlannerSnapshot, key: string): PlannerSnapshot {
  const plan = snapshot.project;
  const id = `${DEMO_PLAN_PREFIX}${key}`;
  if (!plan || plan.id !== id || plan.manualLayout || plan.rootId !== `${id}:root` || Object.keys(plan.nodes).length !== 10) return snapshot;
  const original = (nodeId: string, kind: ConceptNodeData['kind'], parentId: string | null, x: number, y: number) => {
    const node = plan.nodes[nodeId];
    return node?.kind === kind && node.parentId === parentId && node.position.x === x && node.position.y === y;
  };
  if (!original(plan.rootId, 'root', null, 0, 0)) return snapshot;
  for (let index = 0; index < 3; index++) {
    const phaseId = `${id}:phase:${index}`;
    if (!original(phaseId, 'categoria', plan.rootId, index * 260, 180)) return snapshot;
    for (let child = 0; child < 2; child++) {
      if (!original(`${id}:step:${index * 2 + child}`, 'passo', phaseId, child * 260, 360)) return snapshot;
    }
  }
  return { ...snapshot, project: positionDemoPlan(plan) };
}

function demoPlanner(example: typeof examples[number], now: number): PlannerSnapshot {
  const id = `${DEMO_PLAN_PREFIX}${example.key}`;
  const rootId = `${id}:root`;
  const node = (nodeId: string, parentId: string | null, kind: ConceptNodeData['kind'], name: string, order: number): ConceptNodeData => ({
    id: nodeId, parentId, kind, name, fx: 'Ideia organizada → entrega verificável', problem: '',
    confidence: 75, confidenceSource: 'intuition', confidenceReason: 'Exemplo fictício para explorar a estrutura do planejamento.',
    pros: ['Entrega pequena e fácil de revisar'], cons: ['O escopo deve ser ajustado ao contexto real'],
    oQue: kind === 'root' ? example.objective : `Organizar e executar: ${name.toLocaleLowerCase()}.`,
    porQue: 'Transformar o objetivo em partes compreensíveis e conectadas à execução.',
    comoConfirmar: 'Definir um critério real antes de executar e registrar a observação depois.',
    confirmado: false, order, state: 'concept', notes: 'Dados de demonstração. Nenhuma validação real foi realizada.',
    history: [{ id: `${nodeId}:created`, timestamp: now, kind: 'created', message: 'Estrutura de demonstração adicionada localmente.' }],
    aiSuggested: false, position: { x: order * 260, y: kind === 'root' ? 0 : kind === 'categoria' ? 180 : 360 },
  });
  const nodes: Record<string, ConceptNodeData> = { [rootId]: node(rootId, null, 'root', example.name, 0) };
  example.phases.forEach((phase, index) => {
    const categoryId = `${id}:phase:${index}`;
    nodes[categoryId] = node(categoryId, rootId, 'categoria', phase, index);
    for (let child = 0; child < 2; child++) {
      const taskIndex = index * 2 + child;
      const stepId = `${id}:step:${taskIndex}`;
      nodes[stepId] = node(stepId, categoryId, 'passo', example.tasks[taskIndex], child);
    }
  });
  const project: Project = {
    id, name: example.name, objective: example.objective, createdAt: now, updatedAt: now, rootId, nodes,
    edges: Object.fromEntries(Object.values(nodes).filter((n) => n.parentId).map((n) => {
      const edgeId = `${n.id}:edge`;
      return [edgeId, { id: edgeId, source: n.parentId!, target: n.id, kind: 'direct' as const }];
    })),
    rules: ['Exemplo fictício: adapte o plano antes de usar em um projeto real.', 'Limitar o trabalho em andamento a duas entregas.'],
    constructionStrategy: 'hibrido', archetype: 'construir',
  };
  return {
    project: positionDemoPlan(project), selectedNodeId: rootId, focusedParentId: rootId, lens: 'structure', viewMode: 'graph',
    detailPanelOpen: true, lastTutorNodeId: null, drafts: {},
    objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, name: example.name, objective: example.objective, rules: [...project.rules!], expanded: {}, updatedAt: now },
    pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null,
  };
}

function blocks(key: string, content: Omit<NoteBlock, 'id'>[]): NoteBlock[] {
  return content.map((block, index) => ({ ...block, id: `${DEMO_PLAN_PREFIX}${key}:block:${index}` }));
}

export interface DemoLoadResult { projectIds: string[]; createdProjects: number }

/** Add local, explicitly fictitious examples through the same domain actions as the UI. */
export async function loadWorkspaceDemo(): Promise<DemoLoadResult> {
  const store = useWorkspaceStore.getState();
  const previous = { activeProjectId: store.activeProjectId, surface: store.surface };
  const existing = (key: string) => Object.values(useWorkspaceStore.getState().projects).find((project) => project.planner?.project?.id === `${DEMO_PLAN_PREFIX}${key}`);
  const alreadyLoaded = examples.map((example) => existing(example.key));
  alreadyLoaded.forEach((project, index) => {
    if (!project?.planner) return;
    const repaired = repairOriginalDemoLayout(project.planner, examples[index].key);
    if (repaired !== project.planner) store.savePlanner(project.id, repaired);
  });
  if (alreadyLoaded.every(Boolean)) {
    await flushWorkspacePersistence();
    return { projectIds: alreadyLoaded.map((project) => project!.id), createdProjects: 0 };
  }
  const folder = (name: string) => Object.values(useWorkspaceStore.getState().folders).find((f) => f.name === name)?.id ?? store.createFolder(name);
  const diaryFolder = folder('Demo · Diário pessoal');
  const projectFolder = folder('Demo · Projetos');
  const decisionsFolder = folder('Demo · Decisões');
  const referencesFolder = folder('Demo · Referências');
  const today = new Date();
  const now = Date.now();
  const projectIds: string[] = [];
  let createdProjects = 0;

  for (const example of examples) {
    const loaded = existing(example.key);
    if (loaded) { projectIds.push(loaded.id); continue; }
    const projectId = store.createProject(example.name, example.objective);
    projectIds.push(projectId);
    createdProjects++;
    const planner = demoPlanner(example, now);
    store.savePlanner(projectId, planner);
    store.importPlanTasks(projectId);
    const completedSprint = store.createSprint(projectId, { name: 'Sprint 01 · Fundamentos', goal: 'Organizar o objetivo e preparar uma base clara para execução.', startDate: dateFrom(today, -14), endDate: dateFrom(today, -1) });
    const activeSprint = store.createSprint(projectId, { name: 'Sprint 02 · Em construção', goal: example.goal, startDate: dateFrom(today, 0), endDate: dateFrom(today, 13) });
    const plannedSprint = store.createSprint(projectId, { name: 'Sprint 03 · Próximo ciclo', goal: 'Consolidar o aprendizado e preparar as próximas entregas.', startDate: dateFrom(today, 14), endDate: dateFrom(today, 27) });
    const taskIds = example.tasks.map((title, index) => {
      const status = index < 3 ? 'done' : index === 3 || index === 5 ? 'doing' : index === 4 || index === 7 ? 'review' : 'todo';
      const input: TaskInput = {
        title, status, priority: (['high', 'medium', 'low'] as const)[index % 3],
        description: `Demonstração fictícia para ${example.name.replace('(Demo) ', '')}.\n\nEntrega: ${title}.\n\nCritério de aceite: resultado registrado, revisado e acompanhado de um próximo passo claro.\n\nContexto: ${example.discovery}`,
        dueDate: dateFrom(today, index < 3 ? index - 5 : index < 8 ? index - 2 : index + 8),
        sprintId: index < 3 ? completedSprint : index < 8 ? activeSprint : index < 11 ? plannedSprint : null,
      };
      const imported = Object.values(useWorkspaceStore.getState().tasks).find((task) => task.projectId === projectId && task.sourceNodeId === `${planner.project!.id}:step:${index}`);
      if (imported) { store.updateTask(imported.id, input); return imported.id; }
      return store.createTask(projectId, input);
    });
    // Finished work enters a sprint before completion so the normal lifecycle
    // keeps its history; only one sprint per project is ever active.
    store.startSprint(completedSprint);
    store.completeSprint(completedSprint);
    store.startSprint(activeSprint);
    taskIds.slice(3, 8).forEach((taskId, index) => {
      store.addComment(taskId, `Contexto de demonstração: ${example.discovery} Próxima revisão focada na entrega ${index + 1}.`, 'user');
      store.addComment(taskId, `Sugestão fictícia do assistente: dividir a entrega em um passo pequeno e registrar o resultado na nota vinculada antes da próxima revisão.`, 'assistant');
    });
    const addNote = (key: string, title: string, folderId: string, content: Omit<NoteBlock, 'id'>[], taskId: string | null = null, pinned = false) => {
      const id = store.createNote({ projectId, taskId, folderId, title });
      store.updateNote(id, { blocks: blocks(`${example.key}:${key}`, content), pinned });
    };
    addNote('brief', 'Visão do projeto e escopo', projectFolder, [
      { type: 'heading', text: 'De uma ideia a um plano executável' },
      { type: 'text', text: example.objective, bold: true },
      { type: 'text', text: 'Este conteúdo é fictício e serve para explorar projetos, escopo, Kanban, Scrum e diário conectados.' },
      { type: 'bullet', text: `Primeiro foco: ${example.phases[0]}.` },
      { type: 'bullet', text: `Execução atual: ${example.goal}` },
      { type: 'check', text: 'Objetivo e entregas principais organizados', checked: true },
      { type: 'check', text: 'Revisar o resultado do ciclo com os aprendizados', checked: false },
    ], null, true);
    addNote('daily', 'Diário · decisões e próximos passos', diaryFolder, [
      { type: 'heading', text: 'O que avançou hoje' },
      { type: 'text', text: example.discovery },
      { type: 'text', text: 'Registrei o contexto da entrega antes de continuar. A próxima ação deve caber em uma sessão de trabalho.', italic: true },
      { type: 'check', text: 'Rever a tarefa em andamento e registrar uma decisão', checked: true },
      { type: 'check', text: 'Conferir o resultado e mover para revisão', checked: false },
      { type: 'bullet', text: `Atenção para o próximo ciclo: ${example.risk}` },
    ], taskIds[3], true);
    addNote('decision', 'Registro de decisão · foco do ciclo', decisionsFolder, [
      { type: 'heading', text: 'Decisão e contexto' },
      { type: 'text', text: example.decision, bold: true },
      { type: 'heading', text: 'O que pode mudar essa decisão' },
      { type: 'text', text: example.risk },
      { type: 'bullet', text: 'Revisar a decisão quando aparecer uma evidência nova; preservar o motivo original no diário.' },
      { type: 'check', text: 'Levar a decisão para a revisão da sprint', checked: false },
    ], taskIds[4]);
    addNote('retro', 'Retrospectiva · aprendizados do primeiro ciclo', projectFolder, [
      { type: 'heading', text: 'Manter, ajustar e experimentar' },
      { type: 'bullet', text: 'Manter: entregas pequenas com uma definição clara de pronto.' },
      { type: 'bullet', text: `Ajustar: ${example.risk}` },
      { type: 'bullet', text: 'Experimentar: reservar cinco minutos para registrar o aprendizado ao terminar cada tarefa.' },
      { type: 'text', text: 'Síntese fictícia do primeiro ciclo. As tarefas concluídas são exemplos visuais e não representam trabalho real.' },
    ], taskIds[1]);
  }

  const personalNotes = [
    { key: 'morning', title: '(Demo) Meu diário · clareza para a semana', pinned: true, folderId: diaryFolder, content: [
      { type: 'heading' as const, text: 'Uma intenção para esta semana' },
      { type: 'text' as const, text: 'Quero terminar o que comecei, deixar as decisões visíveis e abrir espaço para aprender sem transformar toda ideia em uma urgência.' },
      { type: 'check' as const, text: 'Escolher a entrega mais importante do dia', checked: true },
      { type: 'check' as const, text: 'Reservar um bloco sem interrupções', checked: false },
      { type: 'check' as const, text: 'Registrar um aprendizado antes de encerrar', checked: false },
      { type: 'text' as const, text: 'Nota pessoal de demonstração, independente de projeto.', italic: true },
    ] },
    { key: 'ideas', title: '(Demo) Ideias para depois', pinned: false, folderId: diaryFolder, content: [
      { type: 'heading' as const, text: 'Guardar a ideia sem perder o foco' },
      { type: 'bullet' as const, text: 'Criar uma revisão semanal que reúna tarefas concluídas e notas de aprendizado.' },
      { type: 'bullet' as const, text: 'Experimentar um projeto curto para cada habilidade que quero desenvolver.' },
      { type: 'text' as const, text: 'Voltar a esta lista no planejamento do próximo ciclo. Nenhuma destas ideias precisa virar uma tarefa agora.' },
    ] },
    { key: 'reference', title: '(Demo) Referência · como usar este espaço', pinned: false, folderId: referencesFolder, content: [
      { type: 'heading' as const, text: 'Escopo, execução e diário' },
      { type: 'bullet' as const, text: 'Projetos dão contexto e guardam o objetivo.' },
      { type: 'bullet' as const, text: 'O plano organiza o escopo e seus passos podem virar tarefas.' },
      { type: 'bullet' as const, text: 'Kanban mostra o fluxo; Scrum organiza o trabalho por ciclos.' },
      { type: 'bullet' as const, text: 'Notas registram ideias, decisões e aprendizados; podem apontar para um projeto ou uma tarefa.' },
      { type: 'text' as const, text: 'Todos os exemplos marcados com Demo são fictícios, locais e editáveis.' },
    ] },
  ];
  personalNotes.forEach((note) => {
    const noteBlocks = blocks(`personal:${note.key}`, note.content);
    if (Object.values(useWorkspaceStore.getState().notes).some((n) => n.blocks.some((block) => block.id === noteBlocks[0].id))) return;
    const id = store.createNote({ title: note.title, folderId: note.folderId });
    store.updateNote(id, { blocks: noteBlocks, pinned: note.pinned });
  });
  const restoreId = previous.activeProjectId && useWorkspaceStore.getState().projects[previous.activeProjectId] ? previous.activeProjectId : projectIds[0];
  if (restoreId) store.selectProject(restoreId);
  store.navigate(previous.surface);
  await flushWorkspacePersistence();
  return { projectIds, createdProjects };
}
