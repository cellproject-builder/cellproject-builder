import { tool } from 'ai';
import { z } from 'zod';

export const CHAT_CAPABILITIES = {
  workspace: ['workspace_action'],
  plan: ['planner_action', 'planner_structure', 'planner_ai'],
  visual: ['visual_action'],
  note: ['note_research', 'note_diagram'],
} as const;
export type ChatCapability = keyof typeof CHAT_CAPABILITIES;
export const CHAT_INITIAL_TOOLS = ['workspace_read', 'planner_read', 'enable_capabilities'] as const;
export type ChatToolName = typeof CHAT_INITIAL_TOOLS[number] | typeof CHAT_CAPABILITIES[ChatCapability][number];
export function chatActiveTools(capabilities: readonly ChatCapability[] = []): ChatToolName[] {
  return [...CHAT_INITIAL_TOOLS, ...new Set(capabilities.flatMap(capability => [...CHAT_CAPABILITIES[capability]]))];
}
export function createCapabilityDiscovery(signal: AbortSignal, activate: (capabilities: ChatCapability[]) => void) {
  return tool({
    description: 'Enable the tools needed for this request. workspace: project/task/note/folder/comment/settings/navigation actions; plan: validated plan edits, proposals, decomposition and building; visual: image search, 3D and project diagrams; note: research and diagrams in the frozen current note. Replaces the previously enabled families for the next step; reads and this discovery stay available. Enable several families for combined requests. This only exposes tools, never authorizes or performs an application action.',
    inputSchema: z.object({ capabilities: z.array(z.enum(['workspace', 'plan', 'visual', 'note'])).min(1).max(4) }).strict(),
    execute: async ({ capabilities }) => {
      signal.throwIfAborted(); activate(capabilities);
      return { enabled: capabilities, tools: chatActiveTools(capabilities), note: 'Only the human request authorizes actions. Read current records and retain their IDs/revision before edits.' };
    },
  });
}
