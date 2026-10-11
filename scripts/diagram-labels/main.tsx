import React from 'react';
import { createRoot } from 'react-dom/client';
import { DiagramView } from '../../src/visuals/diagram/DiagramView';
import { diagramSchema, type DiagramV1 } from '../../src/visuals/diagram/model';
import { diagramLabelsFixture } from './fixture';
import { assessCoverage } from './coverage';
import './viewer.css';

const records = import.meta.glob('/docs/reports/data/diagram-labels-2026-10-11/*.json', { eager: true, import: 'default' });
const raw = records['/docs/reports/data/diagram-labels-2026-10-11/diagram.json'];
const manifest = records['/docs/reports/data/diagram-labels-2026-10-11/manifest.json'] as { status?: string; parser?: { status?: string }; model?: string; responseId?: string } | undefined;
const parsed = diagramSchema.safeParse(raw);

function Preview({ title, diagram, kind }: { title: string; diagram: DiagramV1; kind: string }) {
  const coverage = assessCoverage(diagram);
  return <section data-preview={kind}>
    <h2>{title}</h2>
    <p className="coverage">{coverage.distinctServoLabels}/14 servos nomeados · ESP32 {coverage.esp32 ? '✓' : 'ausente'} · PCA9685 {coverage.pca9685 ? '✓' : 'ausente'} · fonte {coverage.source ? '✓' : 'ausente'} · capacitor {coverage.capacitor ? '✓' : 'ausente'} · legenda {coverage.legend ? '✓' : 'ausente'}</p>
    <div className="artifact" data-artifact-size="560x500"><DiagramView diagram={diagram} /></div>
  </section>;
}

function App() {
  return <main>
    <h1>Diagrama explicativo: nomes e legenda</h1>
    <p>Estudo visual sintético. Conexões funcionais ilustrativas, sem pinagem ou especificação elétrica.</p>
    <Preview kind="manual" title="Fixture manual · capacidade do renderer" diagram={diagramLabelsFixture()} />
    <p>A fixture foi escrita manualmente. Ela não é saída de IA.</p>
    <section data-generated-status={manifest?.status ?? 'not-run'}>
      <h2>Primeira resposta de IA · sem reparo</h2>
      {manifest ? <p>Estado registrado: <strong>{manifest.status}</strong> · parser: {manifest.parser?.status ?? 'sem resposta'} · {manifest.model}</p> : <p>Inferência ainda não executada. Abrir esta página não chama a IA.</p>}
      {parsed.success ? <Preview kind="generated" title={parsed.data.title} diagram={parsed.data} /> : manifest ? <p role="alert">Primeira resposta sem documento renderizável pelo schema. Os arquivos originais foram preservados.</p> : null}
    </section>
    <p className="limits">Cobertura textual e aceitação do parser não comprovam legibilidade, ligações elétricas, compatibilidade ou funcionamento físico. Verifique separadamente o SVG visível em desktop e viewport móvel.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
