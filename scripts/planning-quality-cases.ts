import type { PlanningIntent } from '../src/types';
import type { KBContextEntry } from '../src/kb/types';

export const sourceProvenance = {
  consultedAt: '2026-10-10', method: 'Official pages opened with web tool; bounded human paraphrases, not full attachments or extracted PDFs.',
  variant: 'Xiaomi Electric Scooter 4, global, NOT 4 Pro',
  sources: [
    { id: 'specs', url: 'https://www.mi.com/global/product/xiaomi-electric-scooter-4/specs/', sections: ['Product specifications', 'Battery specs', 'Adapter specs'] },
    { id: 'product', url: 'https://www.mi.com/global/product/xiaomi-electric-scooter-4/', sections: ['Full battery protection by the intelligent BMS', 'Intuitive digital dashboard', 'Front folding buckle', 'Dual brake system', 'Range test footnote'] },
  ],
  scope: 'Source ratings describe only the named commercial reference. No internal BOM, controller pinout, connector protocol or homemade compatibility is documented here.',
};

export const boundedSources: KBContextEntry[] = [
  { docId: 'specs', titulo: 'Xiaomi Electric Scooter 4 — especificações globais', dominio: 'mobilidade elétrica', tags: ['referência', 'Scooter 4'], resumo: [], fatos: [], sourceTruncated: true,
    sourceText: `Fonte oficial: ${sourceProvenance.sources[0].url}\nVariante: Xiaomi Electric Scooter 4 global, não 4 Pro. Consultada em 10/10/2026. Paráfrase delimitada: a ficha declara motor de 300 W nominais/600 W máximos, frenagem E-ABS e disco traseiro, pneus sem câmara de 10 polegadas. A bateria de íons de lítio T2201-BA3A tem 7650 mAh/275,4 Wh. O adaptador informa saída nominal de 1,7 A e tensão máxima de 42 VDC. São declarações do produto de referência, não requisitos nem medições do projeto caseiro. A ficha não identifica BOM interna completa, pinagem do controlador ou encaixes entre componentes do projeto.` },
  { docId: 'product', titulo: 'Xiaomi Electric Scooter 4 — descrição global', dominio: 'mobilidade elétrica', tags: ['referência', 'Scooter 4'], resumo: [], fatos: [], sourceTruncated: true,
    sourceText: `Fonte oficial: ${sourceProvenance.sources[1].url}\nVariante: Xiaomi Electric Scooter 4 global, não 4 Pro. Consultada em 10/10/2026. Paráfrase delimitada: a descrição apresenta painel digital, dobra dianteira e BMS com proteções contra curto, sobrecorrente, sobrecarga, descarga excessiva e temperatura. Declara frenagem dianteira E-ABS e disco traseiro. O alcance anunciado de 35 km vem de ensaio citado com carga de 75±5 kg, velocidade constante de 15 km/h, piso plano e temperatura de 25±5 °C. A capacidade comercial não comprova o desempenho de um patinete caseiro. Não há esquema interno completo nem especificações suficientes das interfaces do projeto.` },
];

export interface QualityCase { id: string; group: 'core' | 'extra'; objective: string; intent: PlanningIntent; kb: KBContextEntry[]; focus: string[] }
const scooterGoal = 'Quero construir um patinete elétrico caseiro; ainda não tenho arquitetura, peças ou desempenho selecionados.';
export const qualityCases: QualityCase[] = [
  { id: 'new-no-reference', group: 'core', objective: scooterGoal, intent: { planApproach: 'new_creation' }, kb: [], focus: ['Requisitos e alternativas antes de peças', 'Ausência de números apresentados como decisões humanas', 'Perguntas sobre uso/carga/desempenho'] },
  { id: 'reverse-no-target', group: 'core', objective: scooterGoal, intent: { planApproach: 'reverse_engineering' }, kb: [], focus: ['Identificação do sistema/variante primeiro', 'Nenhuma referência comercial inventada', 'Lacunas concretas em vez de compatibilidade presumida'] },
  { id: 'reverse-bounded-source', group: 'core', objective: scooterGoal, intent: { planApproach: 'reverse_engineering', referenceTarget: 'Xiaomi Electric Scooter 4 global' }, kb: boundedSources, focus: ['Citação specs/product nas afirmações documentadas', 'Separação referência/hipótese/projeto', 'Interfaces e limites ausentes nas páginas'] },
  { id: 'reverse-variant-conflict', group: 'core', objective: scooterGoal, intent: { planApproach: 'reverse_engineering', referenceTarget: 'Xiaomi Electric Scooter 4 Pro global' }, kb: boundedSources, focus: ['Conflito 4 Pro versus fontes Scooter 4 explicitado', 'Pergunta de identificação antes de copiar especificações', 'Nenhuma fusão de variantes'] },
  { id: 'robot-unspecified', group: 'extra', objective: 'Quero construir um robô de dois braços com peças impressas em 3D e servos MG90S; carga útil, alcance e dimensões reais ainda não foram medidos.', intent: { planApproach: 'new_creation' }, kb: [], focus: ['Medição de carga/alcance e especificação do servo', 'Torque, alimentação, interface elétrica e fixação', 'Não afirmar montagem ou teste concluído'] },
  { id: 'arduino-and-cable', group: 'extra', objective: 'Quero programar uma placa Arduino e alimentá-la com um cabo USB. Tenho a placa e um cabo, mas não sei o modelo da placa, o conector nem se o cabo transmite dados.', intent: { planApproach: 'new_creation' }, kb: [], focus: ['Não transformar Arduino + cabo em compatibilidade garantida', 'Modelo, conector, cabo de dados, driver e upload', 'Pergunta/ensaio distinto para cada desconhecido'] },
];
