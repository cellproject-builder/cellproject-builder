import { afterEach, expect, it, vi } from 'vitest';
import { classifyPlanRequest } from './planIntake';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace } from '@/workspace/planner';
import { useGraphStore } from '@/store';
import { extractPlanFile } from '@/attachments/files';
afterEach(() => vi.unstubAllGlobals());
it('sends only bounded file excerpts and plan metadata to the local classifier', async () => {
  useWorkspaceStore.setState({ projects: {}, legacyImported: true }); useGraphStore.setState({ project: null }); initializeWorkspace();
  const projectId = useWorkspaceStore.getState().createProject('Robô', 'Construir');
  const files = await Promise.all(Array.from({ length: 12 }, (_, i) => extractPlanFile(new File(['漢字\n'.repeat(8000)], `${i}.md`))));
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.body) return new Response(JSON.stringify({ textualReview: true }));
    const body = String(init.body); expect(new TextEncoder().encode(body).length).toBeLessThan(24 * 1024);
    expect(JSON.parse(body).files).toHaveLength(12);
    return new Response(JSON.stringify({ status: 'classified', classification: { choice: 'extend', confidence: .8, probabilities: { reference: .05, extend: .8, revise: .05, reorganize: .05, clarify: .05 }, model: 'jev-latest', assessedAt: 1, rubricVersion: 'plan-intake-v1' } }));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await classifyPlanRequest('Adicione as etapas', projectId, files, new AbortController().signal)).toMatchObject({ status: 'classified', classification: { choice: 'extend' } });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/visuals/capabilities', '/api/visuals/plan-intake']);
});
it('reports a missing classifier configuration honestly and propagates cancellation', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Teste');
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ textualReview: false }))); vi.stubGlobal('fetch', fetcher);
  expect(await classifyPlanRequest('Leia', projectId, [], new AbortController().signal)).toEqual({ status: 'not-configured' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const controller = new AbortController(); controller.abort();
  await expect(classifyPlanRequest('Leia', projectId, [], controller.signal)).rejects.toThrow();
});
