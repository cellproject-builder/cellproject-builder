import { computeTreeLayout } from '@/graph/treeLayout';
import { EMPTY_OBJECTIVE_DRAFT } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { loadWorkspaceDemo } from '@/workspace/demoData';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import type { NoteBlock, PlannerSnapshot, TaskInput } from '@/workspace/types';
import { normalizeVisualWorkspace } from '@/visuals/normalize';
import { createDemoRobotScene, createDemoGardenScene } from './models';
import { demoVisualWorkspace, type DemoDiagramKey } from './diagrams';

const PREFIX = 'cellproject-public-demo-v1:';
const FICTION = 'Exemplo fictício de apresentação. Nenhuma validação física ou operação real foi realizada.';

interface ExampleStep { title: string; delivery: string; acceptance: string }
interface Example {
  key: DemoDiagramKey;
  name: string;
  objective: string;
  icon: string;
  color: string;
  phases: [string, string, string];
  premise: string;
  criterion: string;
  rehearsal: string;
  revision: string;
  decision: string;
  risk: string;
  steps: ExampleStep[];
}

const examples: Example[] = [
  {
    key: 'robot', name: '(Demo) Robô de dois braços', icon: 'RocketIcon', color: '#8b5cf6',
    objective: 'Investigar como um robô didático de dois braços poderia organizar peças leves em uma bancada, conectando premissas, critérios próprios, ensaios e revisões justificadas.',
    phases: ['Entender a necessidade', 'Explorar a construção', 'Investigar e revisar'],
    premise: 'Premissa de exemplo: um braço curto com uma garra leve pode mover peças de espuma dentro de uma área limitada. O torque disponível, a massa da garra e a alimentação ainda precisam ser medidos.',
    criterion: 'Critério proposto antes do teste: registrar massa e distância da carga; comparar a demanda estimada com a especificação conferida; só então definir um ensaio supervisionado de baixa carga. Os limites numéricos reais permanecem em aberto.',
    rehearsal: 'Ensaio fictício: em uma simulação de roteiro, aumentar a distância da garra elevou a demanda estimada de torque. A anotação demonstra como registrar uma observação; não descreve um teste físico nem comprova a capacidade de um servo.',
    revision: 'Revisão justificada no cenário fictício: reduzir primeiro o alcance e a massa da garra, depois medir os componentes reais. Manter a hipótese em aberto até comparar a previsão com uma observação documentada.',
    decision: 'Começar com um único movimento e um braço por vez. A coordenação entre os dois braços entra apenas depois de compreender alimentação, limites mecânicos e parada segura no protótipo real.',
    risk: 'Torque insuficiente, folga mecânica e queda de tensão podem comprometer o movimento. Uma animação na tela não confirma estabilidade, precisão ou segurança do conjunto físico.',
    steps: [
      { title: 'Descrever a peça e a área de trabalho', delivery: 'Ficha do cenário com dimensões ainda a medir, superfície prevista e necessidade do movimento.', acceptance: 'Separar valores conhecidos de hipóteses e listar pelo menos três medidas que faltam.' },
      { title: 'Registrar a premissa de alcance e carga', delivery: 'Premissa explícita sobre a relação entre massa, distância e esforço no braço.', acceptance: 'A premissa deve poder ser contrariada por uma medida e apontar a consequência para o projeto.' },
      { title: 'Escrever um critério próprio de verificação', delivery: 'Critério escrito antes de consultar uma sugestão de validação.', acceptance: 'Informar o que medir, como registrar e qual condição exigiria revisar o plano.' },
      { title: 'Desenhar a sequência de movimentos', delivery: 'Roteiro de pegar, deslocar e soltar com uma pausa entre as etapas.', acceptance: 'Cada etapa deve ter posição inicial, posição final e uma condição explícita de interrupção.' },
      { title: 'Explorar torque em um artefato interativo', delivery: 'Cenário visual para variar carga e distância e comparar tendências.', acceptance: 'Identificar unidades e hipóteses; apresentar a saída como previsão de investigação, sem validá-la como medida.' },
      { title: 'Comparar duas geometrias de garra', delivery: 'Quadro de alternativas com massa, alcance e facilidade de montagem como itens a investigar.', acceptance: 'Registrar uma vantagem e uma limitação de cada alternativa sem inventar especificações de hardware.' },
      { title: 'Planejar alimentação e proteção', delivery: 'Lista de verificações para alimentação, conexões e desligamento supervisionado.', acceptance: 'Deixar corrente e tensão reais pendentes de conferência; evitar tratar o desenho como instalação executada.' },
      { title: 'Definir o roteiro do primeiro ensaio', delivery: 'Protocolo curto de ensaio progressivo, começando sem carga e com um único eixo.', acceptance: 'Incluir responsável, condições de parada e registro da observação antes de qualquer montagem real.' },
      { title: 'Registrar o ensaio fictício de bancada', delivery: 'Registro ilustrativo que compara previsão e observação inventada para esta apresentação.', acceptance: 'Marcar o registro como fictício em todas as conclusões e não confirmar capacidade física.' },
      { title: 'Revisar a premissa após o exemplo', delivery: 'Decisão de reduzir alcance e massa antes de avançar para a coordenação dos braços.', acceptance: 'Citar a premissa original, a observação simulada e a alteração que ela motivaria.' },
      { title: 'Preparar uma comparação antes e depois', delivery: 'Resumo do caminho entre objetivo, hipótese, critério, exemplo de ensaio e revisão.', acceptance: 'O leitor deve distinguir o raciocínio demonstrado da evidência física que ainda não existe.' },
      { title: 'Organizar dúvidas para o próximo ciclo', delivery: 'Backlog com medidas, componentes e perguntas de integração ainda em aberto.', acceptance: 'Cada dúvida precisa de uma próxima ação verificável e de um responsável a definir.' },
    ],
  },
  {
    key: 'garden', name: '(Demo) Horta automatizada', icon: 'SunIcon', color: '#22c55e',
    objective: 'Planejar uma horta escolar com irrigação acompanhada por registros, explorando a relação entre necessidade das plantas, leitura de umidade e decisões de cuidado.',
    phases: ['Conhecer a horta', 'Planejar a irrigação', 'Observar e ajustar'],
    premise: 'Premissa de exemplo: observar a umidade do substrato junto com o histórico de rega pode ajudar a evitar decisões feitas apenas pelo calendário. A leitura precisa ser calibrada para o recipiente e o sensor reais.',
    criterion: 'Critério proposto: comparar leituras em condições identificadas como seco, intermediário e úmido; registrar a resposta do sensor e revisar o limite escolhido antes de automatizar qualquer acionamento.',
    rehearsal: 'Ensaio fictício: a tabela ilustrativa contém três vasos e quatro observações inventadas. Um vaso apresentou leitura discrepante; o roteiro indica revisar a posição do sensor, sem concluir que houve defeito real.',
    revision: 'Revisão do exemplo: manter a rega manual supervisionada durante a calibração e registrar o contexto de cada leitura. O limite automático só será considerado depois de observações reais consistentes.',
    decision: 'Construir primeiro o diário de cuidados e uma visualização das leituras. A bomba permanece como hipótese de uma etapa futura, com acionamento e segurança a avaliar.',
    risk: 'Sensores variam com o substrato e a posição. Água perto de circuitos requer um projeto adequado; os dados desta apresentação não permitem dimensionar uma instalação real.',
    steps: [
      { title: 'Mapear vasos e rotina de cuidados', delivery: 'Inventário ilustrativo de três vasos, espécies a escolher e responsáveis pelo cuidado.', acceptance: 'Cada vaso deve ter uma identificação e uma pergunta sobre sua necessidade de água.' },
      { title: 'Registrar a hipótese sobre umidade', delivery: 'Hipótese que conecta leitura do substrato à decisão de regar.', acceptance: 'Indicar fatores de confusão como posição do sensor, tipo de solo e horário da leitura.' },
      { title: 'Definir o diário de observação', delivery: 'Modelo com data, contexto, leitura e ação de cuidado.', acceptance: 'O modelo deve permitir registrar ausência de leitura e evitar preencher lacunas com valores inventados.' },
      { title: 'Escolher as perguntas de calibração', delivery: 'Lista de condições a observar antes de escolher um limite de acionamento.', acceptance: 'Separar calibração, observação da planta e decisão sobre a rega em etapas diferentes.' },
      { title: 'Desenhar o fluxo de irrigação', delivery: 'Diagrama de decisão que começa pela leitura e termina em uma ação supervisionada.', acceptance: 'Incluir caminhos de leitura ausente, valor suspeito e acionamento bloqueado.' },
      { title: 'Comparar cuidado manual e automático', delivery: 'Tabela de vantagens, limites e esforço de manutenção das duas alternativas.', acceptance: 'Evitar prometer economia de água sem medição e indicar como ela poderia ser avaliada.' },
      { title: 'Planejar o posicionamento do sensor', delivery: 'Esboço dos locais possíveis e dos motivos para escolher cada um.', acceptance: 'Registrar que qualquer posição precisa ser conferida no vaso real e permitir sua revisão.' },
      { title: 'Preparar a visualização das leituras', delivery: 'Rascunho de um painel com unidade, horário e indicação de dado ausente.', acceptance: 'Os valores de exemplo devem estar identificados e nenhuma tendência deve ser apresentada como resultado real.' },
      { title: 'Preencher uma série fictícia de exemplo', delivery: 'Tabela com situações inventadas para demonstrar o diário da horta.', acceptance: 'Cada linha deve conter contexto e a marcação de dado fictício.' },
      { title: 'Investigar a leitura discrepante', delivery: 'Registro de hipóteses alternativas para uma diferença simulada entre vasos.', acceptance: 'Propor pelo menos duas explicações e uma forma de discriminá-las por observação real.' },
      { title: 'Revisar o limite de decisão', delivery: 'Decisão demonstrativa de adiar o acionamento automático até concluir a calibração.', acceptance: 'Vincular a revisão à incerteza observada e preservar o motivo da decisão anterior.' },
      { title: 'Preparar a próxima semana de cuidados', delivery: 'Lista de próximos registros e de perguntas para o responsável pela horta.', acceptance: 'Limitar o próximo ciclo a uma variável de investigação por vez.' },
    ],
  },
  {
    key: 'workshop', name: '(Demo) Oficina de invenções', icon: 'MagicWandIcon', color: '#f59e0b',
    objective: 'Organizar uma oficina fictícia em que pequenos grupos transformam uma ideia em uma hipótese, um protótipo de papel e um registro do que aprenderam.',
    phases: ['Preparar o encontro', 'Conduzir a experiência', 'Compartilhar aprendizados'],
    premise: 'Premissa de exemplo: uma atividade curta com materiais simples pode tornar visível o caminho entre uma pergunta e uma revisão de ideia. O roteiro precisa ser adequado ao público real antes de ser utilizado.',
    criterion: 'Critério proposto: ao final da dinâmica, cada grupo consegue mostrar a pergunta inicial, uma previsão própria, o que observou no protótipo e qual decisão revisaria. Esse critério ainda não foi aplicado a participantes reais.',
    rehearsal: 'Ensaio fictício: três grupos inventados percorreram o roteiro em tempos diferentes. O grupo Ipê precisaria de uma pergunta mais concreta; o grupo Maré teria deixado a revisão para depois. Não houve evento ou coleta real de participantes.',
    revision: 'Revisão no cenário de apresentação: reservar um bloco explícito para a revisão da ideia e reduzir a quantidade de materiais. Ensaiar o roteiro com a equipe antes de definir a duração real.',
    decision: 'Priorizar uma pergunta por grupo e um protótipo de papel. A apresentação final deve mostrar a mudança de raciocínio, mesmo quando o primeiro desenho não resolve a pergunta.',
    risk: 'O cronograma pode ficar apertado e participantes podem precisar de formas diferentes de expressão. Prever instruções visuais, pausas e alternativas de registro.',
    steps: [
      { title: 'Definir a pergunta da oficina', delivery: 'Convite fictício com uma pergunta central e o objetivo da experiência.', acceptance: 'O convite deve explicar a atividade em linguagem simples e deixar claro que o encontro é ilustrativo.' },
      { title: 'Desenhar a jornada dos grupos', delivery: 'Sequência de chegada, pergunta, previsão, protótipo, observação e revisão.', acceptance: 'Cada momento deve ter propósito, duração a validar e um sinal de conclusão.' },
      { title: 'Montar a lista de materiais simples', delivery: 'Lista de papel, lápis e itens de apoio com alternativas acessíveis.', acceptance: 'Nenhuma compra deve ser tratada como realizada; a lista deve indicar o que depende de confirmação.' },
      { title: 'Preparar o cartão de previsão', delivery: 'Modelo em branco para o grupo registrar o que espera antes de experimentar.', acceptance: 'Separar previsão, observação e revisão em espaços distintos para evitar respostas retroativas.' },
      { title: 'Escrever as instruções de abertura', delivery: 'Roteiro curto que apresenta a pergunta e o caráter exploratório da atividade.', acceptance: 'As instruções devem caber em uma leitura de dois minutos no ensaio fictício.' },
      { title: 'Desenhar uma alternativa acessível', delivery: 'Opção de registrar a ideia por desenho, fala mediada ou texto.', acceptance: 'A alternativa precisa preservar a possibilidade de registrar previsão e revisão.' },
      { title: 'Criar o quadro de acompanhamento', delivery: 'Quadro com os grupos fictícios Ipê, Maré e Aurora e suas próximas ações.', acceptance: 'Cada grupo deve ter apenas uma próxima ação e nenhum dado de participante real.' },
      { title: 'Preparar a pergunta de observação', delivery: 'Pergunta que ajuda os grupos a comparar o que esperavam com o que viram.', acceptance: 'Evitar induzir uma resposta positiva ou tratar dificuldade como falha do participante.' },
      { title: 'Ensaiar o roteiro com grupos fictícios', delivery: 'Simulação escrita com tempos e dificuldades inventados para testar a clareza do roteiro.', acceptance: 'Marcar todos os resultados como fictícios e listar o que requer um ensaio real.' },
      { title: 'Reservar espaço para a revisão', delivery: 'Ajuste do cronograma que destaca a decisão de manter ou mudar a ideia.', acceptance: 'O cronograma deve mostrar uma etapa própria de revisão após a observação.' },
      { title: 'Montar a galeria de aprendizados', delivery: 'Modelo de apresentação com pergunta, previsão, observação e próxima tentativa.', acceptance: 'Cada exemplo deve evidenciar uma mudança de raciocínio, sem prometer eficácia educacional.' },
      { title: 'Registrar a retrospectiva da equipe', delivery: 'Síntese fictícia do que manter, simplificar e investigar antes de um encontro real.', acceptance: 'Converter as incertezas em próximos passos e preservar os limites do exemplo.' },
    ],
  },
];

