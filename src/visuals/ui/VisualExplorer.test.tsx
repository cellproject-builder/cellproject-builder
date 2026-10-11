import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { VisualExplorer, type VisualExplorerProps } from './VisualExplorer';
import { useVisualPopupStore } from './uiStore';
import type { ImageReference, MentionTarget, VisualProposal, VisualWorkspace } from '../types';
import type { ModelRefinement } from '../refinement';
import { torqueDiagram } from '../diagram/fixture';
import { DiagramLabelsMissingError } from '../diagram/quality';

vi.mock('./DecompositionPanel', () => ({ DecompositionPanel: ({ artifactId }: { artifactId: string }) => <div data-component-inspector={artifactId}>Existing model inspector</div> }));

const target: MentionTarget = { id: 'note-1', kind: 'note', label: 'Measured dimensions', detail: 'Mechanism notes', fingerprint: 'v1' };
const references: ImageReference[] = Array.from({ length: 12 }, (_, i) => ({ id: `image-${i}`, title: `Reference ${i}`, description: 'A measured mechanism', imageUrl: `/images/${i}.png`, sourcePageUrl: `https://example.com/${i}`, credit: null, license: null, width: 200, height: 200 }));
const empty = (): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } });
const refinement = (suggestedPrompt = 'Use the measured geometry'): ModelRefinement => ({ subject: 'Measured motor', interpretation: 'Measured reference', suggestedPrompt, questions: [], assumptions: [], referenceSummary: [], contextFingerprint: 'v1', inputSignature: 'v1' });
let host: HTMLDivElement;
let root: Root;
let props: VisualExplorerProps;
const button = (label: string) => Array.from(host.querySelectorAll('button')).find((el) => {
  const accessibleText = el.cloneNode(true) as HTMLButtonElement;
  accessibleText.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return el.getAttribute('aria-label') === label || accessibleText.textContent?.trim() === label;
})!;
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function type(selector: string, value: string) {
  const el = host.querySelector<HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(selector: string, keyValue: string, extra: KeyboardEventInit = {}) {
  await act(async () => { host.querySelector(selector)!.dispatchEvent(new KeyboardEvent('keydown', { key: keyValue, bubbles: true, ...extra })); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  useVisualPopupStore.setState({ searchOpen: true, modelOpen: true, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { projectId: 'p1', workspace: empty(), listMentions: () => [target], onDraft: vi.fn(), onAttach: vi.fn(async (file) => ({ id: 'a1', name: file.name, mime: file.type, byteLength: file.size, mediaId: 'm1', text: null })), onSearch: vi.fn(async () => references), onGenerate: vi.fn(), onAdd: vi.fn(async () => {}), onApply: vi.fn(), onReject: vi.fn(), onMode: vi.fn(), onMedia: vi.fn(async () => null) };
  await act(async () => { root.render(<VisualExplorer {...props} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('visual popup interaction', () => {
  it('searches a selected @ node without requiring any typed instruction', async () => {
    const node: MentionTarget = { ...target, id: 'power-node', kind: 'node', label: 'Fonte, capacitor e proteção', detail: 'Recurso' };
    props.listMentions = () => [node];
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', '@Fonte');
    await key('[data-visual-popup="search"] textarea', 'Enter');
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="search"] textarea')?.value).toBe('');
    expect(host.querySelector('[data-visual-popup="search"] .visual-chip')?.textContent).toContain(node.label);
    expect(button('Search').disabled).toBe(false);
    expect(props.onSearch).not.toHaveBeenCalled();
    await click('Search');
    expect(props.onSearch).toHaveBeenCalledWith({ text: '', mentions: [node], attachments: [] }, expect.any(AbortSignal));
    expect(host.querySelectorAll('.visual-grid .visual-card').length).toBeGreaterThan(0);
  });
  it('searches an imported document body without requiring typed text', async () => {
    const attachment = { id: 'power-spec', name: 'componentes.md', mime: 'text/markdown', byteLength: 80, mediaId: 'power-media', text: 'Fonte regulada 5 V 5 A e capacitor de 1000 µF.' };
    props.onAttach = vi.fn(async () => attachment);
    await act(async () => root.render(<VisualExplorer {...props} />));
    const picker = host.querySelector<HTMLInputElement>('[data-visual-popup="search"] input[type="file"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File([attachment.text], attachment.name, { type: attachment.mime })] });
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
    expect(button('Search').disabled).toBe(false);
    await click('Search');
    expect(props.onSearch).toHaveBeenCalledWith({ text: '', mentions: [], attachments: [attachment] }, expect.any(AbortSignal));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('keeps search disabled when neither text nor selected sources exist', async () => {
    expect(button('Search').disabled).toBe(true);
    await key('[data-visual-popup="search"] textarea', 'Enter');
    await click('Search');
    expect(props.onSearch).not.toHaveBeenCalled();
  });
  it('reuses references and the existing proposal cycle when switching to a diagram', async () => {
    const selectedNode = { ...target, id: '9_A-b', kind: 'node' as const, label: 'Servo' };
    props.selectedNode = selectedNode;
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: { text: 'Torque e alcance', mentions: [target], attachments: [] } } };
    props.onGenerate = vi.fn(async input => ({ id: 'diagram-ready', projectId: 'p1', label: 'Torque sintético', kind: 'diagram' as const, scene: null, diagram: torqueDiagram(selectedNode.id, selectedNode.id), status: 'ready' as const, input, contextFingerprint: 'v1', createdAt: 1 }));
    await act(async () => root.render(<VisualExplorer {...props}/>));
    await click('Diagram');
    expect(host.querySelector('[data-visual-popup="model"]')?.getAttribute('aria-label')).toBe('Interactive diagram');
    expect(button('Advanced')).toBeUndefined();
    await click('Generate diagram');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ artifactKind: 'diagram', text: 'Torque e alcance', mentions: [target, selectedNode] }), expect.any(AbortSignal));
    expect(host.querySelector('.visual-proposal-text')?.textContent).toContain('elements');
    await click('Apply to canvas'); expect(props.onApply).toHaveBeenCalledWith('diagram-ready');
    await click('3D'); expect(props.onDraft).toHaveBeenLastCalledWith('model', expect.objectContaining({ artifactKind: 'model', mentions: [target, selectedNode] }));
  });
  it.each(['pt-BR', 'en'] as const)('explains missing diagram labels and retains the studio request and context for retry (%s)', async locale => {
    const attachment = { id: 'diagram-spec', name: 'componentes.md', mime: 'text/markdown', byteLength: 80, mediaId: 'diagram-media', text: 'Fonte, controlador e servos.' };
    const input = { text: 'Nomear as peças e conexões', artifactKind: 'diagram' as const, mentions: [target], attachments: [attachment] };
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: input } };
    props.onGenerate = vi.fn().mockRejectedValueOnce(new DiagramLabelsMissingError()).mockResolvedValue({ id: 'diagram-retry', projectId: 'p1', label: 'Peças identificadas', kind: 'diagram', scene: null, diagram: torqueDiagram(), status: 'ready', input, contextFingerprint: 'v1', createdAt: 1 });
    await act(async () => { useLocaleStore.setState({ locale }); root.render(<VisualExplorer {...props} />); });
    const generateLabel = locale === 'en' ? 'Generate diagram' : 'Gerar diagrama';
    await click(generateLabel);
    const panel = host.querySelector('[data-visual-popup="model"]')!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(locale === 'en'
      ? 'The drawing came without visible names or labels. Generate again to get an explanatory diagram.'
      : 'O desenho veio sem nomes ou legendas visíveis. Gere novamente para obter um diagrama explicativo.');
    expect(panel.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(input.text);
    expect(panel.textContent).toContain(target.label); expect(panel.textContent).toContain(attachment.name);
    expect(panel.querySelector('.visual-proposal')).toBeNull(); expect(props.onApply).not.toHaveBeenCalled();
    await click(generateLabel);
    expect(vi.mocked(props.onGenerate).mock.calls.map(([request]) => request)).toEqual([input, input]);
    expect(panel.querySelector('[role="alert"]')).toBeNull(); expect(panel.textContent).toContain('Peças identificadas');
  });
  it('removes an applied proposal from history without invoking artifact removal, rejection or generation', async () => {
    const applied: VisualProposal = { id: 'applied-history', projectId: 'p1', label: 'Applied motor', status: 'applied', scene: { version: 1, label: 'Motor', objects: [] }, input: { text: 'Motor', mentions: [], attachments: [] }, contextFingerprint: 'context-v1', createdAt: 1 };
    props.workspace = { ...empty(), proposals: [applied] }; props.onRemoveHistory = vi.fn();
    await act(async () => root.render(<VisualExplorer {...props}/>));
    await click('Remove from history: Applied motor');
    expect(props.onRemoveHistory).toHaveBeenCalledWith(applied.id);
    expect(host.textContent).not.toContain('Applied motor');
    expect(props.onReject).not.toHaveBeenCalled(); expect(props.onGenerate).not.toHaveBeenCalled(); expect(props.onApply).not.toHaveBeenCalled();
  });
  it('selects advanced modular generation, includes the selected parent and keeps phase progress while minimized', async () => {
    const selectedNode = { ...target, id: 'parent', kind: 'node' as const, label: 'Robot arm' };
    props.selectedNode = selectedNode;
    props.onGenerate = vi.fn(async (_input, _signal, onProgress) => { onProgress?.('Building module 2/4: Servo'); return await new Promise<VisualProposal>(() => {}); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await click('Advanced');
    expect(props.onDraft).toHaveBeenLastCalledWith('model', expect.objectContaining({ generationMode: 'advanced', mentions: [selectedNode] }));
    expect(host.querySelector('[data-visual-popup="model"]')?.textContent).toContain('separate prompts');
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ generationMode: 'advanced', mentions: [selectedNode] }), expect.any(AbortSignal), expect.any(Function));
    await click('Minimize 3D studio');
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Building module 2/4: Servo');
    await click('Restore 3D studio');
    expect(host.querySelector('[data-visual-popup="model"] [role="status"]')?.textContent).toContain('Building module 2/4: Servo');
  });
  it('keeps standard generation explicit and preserves the selected references when switching back', async () => {
    await click('Advanced'); await click('Standard');
    expect(props.onDraft).toHaveBeenLastCalledWith('model', expect.objectContaining({ generationMode: 'standard' }));
    await type('[data-visual-popup="model"] textarea', 'motor'); await click('Generate model');
    expect(vi.mocked(props.onGenerate).mock.calls[0]).toHaveLength(2);
  });
  it.each(['search', 'model'] as const)('keeps %s running while minimized and restores its finished result without resending', async kind => {
    let finish!: (value: any) => void;
    const operation = vi.fn((_input: unknown, _signal: AbortSignal) => new Promise<any>(resolve => { finish = resolve; }));
    if (kind === 'search') props.onSearch = operation; else props.onGenerate = operation;
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type(`[data-visual-popup="${kind}"] textarea`, 'A measured motor');
    await click(kind === 'search' ? 'Search' : 'Generate model');
    const signal = operation.mock.calls[0][1];
    await click(kind === 'search' ? 'Minimize image search' : 'Minimize 3D studio');
    expect(host.querySelector<HTMLElement>(`[data-visual-popup="${kind}"]`)?.hidden).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain(kind === 'search' ? 'Finding references' : 'Building your model');
    await act(async () => finish(kind === 'search' ? references : { id: 'background-model', projectId: 'p1', label: 'Finished motor', status: 'ready', scene: { version: 1, label: 'Motor', objects: [] } }));
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Ready');
    await click(kind === 'search' ? 'Restore image search' : 'Restore 3D studio');
    expect(host.querySelector<HTMLElement>(`[data-visual-popup="${kind}"]`)?.hidden).toBe(false);
    expect(host.querySelector(`[data-visual-popup="${kind}"]`)?.textContent).toContain(kind === 'search' ? 'Reference 0' : 'Finished motor');
    expect(operation).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false);
  });
  it('shows a background failure and cancels only after an explicit cancel or close', async () => {
    let fail!: (reason: Error) => void;
    props.onSearch = vi.fn(() => new Promise<ImageReference[]>((_resolve, reject) => { fail = reject; }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    await click('Minimize image search');
    await act(async () => fail(new Error('Unavailable')));
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Needs attention');
    await click('Restore image search');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click('Search'); const signal = vi.mocked(props.onSearch).mock.calls[1][1];
    await click('Minimize image search'); await click('Restore image search');
    expect(signal.aborted).toBe(false); await click('Close image search'); expect(signal.aborted).toBe(true);
    expect(host.querySelector('[data-visual-minimized]')).toBeNull();
  });
  it('retains the deck position and query while the image panel is minimized', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search'); await click('Deck'); await click('Next');
    const deck = host.querySelector('.visual-deck');
    await click('Minimize image search'); await click('Restore image search');
    expect(host.querySelector('.visual-deck')).toBe(deck);
    expect(deck?.getAttribute('data-active-index')).toBe('1');
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="search"] textarea')?.value).toBe('motor');
  });
  it('keeps a minimized image panel hidden when its shared search result arrives', async () => {
    await click('Minimize image search');
    props.externalSearch = { id: 'background-search', projectId: 'p1', input: { text: 'Arduino', mentions: [], attachments: [] }, results: references };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(host.querySelector<HTMLElement>('[data-visual-popup="search"]')?.hidden).toBe(true);
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Ready');
  });
  it('keeps AI prompt refinement running and reports its status in the minimized studio', async () => {
    let finish!: (result: ModelRefinement) => void;
    props.onRefine = vi.fn(() => new Promise<ModelRefinement>(resolve => { finish = resolve; }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a measured motor');
    const composer = host.querySelector('[data-visual-popup="model"] textarea');
    await click('Refine request with AI');
    expect(host.querySelector('[data-visual-popup="model"] textarea')).toBe(composer);
    expect(button('Generate model').disabled).toBe(true);
    expect(button('Refine request with AI').disabled).toBe(true);
    expect(button('Cancel')).toBeUndefined();
    const signal = vi.mocked(props.onRefine).mock.calls[0][2];
    await click('Minimize 3D studio');
    expect(signal.aborted).toBe(false);
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Refining');
    await act(async () => finish(refinement()));
    expect(host.querySelector('[data-visual-minimized]')?.textContent).toContain('Ready');
    await click('Restore 3D studio');
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe('Use the measured geometry');
    expect(button('Generate model')).toBeDefined();
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(props.onRefine).toHaveBeenCalledOnce();
  });
  it('uses the existing studio for component research and returns to the preserved generation draft', async () => {
    await type('[data-visual-popup="model"] textarea', 'Keep my request');
    await act(async () => useVisualPopupStore.getState().inspectArtifact('uno-model'));
    expect(host.querySelectorAll('[data-visual-popup="model"]')).toHaveLength(1);
    expect(host.querySelector('[data-component-inspector="uno-model"]')).not.toBeNull();
    expect(host.querySelector('[data-visual-popup="model"] textarea')).toBeNull();
    expect(button('Generate model')).toBeUndefined();
    expect(props.onGenerate).not.toHaveBeenCalled();
    await act(async () => useVisualPopupStore.getState().open('model'));
    expect(host.querySelector('[data-component-inspector]')).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe('Keep my request');
  });
  it('clears the inspected artifact when switching to another project', async () => {
    await act(async () => useVisualPopupStore.getState().inspectArtifact('uno-model'));
    await act(async () => root.render(<VisualExplorer {...props} projectId="p2" workspace={empty()} />));
    expect(host.querySelector('[data-component-inspector]')).toBeNull();
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBeNull();
  });
  it('cancels a normal generation when opening the existing-model inspector', async () => {
    props.onGenerate = vi.fn(() => new Promise<never>(() => {}));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'Build a board');
    await click('Generate model');
    const signal = vi.mocked(props.onGenerate).mock.calls[0][1];
    await act(async () => useVisualPopupStore.getState().inspectArtifact('uno-model'));
    expect(signal.aborted).toBe(true);
    expect(host.querySelector('[data-component-inspector="uno-model"]')).not.toBeNull();
  });
  it('offers optional image analysis only in the 3D studio and sends the human choice with the request', async () => {
    const choice = host.querySelector<HTMLInputElement>('[data-visual-popup="model"] input[aria-label="Analyze image pixels with AI"]');
    expect(choice).not.toBeNull();
    expect(choice!.checked).toBe(false);
    expect(host.querySelector('[data-visual-popup="search"] input[aria-label="Analyze image pixels with AI"]')).toBeNull();
    await act(async () => choice!.click());
    await type('[data-visual-popup="model"] textarea', 'Build this board');
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ analyzeImages: true, text: 'Build this board' }), expect.any(AbortSignal));
    expect(props.onDraft).toHaveBeenLastCalledWith('model', expect.objectContaining({ analyzeImages: true }));
  });

  it('restores the saved image-analysis choice and lets the person disable it for a new request', async () => {
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: { text: 'Build a board', mentions: [], attachments: [], analyzeImages: true } } };
    await act(async () => root.render(<VisualExplorer {...props} />));
    const choice = host.querySelector<HTMLInputElement>('[data-visual-popup="model"] input[aria-label="Analyze image pixels with AI"]')!;
    expect(choice.checked).toBe(true);
    await act(async () => choice.click());
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ analyzeImages: false }), expect.any(AbortSignal));
  });

  it('keeps the selected image-analysis mode fixed while generation is running', async () => {
    props.onGenerate = vi.fn(() => new Promise<never>(() => {}));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'Build a board');
    await click('Generate model');
    expect(host.querySelector<HTMLInputElement>('[data-visual-popup="model"] input[aria-label="Analyze image pixels with AI"]')!.disabled).toBe(true);
    await click('Cancel');
    expect(host.querySelector<HTMLInputElement>('[data-visual-popup="model"] input[aria-label="Analyze image pixels with AI"]')!.disabled).toBe(false);
  });

  it('recovers an old image-only draft by keeping the available image and explaining the removed one', async () => {
    const available: MentionTarget = { ...target, kind: 'image', id: 'board', label: 'Arduino Uno R3' };
    const missing: MentionTarget = { ...available, id: 'cable', label: 'USB cable' };
    const workspace = empty();
    workspace.artifacts = [{ id: available.id, kind: 'image', label: available.label, x: 0, y: 0, width: 100, height: 100, mediaId: 'board-media', scene: null, source: null, revisions: [{ scene: null, mediaId: 'board-media', createdAt: 1 }], revisionIndex: 0 }];
    workspace.drafts.model = { text: '', mentions: [missing, available], attachments: [] };
    props.workspace = workspace;
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(button('Remove USB cable')).toBeUndefined();
    expect(button('Remove Arduino Uno R3')).toBeDefined();
    expect(host.querySelector('[data-visual-popup="model"] [role="status"]')?.textContent).toContain('USB cable');
    expect(props.onDraft).toHaveBeenLastCalledWith('model', { text: '', mentions: [available], attachments: [] });
    expect(props.onGenerate).not.toHaveBeenCalled();
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith({ text: '', mentions: [available], attachments: [] }, expect.any(AbortSignal));
  });
  it('does not generate an empty request when its only image reference is no longer available', async () => {
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: { text: '', mentions: [{ ...target, kind: 'image', id: 'removed', label: 'Removed image' }], attachments: [] } } };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(button('Generate model').disabled).toBe(true);
    expect(host.querySelector('[data-visual-popup="model"] [role="status"]')?.textContent).toContain('Removed image');
    expect(props.onGenerate).not.toHaveBeenCalled();
  });
  it('refines the existing composer text in place and leaves generation to an explicit send', async () => {
    const attachment = { id: 'drawing', name: 'motor.txt', mime: 'text/plain', byteLength: 12, mediaId: 'm1', text: '42 mm flange' };
    const original = { text: 'Build the motor from this note', mentions: [target], attachments: [attachment] };
    const result: ModelRefinement = { subject: 'Stepper motor', interpretation: 'A motor with a 42 mm flange; exact model unknown.', suggestedPrompt: 'Model the measured stepper motor, including shaft, front flange and rear connector.', questions: [], assumptions: ['Body length remains illustrative.'], referenceSummary: ['Measured dimensions note'], contextFingerprint: 'context-v1', inputSignature: 'input-v1' };
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: original } };
    props.onRefine = vi.fn(async () => result); props.isRefinementCurrent = vi.fn(() => true);
    await act(async () => root.render(<VisualExplorer {...props} />));
    const composer = host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')!;
    const generate = button('Generate model');
    await click('Refine request with AI');
    expect(props.onRefine).toHaveBeenCalledWith(original, expect.objectContaining({ kind: 'existing' }), expect.any(AbortSignal));
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(props.onSearch).not.toHaveBeenCalled();
    const accepted = { ...original, text: result.suggestedPrompt };
    expect(props.onDraft).toHaveBeenLastCalledWith('model', accepted);
    expect(host.querySelector('[data-visual-popup="model"] textarea')).toBe(composer);
    expect(composer.value).toBe(result.suggestedPrompt);
    expect(button('Generate model')).toBe(generate);
    expect(button('Update request')).toBeUndefined();
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(accepted, expect.any(AbortSignal));
    expect(props.onGenerate).toHaveBeenCalledOnce();
  });
  it.each(['empty', 'whitespace', 'mention', 'attachment'] as const)('does not refine a %s draft without written text', async (kind) => {
    const original = { text: kind === 'whitespace' ? '  \n  ' : '', mentions: kind === 'mention' ? [target] : [], attachments: kind === 'attachment' ? [{ id: 'drawing', name: 'motor.txt', mime: 'text/plain', byteLength: 12, mediaId: 'm1', text: '42 mm flange' }] : [] };
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: original } };
    props.onRefine = vi.fn(async () => refinement());
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(button('Refine request with AI').disabled).toBe(true);
    await click('Refine request with AI');
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe(original.text);
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(props.onRefine).not.toHaveBeenCalled();
  });
  it.each(['close', 'project'] as const)('aborts a pending inline refinement after %s and ignores late output', async (action) => {
    let resolve!: (result: ModelRefinement) => void;
    props.onRefine = vi.fn(() => new Promise<ModelRefinement>((done) => { resolve = done; }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a motor');
    await click('Refine request with AI');
    const signal = vi.mocked(props.onRefine).mock.calls[0][2];
    if (action === 'close') await click('Close 3D studio');
    else await act(async () => root.render(<VisualExplorer {...props} projectId="p2" workspace={empty()} />));
    expect(signal.aborted).toBe(true);
    if (action === 'close') await act(async () => useVisualPopupStore.getState().open('model'));
    await act(async () => resolve(refinement('Discard me')));
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe(action === 'project' ? '' : 'a motor');
    expect(props.onDraft).not.toHaveBeenCalledWith('model', expect.objectContaining({ text: 'Discard me' }));
    expect(props.onGenerate).not.toHaveBeenCalled();
  });
  it('does not overwrite a prompt edited while inline refinement is pending', async () => {
    let resolve!: (result: ModelRefinement) => void;
    props.onRefine = vi.fn(() => new Promise<ModelRefinement>((done) => { resolve = done; }));
    props.isRefinementCurrent = vi.fn(() => true);
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a motor');
    await click('Refine request with AI');
    const signal = vi.mocked(props.onRefine).mock.calls[0][2];
    await type('[data-visual-popup="model"] textarea', 'Keep my newer description');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(refinement('Outdated description')));
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe('Keep my newer description');
    expect(props.onDraft).not.toHaveBeenCalledWith('model', expect.objectContaining({ text: 'Outdated description' }));
    expect(props.onGenerate).not.toHaveBeenCalled();
  });
  it('keeps the prompt intact when its selected reference changes during refinement', async () => {
    let resolve!: (result: ModelRefinement) => void;
    props.onRefine = vi.fn(() => new Promise<ModelRefinement>((done) => { resolve = done; }));
    props.isRefinementCurrent = vi.fn(() => false);
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a measured motor');
    await click('Refine request with AI');
    await act(async () => resolve(refinement('Old dimensions')));
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe('a measured motor');
    expect(props.onDraft).not.toHaveBeenCalledWith('model', expect.objectContaining({ text: 'Old dimensions' }));
    expect(host.querySelector('[data-visual-popup="model"] [role="alert"]')).not.toBeNull();
    expect(props.onGenerate).not.toHaveBeenCalled();
  });
  it('preserves the prompt and direct send when inline refinement fails', async () => {
    props.onRefine = vi.fn(async () => { throw new Error('visualGenerationIncomplete'); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'Build my measured motor');
    const composer = host.querySelector('[data-visual-popup="model"] textarea');
    await click('Refine request with AI');
    expect(host.querySelector('[data-visual-popup="model"] textarea')).toBe(composer);
    expect((composer as HTMLTextAreaElement).value).toBe('Build my measured motor');
    expect(host.querySelector('[data-visual-popup="model"] [role="alert"]')).not.toBeNull();
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(button('Generate model').disabled).toBe(false);
    await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Build my measured motor' }), expect.any(AbortSignal));
  });
  it('preserves direct generation when no refinement callback is configured', async () => {
    expect(button('Refine request with AI')).toBeUndefined();
    await type('[data-visual-popup="model"] textarea', 'a motor'); await click('Generate model');
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ text: 'a motor' }), expect.any(AbortSignal));
  });
  it('hands only the selected studio references to chat, preserves the draft and does not generate', async () => {
    const attachment = { id: 'a1', name: 'measurements.txt', mime: 'text/plain', byteLength: 12, mediaId: 'm1', text: 'private local draft' };
    props.workspace = { ...empty(), drafts: { ...empty().drafts, model: { text: 'Build from these measured parts', mentions: [target], attachments: [attachment] } } };
    props.onDiscuss = vi.fn();
    await act(async () => root.render(<VisualExplorer {...props} />));
    await click('Bring references to chat');
    expect(props.onDiscuss).toHaveBeenCalledWith([target]);
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onDraft).not.toHaveBeenCalled();
    expect(useVisualPopupStore.getState().modelOpen).toBe(false);
    expect(useVisualPopupStore.getState().searchOpen).toBe(false);
    await act(async () => useVisualPopupStore.getState().open('model'));
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="model"] textarea')?.value).toBe('Build from these measured parts');
    expect(host.textContent).toContain('measurements.txt');
    expect(host.textContent).toContain('Measured dimensions');
  });
  it('requires an explicit studio reference before offering a chat handoff and translates the action', async () => {
    props.onDiscuss = vi.fn();
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(button('Bring references to chat').disabled).toBe(true);
    await type('[data-visual-popup="model"] textarea', 'Draft alone is not shared');
    await click('Bring references to chat');
    expect(props.onDiscuss).not.toHaveBeenCalled();
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    expect(button('Levar referências ao chat').disabled).toBe(true);
    expect(host.textContent).toContain('O texto e os anexos ficam neste rascunho.');
  });
  it('shows an accessible unavailable preview message after an image error while preserving its source link', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    const card = host.querySelector('.visual-card')!;
    await act(async () => { card.querySelector('img')!.dispatchEvent(new Event('error')); });
    expect(card.querySelector('[role="status"]')?.textContent).toBe('Preview unavailable');
    expect(card.querySelector('a')?.href).toBe(references[0].sourcePageUrl);
    expect(card.querySelector<HTMLButtonElement>('.visual-card-add')?.disabled).toBe(true);
    expect(props.onAdd).not.toHaveBeenCalled();
  });
  it('copies the chosen image through the explicit image clipboard callback without adding it', async () => {
    props.onCopyImage = vi.fn(async () => {});
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    await click('Copy image: Reference 0');
    expect(props.onCopyImage).toHaveBeenCalledWith(references[0]);
    expect(host.textContent).toContain('Image copied');
    expect(props.onAdd).not.toHaveBeenCalled();
  });
  it('reviews metadata only on explicit click and preserves the deck selection and query', async () => {
    props.onAssess = vi.fn(async () => ({ score: 2.35, confidence: .91 }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    expect(props.onAssess).not.toHaveBeenCalled();
    await click('Deck'); await click('Next');
    await type('[data-visual-popup="search"] textarea', 'edited draft');
    await click('Assess reference: Reference 1');
    expect(props.onAssess).toHaveBeenCalledWith(references[1], expect.objectContaining({ text: 'motor' }), expect.any(AbortSignal));
    expect(host.textContent).toContain('Textual relevance: 2.35/3');
    expect(host.textContent).toContain('Model confidence: 91%');
    expect(host.querySelector('.visual-deck')?.getAttribute('data-active-index')).toBe('1');
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="search"] textarea')!.value).toBe('edited draft');
    expect(props.onAdd).not.toHaveBeenCalled(); expect(props.onGenerate).not.toHaveBeenCalled();
  });
  it('selects side cards through controls outside the inert preview without adding them', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search'); await click('Deck');
    await click('Next reference: Reference 1');
    expect(host.querySelector('.visual-deck')?.getAttribute('data-active-index')).toBe('1');
    await click('Previous reference: Reference 0');
    expect(host.querySelector('.visual-deck')?.getAttribute('data-active-index')).toBe('0');
    expect(props.onAdd).not.toHaveBeenCalled();
  });
  it('uses 60px wheel threshold, 240ms debounce and leaves Meta/Ctrl gestures alone', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search'); await click('Deck');
      const deck = host.querySelector('.visual-deck')!;
      const wheel = async (deltaY: number, extra: WheelEventInit = {}) => act(async () => { deck.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, ...extra })); });
      await wheel(59); expect(deck.getAttribute('data-active-index')).toBe('0');
      await wheel(1); expect(deck.getAttribute('data-active-index')).toBe('1');
      clock.mockReturnValue(1239); await wheel(60); expect(deck.getAttribute('data-active-index')).toBe('1');
      clock.mockReturnValue(1240); await wheel(60); expect(deck.getAttribute('data-active-index')).toBe('2');
      clock.mockReturnValue(2000); await wheel(90, { metaKey: true }); await wheel(90, { ctrlKey: true });
      expect(deck.getAttribute('data-active-index')).toBe('2');
    } finally { clock.mockRestore(); }
  });
  it('keeps both nonmodal tools open and closes only the chosen popup', async () => {
    expect(host.querySelectorAll('[role="dialog"][aria-modal="false"]')).toHaveLength(2);
    await click('Close image search');
    expect(useVisualPopupStore.getState().modelOpen).toBe(true);
    expect(host.querySelector('[data-visual-popup="model"]')).not.toBeNull();
  });
  it('saves independent drafts without searching while typing, and submits on Enter', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor reference');
    await type('[data-visual-popup="model"] textarea', 'make a motor');
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(props.onDraft).toHaveBeenCalledWith('search', expect.objectContaining({ text: 'motor reference' }));
    expect(props.onDraft).toHaveBeenCalledWith('model', expect.objectContaining({ text: 'make a motor' }));
    await key('[data-visual-popup="search"] textarea', 'Enter');
    expect(props.onSearch).toHaveBeenCalledWith(expect.objectContaining({ text: 'motor reference' }), expect.any(AbortSignal));
  });
  it('uses Enter to pick an @ context ID without sending, and ignores IME Enter', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor @meas');
    await key('[data-visual-popup="search"] textarea', 'Enter');
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onDraft).toHaveBeenLastCalledWith('search', expect.objectContaining({ mentions: [target] }));
    await key('[data-visual-popup="search"] textarea', 'Enter', { isComposing: true });
    expect(props.onSearch).not.toHaveBeenCalled();
    await click('Remove Measured dimensions');
    expect(props.onDraft).toHaveBeenLastCalledWith('search', expect.objectContaining({ mentions: [] }));
  });
  it('stores attachments locally until explicit send', async () => {
    const input = host.querySelector<HTMLInputElement>('[data-visual-popup="model"] input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['local text'], 'context.md', { type: 'text/markdown' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(props.onAttach).toHaveBeenCalled();
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('context.md');
  });
  it('shows nine grid references and navigates the deck only after a wheel threshold', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    expect(host.querySelectorAll('.visual-grid .visual-card')).toHaveLength(9);
    await click('Deck');
    const deck = host.querySelector('.visual-deck')!;
    expect(deck.getAttribute('data-active-index')).toBe('0');
    await act(async () => { deck.dispatchEvent(new WheelEvent('wheel', { deltaY: 8, bubbles: true })); });
    expect(deck.getAttribute('data-active-index')).toBe('0');
    await act(async () => { deck.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, bubbles: true })); });
    expect(deck.getAttribute('data-active-index')).toBe('1');
    await key('.visual-deck', 'ArrowRight');
    expect(deck.getAttribute('data-active-index')).toBe('2');
  });
  it('opens the model popup with an existing image selected as context', async () => {
    const image = { ...target, id: 'local-image', kind: 'image' as const, label: 'Local photo' };
    await act(async () => { useVisualPopupStore.getState().useAsBase(image); });
    expect(props.onDraft).toHaveBeenCalledWith('model', expect.objectContaining({ mentions: [image] }));
    expect(host.querySelector('[data-visual-popup="model"]')?.textContent).toContain('Local photo');
  });
  it('cancels pending search and ignores a late response after switching projects', async () => {
    let resolve!: (value: ImageReference[]) => void;
    props.onSearch = vi.fn(() => new Promise<ImageReference[]>((r) => { resolve = r; }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    const signal = vi.mocked(props.onSearch).mock.calls[0][1];
    await act(async () => root.render(<VisualExplorer {...props} projectId="p2" workspace={empty()} />));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(references));
    expect(host.querySelectorAll('.visual-card')).toHaveLength(0);
  });
  it('opens chat search results without making another request', async () => {
    await act(async () => { useVisualPopupStore.getState().close('search'); });
    await act(async () => root.render(<VisualExplorer {...props} externalSearch={{ id: 'chat-search-1', projectId: 'p1', input: { text: 'robot arm', mentions: [], attachments: [] }, results: references }} />));
    expect(host.querySelectorAll('.visual-grid .visual-card')).toHaveLength(9);
    expect(host.querySelector<HTMLTextAreaElement>('[data-visual-popup="search"] textarea')?.value).toBe('robot arm');
    expect(props.onSearch).not.toHaveBeenCalled();
  });
  it('keeps the resolved component and uncertainty visible even when no images are found', async () => {
    const intent = { label: 'motor de passo', query: 'stepper motor component reference image', targetTerms: ['stepper motor'], uncertainty: 'O modelo não foi informado.' };
    const externalSearch = { id: 'resolved-search', projectId: 'p1', input: { text: 'motor de passo daqui', mentions: [], attachments: [] }, results: [], intent };
    await act(async () => root.render(<VisualExplorer {...props} externalSearch={externalSearch} />));
    const context = host.querySelector('.visual-search-intent')!;
    expect(context.textContent).toContain('Searching for: motor de passo');
    expect(context.textContent).toContain(intent.uncertainty);
    expect(context.querySelector('details p')?.textContent).toBe(intent.query);
    expect(host.textContent).toContain('No images found.');
    expect(props.onSearch).not.toHaveBeenCalled();
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    expect(context.textContent).toContain('Buscando: motor de passo');
    expect(context.querySelector('summary')?.textContent).toBe('Ver consulta de busca');
  });
  it('shows separate image queries for each requested object instead of one combined query', async () => {
    const intent = {
      label: 'Arduino Uno e cabo USB', query: 'Arduino Uno board and USB data cable',
      targetTerms: ['Arduino Uno board', 'placa Arduino Uno', 'USB data cable', 'cabo USB de dados'], uncertainty: '',
      targets: [
        { aliases: ['Arduino Uno board', 'placa Arduino Uno'], identifiers: ['Arduino Uno'] },
        { aliases: ['USB data cable', 'cabo USB de dados'], identifiers: [] },
      ],
    };
    props.externalSearch = { id: 'multi-object-search', projectId: 'p1', input: { text: 'Traga a placa e o cabo daqui', mentions: [target], attachments: [] }, results: references, intent };
    await act(async () => { useLocaleStore.setState({ locale: 'pt-BR' }); root.render(<VisualExplorer {...props} />); });
    const details = host.querySelector('.visual-search-intent details')!;
    expect(details.querySelector('summary')?.textContent).toBe('Ver consulta de busca');
    expect(Array.from(details.querySelectorAll('p'), (line) => line.textContent)).toEqual(['Arduino Uno board', 'USB data cable']);
    expect(details.textContent).not.toContain(intent.query);
    expect(props.onSearch).not.toHaveBeenCalled();
  });
  it('preserves the original image query when the search targets just one object', async () => {
    const intent = { label: 'Arduino Uno', query: 'Arduino Uno board top view connector details', targetTerms: ['Arduino Uno board'], targets: [{ aliases: ['Arduino Uno board', 'placa Arduino Uno'], identifiers: ['Arduino Uno'] }], uncertainty: '' };
    props.externalSearch = { id: 'single-object-search', projectId: 'p1', input: { text: 'Arduino Uno', mentions: [], attachments: [] }, results: references, intent };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(Array.from(host.querySelectorAll('.visual-search-intent details p'), (line) => line.textContent)).toEqual([intent.query]);
    expect(props.onSearch).not.toHaveBeenCalled();
  });
  it.each([
    ['ranked', 'Sorted with TypeSafe · textual relevance', 'Ordenado com TypeSafe · relevância textual', 2],
    ['unavailable', 'TypeSafe unavailable · metadata selection', 'TypeSafe indisponível · seleção por metadados', 0],
    ['not-configured', '', '', 0],
  ] as const)('shows the %s automatic review outcome without failing image search', async (status, english, portuguese, removed) => {
    props.externalSearch = { id: `review-${status}`, projectId: 'p1', input: { text: 'motor', mentions: [], attachments: [] }, results: references, review: { status, assessed: status === 'ranked' ? 6 : 0, removed } };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(host.querySelectorAll('.visual-grid .visual-card')).toHaveLength(9);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    if (english) expect(host.querySelector('.visual-search-review')?.textContent).toContain(english);
    else expect(host.querySelector('.visual-search-review')).toBeNull();
    if (removed) expect(host.querySelector('.visual-search-review')?.textContent).toContain('2 references discarded');
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    if (portuguese) expect(host.querySelector('.visual-search-review')?.textContent).toContain(portuguese);
    if (removed) expect(host.querySelector('.visual-search-review')?.textContent).toContain('2 referências descartadas');
    await click('Buscar');
    expect(host.querySelector('.visual-search-review')).toBeNull();
  });
  it('clears the previous interpretation on submit and does not display another project’s interpretation', async () => {
    const intent = { label: 'Stepper motor', query: 'stepper motor', targetTerms: ['stepper motor'], uncertainty: '' };
    props.externalSearch = { id: 'resolved-search', projectId: 'p1', input: { text: 'motor', mentions: [], attachments: [] }, results: references, intent };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(host.querySelector('.visual-search-intent')?.textContent).toContain('Stepper motor');
    await type('[data-visual-popup="search"] textarea', 'servo motor');
    expect(host.querySelector('.visual-search-intent')?.textContent).toContain('Stepper motor');
    await click('Search');
    expect(host.querySelector('.visual-search-intent')).toBeNull();
    await act(async () => root.render(<VisualExplorer {...props} projectId="p2" workspace={empty()} />));
    expect(host.querySelector('.visual-search-intent')).toBeNull();
    expect(host.querySelectorAll('.visual-card')).toHaveLength(0);
  });
  it.each([
    ['visualSearchNeedsAI', 'To search from “here”, configure AI or enter the component name.', 'Para buscar a partir de “daqui”, configure a IA ou escreva o nome do componente.'],
    ['visualSearchUnclear', 'I could not identify the component. Select a reference with @ or enter its name/model.', 'Não consegui identificar o componente. Selecione uma referência com @ ou informe o nome/modelo.'],
  ])('explains %s in the current language without inventing a component', async (code, english, portuguese) => {
    props.onSearch = vi.fn(async () => { throw new Error(code); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'uma imagem daqui'); await click('Search');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(english);
    expect(host.querySelector('.visual-search-intent')).toBeNull();
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    await click('Buscar');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(portuguese);
  });
  it('uses the returned image artifact ID as base and does not add an existing reference twice', async () => {
    const image: MentionTarget = { ...target, id: 'artifact-1', kind: 'image', label: references[0].title };
    const artifact = { id: image.id, label: image.label, kind: 'image' as const, x: 0, y: 0, width: 200, height: 200, mediaId: 'm1', scene: null, source: references[0], revisions: [{ scene: null, mediaId: 'm1', createdAt: 1 }], revisionIndex: 0 };
    props.onAdd = vi.fn(async () => artifact); props.listMentions = () => [target, image];
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    await click(`Use as 3D base: ${references[0].title}`);
    expect(props.onDraft).toHaveBeenLastCalledWith('model', expect.objectContaining({ mentions: [image] }));
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    props.workspace = { ...props.workspace, artifacts: [artifact] };
    await act(async () => root.render(<VisualExplorer {...props} />));
    await click(`Use as 3D base: ${references[0].title}`);
    expect(props.onAdd).toHaveBeenCalledTimes(1);
  });
  it('keeps every file from a multiple-file attachment batch', async () => {
    props.onAttach = vi.fn(async (file) => ({ id: file.name, name: file.name, mime: file.type, byteLength: file.size, mediaId: file.name, text: null }));
    await act(async () => root.render(<VisualExplorer {...props} />));
    const input = host.querySelector<HTMLInputElement>('[data-visual-popup="search"] input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['b'], 'b.txt', { type: 'text/plain' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(props.onDraft).toHaveBeenLastCalledWith('search', expect.objectContaining({ attachments: [expect.objectContaining({ name: 'a.txt' }), expect.objectContaining({ name: 'b.txt' })] }));
  });
  it('explains attachment size errors without submitting the draft', async () => {
    props.onAttach = vi.fn(async () => { throw new Error('visualFileTooLarge'); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    const input = host.querySelector<HTMLInputElement>('[data-visual-popup="search"] input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'large.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('10 MB');
    expect(props.onSearch).not.toHaveBeenCalled();
  });
  it('offers a real generated proposal for explicit application', async () => {
    const proposal = { id: 'proposal-1', projectId: 'p1', label: 'Motor', scene: { version: 1 as const, label: 'Motor', objects: [{ id: 'o1', type: 'cylinder' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#336699' }] }, input: empty().drafts.model, contextFingerprint: 'v1', createdAt: 1, status: 'ready' as const };
    props.onGenerate = vi.fn(async () => proposal);
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a motor'); await click('Generate model');
    expect(props.onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Motor');
    await click('Apply to canvas');
    expect(props.onApply).toHaveBeenCalledWith('proposal-1');
  });
  it('removes a just-generated proposal when refused and keeps it hidden after reopening', async () => {
    const proposal: VisualProposal = { id: 'declined', projectId: 'p1', label: 'Unwanted motor', scene: { version: 1, label: 'Motor', objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#336699' }] }, input: empty().drafts.model, contextFingerprint: 'v1', createdAt: 1, status: 'ready' };
    props.onGenerate = vi.fn(async () => proposal);
    props.onReject = id => {
      props.workspace = { ...props.workspace, proposals: [{ ...proposal, id, status: 'rejected' }] };
      root.render(<VisualExplorer {...props} />);
    };
    await act(async () => root.render(<VisualExplorer {...props} />));
    await type('[data-visual-popup="model"] textarea', 'a motor');
    await click('Generate model');
    await click('Reject proposal: Unwanted motor');
    expect(host.querySelectorAll('.visual-proposal')).toHaveLength(0);
    expect(host.querySelector('[data-visual-popup="model"] [role="status"]')?.textContent).toContain('Proposal rejected');
    await click('Close 3D studio');
    await act(async () => useVisualPopupStore.getState().open('model'));
    expect(host.querySelectorAll('.visual-proposal')).toHaveLength(0);
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<VisualExplorer {...props} />); });
    expect(host.querySelectorAll('.visual-proposal')).toHaveLength(0);
    expect(props.onApply).not.toHaveBeenCalled();
  });
  it('keeps a proposal visible if refusal fails', async () => {
    props.workspace.proposals = [{ id: 'pending', projectId: 'p1', label: 'Motor', scene: { version: 1, label: 'Motor', objects: [] }, input: empty().drafts.model, contextFingerprint: 'v1', createdAt: 1, status: 'ready' }];
    props.onReject = () => { throw new Error('visualProjectChanged'); };
    await act(async () => root.render(<VisualExplorer {...props} />));
    await click('Reject proposal: Motor');
    expect(host.querySelectorAll('.visual-proposal')).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('project changed');
    expect(props.onApply).not.toHaveBeenCalled();
  });
  it('writes a native reference drag payload with the current project ID', async () => {
    await type('[data-visual-popup="search"] textarea', 'motor'); await click('Search');
    const values: Record<string, string> = {};
    const event = new Event('dragstart', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: { setData: (key: string, value: string) => { values[key] = value; }, effectAllowed: '' } });
    await act(async () => { host.querySelector('.visual-card-image')!.dispatchEvent(event); });
    expect(JSON.parse(values['application/x-cellproject-reference'])).toEqual({ projectId: 'p1', reference: references[0], anchor: { x: .5, y: .5 } });
  });
});
