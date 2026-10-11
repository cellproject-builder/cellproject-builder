import type { LanguageModel, ModelMessage } from 'ai';
import type { AssistantActionEvent } from './workspaceTools';
import { createWorkspaceAgent, type WorkspaceContextBudget } from './agents/workspaceAgent';
import type { ChatTurnContext } from '@/chat/turnContext';
import { currentModelIds } from './client';
import { useConfigStore } from '@/config/store';
import { ChatContextBudgetError } from '@/chat/contextBudget';
import type { NoteEditBaseline } from './noteEditBaseline';

export interface AssistantRun {
  messages: ModelMessage[];
  userText: string;
  contextProjectId?: string | null;
  turnContext?: ChatTurnContext;
  noteEditBaseline?: NoteEditBaseline | null;
  contextBudget?: WorkspaceContextBudget;
  signal: AbortSignal;
  model?: LanguageModel;
  onText: (text: string) => void;
  onAction: (event: AssistantActionEvent) => void;
}

// UI adapter. The SDK agent owns the model/tool loop; chat keeps its existing
// accumulated-text callbacks and persisted ModelMessage conversation format.
export async function runAssistant(options: AssistantRun): Promise<{ text: string; messages: ModelMessage[]; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
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
    const { agent, assertActive } = createWorkspaceAgent({ ...options, signal: controller.signal });
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
    assertActive();
    return { text, messages: response.messages, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } };
  } finally {
    unsubscribe();
    options.signal.removeEventListener('abort', stop);
  }
}
