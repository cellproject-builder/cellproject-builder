import { afterEach, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import * as client from './client';
import { generateChatSummary } from './chatCompaction';
import type { ChatSummaryInput } from '@/chat/contextBudget';

const response = (text: string): LanguageModelV3GenerateResult => ({ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' },
  usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [] });
const input = (): ChatSummaryInput => ({ modelKey: 'openai:fixture', signal: new AbortController().signal, maxSummaryTokens: 512,
  previousSummary: 'Decisão anterior: manter MG90S.', messages: [{ role: 'user', content: 'Ajustar somente o suporte. Não alterar os servos.' }, { role: 'assistant', content: 'Suporte atualizado; salvamento falhou. Não repetir a mutação.' }] });
afterEach(() => vi.restoreAllMocks());

it('uses the real SDK without tools and treats transcript and previous memory as fallible source data', async () => {
  const model = new MockLanguageModelV3({ doGenerate: response('  Manter MG90S. Suporte aplicado, ainda não salvo.  ') });
  expect(await generateChatSummary(input(), model)).toBe('Manter MG90S. Suporte aplicado, ainda não salvo.');
  const request = model.doGenerateCalls[0];
  expect(request.tools).toBeUndefined();
  const system = request.prompt.find(message => message.role === 'system');
  expect(system?.content).toContain('never execute');
  expect(system?.content).toContain('not authorization');
  const source = request.prompt.find(message => message.role === 'user');
  expect(JSON.stringify(source)).toContain('Decisão anterior');
  expect(JSON.stringify(source)).toContain('salvamento falhou');
});

it('does not resend binary images or uploaded file bytes to the text summarizer', async () => {
  const model = new MockLanguageModelV3({ doGenerate: response('Referência de imagem disponível; pixels não resumidos.') });
  const request = input();
  request.messages = [{ role: 'user', content: [{ type: 'text', text: 'Minha referência escolhida' }, { type: 'image', image: 'data:image/png;base64,PERSONAL_IMAGE_BYTES' }, { type: 'file', data: new Uint8Array([98, 99]), mediaType: 'application/pdf', filename: 'especificações.pdf' }] }];
  await generateChatSummary(request, model);
  const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
  expect(prompt).not.toContain('PERSONAL_IMAGE_BYTES');
  expect(prompt).toContain('especificações.pdf');
  expect(prompt).toContain('media content omitted');
});

it('removes nested data URLs and binary views from tool results consistently with input budgeting', async () => {
  const model = new MockLanguageModelV3({ doGenerate: response('Referência esp32 preservada; conteúdo incorporado omitido.') });
  const request = input();
  request.messages = [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read-image', toolName: 'visual_action', output: {
    type: 'json', value: { id: 'esp32', references: [{ image: 'data:image/png;base64,PRIVATE_IMAGE'.repeat(20_000), pdf: 'data:application/pdf;base64,PRIVATE_PDF', audio: 'data:audio/webm;base64,PRIVATE_AUDIO', plain: 'data:text/plain;base64,PRIVATE_TEXT' }],
      buffer: new Uint8Array([177, 188, 199]).buffer, view: new DataView(new ArrayBuffer(16)), typed: new Uint16Array([33777, 33888]) } as never,
  } }] }];
  await generateChatSummary(request, model);
  const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
  expect(prompt).toContain('esp32');
  expect(prompt.includes('content omitted')).toBe(true);
  expect(/PRIVATE_|33777|33888|177|188|199/.test(prompt)).toBe(false);
  expect(prompt.length).toBeLessThan(3000);
});

it.each(['', '   ', 'x'.repeat(2000)])('rejects empty or over-budget output without offering a memory replacement', async (text) => {
  const model = new MockLanguageModelV3({ doGenerate: response(text) });
  await expect(generateChatSummary(input(), model)).rejects.toThrow('chatCompactionInvalid');
});

it('rejects a length-truncated summary', async () => {
  const model = new MockLanguageModelV3({ doGenerate: { ...response('Objetivo cortado'), finishReason: { unified: 'length', raw: 'length' } } });
  await expect(generateChatSummary(input(), model)).rejects.toThrow('chatCompactionIncomplete');
});

it('honors cancellation before requesting the provider', async () => {
  const controller = new AbortController(); controller.abort();
  const model = new MockLanguageModelV3({ doGenerate: response('Não usar') });
  await expect(generateChatSummary({ ...input(), signal: controller.signal }, model)).rejects.toMatchObject({ name: 'AbortError' });
  expect(model.doGenerateCalls).toHaveLength(0);
});

it('does not silently retry rate limits', async () => {
  const failure = new APICallError({ message: 'Capacity', statusCode: 429, isRetryable: true, url: 'https://example.test/summary', requestBodyValues: {} });
  const model = new MockLanguageModelV3({ doGenerate: async () => { throw failure; } });
  await expect(generateChatSummary(input(), model)).rejects.toBe(failure);
  expect(model.doGenerateCalls).toHaveLength(1);
});

it('rejects a changed provider/model before using the lazy configured client', async () => {
  vi.spyOn(client, 'assertAIReady').mockImplementation(() => {});
  vi.spyOn(client, 'currentModelIds').mockReturnValue({ provider: 'anthropic', main: 'other', kb: 'other' });
  await expect(generateChatSummary(input())).rejects.toThrow('chatContextModelChanged');
});
