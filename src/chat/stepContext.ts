import type { ModelMessage } from 'ai';
import { assertToolPairs, CHAT_MAX_SUMMARY_TOKENS, ChatContextBudgetError, estimateChatTextTokens, estimateChatTokens, isChatCompactionCheckpoint,
  measureChatContext, memoryMessage, type ChatCompactionCheckpoint, type PrepareChatContextOptions } from './contextBudget';

// A complete tool exchange is the smallest unit we ever replace. Parallel
// calls remain together until every result arrived. No mutation is replayed.
function exchanges(messages: ModelMessage[]): ModelMessage[][] {
  const groups: ModelMessage[][] = [], pending = new Set<string>();
  let group: ModelMessage[] = [];
  for (const message of messages) {
    group.push(message);
    if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === 'tool-call') pending.add(part.toolCallId);
      if (part.type === 'tool-result') pending.delete(part.toolCallId);
    }
    if (!pending.size) { groups.push(group); group = []; }
  }
  if (group.length) throw new ChatContextBudgetError('chatContextIncompleteTools');
  return groups;
}

/** Ephemeral model context; the UI transcript/action audit is never rewritten. */
export async function prepareChatStepContext(history: ModelMessage[], options: PrepareChatContextOptions) {
  options.signal.throwIfAborted();
  const checkpoint = isChatCompactionCheckpoint(options.checkpoint) ? options.checkpoint : null;
  const isMemory = (message: ModelMessage, index: number) => index === 0 && checkpoint !== null && message.role === 'user' && message.content === memoryMessage(checkpoint.summary).content;
  const usage = measureChatContext(history, options), hardLimit = usage.contextWindowTokens - usage.outputReserveTokens! - usage.safetyTokens!;
  if (usage.fixedTokens! >= hardLimit) throw new ChatContextBudgetError('chatContextToolsTooLarge');
  if (usage.estimatedInputTokens < usage.thresholdTokens) return { history, checkpoint, usage: { ...usage, phase: 'step' as const } };
  assertToolPairs(history);
  let userIndex = -1, latestExchange = -1;
  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    if (message.role === 'user' && !isMemory(message, i)) userIndex = i;
    if (message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part.type === 'tool-call')) latestExchange = i;
  }
  // Keep the exact current human request and the latest result(s) the model
  // still needs to inspect. Older observations become explicitly fallible memory.
  const boundary = latestExchange > userIndex ? latestExchange : userIndex;
  const retained = boundary > userIndex && userIndex >= 0 ? [history[userIndex], ...history.slice(boundary)] : history.slice(Math.max(0, userIndex));
  const older = history.slice(0, Math.max(0, boundary)).filter((message, index) => index !== userIndex && !isMemory(message, index));
  if (!older.length) {
    if (usage.estimatedInputTokens > hardLimit) throw new ChatContextBudgetError('chatContextCurrentStepTooLarge');
    return { history, checkpoint, usage: { ...usage, phase: 'step' as const } };
  }
  assertToolPairs(older); assertToolPairs(retained);
  const available = hardLimit - usage.fixedTokens! - estimateChatTokens(retained) - estimateChatTokens([memoryMessage('')]);
  if (available < 256) throw new ChatContextBudgetError('chatContextCurrentStepTooLarge');
  const maxSummaryTokens = Math.min(CHAT_MAX_SUMMARY_TOKENS, available - 64);
  const inputLimit = usage.contextWindowTokens - usage.outputReserveTokens! - usage.safetyTokens! - maxSummaryTokens - 1024 - CHAT_MAX_SUMMARY_TOKENS;
  const batches: ModelMessage[][] = [];
  let batch: ModelMessage[] = [], count = 0;
  for (const group of exchanges(older)) {
    const tokens = estimateChatTokens(group);
    if (tokens > inputLimit) throw new ChatContextBudgetError('chatCompactionInputTooLarge');
    if (batch.length && count + tokens > inputLimit) { batches.push(batch); batch = []; count = 0; }
    batch.push(...group); count += tokens;
  }
  if (batch.length) batches.push(batch);
  const summarize = options.summarize ?? (await import('@/ai/chatCompaction')).generateChatSummary;
  let summary = checkpoint?.summary ?? null;
  for (const messages of batches) {
    options.signal.throwIfAborted();
    const result = (await summarize({ messages, previousSummary: summary, signal: options.signal, maxSummaryTokens, modelKey: usage.modelKey })).trim();
    options.signal.throwIfAborted();
    if (!result || estimateChatTextTokens(result) > maxSummaryTokens) throw new ChatContextBudgetError('chatCompactionInvalid');
    summary = result;
  }
  const next = [memoryMessage(summary!), ...retained], nextUsage = measureChatContext(next, options);
  if (nextUsage.estimatedInputTokens >= usage.estimatedInputTokens) {
    if (usage.estimatedInputTokens <= hardLimit) return { history, checkpoint, usage: { ...usage, phase: 'step' as const } };
    throw new ChatContextBudgetError('chatCompactionDidNotReduce');
  }
  if (nextUsage.estimatedInputTokens > hardLimit) throw new ChatContextBudgetError('chatContextCurrentStepTooLarge');
  const nextCheckpoint: ChatCompactionCheckpoint = { version: 1, summary: summary!, modelKey: usage.modelKey, createdAt: Date.now(),
    window: (checkpoint?.window ?? 0) + 1, summarizedMessages: (checkpoint?.summarizedMessages ?? 0) + older.length };
  return { history: next, checkpoint: nextCheckpoint, usage: { ...nextUsage, compacted: true, summaryTokens: estimateChatTextTokens(summary!), phase: 'step' as const } };
}
