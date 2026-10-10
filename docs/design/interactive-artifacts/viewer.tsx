import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, Position, NodeResizer, useNodesState, useEdgesState, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { demoDiagram, evaluateDiagram, parseDiagram, sampleContext, type Diagram } from './model';
import { createIsolatedDocument, classifyFrameMessage } from './isolation';
import './style.css';

const Selection = createContext({ selected: 'servo', select: (_id: string) => {} });
const names: Record<string, string> = Object.fromEntries(sampleContext.nodes.map(n => [n.id, n.name]));
const assessmentLabel: Record<string, string> = { supported: 'sustentada (IA)', contradicted: 'contrariada (IA)', uncertain: 'incerta (IA)', 'needs-decomposition': 'pede decomposição (IA)' };
type Result = { id: string; status: string; output?: any; code?: string; durationMs?: number; error?: string };

export function DiagramView({ diagram }: { diagram: Diagram }) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const { select } = useContext(Selection);
  let values: Record<string, number> = {}, error = '';
  try { values = evaluateDiagram(diagram, overrides); } catch { error = 'Combinação inválida para este cálculo.'; }
  return <div className="diagram-view">
    <svg viewBox={diagram.viewBox.join(' ')} aria-label={diagram.title} role="group">
      {!error && diagram.elements.map(element => {
        const { id, type, text, nodeId, ...attrs } = element;
        const props: Record<string, unknown> = { ...attrs };
        let label = text;
        for (const b of diagram.bindings.filter(b => b.elementId === id)) {
          const value = values[b.valueId] * b.multiplier + b.offset;
          if (b.attribute === 'text') label = value.toFixed(b.decimals) + b.suffix;
          else props[b.attribute] = value;
        }
        const activate = () => nodeId && select(nodeId);
        return React.createElement(type, { ...props, key: id, 'data-shape': id, ...(nodeId ? { role: 'button', tabIndex: 0, 'aria-label': `Referenciar ${names[nodeId]}`, onClick: activate, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }, className: 'nodrag nopan linked-shape' } : {}) }, type === 'text' ? label : undefined);
      })}
    </svg>
    <div className="parameter-controls nodrag nopan nowheel">
      {diagram.parameters.map(p => <label key={p.id}>{p.label}<output>{(values[p.id] ?? p.value).toFixed(2)} {p.unit}</output><input aria-label={p.label} type="range" min={p.min} max={p.max} step={p.step} value={overrides[p.id] ?? p.value} onChange={event => setOverrides(previous => ({ ...previous, [p.id]: Number(event.target.value) }))} /></label>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="diagram-limit">Cálculo ilustrativo · valores sintéticos · não valida o servo</p>
  </div>;
}

function PlanNode({ id, data }: NodeProps) {
  const { selected, select } = useContext(Selection);
  return <div className={`plan-node ${id === selected ? 'is-focused' : ''}`} onClick={() => select(id)}>
    <Handle type="target" position={Position.Left}/><small>{id === 'root' ? 'OBJETIVO' : id === 'test' ? 'ENSAIO' : 'PREMISSA EM ANÁLISE'}</small>
    <strong>{String(data.label)}</strong><span>Sem validação física</span><Handle type="source" position={Position.Right}/>
  </div>;
}

function IsolatedReact({ runtime }: { runtime: string }) {
  const frame = useRef<HTMLIFrameElement>(null), [failed, setFailed] = useState(false);
  const { select } = useContext(Selection);
  const srcDoc = useMemo(() => {
    const nonce = crypto.randomUUID().replaceAll('-', '');
    return createIsolatedDocument(runtime, nonce);
  }, [runtime]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = classifyFrameMessage(event.source, frame.current?.contentWindow, event.origin, event.data);
      if (message?.type === 'error') setFailed(true);
      if (message?.type === 'select') select(message.nodeId);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [select]);
  return <><iframe ref={frame} title="Amostra React gerada pela IA" srcDoc={srcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer" className="nodrag nopan nowheel generated-frame" />{failed && <p role="alert">A amostra apresentou uma falha de execução.</p>}</>;
}

function ArtifactNode({ data, selected }: NodeProps) {
  return <div className={`artifact ${selected ? 'is-selected' : ''}`}>
    <NodeResizer isVisible={selected} minWidth={400} minHeight={330} color="#aa94cf66"/>
    <Handle type="target" position={Position.Left}/>
    <div className="artifact-grip" title="Arraste para mover o artefato">⠿ <span>{String(data.label)}</span><small>{data.generated ? (data.repaired ? 'IA · transporte adaptado' : 'IA · primeira resposta') : 'Fixture determinística'}</small></div>
    <div className="artifact-content">{data.mode === 'react' ? <IsolatedReact runtime={String(data.runtime)}/> : <DiagramView key={String(data.label)} diagram={data.diagram as Diagram}/>}</div>
  </div>;
}
const nodeTypes = { plan: PlanNode, artifact: ArtifactNode };

function Review({ results }: { results: Result[] }) {
  const [level, setLevel] = useState(0);
  const adapted = results.find(r => r.id === 'plan-adapted'), current = results.find(r => r.id === 'plan-current');
  if (!adapted || !current) return <p>Ensaio do motor ainda não disponível.</p>;
  const output = adapted.output;
  return <section className="review-section">
    <div className="section-heading"><div><small>02 / MOTOR DO PLANO</small><h2>A falha é uma observação. A causa ainda é uma hipótese.</h2></div><span>Mesmo cenário · dois prompts</span></div>
    <div className="review-grid">{[current, adapted].map(r => <article key={r.id}><small>{r.id === 'plan-current' ? 'INSTRUÇÃO ATUAL · TRECHO DO MOTOR' : 'ADAPTAÇÃO · CO-DECOMPOSIÇÃO + EVIDÊNCIAS'}</small><p>{r.output?.diagnosis ?? r.error}</p><div className="tags">{r.output?.nodes.map((n: any) => <span key={n.nodeId}>{names[n.nodeId] ?? n.nodeId} · {assessmentLabel[n.assessment] ?? n.assessment}</span>)}</div><details><summary>Ver razões, alternativas e mudanças propostas</summary><pre>{JSON.stringify(r.output, null, 2)}</pre></details><footer>{r.status === 'valid' ? 'Resposta válida' : 'Resposta rejeitada'} · {((r.durationMs ?? 0) / 1000).toFixed(1)}s · nada foi aplicado</footer></article>)}</div>
    {output && <div className="progressive-help"><div><small>AJUDA SOB DEMANDA</small><h3>{level === 0 ? 'Primeiro, uma pergunta.' : level === 1 ? 'Mais contexto para investigar.' : 'Um subpasso, para você decidir.'}</h3><p>{level === 0 ? output.hints.question : level === 1 ? output.hints.detail : output.hints.suggestedStep}</p></div><div className="help-actions"><button onClick={() => setLevel(Math.max(0, level - 1))} disabled={level === 0}>Voltar</button><button onClick={() => setLevel(Math.min(2, level + 1))} disabled={level === 2}>{level === 0 ? 'Quero uma pista' : 'Ver um subpasso'}</button></div></div>}
  </section>;
}

function App() {
  const [results, setResults] = useState<Result[]>([]), [runtime, setRuntime] = useState(''), [mode, setMode] = useState<'data' | 'react'>('data'), [selected, select] = useState('servo'), [linked, setLinked] = useState(true), [manifest, setManifest] = useState<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([
    ...sampleContext.nodes.map((n, i) => ({ id: n.id, type: 'plan', position: i === 0 ? { x: 0, y: 190 } : { x: 265, y: i === 1 ? 50 : i === 2 ? 360 : 210 }, data: { label: n.name }, style: { width: 220 } })),
    { id: 'artifact', type: 'artifact', position: { x: 610, y: 25 }, data: { label: demoDiagram.title, mode: 'data', diagram: demoDiagram, runtime: '', generated: false }, style: { width: 590, height: 470 } },
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([
    { id: 'root-servo', source: 'root', target: 'servo' }, { id: 'root-power', source: 'root', target: 'power' }, { id: 'servo-test', source: 'servo', target: 'test' },
    { id: 'association', source: 'servo', target: 'artifact', type: 'default', style: { stroke: '#a591c088', strokeDasharray: '5 7' } },
  ]);
  useEffect(() => {
    let alive = true;
    Promise.all(['plan-current', 'plan-adapted', 'diagram-data', 'diagram-data-repaired', 'diagram-data-text', 'diagram-react'].map(id => fetch(`./results/${id}.json`).then(r => r.ok ? r.json() : null).catch(() => null))).then(all => { if (alive) setResults(all.filter(Boolean)); });
    fetch('./results/react-runtime.js').then(r => r.ok ? r.text() : '').then(text => { if (alive) setRuntime(text); });
    fetch('./results/manifest.json').then(r => r.ok ? r.json() : null).then(json => { if (alive) setManifest(json); });
    return () => { alive = false; };
  }, []);
  const dataResult = results.find(r => r.id === 'diagram-data-text' && r.status === 'valid') ?? results.find(r => r.id === 'diagram-data-repaired' && r.status === 'valid') ?? results.find(r => r.id === 'diagram-data');
  const diagram = useMemo(() => { try { return dataResult?.status === 'valid' ? parseDiagram(dataResult.output, Object.keys(names)) : demoDiagram; } catch { return demoDiagram; } }, [dataResult]);
  useEffect(() => setNodes(previous => previous.map(n => n.id === 'artifact' ? { ...n, data: { label: mode === 'data' ? diagram.title : 'Torque · componente React gerado', diagram, mode, runtime, repaired: mode === 'data' && dataResult?.id !== 'diagram-data', generated: mode === 'data' ? dataResult?.status === 'valid' : !!runtime } } : n)), [diagram, mode, runtime, dataResult, setNodes]);
  useEffect(() => setEdges(previous => previous.map(e => e.id === 'association' ? { ...e, hidden: !linked } : e)), [linked, setEdges]);
  const selection = useMemo(() => ({ selected, select }), [selected]);
  return <Selection.Provider value={selection}><main>
    <header><a className="back" href="/">← Voltar ao projeto</a><small>LABORATÓRIO · 10 OUT 2026 · EXPERIMENTAL</small><h1>O plano pensa junto com o artefato.</h1><p>Uma visão localizada para investigar uma premissa. Arraste pela alça, selecione para redimensionar e experimente os controles. O plano original permanece separado da visualização.</p></header>
    <div className="section-heading"><div><small>01 / DUAS ARQUITETURAS</small><h2>Mesma tarefa: investigar carga e distância.</h2></div><div className="segmented"><button aria-pressed={mode === 'data'} onClick={() => setMode('data')}>Dados + React/SVG</button><button aria-pressed={mode === 'react'} disabled={!runtime} onClick={() => setMode('react')}>React gerado</button></div></div>
    <div className="board"><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .09, maxZoom: 1 }} minZoom={.35} maxZoom={1.5} defaultEdgeOptions={{ type: 'default', style: { stroke: '#4c4553' } }} proOptions={{ hideAttribution: true }}><Background color="#39323e" gap={20} size={.65}/><Controls showInteractive={false}/></ReactFlow></div>
    <div className="board-caption"><span role="status">Referência em foco: <strong>{names[selected]}</strong></span><label><input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)}/> Mostrar vínculo</label><span>{mode === 'data' ? (dataResult?.status === 'valid' ? `${diagram.elements.length} elementos · JSON validado${dataResult.id !== 'diagram-data' ? ' · transporte adaptado' : ''}` : 'Fixture determinística · geração indisponível') : 'React gerado · iframe isolado · conexões restritas por CSP'}</span></div>
    <details className="method-details"><summary>Premissas do desenho e limites da comparação</summary><p>{diagram.explanation}</p><ul>{diagram.assumptions.map(a => <li key={a}>{a}</li>)}</ul><p>Este desenho é uma extensão proposta por nós. O DBox não apresenta um gerador livre de componentes React. A geração declarativa teve três tentativas sem desenho válido; a quarta usa JSON como texto, contrato e prompt técnico adaptados e validação local. As falhas foram preservadas. Não comparar taxa de sucesso ou qualidade como superioridade de arquitetura neste ensaio.</p><a href="./results/manifest.json">Entradas, prompts, modelo, tempos e condições</a> · <a href="./results/diagram-data.json">Primeira tentativa declarativa</a> · <a href="./results/diagram-data-text.json">JSON com transporte adaptado</a> · <a href="./results/diagram-react.json">Resposta React</a></details>
    <Review results={results}/>
    <section className="typesafe-section"><small>03 / TYPESAFE EXISTENTE</small><h2>Roteamento de intenção, sem decidir a verdade.</h2><div className="typesafe-results">{manifest?.runs.filter((r: any) => r.id.startsWith('typesafe')).map((r: any) => <article key={r.id}><p>“{r.request}”</p><strong>{r.classification?.choice ?? r.status}</strong>{r.classification && <span>Confiança do modelo: {(r.classification.confidence * 100).toFixed(0)}% · não é acurácia medida</span>}</article>)}</div></section>
    <section className="recommendation"><small>LEITURA PARA O PROJETO</small><h2>Motor primeiro. Artefatos como instrumentos de investigação.</h2><p>Preservar o plano, apontar lacunas por nó e oferecer ajuda progressiva têm aplicação direta. A visão interativa entra quando explica uma relação difícil de entender em texto; ela referencia os nós e trabalha com valores temporários. Alterar um controle não vira observação física nem reorganiza o plano.</p><p>Para integrar, nossa preferência inicial é React/SVG sobre dados validados, com formas customizadas e interações declaradas. React livre fica em experimento isolado até medir falhas, custo de reparo e qualidade em mais tarefas.</p></section>
    <footer className="page-footer">Fonte: <a href="https://arxiv.org/html/2502.19133v1">DBox · Ma et al. · CHI 2025</a>. A pesquisa estudou programação algorítmica; a transferência ao robô é uma hipótese nossa. Laboratório sem acesso de escrita ao plano, sem chamadas pagas ao abrir e sem dados reais de ensaio.</footer>
  </main></Selection.Provider>;
}
if (document.getElementById('root')) createRoot(document.getElementById('root')!).render(<App/>);
