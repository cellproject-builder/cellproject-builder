// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generationSceneSchema } from './legacyScene';
import { matrixCaseSchema, matrixInput, matrixSystem } from './matrix';
import { accountedCost, coordinateWorkers, safeRawText, verifyReferenceFetch } from '../../../scripts/visual-matrix-runner';

describe('matrix runner boundaries', () => {
  it.each(['none', 'image'] as const)('audits the installed SDK/provider payload with %s evidence and no remote calls', async context => {
    const cases = JSON.parse(await readFile('docs/design/three-skills-comparison/fixtures/cases.json', 'utf8'));
    const item = matrixCaseSchema.parse(cases[0]);
    const input = matrixInput(item, context), systemPrompt = matrixSystem(item.prompt, 'skills');
    const bytes = input.imageInput ? await readFile(resolve('docs/design/three-skills-comparison/matrix', input.imageInput.path)) : null;
    const scene = { version: 1, label: 'mocked offline response', objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#112233' }] };
    const remote = vi.fn(async () => new Response(JSON.stringify({ id: 'offline-sdk-response', model: 'offline-mock', created: 1,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(scene) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 17, completion_tokens: 18, total_tokens: 35, cost: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const audited = verifyReferenceFetch({ systemPrompt, userText: input.userText, imageHash: input.imageInput?.sha256 ?? null, mimeType: input.imageInput?.mimeType ?? null }, remote);
    const client = createOpenRouter({ apiKey: 'offline-test-only', fetch: audited });
    const result = await generateObject({ model: client.chat('openai/gpt-6.1-sol', { reasoning: { effort: 'medium' } }),
      schema: generationSceneSchema, system: systemPrompt, messages: [{ role: 'user', content: [
        { type: 'text', text: input.userText }, ...(bytes ? [{ type: 'image' as const, image: bytes, mediaType: input.imageInput!.mimeType }] : []),
      ] }], maxOutputTokens: 10_000, maxRetries: 0 });
    expect(result.object).toEqual(scene);
    expect(remote).toHaveBeenCalledOnce();
  });
  it('stops dispatch after a persistence failure but waits for every active worker', async () => {
    let release!: () => void;
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    let workers = 0, settled = false, stopped = false;
    const coordinator = coordinateWorkers(async shouldStop => {
      if (++workers === 1) throw new Error('persistence-failed');
      await inFlight;
      stopped = shouldStop();
    });
    const outcome = coordinator.then(() => { settled = true; }, error => { settled = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect((await outcome)?.message).toBe('persistence-failed');
    expect(stopped).toBe(true);
  });
  it('reserves unknown and in-flight attempts without charging untouched or skipped cells', () => {
    expect(accountedCost([
      { status: 'success', usage: { costUsd: .08 } },
      { status: 'failed', usage: { costUsd: null } },
      { status: 'running', usage: { costUsd: null } },
      { status: 'pending', usage: { costUsd: null } },
      { status: 'budget-skipped', usage: { costUsd: null } },
    ])).toBeCloseTo(.58);
  });
  it('checks exact image bytes and common user/system text before a remote fetch', async () => {
    const bytes = Buffer.from('fixture pixels');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const remote = vi.fn(async () => new Response('{}'));
    const verified = verifyReferenceFetch({ systemPrompt: 'system', userText: 'user', imageHash: digest, mimeType: 'image/png' }, remote);
    const body = { messages: [{ role: 'system', content: 'system' }, { role: 'user', content: [{ type: 'text', text: 'user' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] }] };
    await verified('https://example.invalid', { body: JSON.stringify(body) });
    expect(remote).toHaveBeenCalledOnce();
    body.messages[1].content = [{ type: 'text', text: 'user' }] as never;
    await expect(verified('https://example.invalid', { body: JSON.stringify(body) })).rejects.toThrow('matrixRequestMismatch');
    expect(remote).toHaveBeenCalledOnce();
  });
  it('rejects unplanned images and never extracts headers or request fields', async () => {
    const remote = vi.fn(async () => new Response('{}'));
    const verified = verifyReferenceFetch({ systemPrompt: 'system', userText: 'user', imageHash: null, mimeType: null }, remote);
    await expect(verified('https://example.invalid', { body: JSON.stringify({ messages: [{ role: 'system', content: 'system' }, { role: 'user', content: [{ type: 'text', text: 'user' }, { type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } }] }] }) })).rejects.toThrow('matrixRequestMismatch');
    expect(remote).not.toHaveBeenCalled();
    expect(safeRawText({ choices: [{ message: { content: 'raw JSON' } }], headers: { authorization: 'secret' } })).toBe('raw JSON');
    expect(safeRawText({ headers: { authorization: 'secret' } })).toBeNull();
  });
});
