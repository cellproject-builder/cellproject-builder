import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasResource } from './canvasModel';
import { CanvasAttachmentLibrary } from './CanvasAttachmentLibrary';

const resources: CanvasResource[] = [
  { id: 'pdf-1', name: 'Manual.pdf', kind: 'pdf', mediaId: 'media-1', mime: 'application/pdf', size: 2048, text: null, url: null, addedAt: 1, pages: 3 },
  { id: 'image-1', name: 'Circuito.png', kind: 'image', mediaId: 'media-2', mime: 'image/png', size: 1024, text: null, url: null, addedAt: 2 },
  { id: 'text-1', name: 'Notas.md', kind: 'text', mediaId: null, mime: 'text/markdown', size: 30, text: '# Hipótese', url: null, addedAt: 3 },
  { id: 'link-1', name: 'Referência', kind: 'link', mediaId: null, mime: null, size: 0, text: null, url: 'https://example.com/reference', addedAt: 4 },
];
let host: HTMLDivElement;
let root: Root;
let callbacks: { onImport: ReturnType<typeof vi.fn>; onAddLink: ReturnType<typeof vi.fn>; onPlace: ReturnType<typeof vi.fn>; onOpen: ReturnType<typeof vi.fn>; onRemove: ReturnType<typeof vi.fn> };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  callbacks = { onImport: vi.fn(), onAddLink: vi.fn(), onPlace: vi.fn(), onOpen: vi.fn(), onRemove: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (props: Partial<Parameters<typeof CanvasAttachmentLibrary>[0]> = {}) => act(() => root.render(<CanvasAttachmentLibrary resources={resources} {...callbacks} {...props} />));
const button = (label: string) => {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  expect(element, `Button: ${label}`).toBeDefined(); return element!;
};
const open = () => act(() => button('Anexos').click());
const checkbox = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="Selecionar ${name}"]`)!;
const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => act(() => Simulate.change(element, { target: { value } } as never));
const rowIds = () => [...document.querySelectorAll<HTMLElement>('[data-resource-id]')].map(item => item.dataset.resourceId);

describe('canvas attachment library', () => {
  it('opens a labelled panel, focuses search and returns focus after Escape or an outside click', () => {
    render(); const trigger = button('Anexos');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    open();
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(document.querySelector('h2')!.id);
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    open();
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('combines search and type filters without losing a deck selection', () => {
    render(); open();
    act(() => checkbox('Manual.pdf').click());
    act(() => checkbox('Circuito.png').click());
    change(document.querySelector('input[type="search"]')!, 'circuito');
    expect(rowIds()).toEqual(['image-1']);
    change(document.querySelector('select')!, 'pdf');
    expect(rowIds()).toEqual([]);
    expect(document.body.textContent).toContain('Nenhum anexo encontrado');
    act(() => button('Colocar seleção no canvas').click());
    expect(callbacks.onPlace).toHaveBeenCalledWith(['pdf-1', 'image-1']);
  });

  it('opens a row, places an individual attachment and removes only its ID', () => {
    render(); open();
    act(() => document.querySelector<HTMLElement>('[data-resource-id="pdf-1"]')!.click());
    expect(callbacks.onOpen).toHaveBeenCalledWith(resources[0]);
    act(() => button('Colocar Manual.pdf no canvas').click());
    expect(callbacks.onPlace).toHaveBeenCalledWith(['pdf-1']);
    act(() => button('Remover Manual.pdf dos anexos').click());
    expect(callbacks.onRemove).toHaveBeenCalledWith('pdf-1');
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
  });

  it('drags only attachment IDs and uses the whole selection only when dragging a selected row', () => {
    render(); open();
    act(() => checkbox('Manual.pdf').click());
    act(() => checkbox('Circuito.png').click());
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    act(() => Simulate.dragStart(document.querySelector('[data-resource-id="pdf-1"]')!, { dataTransfer: transfer } as never));
    expect(transfer.setData).toHaveBeenCalledExactlyOnceWith('application/x-dynamic-diary-attachment', JSON.stringify({ ids: ['pdf-1', 'image-1'] }));
    expect(transfer.effectAllowed).toBe('copy');
    transfer.setData.mockClear();
    act(() => Simulate.dragStart(document.querySelector('[data-resource-id="text-1"]')!, { dataTransfer: transfer } as never));
    expect(transfer.setData).toHaveBeenCalledExactlyOnceWith('application/x-dynamic-diary-attachment', JSON.stringify({ ids: ['text-1'] }));
  });

  it('hands selected files to import without reading them and exposes busy and error states', () => {
    render(); open();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/*');
    expect(input.accept).toContain('.md');
    const file = new File(['# Notas'], 'notas.md', { type: 'text/markdown' });
    const read = vi.fn(); Object.defineProperty(file, 'arrayBuffer', { value: read });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => Simulate.change(input));
    expect(callbacks.onImport).toHaveBeenCalledExactlyOnceWith([file]);
    expect(read).not.toHaveBeenCalled();
    render({ importing: true, error: 'Não foi possível importar o PDF.' });
    expect(button('Enviar arquivos').disabled).toBe(true);
    expect(button('Adicionar link').disabled).toBe(true);
    expect(document.querySelector('[role="status"]')!.textContent).toContain('Importando');
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Não foi possível importar o PDF.');
  });

  it('validates a link and submits its trimmed URL with English labels', () => {
    render({ english: true }); act(() => button('Attachments').click());
    const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
    change(input, 'javascript:alert(1)');
    act(() => Simulate.submit(input.form!));
    expect(callbacks.onAddLink).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    change(input, '  https://example.com/manual  ');
    act(() => Simulate.submit(input.form!));
    expect(callbacks.onAddLink).toHaveBeenCalledExactlyOnceWith('https://example.com/manual');
    expect(input.value).toBe('');
    act(() => button('Open Manual.pdf').click());
    expect(callbacks.onOpen).toHaveBeenCalledWith(resources[0]);
  });

  it('excludes resources removed by the parent from the selected deck', () => {
    render(); open();
    act(() => checkbox('Manual.pdf').click());
    act(() => checkbox('Circuito.png').click());
    render({ resources: resources.slice(1) });
    act(() => button('Colocar seleção no canvas').click());
    expect(callbacks.onPlace).toHaveBeenCalledWith(['image-1']);
  });
});
