import type { LanguageModel, ModelMessage } from 'ai';
import type { AssistantActionEvent } from './workspaceTools';
import { createWorkspaceAgent } from './agents/workspaceAgent';

export interface AssistantRun {
  messages: ModelMessage[];
  userText: string;
  contextProjectId?: string | null;
  signal: AbortSignal;
  model?: LanguageModel;
  onText: (text: string) => void;
  onAction: (event: AssistantActionEvent) => void;
}

// UI adapter. The SDK agent owns the model/tool loop; chat keeps its existing
// accumulated-text callbacks and persisted ModelMessage conversation format.
export async function runAssistant(options: AssistantRun): Promise<{ text: string; messages: ModelMessage[] }> {
  const { agent, assertActive } = createWorkspaceAgent(options);
  const result = await agent.stream({ messages: options.messages, abortSignal: options.signal });
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
  return { text, messages: (await result.response).messages };
}
