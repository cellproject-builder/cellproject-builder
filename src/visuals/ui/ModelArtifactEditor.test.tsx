import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { ModelArtifactEditor } from './ModelArtifactEditor';
import { reviseVisualModel } from '../modelRevision';
import type { VisualArtifact } from '../types';
vi.mock('../modelRevision', () => ({ reviseVisualModel: vi.fn() }));
vi.mock('../domain', () => ({ findMentionTarget: (id: string, kind: string) => ({ id, kind, label: id, detail: '', fingerprint: 'v1' }), listMentionTargets: () => [{ id: 'note-extra', kind: 'note', label: 'Detailed dimensions', detail: '', fingerprint: 'v1' }] }));
vi.mock('../media', () => ({ attachVisualFile: vi.fn(async (file: File) => ({ id: 'file', name: file.name, mime: 'text/plain', byteLength: file.size, mediaId: null, text: '42 mm flange' })) }));
const artifact = { id: 'motor', label: 'Motor', kind: 'model', linkedNodeId: 'node-motor', origin: { imageIds: ['photo'] } } as VisualArtifact;
let host: HTMLDivElement, root: Root, close: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  vi.mocked(reviseVisualModel).mockReset(); vi.mocked(reviseVisualModel).mockResolvedValue(artifact);
  close = vi.fn(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ModelArtifactEditor artifact={artifact} onClose={close}/>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function type(value: string) { const field = host.querySelector('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('sends one explicit revision of the same model with inherited references, @ selection and attachments', async () => {
  expect(reviseVisualModel).not.toHaveBeenCalled(); expect(host.querySelector<HTMLButtonElement>('[aria-label="OK"]')!.disabled).toBe(true);
  await type('Preserve the body and use @');
  const field = host.querySelector('textarea')!;
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const file = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(file, 'files', { value: [new File(['42 mm'], 'drawing.txt', { type: 'text/plain' })], configurable: true });
  await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="OK"]')!.click());
  expect(reviseVisualModel).toHaveBeenCalledOnce();
  expect(reviseVisualModel).toHaveBeenCalledWith('motor', expect.objectContaining({ mentions: expect.arrayContaining([expect.objectContaining({ id: 'node-motor' }), expect.objectContaining({ id: 'photo' }), expect.objectContaining({ id: 'note-extra' })]), attachments: [expect.objectContaining({ name: 'drawing.txt', text: '42 mm flange' })] }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(close).toHaveBeenCalledOnce();
});
it('shows busy/error feedback and cancellation aborts the request', async () => {
  vi.mocked(reviseVisualModel).mockImplementation(() => new Promise(() => {})); await type('Add a connector');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="OK"]')!.click());
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Creating a revision');
  const signal = vi.mocked(reviseVisualModel).mock.calls[0][2].signal;
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!.click()); expect(signal.aborted).toBe(true);
  vi.mocked(reviseVisualModel).mockRejectedValueOnce(new Error('visualContextChanged'));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="OK"]')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('context changed'); expect(close).not.toHaveBeenCalled();
});
