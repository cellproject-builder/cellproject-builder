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
// Demo project — Carrinho de controle remoto 2WD com ESP32 + NRF24L01.
//
// Projeto multidisciplinar (mecânica + eletrônica + firmware) que exercita
// todos os recursos do produto:
//
// - 26 nós: 1 root + 3 categorias + 10 recursos + 8 passos + 4 decisões
// - ~46 arestas: direct entre passos, independent de recursos → passos,
//   middleware de decisões → passos influenciados
// - Estados variados: done, executing, problem, concept, validated
// - 4 decisões reais com tradeoffs concretos (decisionOptions preenchidos)
// - Todos os 4 mecanismos de ground truth em ação:
//   (a) `comoConfirmarUsuario` travado em 2 nós
//   (b) `critica` adversarial gerada em 1 nó
//   (c) `failureContext` reportado em 1 nó
//   (d) `groundTruthRefs` com `verificado: true` em vários nós
//
// As posições são curadas (layout fixo), não auto. O resultado é uma árvore
// densa, legível, que mostra na primeira olhada que o produto consegue
// representar projetos complexos do mundo real.
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

const ROOT = 'demo-root-rc';
const CAT_REC = 'demo-cat-recursos';
const CAT_EXE = 'demo-cat-execucao';
const CAT_DEC = 'demo-cat-decisoes';

// Recursos (10)
const REC_CHASSI = 'demo-rec-chassi';
const REC_MOTORES = 'demo-rec-motores';
const REC_DRIVER = 'demo-rec-driver';
const REC_MCU = 'demo-rec-mcu';
const REC_RF = 'demo-rec-rf';
const REC_BATERIA = 'demo-rec-bateria';
const REC_RODAS = 'demo-rec-rodas';
const REC_FIOS = 'demo-rec-fios';
const REC_CONTROLE = 'demo-rec-controle';
const REC_FERRAMENTAS = 'demo-rec-ferramentas';

// Passos (8)
const PASSO_DESIGN = 'demo-passo-design';
const PASSO_FAB = 'demo-passo-fab';
const PASSO_DRIVETRAIN = 'demo-passo-drivetrain';
const PASSO_ELE = 'demo-passo-eletronica';
const PASSO_FIRMWARE = 'demo-passo-firmware';
const PASSO_PAREAR = 'demo-passo-parear';
const PASSO_BANCO = 'demo-passo-banco';
const PASSO_CAMPO = 'demo-passo-campo';

// Decisões (4)
const DEC_CHASSI = 'demo-dec-chassi';
const DEC_TRACAO = 'demo-dec-tracao';
const DEC_DIRECAO = 'demo-dec-direcao';
const DEC_MCU = 'demo-dec-mcu';

// ---------------------------------------------------------------------------
// Layout curado.
// Eixo x: -950 ← Recursos · 0 = Execução · +700 → Decisões
// Eixo y: 0 = root · 240 = categorias · 500+ = folhas
// ---------------------------------------------------------------------------

const POS = {
  root: { x: 0, y: 0 },
  catRec: { x: -700, y: 240 },
  catExe: { x: 0, y: 240 },
  catDec: { x: 700, y: 240 },

  // Recursos — 3 colunas × ~4 linhas
  chassi: { x: -950, y: 500 },
  motores: { x: -700, y: 500 },
  driver: { x: -450, y: 500 },
  mcu: { x: -950, y: 700 },
  rf: { x: -700, y: 700 },
  bateria: { x: -450, y: 700 },
  rodas: { x: -950, y: 900 },
  fios: { x: -700, y: 900 },
  controle: { x: -450, y: 900 },
  ferramentas: { x: -700, y: 1100 },

  // Execução — cascata vertical
  design: { x: 0, y: 500 },
  fab: { x: 0, y: 660 },
  drivetrain: { x: 0, y: 820 },
  ele: { x: 0, y: 980 },
  firmware: { x: 0, y: 1140 },
  parear: { x: 0, y: 1300 },
  banco: { x: 0, y: 1460 },
  campo: { x: 0, y: 1620 },

  // Decisões — coluna direita
  decChassi: { x: 700, y: 500 },
  decTracao: { x: 700, y: 700 },
  decDirecao: { x: 700, y: 900 },
  decMCU: { x: 700, y: 1100 },
};

// ---------------------------------------------------------------------------
// Crítica adversarial sobre o L298N (driver de motor barato e problemático).
// ---------------------------------------------------------------------------

