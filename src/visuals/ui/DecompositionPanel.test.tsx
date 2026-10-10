import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { mutateVisualWorkspace } from '../domain';
import type { DecompositionAssembly, ObjectDecomposition, SceneV1, VisualArtifact } from '../types';
import type { DecompositionAssemblyProposal } from '../decomposition';
import { useVisualViewStore } from '../rendering/viewStore';
import { DecompositionPanel } from './DecompositionPanel';
import { useVisualPopupStore } from './uiStore';
import { modelSceneFingerprint } from '../modelAssembly';
import type { VisualModelAssembly } from '../types';

const mocks = vi.hoisted(() => ({ research: vi.fn(), generate: vi.fn(), apply: vi.fn(), txt: vi.fn(), current: true, assemblyCurrent: true }));
vi.mock('../decomposition', () => ({
  researchArtifactDecomposition: mocks.research, generateDecompositionAssembly: mocks.generate,
  applyDecompositionAssembly: mocks.apply, decompositionTxt: mocks.txt, decompositionIsCurrent: () => mocks.current,
  decompositionAssemblyCurrent: (a: VisualArtifact) => mocks.assemblyCurrent && !!a.decomposition?.assembly,
}));
const scene: SceneV1 = { version: 1, label: 'Arduino Uno R3', objects: [{ id: 'pcb', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [3, .1, 2], color: '#117788' }] };
const artifact: VisualArtifact = { id: 'uno-model', label: 'Arduino Uno R3', kind: 'model', x: 5, y: 10, width: 360, height: 280, scene, mediaId: null, source: null, revisions: [{ scene, mediaId: null, createdAt: 1 }], revisionIndex: 0 };
const dossier: ObjectDecomposition = {
  version: 1, id: 'dossier', artifactFingerprint: 'fingerprint', identity: 'Arduino Uno R3', sourceImageIds: [], researchedAt: 1,
  sources: [{ id: 'official', title: 'Arduino Uno Rev3 schematic', url: 'https://docs.arduino.cc/uno', text: 'ATmega328P microcontroller', retrievedAt: 1 }],
  parts: [{ id: 'mcu', name: 'Microcontrolador', partNumber: 'ATmega328P', quantity: 1, role: 'Executa o programa', specifications: ['5 V'], evidence: [{ sourceId: 'official', quote: 'ATmega328P microcontroller' }], unknowns: ['Encapsulamento depende da variante'] }],
  unknowns: ['Valores dos resistores ainda não documentados'],
};
const assembly: DecompositionAssembly = { scene, groups: [{ partId: 'mcu', objectIds: ['pcb'], explodeOffset: [0, 2, 0] }], createdAt: 2, dossierId: 'dossier', selectedPartIds: ['mcu'] };
const proposal: DecompositionAssemblyProposal = { assembly, dossier, baseDossierFingerprint: 'base-research' };
let host: HTMLDivElement, root: Root;
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function setArtifact(value: VisualArtifact) { await act(async () => { mutateVisualWorkspace(w => ({ ...w, artifacts: [value] })); }); }
async function render() { await renderInspector(); }
async function renderInspector() {
  function Inspector() {
    const id = useVisualPopupStore(state => state.inspectedArtifactId) ?? artifact.id;
    return <DecompositionPanel key={id} artifactId={id} />;
  }
  await act(async () => root.render(<Inspector />));
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate(), useLocaleStore.persist.rehydrate()]);
  useLocaleStore.setState({ locale: 'en' });
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'plan-decomposition' }, selectedNodeId: null }); initializeWorkspace();
  mutateVisualWorkspace(w => ({ ...w, mode: 'approval', artifacts: [{ ...artifact }] }));
  useVisualViewStore.setState({ angles: {}, pitches: {}, explosions: {}, selectedParts: {} });
  useVisualPopupStore.setState({ searchOpen: false, modelOpen: true, modelBase: null, inspectedArtifactId: null });
  vi.clearAllMocks(); mocks.current = true; mocks.assemblyCurrent = true;
  mocks.research.mockImplementation(async () => { mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => ({ ...a, decomposition: dossier })) })); return dossier; });
  mocks.generate.mockImplementation(async () => ({ ...proposal, dossier: useGraphStore.getState().project!.visuals!.artifacts[0].decomposition! }));
  mocks.apply.mockImplementation((_id: string, next: DecompositionAssemblyProposal) => {
    const child = { ...artifact, id: 'uno-components', sourceArtifactId: artifact.id, scene: next.assembly.scene, decomposition: { ...next.dossier, assembly: next.assembly } } as VisualArtifact;
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts.filter(a => a.id !== child.id).map(a => a.id === artifact.id ? { ...a, decomposition: { ...next.dossier, assembly: next.assembly } } : a), child] }));
    return child;
  });
  mocks.txt.mockReturnValue('Arduino Uno R3\nATmega328P\nhttps://docs.arduino.cc/uno');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:decomposition');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('evidence grounded component inspector', () => {
  it('inspects an advanced assembly in the existing panel and switches to documentary research without duplicating it', async () => {
    const modularScene: SceneV1 = { ...scene, objects: [...scene.objects, { ...scene.objects[0], id: 'support', position: [0, -1, 0] }] };
    const modules = modularScene.objects.map((object, i) => ({ id: `module-${i}`, name: i ? 'Support' : 'Board', prompt: `Specific prompt for ${object.id}`, nodeIds: [], sourceIds: [], center: object.position, size: [5, 5, 5] as [number, number, number], primitiveBudget: 16 }));
    const modular: VisualModelAssembly = { version: 1, sceneFingerprint: modelSceneFingerprint(modularScene), summary: 'Separate modules with shared scale.',
      plan: { units: 'illustrative', sharedConstraints: ['One common scale'], unknowns: ['No measured fit'], modules, interfaces: [] },
      groups: modules.map((module, i) => ({ partId: module.id, name: module.name, objectIds: [modularScene.objects[i].id] })), selectedNodeIds: [], selectedImageIds: [], sources: [], unknowns: ['No measured fit'] };
    await setArtifact({ ...artifact, scene: modularScene, assembly: modular }); await renderInspector();
    expect(host.querySelector('[aria-label="Modular assembly"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Product and variant"]')).toBeNull();
    const before = JSON.stringify(useGraphStore.getState().project!.visuals);
    await click('Exploded'); expect(useVisualViewStore.getState().explosions[artifact.id]).toBe(1);
    await click('Inspect part: Support'); expect(useVisualViewStore.getState().selectedParts[artifact.id]).toBe('module-1');
    await click('Assembled'); expect(useVisualViewStore.getState().explosions[artifact.id]).toBe(0);
    expect(JSON.stringify(useGraphStore.getState().project!.visuals)).toBe(before);
    expect(host.textContent).toContain('Specific prompt for pcb'); expect(host.textContent).toContain('No measured fit');
    await click('Research real components');
    expect(host.querySelector('[aria-label="Product and variant"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Modular assembly"]')).toBeNull();
    await click('Back to modular assembly'); expect(host.querySelector('[aria-label="Modular assembly"]')).not.toBeNull();
    expect(mocks.research).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('keeps unclassified geometry visible as context and adjusts separation without regenerating or editing the plan', async () => {
    const partScene = { ...scene, objects: [{ ...scene.objects[0], id: 'chip', scale: [.4, .2, .4] as [number, number, number] }] };
    const partial = { ...assembly, scene: partScene, groups: [{ partId: 'mcu', objectIds: ['chip'], explodeOffset: [1, 2, 0] as [number, number, number] }] };
    const child = { ...artifact, id: 'uno-components', sourceArtifactId: artifact.id, scene: partScene, decomposition: { ...dossier, assembly: partial } } as VisualArtifact;
    await act(async () => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: [{ ...artifact, decomposition: { ...dossier, assembly: partial } }, child] }));
      useVisualPopupStore.setState({ inspectedArtifactId: child.id });
    });
    await renderInspector();
    expect(host.textContent).toContain('1 original shape kept as context');
    expect(host.textContent).toContain('The researched list may be incomplete');
    const before = JSON.stringify(useGraphStore.getState().project!.visuals);
    const range = host.querySelector<HTMLInputElement>('input[aria-label="Separation distance"]')!;
    expect(range).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '35');
      range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useVisualViewStore.getState().explosions[child.id]).toBe(.35);
    expect(host.querySelector('output')?.textContent).toBe('35%');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(useGraphStore.getState().project!.visuals)).toBe(before);
    await click('Assembled'); expect(range.value).toBe('0');
  });
  it('opens the applied linked decomposition and keeps assembly controls scoped to the child', async () => {
    const child = { ...artifact, id: 'uno-components', sourceArtifactId: artifact.id, decomposition: { ...dossier, assembly } } as VisualArtifact;
    mocks.apply.mockImplementation(() => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: [{ ...artifact, decomposition: { ...dossier, assembly } }, child] }));
      return child;
    });
    await setArtifact({ ...artifact, decomposition: dossier }); await renderInspector();
    await click('Generate selected components'); await click('Create linked decomposition');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('uno-components');
    expect(host.querySelector('input[aria-label="Product and variant"]')).toBeNull();
    expect(button('Generate selected components')).toBeUndefined();
    await click('Exploded');
    expect(useVisualViewStore.getState().explosions['uno-components']).toBe(1);
    expect(useVisualViewStore.getState().explosions['uno-model']).toBeUndefined();
    await click('Inspect part: Microcontrolador');
    expect(useVisualViewStore.getState().selectedParts['uno-components']).toBe('mcu');
    await click('Back to original');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('uno-model');
    expect(button('Exploded')).toBeUndefined();
    expect(button('Open decomposition')).not.toBeUndefined();
    await click('Open decomposition');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('uno-components');
  });

  it('automatically opens a new linked object instead of applying assembly controls to the original', async () => {
    const child = { ...artifact, id: 'uno-components-auto', sourceArtifactId: artifact.id, decomposition: { ...dossier, assembly } } as VisualArtifact;
    mocks.apply.mockImplementation(() => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: [{ ...artifact, decomposition: { ...dossier, assembly } }, child] }));
      return child;
    });
    await setArtifact({ ...artifact, decomposition: dossier });
    mutateVisualWorkspace(w => ({ ...w, mode: 'automatic' })); await renderInspector();
    await click('Generate selected components');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('uno-components-auto');
    expect(host.querySelector('.visual-decomposition-view')).not.toBeNull();
    expect(button('Research specifications')).toBeUndefined();
    expect(useGraphStore.getState().project!.visuals!.artifacts).toHaveLength(2);
  });

  it('shows the retained geometry basis on the child while withholding recursive decomposition', async () => {
    const child = { ...artifact, id: 'uno-components', sourceArtifactId: artifact.id, decomposition: { ...dossier, assembly: { ...assembly, geometryBasis: 'source', reusedObjectIds: ['pcb'] } } } as VisualArtifact;
    await act(async () => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: [{ ...artifact, decomposition: dossier }, child] }));
      root.render(<DecompositionPanel artifactId={child.id} />);
    });
    expect(host.querySelector('[data-geometry-basis="source"]')?.textContent).toContain('preserved');
    expect(host.querySelector('input[data-part-choice]')).toBeNull();
    expect(button('Research specifications')).toBeUndefined();
    expect(button('Generate selected components')).toBeUndefined();
  });

  it('requires explicit product identity confirmation before searching and displays sources with each part', async () => {
    await render();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Product and variant"]')!.value).toBe('Arduino Uno R3');
    expect(button('Research specifications').disabled).toBe(true);
    expect(mocks.research).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Research specifications');
    expect(mocks.research).toHaveBeenCalledWith('uno-model', 'Arduino Uno R3', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(host.textContent).toContain('ATmega328P');
    expect(host.textContent).toContain('ATmega328P microcontroller');
    expect(host.textContent).toContain('Valores dos resistores ainda não documentados');
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://docs.arduino.cc/uno"]')?.rel).toContain('noopener');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('keeps generated geometry pending until applied and then controls the linked canvas model', async () => {
    await setArtifact({ ...artifact, decomposition: dossier }); await render();
    await click('Generate selected components');
    expect(mocks.generate).toHaveBeenCalledWith('uno-model', ['mcu'], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Ready to review');
    await click('Create linked decomposition');
    expect(mocks.apply).toHaveBeenCalledWith('uno-model', proposal);
    expect(button('Create linked decomposition')).toBeUndefined();
    await click('Exploded');
    expect(useVisualViewStore.getState().explosions['uno-components']).toBe(1);
    await click('Assembled');
    expect(useVisualViewStore.getState().explosions['uno-components']).toBe(0);
    await click('Inspect part: Microcontrolador');
    expect(useVisualViewStore.getState().selectedParts['uno-components']).toBe('mcu');
    expect(host.textContent).toContain('didactic');
  });

  it('respects automatic mode while preserving the complete original alongside the linked decomposition', async () => {
    await setArtifact({ ...artifact, decomposition: dossier });
    mutateVisualWorkspace(w => ({ ...w, mode: 'automatic' })); await render();
    await click('Generate selected components');
    expect(mocks.apply).toHaveBeenCalledWith('uno-model', proposal);
    expect(button('Create linked decomposition')).toBeUndefined();
    const current = useGraphStore.getState().project!.visuals!.artifacts;
    expect(current).toHaveLength(2); expect(current[0]).toMatchObject({ id: 'uno-model', x: 5, y: 10, scene });
    expect(current[1]).toMatchObject({ id: 'uno-components', sourceArtifactId: 'uno-model' });
  });

  it('bounds selected parts to eight and requires at least one evidence grounded component', async () => {
    const many = { ...dossier, parts: Array.from({ length: 9 }, (_, i) => ({ ...dossier.parts[0], id: `part-${i}`, name: `Part ${i}` })) };
    await setArtifact({ ...artifact, decomposition: many }); await render();
    const choices = Array.from(host.querySelectorAll<HTMLInputElement>('input[data-part-choice]'));
    expect(choices.filter(input => input.checked)).toHaveLength(8);
    expect(choices[8].disabled).toBe(true);
    await act(async () => choices.filter(input => input.checked).forEach(input => input.click()));
    expect(button('Generate selected components').disabled).toBe(true);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('aborts an in-flight generation after a revision change and ignores its late result', async () => {
    let release!: (value: DecompositionAssemblyProposal) => void;
    mocks.generate.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await setArtifact({ ...artifact, decomposition: dossier }); await render();
    await click('Generate selected components');
    const signal = mocks.generate.mock.calls[0][2].signal as AbortSignal;
    await setArtifact({ ...artifact, revisionIndex: 1, revisions: [...artifact.revisions, { scene, mediaId: null, createdAt: 3 }], decomposition: dossier });
    expect(signal.aborted).toBe(true);
    await act(async () => release(proposal));
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(button('Create linked decomposition')).toBeUndefined();
  });

  it('requires new research for stale evidence and maps research failures without inventing parts', async () => {
    mocks.current = false;
    await setArtifact({ ...artifact, decomposition: dossier }); await render();
    expect(host.textContent).toContain('changed');
    expect(button('Generate selected components').disabled).toBe(true);
    expect(button('Download TXT').disabled).toBe(true);
    mocks.research.mockRejectedValue(new Error('decompositionResearchNoEvidence'));
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Confirm the real product and variant"]')!.click());
    await click('Research specifications');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No component');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('exports the related dossier as one TXT without creating a note or applying geometry', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:component-dossier');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await setArtifact({ ...artifact, decomposition: dossier }); await render(); await click('Download TXT');
    expect(mocks.txt).toHaveBeenCalledWith('uno-model');
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(download).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:component-dossier');
    expect(Object.values(useWorkspaceStore.getState().notes)).toHaveLength(0);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('cancels pending research on unmount and leaves no pending generation state', async () => {
    let release!: (value: ObjectDecomposition) => void;
    mocks.research.mockImplementation(() => new Promise(resolve => { release = resolve; })); await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click('Research specifications');
    const signal = mocks.research.mock.calls[0][2].signal as AbortSignal;
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => release(dossier)); expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('does not expose exploded inspection controls for an assembly from superseded research', async () => {
    mocks.assemblyCurrent = false;
    await setArtifact({ ...artifact, decomposition: { ...dossier, assembly } }); await render();
    expect(button('Exploded')).toBeUndefined();
    expect(button('Inspect part: Microcontrolador')).toBeUndefined();
    expect(button('Generate selected components').disabled).toBe(false);
  });
  it('restores the documented components used in the applied assembly instead of preselecting other parts', async () => {
    const parts = [dossier.parts[0], { ...dossier.parts[0], id: 'usb', name: 'USB connector' }];
    await setArtifact({ ...artifact, decomposition: { ...dossier, parts, assembly: { ...assembly, selectedPartIds: ['usb'], groups: [{ ...assembly.groups[0], partId: 'usb' }] } } });
    await render();
    expect(host.querySelector<HTMLInputElement>('input[data-part-choice="mcu"]')!.checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[data-part-choice="usb"]')!.checked).toBe(true);
  });

  it('shows research and generation progress but ignores progress received after cancellation', async () => {
    let researchProgress!: (message: string) => void;
    mocks.research.mockImplementation(async (_id, _identity, options) => {
      researchProgress = options.onProgress;
      researchProgress('Reading manufacturer documentation…');
      await new Promise<never>(() => {});
    });
    await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Research specifications');
    expect(host.querySelector('.visual-progress')?.textContent).toContain('Reading manufacturer documentation…');
    await click('Cancel');
    await act(async () => researchProgress('Late research progress'));
    expect(host.querySelector('.visual-progress')).toBeNull();
    expect(host.textContent).not.toContain('Late research progress');
    await setArtifact({ ...artifact, decomposition: dossier });
    mocks.generate.mockImplementation(async (_id, _parts, options) => {
      options.onProgress('Researching the selected microcontroller…');
      return await new Promise<never>(() => {});
    });
    await click('Generate selected components');
    expect(host.querySelector('.visual-progress')?.textContent).toContain('Researching the selected microcontroller…');
    await click('Cancel');
    expect(host.querySelector('.visual-progress')).toBeNull();
  });

  it('labels both pending and applied subset geometry as a partial view of the documented parts', async () => {
    const parts = [dossier.parts[0], { ...dossier.parts[0], id: 'usb', name: 'USB connector' }];
    await setArtifact({ ...artifact, decomposition: { ...dossier, parts } }); await render();
    await act(async () => host.querySelector<HTMLInputElement>('input[data-part-choice="usb"]')!.click());
    await click('Generate selected components');
    expect(host.querySelector('.visual-decomposition-pending')?.textContent).toContain('1 of 2 documented parts · partial view');
    expect(host.querySelector('.visual-decomposition-pending')?.textContent).toContain('original model stays visible');
    await click('Create linked decomposition');
    expect(host.querySelector('.visual-decomposition-view')?.textContent).toContain('1 of 2 documented parts · partial view');
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    expect(host.querySelector('.visual-decomposition-view')?.textContent).toContain('1 de 2 peças documentadas · vista parcial');
  });

  it.each(['localhost:8123/A000066/cfmn5-datasheet.html', 'http://127.0.0.1:8123/source.html', 'http://[::1]:8123/source.html'])('uses the public document URL instead of a local PDF metadata title: %s', async title => {
    const url = 'https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf';
    await setArtifact({ ...artifact, decomposition: { ...dossier, sources: [{ ...dossier.sources[0], title, url }] } }); await render();
    const sourceLinks = Array.from(host.querySelectorAll<HTMLAnchorElement>(`a[href="${url}"]`));
    expect(sourceLinks).toHaveLength(2);
    expect(sourceLinks.every(link => link.textContent === 'docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf ↗')).toBe(true);
    expect(host.textContent).not.toContain(title);
    const storedSource = useGraphStore.getState().project!.visuals!.artifacts[0].decomposition!.sources[0];
    expect(storedSource).toMatchObject({ title, url, text: dossier.sources[0].text });
  });

  it('shows compact generation feedback on the action button while the component list is scrolled down', async () => {
    let release!: (value: DecompositionAssemblyProposal) => void;
    mocks.generate.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await setArtifact({ ...artifact, decomposition: dossier }); await render();
    await click('Generate selected components');
    const action = host.querySelector<HTMLButtonElement>('.visual-decomposition-generate')!;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute('aria-busy')).toBe('true');
    expect(action.textContent).toBe('Building documented components…');
    expect(host.querySelectorAll('.visual-progress')).toHaveLength(1);
    await act(async () => release(proposal));
    expect(action.getAttribute('aria-busy')).toBe('false');
    expect(action.textContent).toBe('Generate selected components');
  });

  it('keeps the current dossier and assembly visible until enriched research and geometry are applied together', async () => {
    const enriched = { ...dossier, sources: [...dossier.sources, { ...dossier.sources[0], id: 'usb-source', title: 'USB connector manufacturer' }], parts: [...dossier.parts, { ...dossier.parts[0], id: 'usb', name: 'USB connector' }] };
    mocks.generate.mockResolvedValue({ ...proposal, dossier: enriched });
    await act(async () => mutateVisualWorkspace(w => ({ ...w, artifacts: [{ ...artifact, decomposition: { ...dossier, assembly } }, { ...artifact, id: 'existing-components', sourceArtifactId: artifact.id, decomposition: { ...dossier, assembly } } as VisualArtifact] }))); await render();
    await click('Generate selected components');
    expect(host.querySelector('.visual-decomposition-pending')?.textContent).toContain('1 of 2 documented parts · partial view');
    expect(host.querySelector('.visual-decomposition-view')).not.toBeNull();
    expect(host.querySelectorAll('[data-part-choice]')).toHaveLength(1);
    expect(host.querySelector('.visual-decomposition-sources')?.textContent).not.toContain('USB connector manufacturer');
    expect(useGraphStore.getState().project!.visuals!.artifacts[0].decomposition?.sources).toHaveLength(1);
    await click('Create linked decomposition');
    expect(host.querySelectorAll('[data-part-choice]')).toHaveLength(0);
    expect(host.querySelector('.visual-decomposition-sources')?.textContent).toContain('USB connector manufacturer');
    expect(host.querySelector('.visual-decomposition-view')?.textContent).toContain('1 of 2 documented parts · partial view');
    await click('Back to original');
    expect(host.querySelectorAll('[data-part-choice]')).toHaveLength(2);
  });

  it.each([
    ['en', 'Names and functions are AI interpretations. Check the cited excerpts before modeling.'],
    ['pt-BR', 'Nomes e funções são interpretações da IA. Confira os trechos antes de modelar.'],
  ])('prioritizes the documented part number and explains interpretation once in %s', async (locale, hint) => {
    await act(async () => useLocaleStore.setState({ locale: locale as 'en' | 'pt-BR' }));
    await setArtifact({ ...artifact, decomposition: dossier }); await render();
    const heading = host.querySelector('.visual-decomposition-part-heading')!;
    expect(heading.querySelector('strong')?.textContent).toBe('ATmega328P');
    expect(heading.querySelector('small')?.textContent).toBe('Microcontrolador');
    expect(heading.querySelector('input')?.getAttribute('aria-label')).toBe('Microcontrolador · ATmega328P');
    expect(Array.from(host.querySelectorAll('p')).filter(element => element.textContent === hint)).toHaveLength(1);
  });
});
