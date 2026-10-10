/** Deterministic test material, not a generated plan, BOM or physical validation. */
export const reference = {
  id: 'xiaomi-electric-scooter-4-global',
  label: 'Xiaomi Electric Scooter 4 — página global consultada em 10/10/2026',
  sources: [
    { id: 'specs', url: 'https://www.mi.com/global/product/xiaomi-electric-scooter-4/specs/', title: 'Especificações oficiais' },
    { id: 'product', url: 'https://www.mi.com/global/product/xiaomi-electric-scooter-4/', title: 'Descrição oficial do produto' },
  ],
  // Paraphrases of the bounded sources. These describe the reference, not a homemade design.
  claims: [
    { id: 'motor-rating', module: 'propulsion', source: 'specs', section: 'Product specifications', statement: 'A referência declara motor de 300 W nominais e 600 W máximos.' },
    { id: 'brakes', module: 'braking', source: 'specs', section: 'Braking', statement: 'A referência declara E-ABS e freio a disco traseiro.' },
    { id: 'tires', module: 'wheels', source: 'specs', section: 'Tires', statement: 'A referência declara pneus sem câmara de 10 polegadas.' },
    { id: 'battery', module: 'energy', source: 'specs', section: 'Battery specs', statement: 'A bateria de referência é identificada como T2201-BA3A, com 7650 mAh / 275,4 Wh.' },
    { id: 'charger', module: 'charging', source: 'specs', section: 'Adapter specs', statement: 'O adaptador de referência declara saída nominal de 1,7 A e tensão máxima de 42 VDC.' },
    { id: 'protection', module: 'protection', source: 'product', section: 'Full battery protection by the intelligent BMS', statement: 'A descrição informa BMS com proteções, incluindo sobrecorrente e temperatura.' },
    { id: 'dashboard', module: 'command', source: 'product', section: 'Intuitive digital dashboard', statement: 'A descrição apresenta painel digital para informações do veículo.' },
    { id: 'folding', module: 'structure', source: 'product', section: 'Front folding buckle', statement: 'A descrição apresenta mecanismo de dobra dianteiro.' },
  ],
};

// Engineering review topics. This rubric is our test design, not a manufacturer BOM.
export const reviewTopics = [
  { id: 'structure', name: 'Estrutura, direção e suporte de carga' },
  { id: 'wheels', name: 'Rodas, pneus e fixações' },
  { id: 'propulsion', name: 'Propulsão e transmissão de esforço' },
  { id: 'energy', name: 'Armazenamento de energia' },
  { id: 'protection', name: 'Proteções e limites da energia' },
  { id: 'charging', name: 'Carregamento e interface com bateria' },
  { id: 'control', name: 'Controle de potência e firmware' },
  { id: 'command', name: 'Comando humano e indicação de estado' },
  { id: 'braking', name: 'Frenagem e comando de parada' },
  { id: 'connections', name: 'Conexões elétricas e mecânicas' },
  { id: 'assembly', name: 'Sequência de montagem e inspeção' },
  { id: 'test', name: 'Plano de ensaios e critérios próprios' },
];
export const reviewInterfaces = [
  { id: 'structure-wheels', from: 'structure', to: 'wheels', question: 'Quais dimensões, rolamentos, fixações e caminhos de carga reais serão usados?' },
  { id: 'energy-control', from: 'energy', to: 'control', question: 'Quais limites, proteções, conectores e polaridade reais ligam a bateria ao controlador?' },
  { id: 'control-propulsion', from: 'control', to: 'propulsion', question: 'Qual motor/controlador, sinais e firmware funcionam juntos?' },
  { id: 'command-control', from: 'command', to: 'control', question: 'Qual comando humano e protocolo são aceitos pelo controlador?' },
  { id: 'braking-control', from: 'braking', to: 'control', question: 'Como o comando de parada atua no sistema escolhido?' },
  { id: 'charging-energy', from: 'charging', to: 'energy', question: 'Quais química, limites, conector, polaridade e protocolo de carga devem coincidir?' },
];
export const unresolved = [
  'O patinete caseiro ainda não tem arquitetura e variante de peças selecionadas.',
  'As páginas consultadas não são uma lista completa de peças internas ou esquema elétrico.',
  'Modelo/pinagem do controlador, conectores, chicote e firmware permanecem indefinidos.',
  'Fixações, tolerâncias, carga estrutural e funcionamento dos freios do projeto exigem especificações e ensaios próprios.',
  'As capacidades declaradas do produto comercial não são desempenho do projeto caseiro.',
];

