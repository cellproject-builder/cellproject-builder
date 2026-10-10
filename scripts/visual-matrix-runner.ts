/** Node-only safety helpers for the explicit, paid comparison CLI. */
import { createHash } from 'node:crypto';

export const ATTEMPT_RESERVATION_USD = .25;
export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** Keep the process lock until every in-flight worker settles after any failure. */
export async function coordinateWorkers(worker: (shouldStop: () => boolean) => Promise<void>, count = 2): Promise<void> {
  let stopped = false;
  const outcomes = await Promise.allSettled(Array.from({ length: count }, async () => {
    try { await worker(() => stopped); }
    catch (error) { stopped = true; throw error; }
  }));
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

export function accountedCost(runs: { status: string; usage: { costUsd: number | null } }[]): number {
  return runs.reduce((total, run) => total + (run.status === 'running' || run.status === 'success' || run.status === 'failed'
    ? run.usage.costUsd ?? ATTEMPT_RESERVATION_USD : 0), 0);
}

export function safeRawText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.flatMap(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []);
    return texts.length ? texts.join('') : null;
  }
  return null;
}

/** Check the actual provider payload immediately before the only remote fetch. */
export function verifyReferenceFetch(expected: { systemPrompt: string; userText: string; imageHash: string | null; mimeType: string | null }, remote: typeof fetch): typeof fetch {
  return async (url, init) => {
    let body: { messages?: { role?: string; content?: unknown }[] };
    try { body = JSON.parse(typeof init?.body === 'string' ? init.body : ''); } catch { throw new Error('matrixRequestMismatch'); }
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length !== 2 || messages[0].role !== 'system' || messages[1].role !== 'user') throw new Error('matrixRequestMismatch');
    const system = messages[0].content;
    // OpenRouter serializes the SDK system message as one text part. Require
    // exact content in either representation; do not permit appended guidance.
    if (typeof system === 'string' ? system !== expected.systemPrompt
      : !Array.isArray(system) || system.length !== 1 || system[0]?.type !== 'text' || system[0]?.text !== expected.systemPrompt) throw new Error('matrixRequestMismatch');
    const content = messages[1].content;
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    if (!Array.isArray(parts)) throw new Error('matrixRequestMismatch');
    const texts = parts.filter(part => part?.type === 'text');
    const images = parts.filter(part => part?.type === 'image_url');
    if (parts.length !== texts.length + images.length || texts.length !== 1 || texts[0].text !== expected.userText || images.length !== (expected.imageHash ? 1 : 0)) throw new Error('matrixRequestMismatch');
    if (expected.imageHash) {
      const value = images[0]?.image_url?.url;
      const prefix = `data:${expected.mimeType};base64,`;
      if (typeof value !== 'string' || !value.startsWith(prefix) || sha256(Buffer.from(value.slice(prefix.length), 'base64')) !== expected.imageHash) throw new Error('matrixRequestMismatch');
    }
    return remote(url, init);
  };
}
