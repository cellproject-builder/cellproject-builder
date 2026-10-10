import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatImageCarousel } from './ChatImageCarousel';
import type { ImageReference } from '@/visuals/types';

const results: ImageReference[] = ['Arduino Uno', 'Cabo USB', 'Motor NEMA 17'].map((title, index) => ({ id: `image-${index}`, title, description: '', imageUrl: `https://example.com/image-${index}.jpg`, sourcePageUrl: `https://example.com/reference-${index}`, credit: null, license: null, width: null, height: null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('keeps every requested item visible, filters its images and explains missing groups', () => {
  const groups = [{ id: 'board', label: 'Arduino Uno', imageIds: ['image-0'] }, { id: 'cable', label: 'Cabo USB', imageIds: ['image-1'] }, { id: 'driver', label: 'Driver', imageIds: [] }];
  act(() => root.render(<ChatImageCarousel results={results} groups={groups} projectId="robot" english={false} onChoose={vi.fn()} />));
  act(() => Simulate.click(host.querySelector('[aria-label="Imagens de Cabo USB"]')!));
  expect(host.querySelector('[aria-roledescription="carousel"] img')?.getAttribute('alt')).toBe('Cabo USB');
  act(() => Simulate.click(host.querySelector('[aria-label="Imagens de Driver"]')!));
  expect(host.textContent).toContain('Nenhuma imagem encontrada para Driver');
  expect(host.querySelector('[aria-label="Imagens de Arduino Uno"]')).not.toBeNull();
});

it('shows documentary conflicts and uncertainty without blocking selection as an illustrative reference', async () => {
  const choose = vi.fn().mockResolvedValue(undefined);
  const fits = [{ imageId: 'image-0', status: 'conflict' as const, productName: 'Arduino Uno', checks: [{ aspect: 'Tensão', status: 'conflict' as const, explanation: 'Requisito e alimentação documentada divergem.', requirement: { sourceId: 'req', label: 'Limites do projeto', quote: '12 V' }, evidence: [{ url: 'https://maker.example/spec', title: 'Especificações', quote: '5 V' }] }], unknowns: ['Montagem ainda não medida.'] }];
  act(() => root.render(<ChatImageCarousel results={results} fits={fits} projectId="robot" english={false} onChoose={choose} />));
  expect(host.textContent).toContain('Conflito encontrado'); expect(host.textContent).toContain('Limites do projeto');
  expect(host.textContent).toContain('Montagem ainda não medida');
  await act(async () => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno"]')!));
  expect(choose).toHaveBeenCalled();
});

it('keeps images in the chat and only chooses or prepares 3D after an explicit click', async () => {
  const choose = vi.fn().mockResolvedValue(undefined);
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} onChoose={choose} />));
  expect(choose).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-roledescription="carousel"]')).not.toBeNull();
  expect(host.querySelector<HTMLAnchorElement>('.dd-chat-image-source')?.href).toBe(results[0].sourcePageUrl);
  await act(async () => { Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno"]')!); });
  expect(choose).toHaveBeenCalledWith(results[0], { useAs3D: false });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('canvas');
  await act(async () => { Simulate.click(host.querySelector('[aria-label="Usar Arduino Uno como base 3D"]')!); });
  expect(choose).toHaveBeenLastCalledWith(results[0], { useAs3D: true });
});

it('supports arrows, accumulated wheel, and horizontal swiping without sending a request', () => {
  const choose = vi.fn();
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} onChoose={choose} />));
  const carousel = host.querySelector('[aria-roledescription="carousel"]')!;
  act(() => Simulate.keyDown(carousel, { key: 'ArrowRight' }));
  expect(carousel.getAttribute('data-active-index')).toBe('1');
  act(() => Simulate.wheel(carousel, { deltaY: 70 }));
  expect(carousel.getAttribute('data-active-index')).toBe('2');
  act(() => Simulate.touchStart(carousel, { touches: [{ clientX: 20, clientY: 20 }] } as never));
  act(() => Simulate.touchEnd(carousel, { changedTouches: [{ clientX: 120, clientY: 25 }] } as never));
  expect(carousel.getAttribute('data-active-index')).toBe('1');
  expect(choose).not.toHaveBeenCalled();
});

