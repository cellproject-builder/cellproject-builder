import { readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { sourceFingerprint } from '@/attachments/files';
import { resolveVisualContext } from './domain';
import type { VisualPromptInput } from './types';

export interface ProjectSearchSource { id: string; label: string; kind: string; text: string; truncated: boolean }
export interface ProjectSearchContext { revision: string; partial: boolean; sources: ProjectSearchSource[] }
const encoder = new TextEncoder();
function prefix(text: string, fits: (value: string) => boolean) {
  let low = 0, high = text.length, result = '';
  while (low <= high) {
    const middle = (low + high) >>> 1;
    let value = text.slice(0, middle); if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
    if (fits(value)) { result = value; low = middle + 1; } else high = middle - 1;
  }
  return result;
}
/** Current project only. Independent criteria and unrelated personal sources never enter this context. */
export function collectProjectSearchContext(projectId: string): ProjectSearchContext {
  const workspace = useWorkspaceStore.getState(), managed = workspace.projects[projectId];
  if (!managed) throw new Error('visualProjectMissing');
  const plan = readPlanner(projectId).project;
  const all: ProjectSearchSource[] = [];
  const add = (id: string, label: string, kind: string, text: string, truncated = false) => all.push({ id, label, kind, text, truncated });
  add(`project:${projectId}`, managed.name, 'project', [managed.objective, plan?.objective, ...(plan?.rules ?? [])].filter(Boolean).join('\n'));
  for (const file of managed.attachments ?? []) add(`file:${file.id}`, file.name, 'file', file.text, file.truncated);
  for (const node of Object.values(plan?.nodes ?? {})) {
    const connections = Object.values(plan?.edges ?? {}).filter(edge => edge.source === node.id || edge.target === node.id).map(edge => ({ from: `node:${edge.source}`, to: `node:${edge.target}`, kind: edge.kind, ...(edge.middlewareNodeId ? { via: `node:${edge.middlewareNodeId}` } : {}), ...(edge.note ? { note: edge.note } : {}) }));
    const scope = { parentSourceId: node.parentId ? `node:${node.parentId}` : null, parentName: node.parentId ? plan?.nodes[node.parentId]?.name : null, order: node.order, connections };
    add(`node:${node.id}`, node.name, 'node', [node.name, node.oQue, node.porQue, node.fx, node.problem, node.failureContext, node.notes, JSON.stringify(scope)].filter(Boolean).join('\n'));
  }
  for (const note of Object.values(workspace.notes)) if (note.projectId === projectId && !note.deletedAt) add(`note:${note.id}`, note.title, 'note', [note.title, ...note.blocks.map(block => block.text)].join('\n'));
  for (const task of Object.values(workspace.tasks)) if (task.projectId === projectId) add(`task:${task.id}`, task.title, 'task', [task.title, task.description].join('\n'));
  const chosen = all.slice(0, 120), budget = Math.floor(32000 / Math.max(1, chosen.length));
  const sources = chosen.map(source => {
    const metadata = { id: source.id.slice(0, 140), label: prefix(source.label, text => encoder.encode(JSON.stringify(text)).length <= 96), kind: source.kind };
    const text = prefix(source.text.slice(0, 8000), text => encoder.encode(JSON.stringify({ ...metadata, text, truncated: true })).length <= budget);
    return { ...metadata, text, truncated: source.truncated || text.length < source.text.length };
  });
  return { revision: sourceFingerprint(JSON.stringify([projectId, plan?.id, plan?.rootId, all])), partial: chosen.length < all.length || sources.some(source => source.truncated), sources };
}

export function assertProjectSearchCurrent(projectId: string, revision: string) {
  if (collectProjectSearchContext(projectId).revision !== revision) throw new Error('visualSearchContextChanged');
}
export function chatImageSearchRevision(projectId: string, input: VisualPromptInput) {
  return sourceFingerprint(JSON.stringify([collectProjectSearchContext(projectId).revision, resolveVisualContext(input).fingerprint]));
}