export interface Candidate {
  label: string;
  variantId: string | null;
  topics: string[];
  interfaces: string[];
  statements: Array<{ text: string; claimId?: string; appliesTo: 'reference' | 'homemade'; status: 'documented' | 'assumption' | 'unknown' }>;
  questions: string[];
}
const allTopics = reviewTopics.map(item => item.id), allInterfaces = reviewInterfaces.map(item => item.id);
export const candidates: Record<string, Candidate> = {
  generic: { label: 'Lista genérica sem referência', variantId: null, topics: ['structure', 'propulsion', 'energy'], interfaces: [],
    statements: [{ text: 'Comprar motor e bateria compatíveis', appliesTo: 'homemade', status: 'unknown' }], questions: [] },
  unsupported: { label: 'Referência copiada como se fosse o projeto', variantId: reference.id, topics: allTopics, interfaces: allInterfaces,
    statements: [{ text: 'O patinete caseiro já terá os 300 W da referência', claimId: 'motor-rating', appliesTo: 'homemade', status: 'documented' }], questions: [] },
  wrongVariant: { label: 'Confusão entre modelos', variantId: 'xiaomi-scooter-4-pro', topics: allTopics, interfaces: allInterfaces,
    statements: [{ text: reference.claims[3].statement, claimId: 'battery', appliesTo: 'reference', status: 'documented' }], questions: ['Confirmar etiqueta'] },
  scoped: { label: 'Roteiro delimitado com perguntas', variantId: reference.id, topics: allTopics, interfaces: allInterfaces,
    statements: reference.claims.map(claim => ({ text: claim.statement, claimId: claim.id, appliesTo: 'reference' as const, status: 'documented' as const })),
    questions: [...reviewInterfaces.map(item => item.question), ...unresolved] },
};

/** Checks declared references/coverage, never semantic truth, engineering fit or safety. */
export function assessCandidate(candidate: Candidate) {
  const issues: string[] = [];
  for (const statement of candidate.statements) {
    if (statement.status !== 'documented') continue;
    const claim = reference.claims.find(item => item.id === statement.claimId);
    if (!claim) issues.push('unsupported_source');
    else {
      if (candidate.variantId !== reference.id) issues.push('variant_mismatch');
      if (statement.appliesTo === 'homemade') issues.push('reference_transferred_to_design');
      // Exact text is intentional: paraphrases/interpretations need independent review.
      if (statement.text !== claim.statement) issues.push('statement_needs_review');
    }
  }
  return {
    missingTopics: reviewTopics.filter(topic => !candidate.topics.includes(topic.id)).map(topic => topic.id),
    missingInterfaces: reviewInterfaces.filter(item => !candidate.interfaces.includes(item.id)).map(item => item.id),
    unknownTopicIds: candidate.topics.filter(id => !allTopics.includes(id)),
    unknownInterfaceIds: candidate.interfaces.filter(id => !allInterfaces.includes(id)),
    issues: [...new Set(issues)],
    // Even a completely covered outline remains physically unvalidated.
    physicalCompatibility: 'unknown' as const,
    physicalTestPassed: false,
    unknowns: unresolved,
    coveredTopicCount: reviewTopics.filter(topic => candidate.topics.includes(topic.id)).length,
  };
}
