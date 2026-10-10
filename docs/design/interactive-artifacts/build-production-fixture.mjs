// Offline QA sample for Dynamic Diary; no provider, account or environment access.
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../../src/visuals/diagram/fixture.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { torqueDiagram } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const ids = { root: '9_Root-QA', servo: 'S_ervo-QA', test: '-Test-QA' };
const timestamp = Date.UTC(2026, 9, 10, 12);
const node = (id, parentId, kind, name, oQue, x, y, order) => ({ id, parentId, kind, name, oQue, porQue: 'Amostra sintética para verificar a interface; não há evidência física.', comoConfirmar: '', fx: '', problem: '', confidence: 0, pros: [], cons: [], confirmado: false, state: 'concept', order, notes: '', history: [], aiSuggested: false, position: { x, y } });
const diagram = torqueDiagram(ids.servo, ids.test);
const artifact = { id: 'diagram-torque-example', kind: 'diagram', label: diagram.title, diagram, diagramValues: {}, linkedNodeId: ids.servo, x: 650, y: 0, width: 600, height: 365, scene: null, mediaId: null, source: null, revisions: [{ scene: null, mediaId: null, diagram, diagramValues: {}, label: diagram.title, createdAt: timestamp }], revisionIndex: 0 };
const emptyInput = { text: '', mentions: [], attachments: [] };
const project = {
  id: 'qa-diagram-torque-20261010', name: 'QA · Diagrama de torque (sintético)', objective: 'Verificar a interação do diagrama no canvas do Dynamic Diary com valores sintéticos.',
  createdAt: timestamp, updatedAt: timestamp, rootId: ids.root, archetype: 'entender', manualLayout: true,
  rules: ['Sem modelo de servo definido, sem alegação de capacidade nominal e sem observação física.'],
  nodes: {
    [ids.root]: node(ids.root, null, 'root', 'Torque · exemplo sintético', 'Explorar uma relação idealizada sem concluir compatibilidade.', 0, 120, 0),
    [ids.servo]: node(ids.servo, ids.root, 'recurso', 'Eixo · servo não especificado', 'Nenhuma capacidade nominal foi fornecida.', 320, 20, 0),
    [ids.test]: node(ids.test, ids.root, 'passo', 'Ensaio a planejar', 'Definir critério próprio antes de medir um conjunto real.', 320, 230, 1),
  },
  edges: { 'qa-relation': { id: 'qa-relation', source: ids.servo, target: ids.test, kind: 'independent', note: 'Relação conceitual da amostra.' } },
  visuals: { version: 1, mode: 'approval', artifacts: [artifact], proposals: [], drafts: { search: emptyInput, model: { ...emptyInput, artifactKind: 'diagram' } } },
};
await writeFile(new URL('./production-torque-example.json', import.meta.url), `${JSON.stringify({ format: 'cellproject-visual-plan', version: 1, project, media: [] }, null, 2)}\n`, 'utf8');
