import { beforeEach, expect, it } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { applyVisualProposal, currentVisualScope, getVisualWorkspace, resolveVisualContext, setDiagramParameter, setVisualArtifactLink, storeVisualProposal, updateVisualArtifact } from '../domain';
import { clearMissingVisualNodeLinks, normalizeVisualWorkspace } from '../normalize';
import { copyArtifactSnapshot, parseArtifactClipboard, pasteArtifactSnapshot } from '../artifactClipboard';
import { exportVisualPlan, prepareVisualPlanImport } from '../portable';
import { torqueDiagram } from './fixture';
import type { VisualDiagramProposal } from '../types';
import { readFileSync } from 'node:fs';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'diagram-test' }, selectedNodeId: null }); initializeWorkspace();
});
function proposal(): VisualDiagramProposal {
  const project = useGraphStore.getState().project!;
  const input = { text: 'Mostrar torque com parâmetros sintéticos', mentions: [], attachments: [], artifactKind: 'diagram' as const };
  return { id: 'diagram-proposal', projectId: project.id, label: 'Torque', kind: 'diagram', scene: null, diagram: torqueDiagram(project.rootId, project.rootId), input, contextFingerprint: resolveVisualContext(input).fingerprint, createdAt: 1, status: 'ready' };
}
it('applies a free diagram through the existing proposal cycle, preserving drag, resize, optional links, clipboard and portable data', async () => {
  const p = proposal(); storeVisualProposal(p, currentVisualScope()); const artifact = applyVisualProposal(p.id);
  expect(artifact).toMatchObject({ kind: 'diagram', scene: null, diagram: p.diagram });
  updateVisualArtifact(artifact.id, { x: 150, y: 220, width: 580, height: 340 }); setVisualArtifactLink(artifact.id, null);
  setDiagramParameter(artifact.id, 'mass', .7);
  expect(normalizeVisualWorkspace(JSON.parse(JSON.stringify(getVisualWorkspace(useGraphStore.getState().project)))).artifacts[0]).toMatchObject({ x: 150, y: 220, width: 580, height: 340, linkedNodeId: null });
  const snapshot = parseArtifactClipboard(copyArtifactSnapshot(artifact.id))!; const pasted = await pasteArtifactSnapshot(snapshot);
  expect(pasted.id).not.toBe(artifact.id); expect(pasted.diagram).toEqual(p.diagram); expect(pasted.x).not.toBe(150);
  expect(pasted.diagramValues).toEqual({ mass: .7 }); setDiagramParameter(pasted.id, 'mass', .3);
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0].diagramValues).toEqual({ mass: .7 });
  const portable = await exportVisualPlan(useGraphStore.getState().project!);
  const imported = await prepareVisualPlanImport(JSON.parse(JSON.stringify(portable)));
  expect(imported.visuals?.artifacts.map(a => a.diagram)).toEqual([p.diagram, p.diagram]);
  expect(imported.visuals?.artifacts.map(a => a.diagramValues)).toEqual([{ mass: .7 }, { mass: .3 }]);
});
it('releases missing element links on hydration and in revisions without removing the diagram or changing layout', () => {
  const p = proposal(); storeVisualProposal(p, currentVisualScope()); applyVisualProposal(p.id);
  const workspace = getVisualWorkspace(useGraphStore.getState().project);
  const repaired = clearMissingVisualNodeLinks(workspace, {});
  expect(repaired.artifacts[0]).toMatchObject({ x: workspace.artifacts[0].x, y: workspace.artifacts[0].y, kind: 'diagram' });
  expect(repaired.artifacts[0].diagram!.elements.every(e => !e.nodeId)).toBe(true);
  expect(repaired.artifacts[0].revisions[0].diagram!.elements.every(e => !e.nodeId)).toBe(true);
  expect(clearMissingVisualNodeLinks(repaired, {})).toBe(repaired);
});
it('blocks obsolete context and fabricated node references without inserting an artifact', () => {
  const p = proposal(); storeVisualProposal(p, currentVisualScope());
  useGraphStore.setState(state => ({ project: { ...state.project!, objective: 'Novo requisito' } }));
  expect(() => applyVisualProposal(p.id)).toThrow('visualProposalStale');
  const invalid = proposal(); invalid.id = 'invalid-node'; invalid.diagram.elements[0].nodeId = 'missing'; storeVisualProposal(invalid, currentVisualScope());
  expect(() => applyVisualProposal(invalid.id)).toThrow('diagramUnknownNode');
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toEqual([]);
});
it('rejects imports with mixed revision kinds or parameter state outside the documented range', () => {
  const p = proposal(); storeVisualProposal(p, currentVisualScope()); applyVisualProposal(p.id);
  const raw = JSON.parse(JSON.stringify(getVisualWorkspace(useGraphStore.getState().project)));
  raw.artifacts[0].diagramValues = { mass: -1 };
  expect(() => normalizeVisualWorkspace(raw)).toThrow();
  raw.artifacts[0].diagramValues = {};
  delete raw.artifacts[0].revisions[0].diagram;
  expect(() => normalizeVisualWorkspace(raw)).toThrow();
});
it('imports the offline QA sample through the production portable boundary with real node IDs', async () => {
  const raw = readFileSync('docs/design/interactive-artifacts/production-torque-example.json', 'utf8');
  const imported = await prepareVisualPlanImport(raw);
  expect(imported.id).toBe('qa-diagram-torque-20261010');
  expect(imported.visuals!.artifacts[0].diagram!.elements.filter(e => e.nodeId).map(e => e.nodeId)).toEqual(['S_ervo-QA', '-Test-QA']);
  expect(imported.nodes['S_ervo-QA'].position.x).toBe(320);
  expect(imported.visuals!.artifacts[0].x).toBeGreaterThan(imported.nodes['S_ervo-QA'].position.x + 240 + 60);
  expect(Object.values(imported.nodes).every(n => !n.confirmado && n.state === 'concept')).toBe(true);
});
