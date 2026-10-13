import { lazy, Suspense, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { DiagramView } from '@/visuals/diagram/DiagramView';
import { parseDiagram } from '@/visuals/diagram/model';
import { sceneSchema } from '@/visuals/normalize';
import type { VisualArtifact } from '@/visuals/types';
import { capturePlanner, getPlannerOwnerId, openPlanner, readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { isPublicDemo } from './session';
import { ServoLab } from './ServoLab';
import './diagrams.css';

const BoardModelPreview = lazy(() => import('@/boards/BoardModelPreview').then(module => ({ default: module.BoardModelPreview })));
type ExampleId = { projectId: string; planId: string; artifactId: string };

function currentExample(id: ExampleId) {
  if (!isPublicDemo()) throw new Error('Esta prévia está disponível somente na demonstração.');
  const managed = useWorkspaceStore.getState().projects[id.projectId];
  if (!managed || managed.id !== id.projectId) throw new Error('Este exemplo mudou. Reabra a prévia.');
  const planner = readPlanner(id.projectId), project = planner.project;
  const artifact = project?.visuals?.artifacts.find(item => item.id === id.artifactId);
  if (!project || project.id !== id.planId || !artifact) throw new Error('Este exemplo mudou. Reabra a prévia.');
  return { managed, planner, project, artifact };
}

/** Read the latest owner snapshot before changing only the chosen example parameter. */
export function setDemoDiagramParameter(id: ExampleId, parameterId: string, value: number): void {
  const { planner, project, artifact } = currentExample(id);
  if (artifact.kind !== 'diagram' || !Number.isFinite(value)) throw new Error('Parâmetro inválido.');
  const diagram = parseDiagram(artifact.diagram, Object.keys(project.nodes));
  const parameter = diagram.parameters.find(item => item.id === parameterId);
  if (!parameter) throw new Error('Parâmetro inválido.');
  const diagramValues = { ...artifact.diagramValues, [parameterId]: Math.max(parameter.min, Math.min(parameter.max, value)) };
  const nextProject = { ...project, updatedAt: Date.now(), visuals: {
    ...project.visuals!, artifacts: project.visuals!.artifacts.map(item => item.id === id.artifactId ? { ...item, diagramValues } : item),
  } };
  if (getPlannerOwnerId() === id.projectId) {
    // This modal names its project explicitly, even when another overview is
    // selected. Keep the editor's same owner/plan synchronized without navigation.
    if (useGraphStore.getState().project !== project) throw new Error('Este exemplo mudou. Reabra a prévia.');
    useGraphStore.setState({ project: nextProject });
    useWorkspaceStore.getState().savePlanner(id.projectId, capturePlanner());
    return;
  }
  useWorkspaceStore.getState().savePlanner(id.projectId, { ...planner, project: nextProject });
}

export function DemoDiagrams() {
  const projects = useWorkspaceStore(state => state.projects);
  const graphProject = useGraphStore(state => state.project);
  const english = useLocaleStore(state => state.locale === 'en');
  const [selected, setSelected] = useState<ExampleId | null>(null);
  const [error, setError] = useState('');
  const examples = useMemo(() => Object.values(projects).flatMap(managed => {
    if (managed.archived) return [];
    const project = getPlannerOwnerId() === managed.id ? graphProject : managed.planner?.project;
    if (!project) return [];
    return (project.visuals?.artifacts ?? []).flatMap((artifact): Array<ExampleId & { projectName: string; artifact: VisualArtifact; nodeNames: Record<string, string> }> => {
      if (artifact.kind !== 'diagram' && artifact.kind !== 'model') return [];
      try {
        if (artifact.kind === 'diagram') parseDiagram(artifact.diagram, Object.keys(project.nodes));
        else sceneSchema.parse(artifact.scene);
        return [{ projectId: managed.id, planId: project.id, artifactId: artifact.id, projectName: managed.name, artifact,
          nodeNames: Object.fromEntries(Object.values(project.nodes).map(node => [node.id, node.name])) }];
      } catch { return []; }
    });
  }), [projects, graphProject]);
  if (!isPublicDemo() || !examples.length) return null;
  const example = selected && examples.find(item => item.projectId === selected.projectId && item.planId === selected.planId && item.artifactId === selected.artifactId);
  const close = () => { setSelected(null); setError(''); };
  const openExamplePlan = (target: ExampleId, nodeId?: string) => {
    try {
      const { project } = currentExample(target);
      if (nodeId && !Object.hasOwn(project.nodes, nodeId)) throw new Error('Esta parte não está mais disponível.');
      openPlanner(target.projectId);
      const workspace = useWorkspaceStore.getState();
      workspace.selectProject(target.projectId);
      if (nodeId) {
        useGraphStore.getState().selectNode(nodeId);
        useGraphStore.getState().setDetailPanelOpen(true);
      }
      workspace.navigate('planner');
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir este exemplo.'); }
  };
  const openPlan = (nodeId?: string) => { if (example) openExamplePlan(example, nodeId); };
  const robot = examples.find(item => item.planId === 'cellproject-public-demo-v1:robot');

  return <section className="demo-examples" aria-label={english ? 'Interactive examples' : 'Exemplos interativos'}>
    <ServoLab english={english} onOpenPlan={robot ? () => openExamplePlan(robot, `${robot.planId}:step:4`) : undefined}/>
    {error && !example && <p className="demo-example-error" role="alert">{error}</p>}
    <div className="demo-examples-heading"><h2>{english ? 'Explore an example' : 'Explore um exemplo'}</h2><p>{english ? 'Fictional scenarios. Changes disappear when you reload.' : 'Cenários fictícios. As alterações desaparecem ao recarregar.'}</p></div>
    <div className="demo-examples-actions">{examples.map(item => <button type="button" key={`${item.projectId}:${item.artifactId}`}
      aria-label={`${english ? 'Explore' : 'Explorar'} ${item.artifact.kind === 'model' ? '3D' : (english ? 'diagram' : 'diagrama')}: ${item.artifact.label}`}
      onClick={() => { setError(''); setSelected(item); }}><span>{item.artifact.label.split(' · ')[0]}</span><small>{item.projectName} · {item.artifact.kind === 'model' ? '3D' : (english ? 'Diagram' : 'Diagrama')}</small></button>)}</div>
    {example && <Modal open onClose={close} title={example.artifact.label} className="demo-example-modal">
      <p className="demo-example-context">{example.projectName}</p>
      <p className="demo-example-fiction">{english ? 'Fictional illustration for exploration; no real-world validation. Changes affect this temporary example only.' : 'Ilustração fictícia para explorar; sem validação real. As alterações afetam apenas este exemplo temporário.'}</p>
      {example.artifact.kind === 'diagram' && example.artifact.diagram ? <div className="demo-example-preview"><DiagramView
        diagram={example.artifact.diagram} values={example.artifact.diagramValues} english={english}
        nodeNames={example.nodeNames}
        onParameter={(parameterId, value) => { try { setDemoDiagramParameter(example, parameterId, value); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ajustar o parâmetro.'); } }}
        onSelectNode={nodeId => openPlan(nodeId)} /></div>
        : example.artifact.kind === 'model' && example.artifact.scene && <>
          <div className="demo-model-preview"><Suspense fallback={<p role="status">{english ? 'Opening 3D preview…' : 'Abrindo prévia 3D…'}</p>}><BoardModelPreview scene={example.artifact.scene} english={english} /></Suspense></div>
          <p className="demo-model-hint">{english ? 'Drag to rotate. Keyboard: arrows rotate; Home resets the view. Ctrl + scroll zooms.' : 'Arraste para girar. No teclado: setas giram; Home restaura a vista. Ctrl + rolagem aproxima.'}</p>
        </>}
      {error && <p className="demo-example-error" role="alert">{error}</p>}
      <div className="demo-example-footer"><button type="button" className="ws-button" onClick={close}>{english ? 'Close' : 'Fechar'}</button><button type="button" className="ws-button primary" onClick={() => openPlan()}>{english ? 'Open in plan' : 'Abrir no plano'}</button></div>
    </Modal>}
  </section>;
}
