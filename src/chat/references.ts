import type { MentionTarget } from '@/visuals/types';
import { canRevealAICriterionNow } from '@/store';
import { readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
export interface ChatReferenceTarget extends Omit<MentionTarget, 'kind'> { kind: MentionTarget['kind'] | 'file'; projectId: string | null; planId: string | null }
export interface ChatReferenceSnapshot extends ChatReferenceTarget { content: string; truncated: boolean }
export const CHAT_REFERENCE_LIMIT = 20;
const PER_SOURCE_LIMIT = 8_000, TOTAL_CONTEXT_LIMIT = 48_000;
function fingerprint(value: unknown) {
  const text = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
function sources(projectId: string | null) {
  const workspace = useWorkspaceStore.getState();
  if (projectId && !workspace.projects[projectId]) throw new Error('chatReferenceScope');
  const project = projectId ? readPlanner(projectId).project : null;
  const result: Array<{ target: ChatReferenceTarget; content: string }> = [];
  for (const file of projectId ? workspace.projects[projectId]?.attachments ?? [] : []) {
    const content = JSON.stringify({ filename: file.name, text: file.text, truncated: file.truncated, kind: file.kind });
    result.push({ target: { id: file.id, kind: 'file', label: file.name, detail: file.truncated ? 'Anexo · trecho' : 'Anexo do projeto', projectId, planId: null, fingerprint: fingerprint(content) }, content });
  }
  for (const note of Object.values(workspace.notes)) {
    if (note.deletedAt !== null || (note.projectId !== null && note.projectId !== projectId)) continue;
    const content = JSON.stringify({ title: note.title, blocks: note.blocks });
    result.push({ target: { id: note.id, kind: 'note', label: note.title || 'Nota sem título', detail: note.projectId ? 'Nota do projeto' : 'Nota pessoal', projectId: note.projectId, planId: null, fingerprint: fingerprint([content, note.updatedAt]) }, content });
  }
  if (!project) return result;
  for (const node of Object.values(project.nodes)) {
    // Serialize a field allowlist, never the whole node or its hidden AI criterion.
    const content = JSON.stringify({ name: node.name, kind: node.kind, oQue: node.oQue, porQue: node.porQue, notes: node.notes, comoConfirmarUsuario: node.comoConfirmarUsuario, comoConfirmarAtendido: node.comoConfirmarAtendido, ...(canRevealAICriterionNow(node) ? { comoConfirmar: node.comoConfirmar } : {}) });
    result.push({ target: { id: node.id, kind: 'node', label: node.name, detail: node.kind, projectId, planId: project.id, fingerprint: fingerprint([content, node.comoConfirmarUsuarioAt, node.aiCriterionSeenAt]) }, content });
  }
  for (const image of project.visuals?.artifacts ?? []) {
    if (image.kind !== 'image') continue;
    const content = JSON.stringify({ label: image.label, source: image.source ? { title: image.source.title, description: image.source.description, sourcePageUrl: image.source.sourcePageUrl, credit: image.source.credit, license: image.source.license } : null, mediaId: image.mediaId, revisionIndex: image.revisionIndex, imageNote: 'Referência textual. Pixels não analisados; não inferir dimensões ou características físicas.' });
    result.push({ target: { id: image.id, kind: 'image', label: image.label, detail: 'Imagem do plano', projectId, planId: project.id, fingerprint: fingerprint(content) }, content });
  }
  return result;
}
/** Metadata only: searching or selecting @ never calls a model or sends source bodies. */
export function listChatReferences(query: string, projectId: string | null): ChatReferenceTarget[] {
  const needle = query.replace(/^@/, '').trim().toLocaleLowerCase();
  return sources(projectId).map(source => source.target).filter(target => target.label.toLocaleLowerCase().includes(needle)).slice(0, 100);
}
/** Freeze the actual selected records once, immediately before the human submits. */
export function resolveChatReferences(selected: ChatReferenceTarget[], projectId: string | null): ChatReferenceSnapshot[] {
  if (selected.length > CHAT_REFERENCE_LIMIT) throw new Error('chatReferenceLimit');
  const available = sources(projectId), used = new Set<string>();
  let remaining = TOTAL_CONTEXT_LIMIT;
  return selected.map(target => {
    if (target.projectId !== null && target.projectId !== projectId) throw new Error('chatReferenceScope');
    const source = available.find(source => source.target.id === target.id && source.target.kind === target.kind && source.target.projectId === target.projectId && source.target.planId === target.planId);
    if (!source) throw new Error('chatReferenceMissing');
    if (source.target.fingerprint !== target.fingerprint) throw new Error('chatReferenceChanged');
    const identity = `${target.kind}:${target.projectId}:${target.id}`;
    if (used.has(identity)) throw new Error('chatReferenceDuplicate'); used.add(identity);
    if (remaining <= 0) throw new Error('chatReferenceLimit');
    const content = source.content.slice(0, Math.min(PER_SOURCE_LIMIT, remaining)); remaining -= content.length;
    return { ...source.target, content, truncated: content.length < source.content.length };
  });
}

export function chatReferenceError(reason: unknown, english: boolean) {
  const code = reason instanceof Error ? reason.message : '';
  if (code === 'chatReferenceLimit') return english ? 'Use up to 20 references. Reduce the selection to fit the context limit.' : 'Use até 20 referências. Reduza a seleção para caber no limite de contexto.';
  if (code === 'chatReferenceChanged') return english ? 'A reference changed. Remove it and select its current version with @.' : 'Uma referência mudou. Remova e selecione a versão atual com @.';
  if (code === 'chatReferenceHandoffConflict') return english ? 'Your draft already references another project. Remove those references before bringing this source to the chat.' : 'Seu rascunho já referencia outro projeto. Remova essas referências antes de trazer esta fonte ao chat.';
  if (code === 'chatReferenceScope') return english ? 'These references belong to another or removed project. Remove them or return to that project.' : 'As referências pertencem a outro projeto ou a um projeto removido. Remova ou volte ao projeto de origem.';
  return english ? 'A reference is no longer available. Remove it and select another with @.' : 'Uma referência não está mais disponível. Remova e selecione outra com @.';
}
