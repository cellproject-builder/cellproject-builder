import type { LanguageModel, ModelMessage } from 'ai';
import type { AssistantActionEvent } from './workspaceTools';
import { createWorkspaceAgent, type WorkspaceContextBudget, type WorkspaceContextEvent } from './agents/workspaceAgent';
import type { ChatTurnContext } from '@/chat/turnContext';
import { currentModelIds } from './client';
import { useConfigStore } from '@/config/store';
import { ChatContextBudgetError } from '@/chat/contextBudget';
import type { NoteEditBaseline } from './noteEditBaseline';
import type { PlannerEditBaseline } from './plannerEditBaseline';
import type { ChatCompactionCheckpoint, ChatSummarizer } from '@/chat/contextBudget';

export interface AssistantRun {
  messages: ModelMessage[];
  userText: string;
  contextProjectId?: string | null;
  turnContext?: ChatTurnContext;
  noteEditBaseline?: NoteEditBaseline | null;
  plannerEditBaseline?: PlannerEditBaseline | null;
  contextBudget?: WorkspaceContextBudget;
  compaction?: ChatCompactionCheckpoint | null;
  summarize?: ChatSummarizer;
  onContext?: (event: WorkspaceContextEvent) => void;
  signal: AbortSignal;
  model?: LanguageModel;
  onText: (text: string) => void;
  onAction: (event: AssistantActionEvent) => void;
}

type AssistantResult = { text: string; messages: ModelMessage[]; contextMessages?: ModelMessage[]; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
/** Completed observations/actions remain available even if the model omitted its answer. */
export class ChatFinalAnswerError extends Error {
  readonly messages: ModelMessage[];
  readonly contextMessages?: ModelMessage[];
  readonly usage?: AssistantResult['usage'];
  constructor(result: Pick<AssistantResult, 'messages' | 'contextMessages' | 'usage'>) {
    super('chatFinalAnswerMissing');
    this.name = 'ChatFinalAnswerError';
    this.messages = result.messages;
    this.contextMessages = result.contextMessages;
    this.usage = result.usage;
  }
}

// UI adapter. The SDK agent owns the model/tool loop; chat keeps its existing
// accumulated-text callbacks and persisted ModelMessage conversation format.
export async function runAssistant(options: AssistantRun): Promise<AssistantResult> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort(options.signal.reason);
  options.signal.addEventListener('abort', stop, { once: true });
  const scope = options.model ? null : currentModelIds();
  // Cancel shared nested generators while they are awaiting a provider. Their
  // signal checks run before committing results, including automatic visuals.
  const unsubscribe = options.model ? () => {} : useConfigStore.subscribe(() => {
    const current = currentModelIds();
    if (!current || current.provider !== scope?.provider || current.main !== scope?.main) {
      controller.abort(new ChatContextBudgetError('chatContextModelChanged'));
    }
  });
  try {
    const { agent, assertActive, contextMessages } = createWorkspaceAgent({ ...options, signal: controller.signal });
    const result = await agent.stream({ messages: options.messages, abortSignal: controller.signal });
    let text = '';
    // Consume fullStream: textStream alone filters errors and can return partial
    // text as if the request succeeded. Keep the original provider error for UI.
    for await (const part of result.fullStream) {
      assertActive();
      if (part.type === 'text-start' && text) text += '\n\n';
      if (part.type === 'text-delta') { text += part.text; options.onText(text); }
      if (part.type === 'error') throw part.error;
    }
    assertActive();
    // SDK usage describes the final step; totalUsage sums all requests and is unsuitable for context occupancy.
    const usage = await result.usage;
    const response = await result.response;
    const finalStep = (await result.steps).at(-1);
    assertActive();
    const completed = { text, messages: response.messages, contextMessages: contextMessages(response.messages) ?? undefined,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } };
    // A progress sentence preceding tool calls is not a final answer. Neither
    // an empty last step nor an ignored toolChoice may become generic success.
    if (!finalStep?.text.trim() || finalStep.toolCalls.length || ['tool-calls', 'length', 'error', 'content-filter'].includes(finalStep.finishReason)) {
      throw new ChatFinalAnswerError(completed);
    }
    // Progress remains in the SDK transcript; the visible answer is the final
    // synthesis, not every promise emitted before a read or mutation.
    completed.text = finalStep.text;
    if (text !== completed.text) options.onText(completed.text);
    return completed;
  } finally {
    unsubscribe();
    options.signal.removeEventListener('abort', stop);
  }
}