function dateFrom(today: Date, offset: number): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function plannerFor(example: Example, now: number): PlannerSnapshot {
  const id = `${PREFIX}${example.key}`, rootId = `${id}:root`;
  const node = (nodeId: string, parentId: string | null, kind: ConceptNodeData['kind'], name: string, order: number, step?: ExampleStep): ConceptNodeData => ({
    id: nodeId, parentId, kind, name, order,
    fx: 'Pergunta → premissa → critério próprio → observação → revisão justificada',
    problem: example.risk, confidence: 45, confidenceSource: 'intuition',
    confidenceReason: 'Hipótese de um cenário fictício. O valor ilustra incerteza e não representa confiança medida.',
    pros: ['Contexto e próxima ação explícitos', 'Comparação entre previsão e observação'],
    cons: ['Sem validação em uma situação real', example.risk],
    oQue: step?.delivery ?? (kind === 'root' ? example.objective : `Organizar a etapa ${name.toLocaleLowerCase()} com entregas pequenas e registros de decisão.`),
    porQue: `Conectar esta parte ao objetivo: ${example.objective}`,
    comoConfirmar: step?.acceptance ?? example.criterion,
    ...(step ? { comoConfirmarUsuario: step.acceptance, comoConfirmarUsuarioAt: now } : {}),
    confirmado: false, state: 'concept', notes: `${FICTION}\n\n${example.premise}\n\n${example.revision}`,
    history: [{ id: `${nodeId}:created`, timestamp: now, kind: 'created', message: 'Estrutura fictícia preparada para exploração no ambiente de demonstração.' }],
    aiSuggested: false, position: { x: 0, y: 0 },
  });
  const nodes: Record<string, ConceptNodeData> = { [rootId]: node(rootId, null, 'root', example.name, 0) };
  example.phases.forEach((phase, phaseIndex) => {
    const categoryId = `${id}:phase:${phaseIndex}`;
    nodes[categoryId] = node(categoryId, rootId, 'categoria', phase, phaseIndex);
    example.steps.slice(phaseIndex * 4, phaseIndex * 4 + 4).forEach((step, index) => {
      const stepId = `${id}:step:${phaseIndex * 4 + index}`;
      nodes[stepId] = node(stepId, categoryId, 'passo', step.title, index, step);
    });
  });
  const project: Project = {
    id, name: example.name, objective: example.objective, createdAt: now, updatedAt: now, rootId, nodes,
    edges: Object.fromEntries(Object.values(nodes).filter(item => item.parentId).map(item => [`${item.id}:edge`, {
      id: `${item.id}:edge`, source: item.parentId!, target: item.id, kind: 'direct' as const,
    }])),
    rules: [FICTION, 'Escrever o critério antes de interpretar o resultado.', 'Preservar dúvidas e revisar o plano quando aparecer evidência nova.'],
    archetype: 'construir', constructionStrategy: 'hibrido', planApproach: 'new_creation',
    manualLayout: true,
  };
  const positions = computeTreeLayout(project);
  // Reserve a band under the root for the local diagram; retain the tree's sibling spacing.
  project.nodes = Object.fromEntries(Object.values(nodes).map(item => [item.id, {
    ...item, position: { x: positions[item.id].x, y: positions[item.id].y + (item.id === rootId ? 0 : 340) },
  }]));
  project.visuals = demoVisualWorkspace(example.key, project, now);
  const scene = example.key === 'robot' ? createDemoRobotScene() : example.key === 'garden' ? createDemoGardenScene() : null;
  if (scene) project.visuals = normalizeVisualWorkspace({ ...project.visuals, artifacts: [...project.visuals.artifacts, {
    id: `${id}:model`, label: scene.label, kind: 'model', linkedNodeId: `${id}:step:${example.key === 'robot' ? 4 : 7}`,
    x: 450, y: 220, width: 520, height: 360, scene, mediaId: null, source: null,
    revisions: [{ scene, mediaId: null, createdAt: now }], revisionIndex: 0,
  }] });
  return {
    project, selectedNodeId: rootId, focusedParentId: rootId, lens: 'structure', viewMode: 'graph', detailPanelOpen: true,
    lastTutorNodeId: null, drafts: {},
    objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, name: example.name, objective: example.objective, rules: [...project.rules!], expanded: {}, updatedAt: now },
    pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null, archivedSession: null,
  };
}

