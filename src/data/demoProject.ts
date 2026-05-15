import { nanoid } from 'nanoid';
import type {
  AdversarialCritique,
  ConceptEdgeData,
  ConceptNodeData,
  GroundTruthRef,
  HistoryEntry,
  Project,
} from '@/types';

// ---------------------------------------------------------------------------
// Demo project — Pipa octogonal de bambu (canônica do CONCEITO.md).
//
// Cobre nó-a-nó os recursos do produto:
// - 3 categorias (Recursos, Execução, Decisões)
// - estados variados (concept, validated, executing, done)
// - confirmações parciais (parte feito, parte pendente)
// - groundTruthRefs com `verificado: true` (mecanismo d em ação)
// - 1 nó com `comoConfirmarUsuario` travado (mecanismo a)
// - 1 nó com `critica` adversarial gerada (mecanismo b)
// - 1 decisão real com `decisionOptions` (4 vs 8 pontos de tensão)
// - arestas variadas: direct entre passos, optional/middleware onde cabe
// - history rica em vários nós (auditoria visível)
//
// As posições são fixas — não passa pelo layoutFromPlan porque queremos um
// arranjo curado e legível, não auto-layout.
// ---------------------------------------------------------------------------

const DEMO_T0 = 1_730_000_000_000; // 2024-10-27 — fixed so timestamps don't drift between runs

const ts = (deltaSec: number) => DEMO_T0 + deltaSec * 1000;

const hist = (kind: HistoryEntry['kind'], message: string, at: number): HistoryEntry => ({
  id: nanoid(8),
  timestamp: at,
  kind,
  message,
});

const gtRef = (
  partial: Omit<GroundTruthRef, 'id' | 'addedAt' | 'verifiedAt'> & {
    addedAt: number;
    verifiedAt?: number;
  },
): GroundTruthRef => ({
  id: nanoid(8),
  ...partial,
});

// ---------------------------------------------------------------------------
// IDs fixos por papel — facilita escrever as arestas referenciando-os.
// ---------------------------------------------------------------------------

const ROOT = 'demo-root-pipa';
const CAT_REC = 'demo-cat-recursos';
const CAT_EXE = 'demo-cat-execucao';
const CAT_DEC = 'demo-cat-decisoes';

const REC_VARETA_A = 'demo-rec-vareta-a';
const REC_VARETA_B = 'demo-rec-vareta-b';
const REC_LINHA = 'demo-rec-linha';
const REC_PAPEL = 'demo-rec-papel';
const REC_COLA = 'demo-rec-cola';

const PASSO_CORTAR = 'demo-passo-cortar';
const PASSO_AMARRAR = 'demo-passo-amarrar';
const PASSO_PAPEL = 'demo-passo-papel';
const PASSO_TENSIONAR = 'demo-passo-tensionar';
const PASSO_TESTE = 'demo-passo-teste';

const DEC_PONTOS = 'demo-dec-pontos';

// ---------------------------------------------------------------------------
// Layout (curado).
// Eixo x: -560 ← Recursos · 0 = Execução · +560 → Decisões
// Eixo y: 0 = root · 220 = categorias · 460+ = folhas
// ---------------------------------------------------------------------------

const POS = {
  root: { x: 0, y: 0 },
  catRec: { x: -560, y: 220 },
  catExe: { x: 0, y: 220 },
  catDec: { x: 560, y: 220 },

  // Recursos column (left)
  varA: { x: -780, y: 460 },
  varB: { x: -600, y: 460 },
  linha: { x: -420, y: 460 },
  papel: { x: -780, y: 660 },
  cola: { x: -540, y: 660 },

  // Execução column (center) — 5 passos in cascade
  cortar: { x: -180, y: 460 },
  amarrar: { x: 0, y: 540 },
  papelExe: { x: 180, y: 460 },
  tensionar: { x: 0, y: 700 },
  teste: { x: 0, y: 860 },

  // Decisões column (right)
  pontos: { x: 560, y: 460 },
};

