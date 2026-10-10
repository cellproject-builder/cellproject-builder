import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { FileAttachments } from './FileAttachments';
import { extractPlanFile } from './files';

it('keeps sources added through the chat while a file is being read in the same project', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), change = vi.fn();
  const original = await extractPlanFile(new File(['Original'], 'original.md'));
  const fromChat = await extractPlanFile(new File(['From chat'], 'chat.md'));
  let finish!: (bytes: ArrayBuffer) => void;
  const delayed = new File(['New'], 'new.md'); Object.defineProperty(delayed, 'arrayBuffer', { value: () => new Promise(resolve => { finish = resolve; }) });
  try {
    act(() => root.render(<FileAttachments files={[original]} onChange={change} english={false} scopeKey="a" />));
    act(() => Simulate.change(host.querySelector('input')!, { target: { files: [delayed] } } as never));
    act(() => root.render(<FileAttachments files={[original, fromChat]} onChange={change} english={false} scopeKey="a" />));
    await act(async () => { finish(new TextEncoder().encode('New').buffer); await Promise.resolve(); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0].map((file: { name: string }) => file.name)).toEqual(['original.md', 'chat.md', 'new.md']);
  } finally { act(() => root.unmount()); host.remove(); }
});

it('reads a chosen file into a removable reference and ignores an upload after changing projects', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), change = vi.fn();
  try {
    act(() => root.render(<FileAttachments files={[]} onChange={change} english={false} scopeKey="a" />));
    await act(async () => { Simulate.change(host.querySelector('input')!, { target: { files: [new File(['# Estudo'], 'estudo.md')] } } as never); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(change.mock.calls[0][0][0]).toMatchObject({ name: 'estudo.md', text: '# Estudo' });
    let finish!: (bytes: ArrayBuffer) => void;
    const delayed = new File(['x'], 'delayed.txt'); Object.defineProperty(delayed, 'arrayBuffer', { value: () => new Promise(resolve => { finish = resolve; }) });
    act(() => Simulate.change(host.querySelector('input')!, { target: { files: [delayed] } } as never));
    act(() => root.render(<FileAttachments files={[]} onChange={change} english={false} scopeKey="b" />));
    await act(async () => { finish(new TextEncoder().encode('foreign').buffer); await Promise.resolve(); });
    expect(change).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); host.remove(); }
});