function addExample(example: Example, folders: { projects: string; experiments: string; decisions: string; diary: string }, today: Date, now: number): void {
  const store = useWorkspaceStore.getState();
  if (Object.values(store.projects).some(project => project.planner?.project?.id === `${PREFIX}${example.key}`)) return;
  const projectId = store.createProject(example.name, example.objective, { icon: example.icon, color: example.color });
  const planner = plannerFor(example, now);
  store.savePlanner(projectId, planner);
  store.importPlanTasks(projectId);
  const completed = store.createSprint(projectId, { name: 'Sprint 01 · Perguntas e contexto', goal: 'Tornar a pergunta e as premissas explícitas antes de escolher a construção.', startDate: dateFrom(today, -14), endDate: dateFrom(today, -1) });
  const active = store.createSprint(projectId, { name: 'Sprint 02 · Exploração guiada', goal: example.decision, startDate: dateFrom(today, 0), endDate: dateFrom(today, 13) });
  const planned = store.createSprint(projectId, { name: 'Sprint 03 · Observação e revisão', goal: 'Comparar previsão e observação, registrar limites e revisar o próximo passo.', startDate: dateFrom(today, 14), endDate: dateFrom(today, 27) });
  const taskIds = example.steps.map((step, index) => {
    const task = Object.values(useWorkspaceStore.getState().tasks).find(item => item.projectId === projectId && item.sourceNodeId === `${planner.project!.id}:step:${index}`)!;
    const status = index < 3 ? 'done' : index === 3 || index === 5 ? 'doing' : index === 4 || index === 7 ? 'review' : 'todo';
    const input: TaskInput = {
      title: step.title, description: `${FICTION}\n\nEntrega: ${step.delivery}\n\nCritério de aceite: ${step.acceptance}\n\nContexto: ${example.premise}`,
      status, priority: (['high', 'medium', 'low'] as const)[index % 3], dueDate: dateFrom(today, index < 3 ? index - 5 : index + 1),
      sprintId: index < 3 ? completed : index < 8 ? active : index < 11 ? planned : null,
    };
    store.updateTask(task.id, input);
    return task.id;
  });
  store.startSprint(completed);
  store.completeSprint(completed);
  store.startSprint(active);
  taskIds.slice(3, 9).forEach((taskId, index) => {
    store.addComment(taskId, `Registro fictício da equipe: ${example.steps[index + 3].delivery} Antes de avançar, conferir o critério de aceite e registrar uma dúvida na nota do projeto.`, 'user');
    store.addComment(taskId, `Comentário ilustrativo do assistente: ${example.steps[index + 3].acceptance} Esta sugestão faz parte dos dados de demonstração.`, 'assistant');
  });
  const note = (key: string, title: string, folderId: string, content: Omit<NoteBlock, 'id'>[], taskId: string | null = null, pinned = false) => {
    const noteId = store.createNote({ projectId, taskId, folderId, title });
    store.updateNote(noteId, { pinned, blocks: content.map((block, index) => ({ ...block, id: `${PREFIX}${example.key}:${key}:block:${index}` })) });
  };
  note('brief', 'Visão do projeto · propósito e limites', folders.projects, [
    { type: 'heading', text: 'Uma pergunta que orienta o trabalho' },
    { type: 'text', text: example.objective, bold: true },
    { type: 'text', text: FICTION, italic: true },
    { type: 'bullet', text: `Premissa inicial: ${example.premise}` },
    { type: 'bullet', text: `Escolha de foco: ${example.decision}` },
    { type: 'check', text: 'Organizar o objetivo em uma desestruturação navegável', checked: true },
    { type: 'check', text: 'Conferir as condições reais antes de usar este plano fora da demonstração', checked: false },
  ], null, true);
  note('investigation', 'Caderno de investigação · da premissa à revisão', folders.experiments, [
    { type: 'heading', text: '1. Premissa que queremos investigar' },
    { type: 'text', text: example.premise },
    { type: 'heading', text: '2. Critério escrito antes da observação' },
    { type: 'text', text: example.criterion, bold: true },
    { type: 'heading', text: '3. Ensaio fictício para demonstrar o registro' },
    { type: 'text', text: example.rehearsal },
    { type: 'heading', text: '4. Revisão justificada e próxima investigação' },
    { type: 'text', text: example.revision },
    { type: 'text', text: FICTION, italic: true },
  ], taskIds[8], true);
  note('daily', 'Diário de bordo · onde paramos hoje', folders.diary, [
    { type: 'heading', text: 'Avanço no cenário fictício' },
    { type: 'text', text: 'A equipe de exemplo organizou a pergunta, explicitou as hipóteses e escolheu uma próxima ação pequena. As tarefas concluídas ilustram o fluxo e não representam trabalho realizado.' },
    { type: 'bullet', text: `Em andamento: ${example.steps[3].title}. Entrega esperada: ${example.steps[3].delivery}` },
    { type: 'bullet', text: `Para revisão: ${example.steps[4].title}. Conferir: ${example.steps[4].acceptance}` },
    { type: 'check', text: 'Registrar o contexto antes de mudar o status da tarefa', checked: true },
    { type: 'check', text: 'Anotar uma dúvida e uma próxima tentativa ao encerrar a sessão', checked: false },
    { type: 'text', text: example.risk, italic: true },
  ], taskIds[3], true);
  note('decision', 'Decisão de projeto · por que escolhemos este caminho', folders.decisions, [
    { type: 'heading', text: 'Escolha e contexto' },
    { type: 'text', text: example.decision, bold: true },
    { type: 'heading', text: 'Alternativa que ficou para depois' },
    { type: 'text', text: 'Ampliar todas as frentes ao mesmo tempo. No cenário fictício, isso esconderia as perguntas mais importantes e aumentaria a dificuldade de interpretar uma observação.' },
    { type: 'bullet', text: `O que faria a escolha mudar: ${example.risk}` },
    { type: 'bullet', text: `Próximo passo para revisar: ${example.revision}` },
    { type: 'text', text: FICTION, italic: true },
  ], taskIds[4]);
  note('retro', 'Retrospectiva · manter, ajustar e experimentar', folders.projects, [
    { type: 'heading', text: 'Aprendizados ilustrativos do primeiro ciclo' },
    { type: 'bullet', text: 'Manter: uma entrega pequena por vez, com critério próprio escrito antes de interpretar o resultado.' },
    { type: 'bullet', text: `Ajustar: ${example.revision}` },
    { type: 'bullet', text: `Experimentar: ${example.steps[11].delivery}` },
    { type: 'text', text: 'Uma dificuldade pode revelar uma premissa frágil. No próximo ciclo, a equipe de exemplo deve registrar primeiro o que esperava e só depois comparar com o que observou.' },
    { type: 'check', text: 'Levar uma pergunta concreta para o próximo planejamento', checked: false },
    { type: 'text', text: FICTION, italic: true },
  ], taskIds[2]);
  note('questions', 'Perguntas abertas · o que ainda precisamos descobrir', folders.experiments, [
    { type: 'heading', text: 'Incertezas que orientam a próxima ação' },
    { type: 'bullet', text: `Qual observação poderia contrariar esta premissa? ${example.premise}` },
    { type: 'bullet', text: `Como distinguir uma limitação do modelo de uma dificuldade de execução? ${example.risk}` },
    { type: 'bullet', text: `Qual é o menor próximo teste capaz de ajudar esta decisão? ${example.decision}` },
    { type: 'text', text: 'Estas perguntas pertencem ao cenário fictício. Não há arquivos, contas, pessoas ou fontes externas reais associados a este caderno.' },
    { type: 'check', text: 'Escolher uma pergunta e explicar como a resposta mudaria o plano', checked: false },
  ], taskIds[11]);
}

let seeding: Promise<void> | null = null;

/** Add fictional examples with the real domain actions; a repeated mount keeps visitor edits. */
export function seedPublicDemo(): Promise<void> {
  if (seeding) return seeding;
  seeding = (async () => {
    await loadWorkspaceDemo();
    const store = useWorkspaceStore.getState();
    const folder = (name: string) => Object.values(useWorkspaceStore.getState().folders).find(item => item.name === name)?.id ?? store.createFolder(name);
    const folders = {
      projects: folder('Demo · Projetos'), experiments: folder('Demo · Investigações'),
      decisions: folder('Demo · Decisões'), diary: folder('Demo · Diário pessoal'),
    };
    const today = new Date(), now = Date.now();
    examples.forEach(example => addExample(example, folders, today, now));
    useWorkspaceStore.setState({ activeProjectId: null, activeBoardId: null, surface: 'projects' });
    await flushWorkspacePersistence();
  })().finally(() => { seeding = null; });
  return seeding;
}
