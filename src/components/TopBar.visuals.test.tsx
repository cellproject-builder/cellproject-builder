import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { useToastStore } from './ui/Toast';
import { prepareVisualPlanImport } from '@/visuals/portable';
import { TopBar } from './TopBar';
import type { Project } from '@/types';

vi.mock('./KnowledgeRepo', () => ({ KnowledgeRepo: () => null }));
vi.mock('./ApiKeyGate', () => ({ ApiKeyGate: () => null }));
vi.mock('@/visuals/portable', async importOriginal => ({ ...await importOriginal<object>(), prepareVisualPlanImport: vi.fn() }));

let container: HTMLDivElement, root: Root, importCompletion: Promise<unknown>;
const imported = { ...buildDemoProject(), id: 'imported-visual-plan', name: 'Imported' };
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'current-visual-plan' } });
  initializeWorkspace();
  useToastStore.setState({ toasts: [] });
  vi.mocked(prepareVisualPlanImport).mockReset().mockResolvedValue(imported);
  vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'result', { value: JSON.stringify(imported) });
    importCompletion = Promise.resolve(this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>));
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<TopBar />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

async function selectFile() {
  const input = container.querySelector<HTMLInputElement>('input[name="import-file"]')!;
  await act(async () => Simulate.change(input, { target: { files: [new File(['{}'], 'plan.json', { type: 'application/json' })] } } as never));
}

describe('toolbar portable visual import', () => {
  it('imports the prepared portable plan and archives the previous plan', async () => {
    const previous = useGraphStore.getState().project!;
    await selectFile(); await act(async () => { await importCompletion; });
    expect(useGraphStore.getState().project?.id).toBe(imported.id);
    expect(useGraphStore.getState().archivedProject?.id).toBe(previous.id);
  });

  it('does not replace the visible plan when context changes while originals are loading', async () => {
    let resolve!: (project: Project) => void;
    vi.mocked(prepareVisualPlanImport).mockReturnValue(new Promise<Project>(done => { resolve = done; }));
    await selectFile();
    const other = { ...buildDemoProject(), id: 'switched-during-import' };
    await act(async () => useGraphStore.setState({ project: other }));
    await act(async () => { resolve(imported); await importCompletion; });
    expect(useGraphStore.getState().project).toBe(other);
    expect(useToastStore.getState().toasts.some(toast => toast.message.includes('projeto mudou'))).toBe(true);
  });
});
