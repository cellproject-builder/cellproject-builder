import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceBackup, restoreWorkspaceBackup } from '@/data/workspaceTransfer';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { capturePlanner, openPlanner } from '@/workspace/planner';
import { DEFAULT_NODE_DIMENSIONS } from '@/graph/autoLayout';
import { evaluateDiagram, parseDiagram, resolveDiagramElements } from '@/visuals/diagram/model';
import { setDiagramParameter, updateVisualArtifact } from '@/visuals/domain';
import { normalizeVisualWorkspace } from '@/visuals/normalize';
import { useGraphStore } from '@/store';
import { seedPublicDemo } from './seed';

beforeEach(async () => {
  await flushWorkspacePersistence();
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({
    projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {},
    activeProjectId: null, activeBoardId: null, surface: 'projects', legacyImported: true,
  });
});

describe('public demonstration content', () => {
  it('opens a rich fictional catalogue with useful content and valid domain links', async () => {
    await seedPublicDemo();
    const state = useWorkspaceStore.getState();
    const projects = Object.values(state.projects);
    const tasks = Object.values(state.tasks);
    const notes = Object.values(state.notes);
    expect(projects).toHaveLength(6);
    expect(tasks).toHaveLength(72);
    expect(notes.length).toBeGreaterThanOrEqual(30);
    expect(state).toMatchObject({ activeProjectId: null, surface: 'projects' });
    expect(projects.map(project => project.name)).toEqual(expect.arrayContaining([
      '(Demo) Robô de dois braços', '(Demo) Horta automatizada', '(Demo) Oficina de invenções',
    ]));
    expect(new Set(tasks.map(task => task.status))).toEqual(new Set(['todo', 'doing', 'review', 'done']));
    expect(new Set(Object.values(state.sprints).map(sprint => sprint.status))).toEqual(new Set(['planned', 'active', 'completed']));
    for (const project of projects) {
      const plan = project.planner?.project;
      expect(plan).toBeDefined();
      const nodes = Object.values(plan!.nodes);
      expect(nodes.length).toBeGreaterThanOrEqual(10);
      expect(nodes.find(node => node.id === plan!.rootId)?.parentId).toBeNull();
      for (const node of nodes) {
        if (node.parentId) expect(plan!.nodes[node.parentId]).toBeDefined();
        expect(node.oQue.trim().length).toBeGreaterThan(25);
        expect(node.porQue.trim().length).toBeGreaterThan(25);
        expect(node.comoConfirmar.trim().length).toBeGreaterThan(25);
        expect(node.notes).toMatch(/fictíci|demonstração/i);
        expect(node.confirmado).toBe(false);
        expect(Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).toBe(true);
      }
      nodes.forEach((node, index) => nodes.slice(index + 1).forEach(other => {
        expect(Math.abs(node.position.x - other.position.x) >= 300 || Math.abs(node.position.y - other.position.y) >= 280).toBe(true);
      }));
      expect(tasks.filter(task => task.projectId === project.id)).toHaveLength(12);
      expect(Object.values(state.sprints).filter(sprint => sprint.projectId === project.id && sprint.status === 'active')).toHaveLength(1);
    }
    for (const task of tasks) {
      const project = state.projects[task.projectId];
      expect(project).toBeDefined();
      expect(task.description.length).toBeGreaterThan(100);
      expect(task.description).toMatch(/[Aa]ceite/);
      if (task.sourceNodeId) expect(project.planner!.project!.nodes[task.sourceNodeId]).toBeDefined();
      if (task.sprintId) {
        expect(state.sprints[task.sprintId].projectId).toBe(task.projectId);
        if (state.sprints[task.sprintId].status === 'completed') expect(task.status).toBe('done');
      }
    }
    for (const note of notes) {
      expect(note.title.trim().length).toBeGreaterThan(10);
      expect(note.blocks.length).toBeGreaterThanOrEqual(4);
      expect(note.blocks.map(block => block.text).join(' ').length).toBeGreaterThan(150);
      if (note.projectId) expect(state.projects[note.projectId]).toBeDefined();
      if (note.taskId) expect(state.tasks[note.taskId].projectId).toBe(note.projectId);
      if (note.folderId) expect(state.folders[note.folderId]).toBeDefined();
    }
    const blockIds = notes.flatMap(note => note.blocks.map(block => block.id));
    expect(new Set(blockIds).size).toBe(blockIds.length);
    expect(Object.values(state.comments).length).toBeGreaterThanOrEqual(60);
    for (const comment of Object.values(state.comments)) expect(state.tasks[comment.taskId].projectId).toBe(comment.projectId);
    const robot = projects.find(project => project.name === '(Demo) Robô de dois braços')!;
    const robotText = notes.filter(note => note.projectId === robot.id).flatMap(note => note.blocks.map(block => block.text)).join(' ');
    expect(robotText).toMatch(/premissa/i);
    expect(robotText).toMatch(/critério/i);
    expect(robotText).toMatch(/ensaio fictício/i);
    expect(robotText).toMatch(/revisão/i);
    expect(robotText).toMatch(/nenhum.*físic|não.*físic/i);
    const backup = createWorkspaceBackup(state, 1);
    expect(restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup.data);
  });

  it('does not duplicate examples or overwrite edits when StrictMode starts it twice', async () => {
    await Promise.all([seedPublicDemo(), seedPublicDemo()]);
    const state = useWorkspaceStore.getState();
    expect(Object.keys(state.projects)).toHaveLength(6);
    expect(Object.keys(state.tasks)).toHaveLength(72);
    const project = Object.values(state.projects).find(item => item.name === '(Demo) Robô de dois braços')!;
    const note = Object.values(state.notes).find(item => item.projectId === project.id)!;
    state.updateProject(project.id, { name: 'Minha versão de apresentação' });
    state.updateNote(note.id, { blocks: [{ id: 'visitor-edit', type: 'text', text: 'Uma ideia que escrevi durante a demonstração.' }] });
    const before = createWorkspaceBackup(useWorkspaceStore.getState(), 1).data;
    await seedPublicDemo();
    expect(createWorkspaceBackup(useWorkspaceStore.getState(), 1).data).toEqual(before);
  });

  it('includes three local interactive SVG examples with valid plan links and meaningful calculations', async () => {
    await seedPublicDemo();
    const projects = Object.values(useWorkspaceStore.getState().projects);
    const examples = [
      { name: '(Demo) Robô de dois braços', output: 'torque', parameter: 'mass', next: .4, before: .1962, after: .3924 },
      { name: '(Demo) Horta automatizada', output: 'volume', parameter: 'flow', next: 2, before: 5, after: 10 },
      { name: '(Demo) Oficina de invenções', output: 'total', parameter: 'revision', next: 15, before: 30, after: 35 },
    ];
    expect(projects.flatMap(project => project.planner?.project?.visuals?.artifacts ?? []).filter(artifact => artifact.kind === 'diagram')).toHaveLength(3);
    for (const example of examples) {
      const planner = projects.find(project => project.name === example.name)!.planner!;
      const project = planner.project!;
      expect(planner).toMatchObject({ lens: 'structure', viewMode: 'graph', selectedNodeId: project.rootId });
      expect(project.manualLayout).toBe(true);
      const visuals = normalizeVisualWorkspace(project.visuals);
      expect(visuals.artifacts.filter(artifact => artifact.kind === 'diagram')).toHaveLength(1);
      expect(visuals.proposals).toEqual([]);
      const artifact = visuals.artifacts.find(artifact => artifact.kind === 'diagram')!;
      expect(artifact).toMatchObject({ kind: 'diagram', scene: null, mediaId: null, source: null, revisionIndex: 0 });
      expect(project.nodes[artifact.linkedNodeId!]).toBeDefined();
      const diagram = parseDiagram(artifact.diagram, Object.keys(project.nodes));
      expect(`${diagram.title} ${diagram.explanation} ${diagram.assumptions.join(' ')}`).toMatch(/fictíci|sintétic/i);
      expect(diagram.elements.filter(element => element.nodeId).length).toBeGreaterThanOrEqual(2);
      expect(artifact.revisions[0]).toMatchObject({ scene: null, mediaId: null, diagram, diagramValues: {} });
      expect(evaluateDiagram(diagram, {})[example.output]).toBeCloseTo(example.before);
      expect(evaluateDiagram(diagram, { [example.parameter]: example.next })[example.output]).toBeCloseTo(example.after);
      expect(resolveDiagramElements(diagram, { [example.parameter]: example.next })).not.toEqual(resolveDiagramElements(diagram, {}));
      for (const parameter of diagram.parameters) {
        expect(evaluateDiagram(diagram, { [parameter.id]: parameter.max })[example.output]).not.toBe(evaluateDiagram(diagram, { [parameter.id]: parameter.min })[example.output]);
      }
      const positions = Object.values(project.nodes).map(node => node.position);
      // Canvas resize can frame only concepts. Keep the example inside their bounds and in its own reserved band.
      expect(artifact.x).toBeGreaterThanOrEqual(Math.min(...positions.map(position => position.x)));
      expect(artifact.y).toBeGreaterThanOrEqual(Math.min(...positions.map(position => position.y)));
      expect(artifact.x + artifact.width).toBeLessThanOrEqual(Math.max(...positions.map(position => position.x + DEFAULT_NODE_DIMENSIONS.width)));
      expect(artifact.y + artifact.height).toBeLessThanOrEqual(Math.max(...positions.map(position => position.y + DEFAULT_NODE_DIMENSIONS.height)));
      for (const position of positions) {
        expect(artifact.x + artifact.width <= position.x || artifact.x >= position.x + DEFAULT_NODE_DIMENSIONS.width
          || artifact.y + artifact.height <= position.y || artifact.y >= position.y + DEFAULT_NODE_DIMENSIONS.height).toBe(true);
      }
    }
    const backup = createWorkspaceBackup(useWorkspaceStore.getState(), 1);
    expect(restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup.data);
  });

  it('preserves visitor slider changes and positions when the demonstration is seeded again', async () => {
    await seedPublicDemo();
    const state = useWorkspaceStore.getState();
    const project = Object.values(state.projects).find(item => item.name === '(Demo) Robô de dois braços')!;
    expect(project.planner!.project!.visuals?.artifacts.filter(artifact => artifact.kind === 'diagram')).toHaveLength(1);
    openPlanner(project.id);
    const artifact = useGraphStore.getState().project!.visuals!.artifacts[0];
    setDiagramParameter(artifact.id, 'mass', .65);
    updateVisualArtifact(artifact.id, { x: artifact.x - 100, y: artifact.y - 80 });
    state.savePlanner(project.id, capturePlanner());
    const before = createWorkspaceBackup(useWorkspaceStore.getState(), 1).data;
    await Promise.all([seedPublicDemo(), seedPublicDemo()]);
    expect(createWorkspaceBackup(useWorkspaceStore.getState(), 1).data).toEqual(before);
    expect(useWorkspaceStore.getState().projects[project.id].planner!.project!.visuals!.artifacts[0].diagramValues).toEqual({ mass: .65 });
  });

  it('stores two local 3D models beside their diagrams with complete revisions and valid project links', async () => {
    await seedPublicDemo();
    const projects = Object.values(useWorkspaceStore.getState().projects);
    const models = projects.flatMap(managed => {
      const project = managed.planner?.project;
      return project ? (project.visuals?.artifacts ?? []).filter(artifact => artifact.kind === 'model').map(artifact => ({ project, artifact })) : [];
    });
    expect(models).toHaveLength(2);
    for (const { project, artifact } of models) {
      expect(project.nodes[artifact.linkedNodeId!]).toBeDefined();
      expect(artifact.mediaId).toBeNull();
      expect(artifact.source).toBeNull();
      expect(artifact.scene!.objects.some(object => object.type === 'custom')).toBe(true);
      expect(artifact.revisions[artifact.revisionIndex].scene).toEqual(artifact.scene);
      for (const other of project.visuals!.artifacts.filter(other => other.id !== artifact.id)) {
        expect(artifact.x + artifact.width <= other.x || artifact.x >= other.x + other.width
          || artifact.y + artifact.height <= other.y || artifact.y >= other.y + other.height).toBe(true);
      }
    }
    const backup = createWorkspaceBackup(useWorkspaceStore.getState(), 1);
    expect(restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup.data);
  });
});
