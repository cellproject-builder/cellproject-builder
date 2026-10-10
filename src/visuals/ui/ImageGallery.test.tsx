import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { REFERENCE_DRAG_TYPE } from '../drag';
import type { ImageReference } from '../types';
import { ImageGallery } from './ImageGallery';

const reference: ImageReference = { id: 'image', title: 'Board reference', description: '', imageUrl: '/board.png', sourcePageUrl: 'https://example.com/board', credit: null, license: null, width: 400, height: 200 };
const references = [reference];
let host: HTMLDivElement;
let root: Root;
let add: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  add = vi.fn(async () => {});
  await act(async () => root.render(<ImageGallery references={references} projectId="project" onAdd={add} onBase={vi.fn(async () => {})} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('gallery image dragging', () => {
  it('drags just the preview, preserves the picked point, and leaves actions independent', async () => {
    const card = host.querySelector<HTMLElement>('.visual-card')!;
    const thumbnail = host.querySelector<HTMLElement>('.visual-card-image')!;
    const image = thumbnail.querySelector('img')!;
    expect(card.draggable).toBe(false); expect(thumbnail.draggable).toBe(true);
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 400 }, naturalHeight: { value: 200 } });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 130, bottom: 108, width: 120, height: 88, toJSON: () => ({}) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn() } as unknown as CanvasRenderingContext2D);
    const data: Record<string, string> = {};
    const transfer = { setData: (type: string, value: string) => { data[type] = value; }, setDragImage: vi.fn(), effectAllowed: '' };
    const event = new MouseEvent('dragstart', { bubbles: true, clientX: 40, clientY: 64 });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    await act(async () => thumbnail.dispatchEvent(event));
    expect(JSON.parse(data[REFERENCE_DRAG_TYPE])).toEqual({ projectId: 'project', reference, anchor: { x: .25, y: .5 } });
    expect(transfer.effectAllowed).toBe('copy');
    expect(transfer.setDragImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 40, 40);
    expect(card.classList.contains('is-dragging')).toBe(true);
    expect(add).not.toHaveBeenCalled();
    await act(async () => thumbnail.dispatchEvent(new Event('dragend', { bubbles: true })));
    expect(card.classList.contains('is-dragging')).toBe(false);
    expect(document.querySelector('.visual-reference-drag-preview')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.visual-card-add')!.click());
    expect(add).toHaveBeenCalledWith(reference);
  });

  it('blocks unavailable previews from initiating a reference drag', async () => {
    const image = host.querySelector('img')!;
    await act(async () => image.dispatchEvent(new Event('error')));
    const thumbnail = host.querySelector<HTMLElement>('.visual-card-image')!;
    expect(thumbnail.draggable).toBe(false);
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    await act(async () => thumbnail.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(transfer.setData).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
  });

  it('keeps the initial grab point when native dragstart occurs after the cursor has moved', async () => {
    const thumbnail = host.querySelector<HTMLElement>('.visual-card-image')!;
    const image = thumbnail.querySelector('img')!;
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 200 } });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, width: 120, height: 88 } as DOMRect);
    const payloads: string[] = [];
    const transfer = { setData: (_type: string, value: string) => payloads.push(value), effectAllowed: '' };
    await act(async () => thumbnail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 64 })));
    const start = () => {
      const event = new MouseEvent('dragstart', { bubbles: true, clientX: 95, clientY: 64 });
      Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event;
    };
    await act(async () => thumbnail.dispatchEvent(start()));
    expect(JSON.parse(payloads[0]).anchor).toEqual({ x: .25, y: .5 });
    await act(async () => thumbnail.dispatchEvent(new Event('dragend', { bubbles: true })));
    await act(async () => thumbnail.dispatchEvent(start()));
    expect(JSON.parse(payloads[1]).anchor.x).toBeCloseTo(85 / 120);
  });
});

describe('reference assessment', () => {
  it('displays automatic TypeSafe scores without offering a duplicate paid assessment', async () => {
    const assessed: ImageReference = { ...reference, assessment: { kind: 'textual', model: 'reference-review', rubricVersion: 'v1', score: 2.7, confidence: .92, probabilities: { '0': 0, '1': 0, '2': .3, '3': .7 }, legend: { '0': 'unrelated', '1': 'weak', '2': 'related', '3': 'relevant' }, assessedAt: 1 } };
    const onAssess = vi.fn(async () => ({ score: 1, confidence: .5 }));
    await act(async () => root.render(<ImageGallery references={[assessed]} projectId="project" onAdd={add} onBase={vi.fn(async () => {})} onAssess={onAssess} />));
    expect(host.textContent).toContain('TypeSafe · Textual relevance: 2.7/3');
    expect(host.textContent).toContain('Model confidence: 92%');
    expect(host.querySelector('[aria-label="Assess reference: Board reference"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.visual-card-add')!.click());
    expect(add).toHaveBeenCalledWith(assessed);
    expect(onAssess).not.toHaveBeenCalled();
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    expect(host.textContent).toContain('TypeSafe · Relevância textual: 2.7/3');
  });
});
