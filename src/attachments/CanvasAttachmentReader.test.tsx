import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasAttachmentReader } from './CanvasAttachmentReader';
import type { CanvasResource } from './canvasModel';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/visuals/media', () => ({ readVisualMedia: mocks.read }));
vi.mock('./CanvasResourcePreview', () => ({ CanvasResourcePreview: ({ resource }: { resource: CanvasResource }) => <div data-reader-preview={resource.id}>{resource.text}</div> }));
let host: HTMLDivElement, trigger: HTMLButtonElement, root: Root;
const a: CanvasResource = { id: 'first', name: 'Primeiro.md', kind: 'text', mediaId: null, mime: 'text/markdown', size: 5, text: 'Primeira referência', url: null, addedAt: 1 };
const b: CanvasResource = { ...a, id: 'second', name: 'Segundo.pdf', kind: 'pdf', mediaId: 'missing', mime: 'application/pdf' };
const close = vi.fn();
const render = async (resources: CanvasResource[]) => { await act(async () => { root.render(<CanvasAttachmentReader resources={resources} onClose={close} />); }); };
const button = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); trigger = document.createElement('button'); document.body.append(trigger, host); trigger.focus(); root = createRoot(host);
  mocks.read.mockReset(); close.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); trigger.remove(); });

describe('attachment reader', () => {
  it('keeps a visible, closable reader if the selected deck entry is deleted', async () => {
    await render([a, b]);
    act(() => Simulate.change(document.querySelector('[aria-label="Arquivo do deck"]')!, { target: { value: '1' } } as never));
    expect(document.querySelector('[data-reader-preview="second"]')).not.toBeNull();
    await render([a]);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-reader-preview="first"]')).not.toBeNull();
    act(() => button('Fechar leitor').click()); expect(close).toHaveBeenCalledOnce();
  });

  it('reports a missing original without creating a download and restores focus on close', async () => {
    mocks.read.mockResolvedValue(null); await render([b]);
    await act(async () => { button('Baixar anexo').click(); });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('missing');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível baixar');
    act(() => root.render(null)); expect(document.activeElement).toBe(trigger);
  });

  it('offers an explicit external link without loading a remote frame or media', async () => {
    await render([{ id: 'link', name: 'Especificação', kind: 'link', mediaId: null, mime: null, size: 0, text: null, url: 'https://example.org/spec', addedAt: 1 }]);
    const link = document.querySelector<HTMLAnchorElement>('.canvas-reader-source a')!;
    expect(link.href).toBe('https://example.org/spec'); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noopener');
    expect(document.querySelector('iframe,embed,object')).toBeNull(); expect(mocks.read).not.toHaveBeenCalled();
  });
});