it('keeps historic results readable but prevents insertion after switching projects', () => {
  const choose = vi.fn();
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} unavailable="projectChanged" onChoose={choose} />));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno"]')?.disabled).toBe(true);
  expect(host.textContent).toContain('projeto de origem');
  expect(host.querySelector<HTMLAnchorElement>('.dd-chat-image-source')?.href).toBe(results[0].sourcePageUrl);
  expect(choose).not.toHaveBeenCalled();
});

it('keeps an older plan search readable but prevents reusing it in its replacement plan', () => {
  const choose = vi.fn(), openProject = vi.fn();
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} unavailable="planChanged" onChoose={choose} onOpenProject={openProject} />));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno"]')?.disabled).toBe(true);
  expect(host.textContent).toContain('O plano mudou');
  expect(host.textContent).toContain('nova busca');
  expect(host.textContent).not.toContain('Voltar ao projeto');
  expect(choose).not.toHaveBeenCalled();
});

it('explains an expired reference without leaking an internal error and allows another choice', async () => {
  const choose = vi.fn().mockRejectedValueOnce(new Error('visualReferenceUnregistered')).mockResolvedValue(undefined);
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} onChoose={choose} />));
  await act(async () => { Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno"]')!); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Busque novamente');
  expect(host.textContent).not.toContain('visualReferenceUnregistered');
  act(() => Simulate.click(host.querySelector('[aria-label="Próxima imagem"]')!));
  await act(async () => { Simulate.click(host.querySelector('[aria-label="Escolher Cabo USB"]')!); });
  expect(choose).toHaveBeenLastCalledWith(results[1], { useAs3D: false });
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('discards late feedback when the carousel changes while an image is being added', async () => {
  let finish!: () => void;
  const choose = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} onChoose={choose} />));
  act(() => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno"]')!));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno"]')?.disabled).toBe(true);
  act(() => root.render(<ChatImageCarousel results={[results[1]]} projectId="other" english={false} onChoose={choose} />));
  await act(async () => finish());
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Cabo USB"]')?.disabled).toBe(false);
});

it('never renders executable image or source URLs from a stored result', () => {
  const invalid = [{ ...results[0], imageUrl: 'javascript:alert(1)', sourcePageUrl: 'javascript:alert(1)' }];
  act(() => root.render(<ChatImageCarousel results={invalid} projectId="robot" english={false} onChoose={vi.fn()} />));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('disponíveis');
});

it('announces an empty search and explains a preview that no longer loads', () => {
  act(() => root.render(<ChatImageCarousel results={[]} projectId="robot" english={false} onChoose={vi.fn()} />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Nenhuma imagem encontrada');
  act(() => root.render(<ChatImageCarousel results={results} projectId="robot" english={false} onChoose={vi.fn()} />));
  act(() => Simulate.error(host.querySelector('img')!));
  expect(host.textContent).toContain('Busque novamente');
});

it('renders registered same-origin media URLs returned by the real gateway', () => {
  const reference = { ...results[0], sessionId: 'search-session', imageUrl: '/api/visuals/media?sessionId=search-session&candidateId=image-0' };
  act(() => root.render(<ChatImageCarousel results={[reference]} projectId="robot" english={false} onChoose={vi.fn()} />));
  expect(host.querySelector('img')?.getAttribute('src')).toBe(reference.imageUrl);
  expect(host.querySelector('[aria-label="Escolher Arduino Uno"]')).not.toBeNull();
});

it.each(['//evil.example/image.png', 'data:image/png;base64,bogus', '/api/visuals/media?sessionId=wrong&candidateId=image-0', '/api/visuals/media?sessionId=search-session&candidateId=another', '/api/visuals/other?sessionId=search-session&candidateId=image-0'])('rejects unregistered relative media URLs: %s', imageUrl => {
  act(() => root.render(<ChatImageCarousel results={[{ ...results[0], sessionId: 'search-session', imageUrl }]} projectId="robot" english={false} onChoose={vi.fn()} />));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('a')).toBeNull();
});
