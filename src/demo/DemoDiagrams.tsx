import { useMemo, useState } from 'react';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { parseDiagram } from '@/visuals/diagram/model';
import { sceneSchema } from '@/visuals/normalize';
import type { VisualArtifact } from '@/visuals/types';
import { capturePlanner, getPlannerOwnerId, openPlanner, readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { isPublicDemo } from './session';
import './diagrams.css';

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
  const robot = examples.find(item => item.artifactId === 'cellproject-public-demo-v1:robot:servo') ?? examples.find(item => item.planId === 'cellproject-public-demo-v1:robot');
  const openExamplePlan = (target: ExampleId) => {
    try {
      currentExample(target);
      openPlanner(target.projectId);
      const workspace = useWorkspaceStore.getState();
      workspace.selectProject(target.projectId);
      useGraphStore.getState().setDetailPanelOpen(false);
      workspace.navigate('planner');
      useGraphStore.getState().requestCenter(`visual:${target.artifactId}`);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir este exemplo.'); }
  };

  return <section className="demo-examples" aria-label={english ? 'Interactive examples' : 'Exemplos interativos'}>
    {robot && <div className="demo-project-entry"><strong>{english ? 'A project in use' : 'Um projeto em uso'}</strong><p>{english ? 'Open the robot project to investigate its servos, load assumptions and control with editable artifacts on the plan canvas.' : 'Abra o projeto do robô para investigar servos, premissas de carga e controle com artefatos editáveis no canvas do plano.'}</p><button type="button" className="ws-button primary" onClick={() => openExamplePlan(robot)}>{english ? 'Open robot project · 3D & diagrams' : 'Abrir projeto do robô · 3D e diagramas'} <span aria-hidden="true">↗</span></button></div>}
    {error && <p className="demo-example-error" role="alert">{error}</p>}
    <div className="demo-examples-heading"><h2>{english ? 'Explore an example' : 'Explore um exemplo'}</h2><p>{english ? 'Fictional scenarios. Changes disappear when you reload.' : 'Cenários fictícios. As alterações desaparecem ao recarregar.'}</p></div>
    <div className="demo-examples-actions">{examples.map(item => <button type="button" key={`${item.projectId}:${item.artifactId}`}
      aria-label={`${english ? 'Explore' : 'Explorar'} ${item.artifact.kind === 'model' ? '3D' : (english ? 'diagram' : 'diagrama')}: ${item.artifact.label}`}
      onClick={() => openExamplePlan(item)}><span>{item.artifact.label.split(' · ')[0]}</span><small>{item.projectName} · {item.artifact.kind === 'model' ? '3D' : (english ? 'Diagram' : 'Diagrama')} ↗</small></button>)}</div>
  </section>;
}
