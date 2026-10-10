import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VaultGate } from './VaultGate';
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('keeps vault setup explicit, separates the phrase from login and requires a saved backup/recovery key', async () => {
  const ready = vi.fn(), skip = vi.fn(), fetcher = vi.fn();
  await act(async () => root.render(<VaultGate ownerId="owner" head={null} snapshot={{ documents: [], media: [] }} fetcher={fetcher} onUnlocked={ready} onSkip={skip}/>));
  expect(container.textContent).toContain('frase exclusiva'); expect(container.textContent).toContain('senha de login');
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
  expect(ready).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Continuar sem ativar agora')!;
  await act(async () => button.click()); expect(skip).toHaveBeenCalledOnce();
});
it('blocks unsupported legacy media without attempting activation or deleting anything', async () => {
  const fetcher = vi.fn();
  await act(async () => root.render(<VaultGate ownerId="owner" head={null} snapshot={{ documents: [], media: [{ id: 'old-file', name: 'private.png', mime: 'image/png', sha256: '0'.repeat(64), size: 2 }] }} fetcher={fetcher} onUnlocked={vi.fn()} onSkip={vi.fn()}/>));
  expect(container.textContent).toContain('migração assistida'); expect(container.querySelector('input[type=password]')).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