const adversarialOnTensionar: AdversarialCritique = {
  fraquezas: [
    'Tensão excessiva pode fender bambu de Phyllostachys aurea seco.',
    'Sem nó-cego nos vértices, a linha periférica afrouxa em umidade alta.',
  ],
  premissasOcultas: [
    'Assume que o bambu já está curado e estável dimensionalmente.',
    'Assume nó simples — não trava lateralmente sob torção.',
  ],
  criterioAlternativo:
    'Borda deve resistir a flexão de 30° sem deformação permanente em teste de torção manual. Após 24h pendurado, perímetro não deve variar mais que ±2mm.',
  generatedAt: ts(7200),
};

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function makeNodes(): Record<string, ConceptNodeData> {
  const nodes: Record<string, ConceptNodeData> = {};

  // ---------- ROOT
  nodes[ROOT] = {
    id: ROOT,
    parentId: null,
    kind: 'root',
    name: 'Pipa octogonal de bambu',
    fx: 'construir uma pipa octogonal de bambu que voe estável em vento médio',
    problem: 'Objetivo global do projeto',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Dado pelo usuário',
    pros: [],
    cons: [],
    oQue: 'construir uma pipa octogonal de bambu que voe estável em vento médio',
    porQue:
      'Pipa octogonal distribui melhor a tensão da linha que a clássica losango, voa mais alto e suporta vento entre 12 e 25 km/h.',
    comoConfirmar:
      'Pipa montada, em voo estável a pelo menos 30m de altura por mais de 2 minutos.',
    confirmado: false,
    order: 0,
    state: 'executing',
    notes:
      'Plano canônico: 2 varetas de bambu como cruz central, perímetro octogonal tensionado por linha encerada, papel seda como cobertura.',
    history: [
      hist('created', 'Projeto criado a partir do plano "Pipa octogonal — vento médio"', ts(0)),
      hist('state', 'Avançou para executing', ts(3600)),
    ],
    aiSuggested: false,
    position: POS.root,
  };

  // ---------- CATEGORIA: RECURSOS
  nodes[CAT_REC] = {
    id: CAT_REC,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Recursos',
    fx: 'categoria: recursos',
    problem: 'O que precisa estar disponível antes de começar a execução.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: 'tudo que precisa estar à mão antes do passo 1',
    porQue: 'Sem recurso, qualquer execução trava.',
    comoConfirmar: 'Todos os 5 itens desta lista confirmados.',
    confirmado: false,
    order: 0,
    state: 'validated',
    notes: '',
    history: [hist('created', 'Categoria Recursos criada', ts(0))],
    aiSuggested: false,
    position: POS.catRec,
  };

  // ---------- CATEGORIA: EXECUÇÃO
  nodes[CAT_EXE] = {
    id: CAT_EXE,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Execução',
    fx: 'categoria: execução',
    problem: 'A sequência cronológica de passos para construir a pipa.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: 'passos do começo ao primeiro voo',
    porQue: 'Sem ordem, alguns passos bloqueiam os outros (não dá pra tensionar antes de amarrar).',
    comoConfirmar: 'Todos os passos desta categoria executados em ordem.',
    confirmado: false,
    order: 1,
    state: 'executing',
    notes: '',
    history: [hist('created', 'Categoria Execução criada', ts(0))],
    aiSuggested: false,
    position: POS.catExe,
  };

  // ---------- CATEGORIA: DECISÕES
  nodes[CAT_DEC] = {
    id: CAT_DEC,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Decisões',
    fx: 'categoria: decisões',
    problem: 'Escolhas com tradeoff real entre caminhos.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: 'pontos onde existe mais de um caminho válido',
    porQue: 'Cada decisão fecha portas; vale explicitar o tradeoff.',
    comoConfirmar: 'Todas as decisões pendentes resolvidas.',
    confirmado: false,
    order: 2,
    state: 'validated',
    notes: '',
    history: [hist('created', 'Categoria Decisões criada', ts(0))],
    aiSuggested: false,
    position: POS.catDec,
  };

  // ---------- RECURSO: vareta A (com ground truth verificado + critério do usuário travado)
  nodes[REC_VARETA_A] = {
    id: REC_VARETA_A,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Vareta de bambu A — 40cm',
    fx: 'estrutura horizontal da cruz central',
    problem: 'Sem vareta reta, a pipa não tem esqueleto.',
    confidence: 95,
    confidenceSource: 'experience',
    confidenceReason: 'Já cortei dezenas no quintal',
    pros: ['leve', 'flexível sem quebrar', 'fácil de encontrar'],
    cons: ['precisa estar bem reta', 'pode rachar se for muito jovem'],
    oQue: 'uma vareta de bambu Phyllostachys aurea de 40cm de comprimento',
    porQue:
      'A vareta horizontal define a largura total da pipa. Tem que ser reta e ter espessura entre 5 e 8mm para flexionar sem quebrar.',
    comoConfirmar:
      'Vareta cortada em 40cm exatos, sem rachaduras visíveis, com espessura uniforme.',
    comoConfirmarUsuario:
      'Mediu com fita métrica 40cm de ponta a ponta. Sem nós internos rachados. Roda a vareta entre os dedos e ela gira reta — não cambaleia.',
    comoConfirmarUsuarioAt: ts(1800),
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Espécie e dimensão',
        value: 'Phyllostachys aurea, 40cm ± 2cm, Ø 5-8mm',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2400),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'Peso máximo (estrutural)',
        value: '< 15g por vareta',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2700),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 0,
    state: 'done',
    notes: 'Achei 3 candidatas no jardim, escolhi a mais reta.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('criterio_usuario', 'Critério do usuário travado — antes de ver o da IA', ts(1800)),
      hist('ground_truth', 'Spec verificada no mundo', ts(2400)),
      hist('ground_truth', 'Medida verificada no mundo', ts(2700)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3000)),
    ],
    aiSuggested: true,
    position: POS.varA,
  };

  // ---------- RECURSO: vareta B
  nodes[REC_VARETA_B] = {
    id: REC_VARETA_B,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Vareta de bambu B — 40cm',
    fx: 'estrutura vertical da cruz central',
    problem: 'Sem o eixo vertical, a pipa não tem altura.',
    confidence: 95,
    confidenceSource: 'experience',
    confidenceReason: 'Mesma da vareta A — mesma espécie',
    pros: ['simétrica à vareta A'],
    cons: ['precisa casar exatamente o comprimento da A'],
    oQue: 'segunda vareta idêntica à A, 40cm',
    porQue:
      'A vareta vertical cruza com a horizontal no centro geométrico, formando o + da cruz.',
    comoConfirmar:
      'Mesmas dimensões da vareta A, sem rachaduras.',
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Mesma espécie e dimensão da A',
        value: 'Phyllostachys aurea, 40cm ± 2cm',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2400),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 1,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3100)),
    ],
    aiSuggested: true,
    position: POS.varB,
  };

  // ---------- RECURSO: linha encerada
  nodes[REC_LINHA] = {
    id: REC_LINHA,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Linha encerada — 4m',
    fx: 'tensiona o perímetro octogonal',
    problem: 'Linha sem cera afrouxa em umidade.',
    confidence: 88,
    confidenceSource: 'data',
    confidenceReason: 'Pesquisa rápida em fórum de aeromodelismo',
    pros: ['não estica', 'resistente à umidade'],
    cons: ['mais cara que linha comum'],
    oQue: '4m de linha encerada de algodão #10 ou equivalente',
    porQue:
      'A linha perimetral mantém o octógono tensionado. Linha comum estica e perde a forma.',
    comoConfirmar: 'Linha cortada em 4m, sem nós ou pontos fracos visíveis.',
    groundTruthRefs: [
      gtRef({
        kind: 'link',
        label: 'Tutorial de referência',
        value: 'https://aeromodelismo.exemplo/linhas',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(3300),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'Comprimento total',
        value: '4m ± 10cm',
        verificado: false,
        addedAt: ts(600),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 2,
    state: 'done',
    notes: 'Comprei na papelaria do bairro, 5m por R$8.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3400)),
    ],
    aiSuggested: true,
    position: POS.linha,
  };

  // ---------- RECURSO: papel seda (concept ainda, não confirmado)
  nodes[REC_PAPEL] = {
    id: REC_PAPEL,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Papel seda 50×50cm',
    fx: 'superfície aerodinâmica da pipa',
    problem: 'Sem cobertura, não tem o que pegar o vento.',
    confidence: 80,
    confidenceSource: 'ai',
    confidenceReason: 'Material clássico do domínio',
    pros: ['leve', 'fácil de cortar', 'aceita cola branca'],
    cons: ['rasga se molhar', 'precisa cuidado pra esticar sem amassar'],
    oQue: 'uma folha de papel seda quadrada 50×50cm',
    porQue:
      'Cobre o octógono inteiro com sobra de 5cm pra dobrar nas bordas. Papel seda é o mais leve dentro do uso doméstico.',
    comoConfirmar:
      'Folha de 50×50cm, sem rasgos, esticada sobre a estrutura.',
    groundTruthRefs: [
      gtRef({
        kind: 'medida',
        label: 'Área mínima',
        value: '50×50cm para octógono de 35cm de envergadura',
        verificado: false,
        addedAt: ts(600),
        addedByAI: true,
      }),
    ],
    confirmado: false,
    order: 3,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Recurso criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.papel,
  };

  // ---------- RECURSO: cola (estado problem — exemplo de falha reportada)
  nodes[REC_COLA] = {
    id: REC_COLA,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Cola branca lavável',
    fx: 'fixa o papel seda nas varetas e nas bordas',
    problem: 'Cola muito úmida pode encharcar o papel seda.',
    confidence: 72,
    confidenceSource: 'experience',
    confidenceReason: 'Já tive papel encharcado por cola branca normal',
    pros: ['fácil de achar', 'barato'],
    cons: ['demora a secar', 'pode amassar o papel'],
    oQue: 'cola branca escolar lavável (Tenaz, Acrilex ou similar)',
    porQue:
      'Aplica em pontos discretos nas extremidades das varetas e ao longo da borda. Não cobre toda a superfície.',
    comoConfirmar: 'Tubo de cola lacrado ou bem fechado, sem secar.',
    failureContext:
      'Tentei usar cola branca normal e o papel seda ficou amassado e encharcado nos pontos. Preciso de uma cola que seque mais rápido ou aplicar bem menos.',
    failureReportedAt: ts(5400),
    confirmado: false,
    order: 4,
    state: 'problem',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('failure', 'Reportado problema com cola branca normal', ts(5400)),
    ],
    aiSuggested: true,
    position: POS.cola,
  };

  // ---------- PASSO 1: cortar varetas
  nodes[PASSO_CORTAR] = {
    id: PASSO_CORTAR,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Cortar varetas no tamanho exato',
    fx: 'ajustar comprimento físico das varetas para 40cm',
    problem: 'Vareta longa ou desigual desbalanceia a cruz.',
    confidence: 92,
    confidenceSource: 'experience',
    confidenceReason: 'Já cortei várias',
    pros: ['rápido', 'reversível se errar pra menor não é, mas pra maior dá pra encurtar'],
    cons: ['precisa cuidado pra não deixar lasca'],
    oQue: 'cortar as duas varetas em 40cm exatos com estilete ou serra de mão',
    porQue:
      'Vareta com tamanho diferente desbalanceia o centro de pressão da pipa em voo.',
    comoConfirmar:
      'Duas varetas medindo 40cm ± 2mm, sem rebarba nas pontas.',
    confirmado: true,
    order: 0,
    state: 'done',
    notes: 'Usei estilete novo. Cortei devagar pra não rachar.',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('state', 'Avançou para executing', ts(3800)),
      hist('confirmed', 'Confirmado pelo usuário', ts(4200)),
    ],
    aiSuggested: true,
    position: POS.cortar,
  };

  // ---------- PASSO 2: amarrar em cruz
  nodes[PASSO_AMARRAR] = {
    id: PASSO_AMARRAR,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Amarrar varetas em cruz com nó de cirurgião',
    fx: 'unir as duas varetas no centro formando o +',
    problem: 'Nó frouxo desmonta a cruz durante o tensionamento.',
    confidence: 85,
    confidenceSource: 'data',
    confidenceReason: 'Tutorial referência indica nó de cirurgião',
    pros: ['mais firme que nó simples', 'trava lateralmente'],
    cons: ['precisa praticar 2-3 vezes pra acertar'],
    oQue: 'cruzar as varetas no centro a 90° e amarrar com nó de cirurgião usando linha encerada',
    porQue:
      'Cruz precisa manter exatamente 90° durante o resto da montagem.',
    comoConfirmar:
      'Cruz montada, varetas a 90° (verificável com esquadro ou folha de papel A4 dobrada).',
    confirmado: false,
    order: 1,
    state: 'executing',
    notes: '',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('state', 'Avançou para executing', ts(4500)),
    ],
    aiSuggested: true,
    position: POS.amarrar,
  };

  // ---------- PASSO 3: tensionar borda (com crítica adversarial)
  nodes[PASSO_TENSIONAR] = {
    id: PASSO_TENSIONAR,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Tensionar borda octogonal',
    fx: 'criar perímetro tensionado em 8 pontos',
    problem: 'Tensão errada deforma a estrutura.',
    confidence: 75,
    confidenceSource: 'ai',
    confidenceReason: 'Mais complexo — depende muito da prática',
    pros: ['define o formato final', 'sem isto não é pipa'],
    cons: ['etapa mais sensível', 'fácil de exagerar a tensão'],
    oQue: 'passar a linha encerada pelos 8 vértices do octógono, tensionando levemente em cada passagem',
    porQue:
      'A tensão da linha mantém o octógono rígido sem deformar as varetas.',
    comoConfirmar:
      'Octógono visível, linha sem afrouxar quando se pressiona no centro do papel.',
    critica: adversarialOnTensionar,
    confirmado: false,
    order: 2,
    state: 'concept',
    notes: '',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('critica', 'Crítica adversarial gerada — sob demanda do usuário', ts(7200)),
    ],
    aiSuggested: true,
    position: POS.tensionar,
  };

  // ---------- PASSO 4: colar papel seda (entra "entre" amarrar e tensionar como middleware)
  nodes[PASSO_PAPEL] = {
    id: PASSO_PAPEL,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Colar papel seda nas varetas',
    fx: 'cobrir a estrutura com a superfície aerodinâmica',
    problem: 'Papel mal colado descola em voo.',
    confidence: 70,
    confidenceSource: 'experience',
    confidenceReason: 'É a etapa onde mais errei em tentativas anteriores',
    pros: ['define a superfície da pipa'],
    cons: ['mais sensível a umidade da cola'],
    oQue: 'aplicar cola em pontos discretos nas pontas e amarrações; pressionar o papel seda sobre as varetas',
    porQue:
      'O papel é a superfície aerodinâmica que pega o vento. Sem boa adesão, voa torto.',
    comoConfirmar:
      'Papel esticado sem ondulações, colado em todos os 4 pontos cardeais da cruz + cada vértice.',
    confirmado: false,
    order: 3,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.papelExe,
  };

  // ---------- PASSO 5: voo teste
  nodes[PASSO_TESTE] = {
    id: PASSO_TESTE,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Voo teste no parque',
    fx: 'validar comportamento aerodinâmico em vento real',
    problem: 'Sem teste, não há prova de que voa.',
    confidence: 60,
    confidenceSource: 'intuition',
    confidenceReason: 'Não dá pra prever totalmente — depende do vento do dia',
    pros: ['valida tudo de uma vez'],
    cons: ['precisa do vento certo, 12-25 km/h'],
    oQue: 'levar a pipa ao parque com vento entre 12 e 25 km/h e tentar subir',
    porQue:
      'É a única forma real de validar o objetivo — voo estável a 30m por 2 minutos.',
    comoConfirmar:
      'Pipa estável a 30m+ de altura por 2 minutos contínuos.',
    confirmado: false,
    order: 4,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.teste,
  };

  // ---------- DECISÃO: 4 ou 8 pontos de tensão
  nodes[DEC_PONTOS] = {
    id: DEC_PONTOS,
    parentId: CAT_DEC,
    kind: 'decisao',
    name: '4 ou 8 pontos de tensão na borda?',
    fx: 'escolher densidade de amarração perimetral',
    problem: 'Tradeoff entre estabilidade e tempo de construção.',
    confidence: 78,
    confidenceSource: 'experience',
    confidenceReason: 'Já testei pipas com 4 pontos — funciona mas oscila mais',
    pros: ['decisão real — não é detalhe técnico'],
    cons: ['define o tempo total de montagem'],
    oQue: 'decidir entre amarrar a linha perimetral em 4 vértices (cantos cardeais) ou em todos os 8 vértices do octógono',
    porQue:
      'Mais pontos = mais estabilidade aerodinâmica, mas dobra o tempo de tensionamento.',
    comoConfirmar:
      'Opção escolhida e registrada.',
    decisionOptions: [
      {
        id: 'opt-4',
        label: '4 pontos (cardeais)',
        pitch: 'Mais rápido — só nos 4 cantos principais do octógono.',
        consequences:
          'Pipa monta em ~10min mas oscila mais em vento forte. Boa pra teste rápido.',
      },
      {
        id: 'opt-8',
        label: '8 pontos (todos os vértices)',
        pitch: 'Mais estável — uma amarração por vértice.',
        consequences:
          'Monta em ~25min. Aerodinâmica mais previsível, suporta vento até 30km/h sem oscilar.',
      },
    ],
    confirmado: false,
    order: 0,
    state: 'validated',
    notes: 'Decisão pendente. Vou esperar o voo teste com 4 pontos antes de decidir.',
    history: [hist('created', 'Decisão criada pela IA', ts(0))],
    aiSuggested: true,
    position: POS.pontos,
  };

  return nodes;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function makeEdges(): Record<string, ConceptEdgeData> {
  const edges: Record<string, ConceptEdgeData> = {};
  const add = (source: string, target: string, kind: ConceptEdgeData['kind'], note?: string) => {
    const id = nanoid(10);
    edges[id] = { id, source, target, kind, note };
  };

  // root → categorias
  add(ROOT, CAT_REC, 'direct');
  add(ROOT, CAT_EXE, 'direct');
  add(ROOT, CAT_DEC, 'direct');

  // categoria → recursos
  add(CAT_REC, REC_VARETA_A, 'direct');
  add(CAT_REC, REC_VARETA_B, 'direct');
  add(CAT_REC, REC_LINHA, 'direct');
  add(CAT_REC, REC_PAPEL, 'direct');
  add(CAT_REC, REC_COLA, 'direct');

  // categoria → passos
  add(CAT_EXE, PASSO_CORTAR, 'direct');
  add(CAT_EXE, PASSO_AMARRAR, 'direct');
  add(CAT_EXE, PASSO_PAPEL, 'direct');
  add(CAT_EXE, PASSO_TENSIONAR, 'direct');
  add(CAT_EXE, PASSO_TESTE, 'direct');

  // categoria → decisões
  add(CAT_DEC, DEC_PONTOS, 'direct');

  // sequência cronológica entre passos (direct)
  add(PASSO_CORTAR, PASSO_AMARRAR, 'direct', 'precisa estar cortada antes de amarrar');
  add(PASSO_AMARRAR, PASSO_PAPEL, 'direct', 'cruz antes do papel');
  add(PASSO_PAPEL, PASSO_TENSIONAR, 'direct', 'papel antes da tensão final');
  add(PASSO_TENSIONAR, PASSO_TESTE, 'direct', 'tensão antes do voo');

  // recursos influenciam passos onde são usados (independent — informa, não bloqueia)
  add(REC_VARETA_A, PASSO_CORTAR, 'independent');
  add(REC_VARETA_B, PASSO_CORTAR, 'independent');
  add(REC_LINHA, PASSO_AMARRAR, 'independent');
  add(REC_PAPEL, PASSO_PAPEL, 'independent');
  add(REC_COLA, PASSO_PAPEL, 'independent');
  add(REC_LINHA, PASSO_TENSIONAR, 'independent');

  // decisão dos 8 pontos influencia o passo de tensionar (middleware)
  add(DEC_PONTOS, PASSO_TENSIONAR, 'middleware', 'a escolha do número de pontos define como tensionar');

  return edges;
}

// ---------------------------------------------------------------------------
// Exported builder
// ---------------------------------------------------------------------------

export function buildDemoProject(): Project {
  return {
    id: 'demo-cellproject',
    name: 'Demo · Pipa octogonal',
    objective: 'construir uma pipa octogonal de bambu que voe estável em vento médio',
    createdAt: DEMO_T0,
    updatedAt: ts(7200),
    nodes: makeNodes(),
    edges: makeEdges(),
    rootId: ROOT,
  };
}

export const DEMO_PROJECT_ID = 'demo-cellproject';

export function isDemoProject(projectId: string | undefined | null): boolean {
  return projectId === DEMO_PROJECT_ID;
}