const adversarialOnDriver: AdversarialCritique = {
  fraquezas: [
    'L298N tem dropout de ~2.5V — com bateria 7.4V (LiPo 2S), o motor recebe só ~4.9V, perdendo ~30% do RPM nominal.',
    'Sem dissipador, esquenta acima de 70°C em corrente contínua de 1.5A — entra em proteção térmica e desliga.',
    'Frequência PWM padrão (~1kHz) é audível e gera ruído eletromagnético que pode interferir no NRF24L01.',
  ],
  premissasOcultas: [
    'Assume que o motor não vai pedir corrente de partida — mas motores DC podem puxar 3-4× a corrente nominal por 100ms ao sair do zero.',
    'Assume tensão de bateria constante — descarga reduz 11.1V→9V no fim, mudando o ponto de operação.',
  ],
  criterioAlternativo:
    'Driver deve manter o motor em ≥90% do RPM nominal durante 5 minutos contínuos a 1.5A, sem entrar em proteção térmica, com a temperatura do CI estabilizando abaixo de 60°C medida por termopar.',
  generatedAt: ts(9000),
};

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function makeNodes(): Record<string, ConceptNodeData> {
  const nodes: Record<string, ConceptNodeData> = {};

  // ============================================================ ROOT
  nodes[ROOT] = {
    id: ROOT,
    parentId: null,
    kind: 'root',
    name: 'Carrinho RC 2WD',
    fx: 'construir um carrinho de controle remoto 2WD com chassi próprio, eletrônica embarcada e controle via rádio 2.4GHz que ande estável em terreno liso a ≥15 km/h por 30 min',
    problem: 'Objetivo global do projeto',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Dado pelo usuário',
    pros: [],
    cons: [],
    oQue:
      'um carrinho RC 2WD funcional, com chassi próprio, motores DC com driver, microcontrolador ESP32, rádio NRF24L01 e bateria recarregável',
    porQue:
      'Projeto-piloto multidisciplinar: cobre mecânica (chassi + drivetrain), eletrônica (driver + power), firmware (controle + RF) e teste de campo.',
    comoConfirmar:
      'Carrinho rodando 30min contínuos em chão liso, mantendo ≥15 km/h, respondendo aos comandos do joystick com latência <100ms.',
    confirmado: false,
    order: 0,
    state: 'executing',
    notes:
      'Decisões já fechadas: 2WD (skid steer), ESP32, chassi impresso 3D, LiPo 2S. Decisões abertas: nenhuma — todas confirmadas via decisionPickedId.',
    history: [
      hist('created', 'Projeto criado a partir do plano "RC 2WD — clássico maker"', ts(0)),
      hist('state', 'Avançou para executing', ts(3600)),
      hist('note', 'Adicionada nota sobre escopo da v1 (sem suspensão, sem luzes)', ts(7200)),
    ],
    aiSuggested: false,
    position: POS.root,
  };

  // ============================================================ CATEGORIAS
  nodes[CAT_REC] = {
    id: CAT_REC,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Recursos',
    fx: 'categoria: recursos',
    problem: 'Tudo que precisa estar comprado, impresso ou em mãos antes do passo 1.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: 'componentes mecânicos, eletrônicos e ferramental disponíveis na bancada',
    porQue: 'Sem recurso, qualquer execução trava no meio.',
    comoConfirmar: 'Todos os 10 itens desta categoria confirmados.',
    confirmado: false,
    order: 0,
    state: 'validated',
    notes: '',
    history: [hist('created', 'Categoria Recursos criada', ts(0))],
    aiSuggested: false,
    position: POS.catRec,
  };

  nodes[CAT_EXE] = {
    id: CAT_EXE,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Execução',
    fx: 'categoria: execução',
    problem: 'Sequência cronológica do design ao teste em campo.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: '8 passos do CAD ao primeiro teste em campo',
    porQue:
      'Sem ordem, vários passos travam — não dá pra soldar a eletrônica antes de imprimir o chassi.',
    comoConfirmar: 'Todos os 8 passos executados em ordem com confirmação.',
    confirmado: false,
    order: 1,
    state: 'executing',
    notes: '',
    history: [hist('created', 'Categoria Execução criada', ts(0))],
    aiSuggested: false,
    position: POS.catExe,
  };

  nodes[CAT_DEC] = {
    id: CAT_DEC,
    parentId: ROOT,
    kind: 'categoria',
    name: 'Decisões',
    fx: 'categoria: decisões',
    problem: '4 escolhas com tradeoff real entre caminhos.',
    confidence: 100,
    confidenceSource: 'ai',
    confidenceReason: 'Eixo estrutural',
    pros: [],
    cons: [],
    oQue: 'pontos onde existe mais de um caminho técnico válido',
    porQue: 'Cada decisão fecha portas e altera os passos seguintes — vale explicitar.',
    comoConfirmar: 'Todas as decisões pendentes resolvidas com `decisionPickedId`.',
    confirmado: false,
    order: 2,
    state: 'validated',
    notes: '',
    history: [hist('created', 'Categoria Decisões criada', ts(0))],
    aiSuggested: false,
    position: POS.catDec,
  };

  // ============================================================ RECURSOS

  // ---------- Chassi (done, com ground truth verificado)
  nodes[REC_CHASSI] = {
    id: REC_CHASSI,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Chassi impresso em PETG',
    fx: 'estrutura mecânica que sustenta motores, bateria e eletrônica',
    problem: 'Sem chassi rígido, vibração desalinha o drivetrain.',
    confidence: 92,
    confidenceSource: 'experience',
    confidenceReason: 'Imprimi 2 protótipos antes deste — terceiro saiu bom.',
    pros: ['leve (~180g)', 'rígido o suficiente', 'fácil de iterar — só reimprimir'],
    cons: ['PETG amolece >70°C', 'parafusos M3 não seguram em furos sem inserto'],
    oQue:
      'chassi monolítico em PETG, 200×120×35mm, com furação M3 para motores TT, suporte central para ESP32 e cavidade para bateria 2S',
    porQue:
      'PETG combina rigidez com tenacidade — não estilhaça em impacto leve como o PLA. Geometria curada para deixar centro de massa baixo.',
    comoConfirmar:
      'Peça impressa sem warping, parafusos M3 dos motores rosqueando firme nos insertos a quente.',
    comoConfirmarUsuario:
      'Coloquei o chassi numa balança: 178g. Apertei parafuso M3 com chave Allen — não desfia o inserto. Verifico planicidade pondo em mesa de vidro: rocking de no máximo 0.5mm.',
    comoConfirmarUsuarioAt: ts(2000),
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Material e dimensão',
        value: 'PETG 100% infill linear, 200×120×35mm, parede 1.6mm',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2500),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'Massa real medida',
        value: '178g (esperado 175g ± 15g)',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2800),
        addedByAI: false,
      }),
      gtRef({
        kind: 'link',
        label: 'STL no repo',
        value: 'https://github.com/exemplo/rc-2wd/blob/main/cad/chassi-v3.stl',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(2900),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 0,
    state: 'done',
    notes: 'Versão 3 do CAD. As v1 e v2 tinham flexão central — adicionei nervura longitudinal.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('criterio_usuario', 'Critério do usuário travado — antes de ver o da IA', ts(2000)),
      hist('ground_truth', 'Spec verificada', ts(2500)),
      hist('ground_truth', 'Massa medida no mundo', ts(2800)),
      hist('ground_truth', 'STL conferido no GitHub', ts(2900)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3100)),
    ],
    aiSuggested: true,
    position: POS.chassi,
  };

  // ---------- Motores (done)
  nodes[REC_MOTORES] = {
    id: REC_MOTORES,
    parentId: CAT_REC,
    kind: 'recurso',
    name: '2× motor DC TT 5840 (200 RPM @ 6V)',
    fx: 'tração nas rodas traseiras (2WD skid steer)',
    problem: 'Motor de baixo torque trava em rampa.',
    confidence: 80,
    confidenceSource: 'data',
    confidenceReason: 'Datasheet confirma 200 RPM e ~0.78 kg·cm de torque máximo',
    pros: ['baratos (~R$15/par)', 'plug-and-play com chassi padrão maker', 'fáceis de achar'],
    cons: ['torque modesto', 'engrenagem plástica desgasta em uso pesado'],
    oQue:
      'par de motores DC com redução 1:48, eixo de saída duplo (D-shaped), tensão nominal 3-6V',
    porQue:
      'Combo clássico para projetos RC nível 1. Atendem o requisito de 15 km/h em chão liso com a roda de 65mm escolhida.',
    comoConfirmar:
      '2 motores idênticos, ambos girando ao aplicar 6V direto. Sem ruído mecânico anômalo.',
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Datasheet do motor',
        value: 'TT5840: 200 RPM @ 6V, 0.78 kg·cm torque, corrente livre 150mA, stall 0.65A',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(3200),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'RPM medido com tacômetro (sem carga, 6V)',
        value: '195 ± 3 RPM',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(3400),
        addedByAI: false,
      }),
    ],
    confirmado: true,
    order: 1,
    state: 'done',
    notes: 'Testei os dois com fonte 6V e tacômetro óptico. RPM próximo do nominal.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('ground_truth', 'Datasheet verificado', ts(3200)),
      hist('ground_truth', 'RPM medido com tacômetro', ts(3400)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3500)),
    ],
    aiSuggested: true,
    position: POS.motores,
  };

  // ---------- Driver de motor (problem — falha real reportada, com crítica adversarial)
  nodes[REC_DRIVER] = {
    id: REC_DRIVER,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Driver de motor L298N',
    fx: 'amplifica saída PWM do MCU para corrente que move os motores',
    problem: 'L298N tem dropout alto e esquenta — pode não entregar a corrente esperada.',
    confidence: 55,
    confidenceSource: 'experience',
    confidenceReason: 'Já tive problema com L298N em projeto anterior — superaqueceu',
    pros: ['baratíssimo', 'amplamente documentado', 'suporta até 2A por canal'],
    cons: [
      'dropout de ~2.5V derruba a tensão útil no motor',
      'esquenta sem dissipador',
      'PWM audível em 1kHz padrão',
    ],
    oQue: 'placa breakout L298N com terminal screw, jumper de 5V regulator interno',
    porQue:
      'Solução padrão do "starter kit" maker. Entrega corrente suficiente em teoria; em prática, o dropout pode ser problema.',
    comoConfirmar:
      'Driver alimentando os 2 motores simultaneamente a 1.5A por 5min sem entrar em proteção térmica.',
    critica: adversarialOnDriver,
    failureContext:
      'Bancada teste de 5min com motor à 80% PWM: temperatura do L298N subiu pra 78°C medido com termopar, entrou em proteção térmica aos 4min12s. Motor parou. Sem dissipador o componente não aguenta. Próxima tentativa: trocar pelo TB6612FNG ou adicionar dissipador + ventoinha.',
    failureReportedAt: ts(8500),
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Datasheet ST L298N',
        value: 'Vmax 46V, Iout 2A/canal, dropout ~2.5V @ 1A',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(4000),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'Temperatura do chip no teste',
        value: '78°C @ 1.5A contínuos, sem dissipador',
        verificado: true,
        addedAt: ts(8500),
        verifiedAt: ts(8500),
        addedByAI: false,
      }),
    ],
    confirmado: false,
    order: 2,
    state: 'problem',
    notes: 'Provavelmente vou trocar pelo TB6612FNG. Aguardando crítica adversarial pra decidir.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('ground_truth', 'Datasheet anexado', ts(4000)),
      hist('failure', 'Reportado superaquecimento no teste de bancada', ts(8500)),
      hist('critica', 'Crítica adversarial solicitada', ts(9000)),
    ],
    aiSuggested: true,
    position: POS.driver,
  };

  // ---------- MCU (done, com critério do usuário travado)
  nodes[REC_MCU] = {
    id: REC_MCU,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'ESP32-WROOM-32 DevKit',
    fx: 'cérebro do carrinho — gera PWM, lê rádio, executa lógica de controle',
    problem: 'MCU lento ou com pouca memória limita firmware.',
    confidence: 95,
    confidenceSource: 'data',
    confidenceReason: 'ESP32 é overkill pro caso de uso — sobra processador',
    pros: ['240MHz dual-core', '520KB SRAM', 'WiFi/BT embutidos (não usados na v1)', 'PWM hardware'],
    cons: ['mais caro que Arduino Nano', 'consumo de corrente maior (~80mA idle)'],
    oQue: 'placa ESP32-WROOM-32 DevKit (38 pinos)',
    porQue:
      'Suporta múltiplos canais PWM em hardware, SPI rápida pra NRF24L01, e deixa headroom pra adicionar BT/WiFi numa v2.',
    comoConfirmar:
      'Placa entra no bootloader ao receber sketch, GPIO controla LED, leitura SPI do NRF24 retorna ID de canal correto.',
    comoConfirmarUsuario:
      'Plugo no PC, abro o Arduino IDE com pacote esp32. Faço upload do "Blink": LED da placa pisca em 1Hz. Lê SPI status register do NRF24 e retorna 0x0E (default).',
    comoConfirmarUsuarioAt: ts(4500),
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Especificações do chip',
        value: 'ESP32-WROOM-32: 240MHz Xtensa LX6 dual-core, 520KB SRAM, 4MB flash',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(4800),
        addedByAI: true,
      }),
      gtRef({
        kind: 'link',
        label: 'Pinout oficial Espressif',
        value: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32/hw-reference/esp32/get-started-devkitc.html',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(4900),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 3,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('criterio_usuario', 'Critério do usuário travado', ts(4500)),
      hist('ground_truth', 'Specs verificadas no datasheet', ts(4800)),
      hist('ground_truth', 'Pinout oficial conferido', ts(4900)),
      hist('confirmed', 'Confirmado pelo usuário', ts(5000)),
    ],
    aiSuggested: true,
    position: POS.mcu,
  };

  // ---------- RF NRF24L01
  nodes[REC_RF] = {
    id: REC_RF,
    parentId: CAT_REC,
    kind: 'recurso',
    name: '2× módulo NRF24L01+ (TX + RX)',
    fx: 'comunicação sem fio 2.4GHz entre controle e carrinho',
    problem: 'NRF24 sem capacitor de filtro fica instável.',
    confidence: 78,
    confidenceSource: 'experience',
    confidenceReason: 'Já usei em projetos anteriores — precisa de bom decoupling',
    pros: ['baratíssimo (~R$8/par)', 'alcance até 100m em campo aberto', 'SPI rápido'],
    cons: ['sensível a ruído de alimentação', 'precisa de capacitor 10µF entre VCC/GND'],
    oQue: 'par NRF24L01+ com antena PCB integrada (versão básica, não a PA+LNA)',
    porQue:
      'Custo-benefício imbatível para projetos hobby. Versão básica é suficiente pro alcance esperado (até 30m em interno).',
    comoConfirmar:
      'TX envia "hello" a cada 100ms, RX recebe sem perdas em 30s contínuos a 5m de distância.',
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Datasheet Nordic Semi',
        value: 'NRF24L01+ — 2.4GHz, 250kbps a 2Mbps, GFSK, 126 canais',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(5300),
        addedByAI: true,
      }),
      gtRef({
        kind: 'spec',
        label: 'Filtro de alimentação recomendado',
        value: 'Capacitor cerâmico 10µF + 100nF entre VCC e GND, próximo ao módulo',
        verificado: false,
        addedAt: ts(600),
        addedByAI: true,
      }),
    ],
    confirmado: true,
    order: 4,
    state: 'done',
    notes: 'Comprei o par no AliExpress. Soldei capacitor 10µF no módulo TX (módulo RX ainda sem).',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('ground_truth', 'Datasheet conferido', ts(5300)),
      hist('confirmed', 'Confirmado pelo usuário', ts(5400)),
    ],
    aiSuggested: true,
    position: POS.rf,
  };

  // ---------- Bateria LiPo 2S
  nodes[REC_BATERIA] = {
    id: REC_BATERIA,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Bateria LiPo 2S 1500mAh 25C',
    fx: 'fornece energia para motores e eletrônica',
    problem: 'LiPo mal carregada degrada rápido; descarga abaixo de 3V/cel mata a célula.',
    confidence: 70,
    confidenceSource: 'experience',
    confidenceReason: 'LiPo exige cuidado — já estraguei uma por descarga excessiva',
    pros: ['densidade de energia alta (~150 Wh/kg)', 'taxa de descarga compatível com motores DC'],
    cons: ['precisa carregador balanceador', 'inflama se for perfurada', 'cuidado com armazenamento'],
    oQue: 'bateria LiPo 2 células em série (7.4V nominal, 8.4V cheia), 1500mAh, 25C',
    porQue:
      '7.4V atende bem motor 3-6V via driver (drop). 1500mAh dá ~30min com consumo médio de ~3A.',
    comoConfirmar:
      'Bateria nova, cheia (8.4V medido com multímetro), sem inchaço visível.',
    groundTruthRefs: [
      gtRef({
        kind: 'spec',
        label: 'Capacidade e taxa',
        value: '2S 7.4V nominal, 1500mAh, 25C contínuo (~37.5A máx burst)',
        verificado: true,
        addedAt: ts(600),
        verifiedAt: ts(5700),
        addedByAI: true,
      }),
      gtRef({
        kind: 'medida',
        label: 'Tensão na chegada do pacote',
        value: '8.32V (em storage charge — esperado 7.6V, vendedor entregou cheia)',
        verificado: true,
        addedAt: ts(5800),
        verifiedAt: ts(5800),
        addedByAI: false,
      }),
    ],
    confirmado: true,
    order: 5,
    state: 'done',
    notes: 'Chegou já carregada. Vai precisar descarregar a 3.85V/cel pra armazenamento se demorar pra usar.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('ground_truth', 'Spec conferida', ts(5700)),
      hist('ground_truth', 'Tensão real medida', ts(5800)),
      hist('confirmed', 'Confirmado pelo usuário', ts(5900)),
    ],
    aiSuggested: true,
    position: POS.bateria,
  };

  // ---------- Rodas (done)
  nodes[REC_RODAS] = {
    id: REC_RODAS,
    parentId: CAT_REC,
    kind: 'recurso',
    name: '4× roda 65mm com pneu de borracha',
    fx: 'interface entre drivetrain e solo',
    problem: 'Roda muito pequena perde tração; muito grande exige torque que o motor não dá.',
    confidence: 85,
    confidenceSource: 'data',
    confidenceReason: 'Cálculo: 200 RPM × π × 65mm = 40.8m/min = ~2.5 km/h sem redução adicional',
    pros: ['encaixe direto no eixo D-shaped', 'borracha agarra em chão liso'],
    cons: ['65mm é o limite superior pro torque do TT5840 — limítrofe'],
    oQue: '4 rodas em plástico com banda de borracha, furo central D-shaped para eixo do TT5840',
    porQue:
      'Diâmetro 65mm casa com o torque disponível e dá velocidade de pico de ~2.5 km/h em rotação livre. Com redução adicional via diferença de PWM, alcança o pico de 15 km/h alvo.',
    comoConfirmar:
      '4 rodas idênticas, sem desalinhamento visual, encaixando firme no eixo.',
    confirmado: true,
    order: 6,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(6000)),
    ],
    aiSuggested: true,
    position: POS.rodas,
  };

  // ---------- Fios + solda (done)
  nodes[REC_FIOS] = {
    id: REC_FIOS,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Fios silicone 22AWG + solda 0.6mm + termo-retrátil',
    fx: 'conexões elétricas entre componentes',
    problem: 'Fio fino demais aquece; solda mal feita gera mau contato.',
    confidence: 88,
    confidenceSource: 'experience',
    confidenceReason: 'Material padrão de bancada — sem mistério',
    pros: ['22AWG aguenta 3A com folga', 'silicone resiste ao calor da solda'],
    cons: ['nenhum relevante'],
    oQue: 'rolinho 2m de fio silicone 22AWG (vermelho/preto), 50g solda 60/40 0.6mm, 1m termo-retrátil 3mm',
    porQue:
      '22AWG é o calibre certo pra correntes 1-3A típicas do projeto. Silicone aguenta solda sem derreter a isolação.',
    comoConfirmar: 'Materiais em mãos, na bancada.',
    confirmado: true,
    order: 7,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(6100)),
    ],
    aiSuggested: true,
    position: POS.fios,
  };

  // ---------- Controle remoto (joystick) — done
  nodes[REC_CONTROLE] = {
    id: REC_CONTROLE,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Joystick analógico + 2º ESP32 (TX)',
    fx: 'interface humana que envia comandos ao carrinho',
    problem: 'Joystick com deadzone grande deixa controle impreciso.',
    confidence: 75,
    confidenceSource: 'intuition',
    confidenceReason: 'Joysticks Aliexpress têm qualidade variável — esperar deadzone',
    pros: ['controle por dois eixos analógicos', 'fácil de montar em case 3D'],
    cons: ['deadzone central pode chegar a ±5% sem calibração'],
    oQue:
      'módulo joystick KY-023 (2 eixos + botão pushdown) + segundo ESP32 fazendo TX, alimentado por bateria 1S 18650',
    porQue:
      'Mesmo MCU em ambas as pontas simplifica o stack — código de TX e RX compartilha biblioteca RF24.',
    comoConfirmar:
      'Joystick centrado retorna analogRead próximo a 2048 (12-bit ADC do ESP32) com tolerância ±100. Botão pushdown gera GPIO LOW.',
    confirmado: true,
    order: 8,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(6200)),
    ],
    aiSuggested: true,
    position: POS.controle,
  };

  // ---------- Ferramentas (done)
  nodes[REC_FERRAMENTAS] = {
    id: REC_FERRAMENTAS,
    parentId: CAT_REC,
    kind: 'recurso',
    name: 'Ferramentas de bancada',
    fx: 'permite montagem, solda, medição e debug',
    problem: 'Sem multímetro, impossível debugar curto-circuito.',
    confidence: 100,
    confidenceSource: 'experience',
    confidenceReason: 'Bancada já equipada',
    pros: [],
    cons: [],
    oQue:
      'ferro de solda 60W com ponta cônica, multímetro digital, chave Phillips PH00, chave Allen 2mm, alicate de corte, pinça',
    porQue:
      'Conjunto mínimo pra montar eletrônica e mecânica do nível desse projeto.',
    comoConfirmar: 'Todas as ferramentas presentes na bancada e funcionais.',
    confirmado: true,
    order: 9,
    state: 'done',
    notes: 'Tudo já está na bancada — verificação trivial.',
    history: [
      hist('created', 'Recurso criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(6300)),
    ],
    aiSuggested: true,
    position: POS.ferramentas,
  };

  // ============================================================ PASSOS

  // ---------- Design do chassi (done)
  nodes[PASSO_DESIGN] = {
    id: PASSO_DESIGN,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Projetar chassi em CAD',
    fx: 'definir geometria, furação e tolerâncias antes de imprimir',
    problem: 'CAD com folga errada gera peça inutilizável.',
    confidence: 90,
    confidenceSource: 'experience',
    confidenceReason: 'Já fiz vários CAD pra impressão 3D',
    pros: [],
    cons: [],
    oQue: 'modelar chassi em Fusion 360 ou FreeCAD com cavidades, furação M3 e suporte de bateria',
    porQue:
      'Imprimir sem CAD revisado garante 2-3 reimpressões. Fusão antes economiza filamento.',
    comoConfirmar:
      'STL exportado, verificado em slicer (sem manifold errors), com tolerância de furo M3 = 3.2mm.',
    confirmado: true,
    order: 0,
    state: 'done',
    notes: 'Versão 3 do CAD aprovada. v1 e v2 tinham flexão central.',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3000)),
    ],
    aiSuggested: true,
    position: POS.design,
  };

  // ---------- Fabricação (done)
  nodes[PASSO_FAB] = {
    id: PASSO_FAB,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Imprimir chassi em PETG',
    fx: 'transformar STL em peça física',
    problem: 'PETG warpa se a temperatura de mesa estiver baixa.',
    confidence: 82,
    confidenceSource: 'experience',
    confidenceReason: 'Já imprimi várias peças em PETG — receita conhecida',
    pros: [],
    cons: [],
    oQue:
      'imprimir o STL com PETG, 100% infill linear no piso (parafusos), 30% no resto, 240°C bico / 80°C mesa',
    porQue:
      'PETG segura melhor que PLA pra peças com carga mecânica como suporte de motor.',
    comoConfirmar:
      'Peça impressa sem warping visível, parafusos M3 entrando firme nos furos com inserto a quente.',
    confirmado: true,
    order: 1,
    state: 'done',
    notes: 'Tempo de impressão: ~6h. Usei filamento eSun PETG roxo.',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3300)),
    ],
    aiSuggested: true,
    position: POS.fab,
  };

  // ---------- Drivetrain (done)
  nodes[PASSO_DRIVETRAIN] = {
    id: PASSO_DRIVETRAIN,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Montar drivetrain (motores + rodas)',
    fx: 'fixar motores no chassi e rodas nos eixos',
    problem: 'Roda mal encaixada bate na lateral do chassi.',
    confidence: 88,
    confidenceSource: 'experience',
    confidenceReason: 'Etapa mecânica simples — só apertar parafuso',
    pros: [],
    cons: [],
    oQue:
      'fixar os 2 motores TT5840 no chassi com parafusos M3×8, encaixar as 4 rodas (2 nos motores, 2 livres no eixo dianteiro)',
    porQue: 'Drivetrain estável é pré-requisito pra qualquer teste em movimento.',
    comoConfirmar:
      'Rodas girando livres sem atrito lateral, motor fixo sem folga ao tentar mover com a mão.',
    confirmado: true,
    order: 2,
    state: 'done',
    notes: '',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('confirmed', 'Confirmado pelo usuário', ts(3700)),
    ],
    aiSuggested: true,
    position: POS.drivetrain,
  };

  // ---------- Eletrônica (executing)
  nodes[PASSO_ELE] = {
    id: PASSO_ELE,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Soldar eletrônica (driver + MCU + RF)',
    fx: 'conectar todos os componentes em fios curtos com solda firme',
    problem: 'Solda fria gera mau contato intermitente — bug fantasma.',
    confidence: 65,
    confidenceSource: 'experience',
    confidenceReason: 'Já tive solda fria que demorou pra debugar',
    pros: [],
    cons: [],
    oQue:
      'soldar fios silicone 22AWG entre: bateria → driver (entrada), driver → motores (2 pares), ESP32 → driver (4 fios de controle PWM/DIR), ESP32 → NRF24L01 (SPI: 5 fios)',
    porQue:
      'Conexão soldada (vs jumper) elimina vibração que solta jumper em campo. Solda firme é a diferença entre funcionar e não.',
    comoConfirmar:
      'Continuidade verificada com multímetro em todas as conexões, sem curto entre VCC/GND, soldas brilhantes (não foscas).',
    confirmado: false,
    order: 3,
    state: 'executing',
    notes: 'Em andamento. Já soldei bateria → driver, falta driver → motores e SPI do RF.',
    history: [
      hist('created', 'Passo criado pela IA', ts(0)),
      hist('state', 'Avançou para executing', ts(7000)),
    ],
    aiSuggested: true,
    position: POS.ele,
  };

  // ---------- Firmware (concept)
  nodes[PASSO_FIRMWARE] = {
    id: PASSO_FIRMWARE,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Escrever firmware (RX no carrinho + TX no controle)',
    fx: 'lógica que lê rádio, mapeia comandos para PWM dos motores',
    problem: 'Mapping joystick→PWM sem deadzone faz motor zumbir parado.',
    confidence: 70,
    confidenceSource: 'ai',
    confidenceReason: 'Padrão claro mas precisa testar deadzone na prática',
    pros: [],
    cons: [],
    oQue:
      'firmware Arduino-ESP32 no RX (recebe pacote {x, y, btn}, calcula PWM L/R via mistura skid-steer), e TX (lê joystick + botão a cada 50ms)',
    porQue:
      'Sem firmware não há controle. Skid-steer mixing: PWM_esq = throttle + steering, PWM_dir = throttle − steering.',
    comoConfirmar:
      'TX envia 20 pacotes/s, RX aplica PWM aos motores sem latência perceptível (<100ms).',
    confirmado: false,
    order: 4,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.firmware,
  };

  // ---------- Pareamento RF (concept)
  nodes[PASSO_PAREAR] = {
    id: PASSO_PAREAR,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Parear TX e RX em canal RF dedicado',
    fx: 'estabelecer canal exclusivo + endereço pra evitar interferência',
    problem: 'Canal padrão da biblioteca pode colidir com outros dispositivos 2.4GHz na sala.',
    confidence: 75,
    confidenceSource: 'data',
    confidenceReason: 'Biblioteca RF24 documenta bem o procedimento',
    pros: [],
    cons: [],
    oQue:
      'configurar mesmo canal RF (range 76-125 — alto pra evitar WiFi) e mesmo endereço de pipe ("RCRC1") em TX e RX',
    porQue:
      'Canais 0-75 frequentemente colidem com WiFi 2.4GHz (canais 1, 6, 11 do 802.11). 76+ fica acima do WiFi.',
    comoConfirmar:
      'TX e RX trocando pacotes com 0% perda em 1000 pacotes contínuos.',
    confirmado: false,
    order: 5,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.parear,
  };

  // ---------- Teste de bancada (concept)
  nodes[PASSO_BANCO] = {
    id: PASSO_BANCO,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Teste de bancada com carrinho suspenso',
    fx: 'validar drivetrain + eletrônica sem risco de fugir',
    problem: 'Testar em chão direto pode quebrar o carrinho ou bater nos pés.',
    confidence: 80,
    confidenceSource: 'experience',
    confidenceReason: 'Bancada é onde quase tudo se descobre antes',
    pros: [],
    cons: [],
    oQue:
      'suspender carrinho em apoio (rodas no ar), conectar bateria, mover joystick e verificar resposta de cada motor + sentido',
    porQue:
      'Em bancada dá pra debugar sentido invertido, deadzone, temperatura do driver, sem destruir o protótipo.',
    comoConfirmar:
      'Ambos motores girando no sentido correto pra cada direção do joystick. Driver não esquenta acima de 60°C em 5min.',
    confirmado: false,
    order: 6,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.banco,
  };

  // ---------- Teste em campo (concept)
  nodes[PASSO_CAMPO] = {
    id: PASSO_CAMPO,
    parentId: CAT_EXE,
    kind: 'passo',
    name: 'Teste em campo (chão liso)',
    fx: 'validar comportamento dinâmico em terreno real',
    problem: 'Bancada não simula peso da carcaça + atrito real.',
    confidence: 55,
    confidenceSource: 'intuition',
    confidenceReason: 'Depende muito de variáveis físicas — só rodando pra saber',
    pros: [],
    cons: [],
    oQue:
      'em garagem ou pátio liso, conectar bateria, dirigir o carrinho por 30min, anotar velocidade pico, autonomia real, latência',
    porQue:
      'É o único momento em que o objetivo final é validável: 15 km/h sustentado por 30min.',
    comoConfirmar:
      'Carrinho atinge 15 km/h em reta, mantém por 30 min antes de a bateria atingir 6.6V (corte de descarga).',
    confirmado: false,
    order: 7,
    state: 'concept',
    notes: '',
    history: [hist('created', 'Passo criado pela IA', ts(0))],
    aiSuggested: true,
    position: POS.campo,
  };

  // ============================================================ DECISÕES

  // ---------- Decisão de chassi (já decidida)
  nodes[DEC_CHASSI] = {
    id: DEC_CHASSI,
    parentId: CAT_DEC,
    kind: 'decisao',
    name: 'Chassi: impressão 3D ou MDF cortado?',
    fx: 'escolher processo de fabricação do chassi',
    problem: 'Cada caminho exige ferramental diferente.',
    confidence: 85,
    confidenceSource: 'experience',
    confidenceReason: 'Tenho impressora 3D na bancada — escolha quase óbvia',
    pros: [],
    cons: [],
    oQue:
      'escolher entre imprimir o chassi em PETG ou cortar/colar em MDF 3mm',
    porQue:
      'Impressão dá geometria orgânica e iteração rápida; MDF é mais barato e não exige impressora.',
    comoConfirmar: 'Opção escolhida e registrada.',
    decisionOptions: [
      {
        id: 'opt-3d',
        label: 'Impressão 3D em PETG',
        pitch: 'Geometria livre, fácil de iterar, leve.',
        consequences:
          'Precisa de impressora 3D + filamento. Tempo de impressão ~6h. Custo ~R$25 em filamento.',
      },
      {
        id: 'opt-mdf',
        label: 'MDF 3mm cortado a laser',
        pitch: 'Sem necessidade de impressora, peças planas coladas.',
        consequences:
          'Geometria limitada a planos. Custo de corte a laser ~R$40. Tempo de montagem ~2h. Sensível à umidade.',
      },
    ],
    decisionPickedId: 'opt-3d',
    confirmado: true,
    order: 0,
    state: 'done',
    notes: 'Decidido por ter impressora na bancada. MDF seria backup.',
    history: [
      hist('created', 'Decisão criada pela IA', ts(0)),
      hist('decision', 'Escolhida opção: Impressão 3D em PETG', ts(2200)),
      hist('confirmed', 'Decisão confirmada', ts(2300)),
    ],
    aiSuggested: true,
    position: POS.decChassi,
  };

  // ---------- Decisão de tração (já decidida)
  nodes[DEC_TRACAO] = {
    id: DEC_TRACAO,
    parentId: CAT_DEC,
    kind: 'decisao',
    name: 'Tração: 2WD ou 4WD?',
    fx: 'escolher quantos motores tracionados',
    problem: 'Mais motores = mais torque mas mais corrente.',
    confidence: 80,
    confidenceSource: 'experience',
    confidenceReason: '2WD é o padrão para protótipo simples',
    pros: [],
    cons: [],
    oQue:
      'escolher entre 2WD (2 motores traseiros + rodas dianteiras livres) ou 4WD (4 motores)',
    porQue: '4WD dá mais tração mas dobra o consumo de bateria e exige driver mais robusto.',
    comoConfirmar: 'Opção escolhida e registrada.',
    decisionOptions: [
      {
        id: 'opt-2wd',
        label: '2WD (skid steer)',
        pitch: 'Mais simples e barato. Curva via diferença de PWM entre os dois lados.',
        consequences:
          'Tração limitada em rampas. Bom pra chão liso. Driver L298N é suficiente.',
      },
      {
        id: 'opt-4wd',
        label: '4WD',
        pitch: 'Tração em todas as rodas. Curva via skid em todas as 4.',
        consequences:
          'Dobra consumo de bateria (~6A pico). Precisa driver de 4 canais ou 2× L298N. Custo +R$30, autonomia cai ~50%.',
      },
    ],
    decisionPickedId: 'opt-2wd',
    confirmado: true,
    order: 1,
    state: 'done',
    notes: 'Decidido 2WD pra v1. 4WD fica pra v2 se a v1 funcionar.',
    history: [
      hist('created', 'Decisão criada pela IA', ts(0)),
      hist('decision', 'Escolhida opção: 2WD (skid steer)', ts(2400)),
      hist('confirmed', 'Decisão confirmada', ts(2500)),
    ],
    aiSuggested: true,
    position: POS.decTracao,
  };

  // ---------- Decisão de direção (já decidida)
  nodes[DEC_DIRECAO] = {
    id: DEC_DIRECAO,
    parentId: CAT_DEC,
    kind: 'decisao',
    name: 'Direção: skid steer ou Ackermann?',
    fx: 'escolher mecanismo de curva',
    problem: 'Ackermann é mais natural mas exige servo + linkagem mecânica.',
    confidence: 78,
    confidenceSource: 'data',
    confidenceReason: 'Skid steer é praticamente forçado pela escolha de 2WD',
    pros: [],
    cons: [],
    oQue:
      'escolher entre skid steer (curva por diferença de PWM L/R) ou Ackermann (servo motor virando rodas dianteiras)',
    porQue:
      'Skid steer é grátis se já é 2WD; Ackermann é mais elegante mas precisa de mais hardware e linkagem.',
    comoConfirmar: 'Opção escolhida e registrada.',
    decisionOptions: [
      {
        id: 'opt-skid',
        label: 'Skid steer',
        pitch: 'Zero hardware extra. Curva diferenciando PWM dos lados.',
        consequences:
          'Curva agressiva, derrapa em chão liso. Difícil andar reto sem trim de PWM no firmware.',
      },
      {
        id: 'opt-ackermann',
        label: 'Ackermann com servo',
        pitch: 'Curva suave e previsível, parece um carro de verdade.',
        consequences:
          'Precisa servo + linkagem 3D. Tempo +2h, custo +R$25. Limita ângulo de curva (~±25°).',
      },
    ],
    decisionPickedId: 'opt-skid',
    confirmado: true,
    order: 2,
    state: 'done',
    notes: 'Forçado pela decisão de 2WD. Ackermann ficaria caro só pra v1.',
    history: [
      hist('created', 'Decisão criada pela IA', ts(0)),
      hist('decision', 'Escolhida opção: Skid steer', ts(2600)),
      hist('confirmed', 'Decisão confirmada', ts(2700)),
    ],
    aiSuggested: true,
    position: POS.decDirecao,
  };

  // ---------- Decisão de MCU (já decidida)
  nodes[DEC_MCU] = {
    id: DEC_MCU,
    parentId: CAT_DEC,
    kind: 'decisao',
    name: 'MCU: ESP32 ou Arduino Nano?',
    fx: 'escolher o microcontrolador',
    problem: 'Nano é mais barato mas tem só 2KB de RAM.',
    confidence: 85,
    confidenceSource: 'data',
    confidenceReason: 'Comparei specs lado a lado — ESP32 sobra',
    pros: [],
    cons: [],
    oQue: 'escolher entre ESP32-WROOM-32 (240MHz dual-core, 520KB SRAM, WiFi/BT) ou Arduino Nano (16MHz, 2KB SRAM, AVR)',
    porQue:
      'ESP32 é 5× mais rápido com 250× mais RAM, ao custo de R$15 a mais. Sobra processador pra v2 com BT/WiFi.',
    comoConfirmar: 'Opção escolhida e registrada.',
    decisionOptions: [
      {
        id: 'opt-esp32',
        label: 'ESP32-WROOM-32',
        pitch: 'Overkill mas dá headroom pra v2 (BT, WiFi, IMU integrado).',
        consequences:
          'Custo R$35-45. 3.3V GPIO (precisa nível lógico no driver L298N). Consumo idle 80mA.',
      },
      {
        id: 'opt-nano',
        label: 'Arduino Nano (ATmega328P)',
        pitch: 'Padrão maker, super documentado, 5V tolerante.',
        consequences:
          'Custo R$25. RAM 2KB limita firmware. Sem RF nativo — precisa NRF24 SPI anyway. Sem WiFi/BT.',
      },
    ],
    decisionPickedId: 'opt-esp32',
    confirmado: true,
    order: 3,
    state: 'done',
    notes: 'ESP32 ganha por headroom. Preço quase igual hoje.',
    history: [
      hist('created', 'Decisão criada pela IA', ts(0)),
      hist('decision', 'Escolhida opção: ESP32-WROOM-32', ts(2800)),
      hist('confirmed', 'Decisão confirmada', ts(2900)),
    ],
    aiSuggested: true,
    position: POS.decMCU,
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
  add(CAT_REC, REC_CHASSI, 'direct');
  add(CAT_REC, REC_MOTORES, 'direct');
  add(CAT_REC, REC_DRIVER, 'direct');
  add(CAT_REC, REC_MCU, 'direct');
  add(CAT_REC, REC_RF, 'direct');
  add(CAT_REC, REC_BATERIA, 'direct');
  add(CAT_REC, REC_RODAS, 'direct');
  add(CAT_REC, REC_FIOS, 'direct');
  add(CAT_REC, REC_CONTROLE, 'direct');
  add(CAT_REC, REC_FERRAMENTAS, 'direct');

  // categoria → passos
  add(CAT_EXE, PASSO_DESIGN, 'direct');
  add(CAT_EXE, PASSO_FAB, 'direct');
  add(CAT_EXE, PASSO_DRIVETRAIN, 'direct');
  add(CAT_EXE, PASSO_ELE, 'direct');
  add(CAT_EXE, PASSO_FIRMWARE, 'direct');
  add(CAT_EXE, PASSO_PAREAR, 'direct');
  add(CAT_EXE, PASSO_BANCO, 'direct');
  add(CAT_EXE, PASSO_CAMPO, 'direct');

  // categoria → decisões
  add(CAT_DEC, DEC_CHASSI, 'direct');
  add(CAT_DEC, DEC_TRACAO, 'direct');
  add(CAT_DEC, DEC_DIRECAO, 'direct');
  add(CAT_DEC, DEC_MCU, 'direct');

  // Sequência cronológica de passos (direct)
  add(PASSO_DESIGN, PASSO_FAB, 'direct', 'CAD antes da impressão');
  add(PASSO_FAB, PASSO_DRIVETRAIN, 'direct', 'chassi antes de fixar motores');
  add(PASSO_DRIVETRAIN, PASSO_ELE, 'direct', 'mecânica antes de eletrônica');
  add(PASSO_ELE, PASSO_FIRMWARE, 'direct', 'hardware antes do firmware');
  add(PASSO_FIRMWARE, PASSO_PAREAR, 'direct', 'firmware existe antes de parear');
  add(PASSO_PAREAR, PASSO_BANCO, 'direct', 'RF funcionando antes de bancada');
  add(PASSO_BANCO, PASSO_CAMPO, 'direct', 'validar em bancada antes de campo');

  // Recursos → passos onde são usados (independent — informa, não bloqueia)
  add(REC_CHASSI, PASSO_FAB, 'independent');
  add(REC_CHASSI, PASSO_DRIVETRAIN, 'independent');
  add(REC_MOTORES, PASSO_DRIVETRAIN, 'independent');
  add(REC_RODAS, PASSO_DRIVETRAIN, 'independent');
  add(REC_DRIVER, PASSO_ELE, 'independent');
  add(REC_MCU, PASSO_ELE, 'independent');
  add(REC_RF, PASSO_ELE, 'independent');
  add(REC_BATERIA, PASSO_ELE, 'independent');
  add(REC_FIOS, PASSO_ELE, 'independent');
  add(REC_MCU, PASSO_FIRMWARE, 'independent');
  add(REC_CONTROLE, PASSO_FIRMWARE, 'independent');
  add(REC_RF, PASSO_PAREAR, 'independent');
  add(REC_BATERIA, PASSO_CAMPO, 'independent');

  // Decisões influenciam passos específicos (middleware — A muda comportamento de B)
  add(DEC_CHASSI, PASSO_FAB, 'middleware', 'método de fabricação muda o processo');
  add(DEC_TRACAO, PASSO_DRIVETRAIN, 'middleware', '2WD vs 4WD muda quantos motores fixar');
  add(DEC_TRACAO, PASSO_ELE, 'middleware', '4WD exigiria driver maior');
  add(DEC_DIRECAO, PASSO_FIRMWARE, 'middleware', 'Ackermann adicionaria controle de servo');
  add(DEC_MCU, PASSO_ELE, 'middleware', 'Nano usa 5V, ESP32 usa 3.3V — muda level shifter');
  add(DEC_MCU, PASSO_FIRMWARE, 'middleware', 'libs e clock diferentes entre Nano e ESP32');

  // Aresta opcional: ferramentas conecta a tudo de eletrônica/mecânica mas
  // não bloqueia ordem — marca como optional
  add(REC_FERRAMENTAS, PASSO_DRIVETRAIN, 'optional');
  add(REC_FERRAMENTAS, PASSO_ELE, 'optional');

  return edges;
}

// ---------------------------------------------------------------------------
// Exported builder
// ---------------------------------------------------------------------------

export function buildDemoProject(): Project {
  return {
    id: 'demo-cellproject',
    name: 'Demo · Carrinho RC',
    objective:
      'construir um carrinho de controle remoto 2WD com chassi próprio, eletrônica embarcada e controle via rádio 2.4GHz que ande estável em terreno liso a ≥15 km/h por 30 min',
    createdAt: DEMO_T0,
    updatedAt: ts(9000),
    nodes: makeNodes(),
    edges: makeEdges(),
    rootId: ROOT,
  };
}

export const DEMO_PROJECT_ID = 'demo-cellproject';

export function isDemoProject(projectId: string | undefined | null): boolean {
  return projectId === DEMO_PROJECT_ID;
}
