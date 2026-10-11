import type { MentionTarget, VisualArtifact } from '@/visuals/types';
import { canRevealAICriterionNow } from '@/store';
import { readPlanner } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { summarizeNoteCanvas } from '@/workspace/noteCanvasSummary';
import { summarizeBoard } from '@/boards/summary';

export type ChatReferenceKind = MentionTarget['kind'] | 'file' | 'project' | 'board' | 'diagram' | 'model';
export interface ChatNoteSelection { blockId: string; start: number; end: number; original: string }
export interface ChatReferenceTarget extends Omit<MentionTarget, 'kind'> { kind: ChatReferenceKind; projectId: string | null; planId: string | null; noteSelection?: ChatNoteSelection }
export type ChatReferenceIdentity = Pick<ChatReferenceTarget, 'id' | 'kind' | 'projectId'> & Partial<Pick<ChatReferenceTarget, 'planId' | 'noteSelection'>>;
export type ChatReferenceHandoffTarget = Omit<ChatReferenceTarget, 'projectId' | 'planId'> & Partial<Pick<ChatReferenceTarget, 'projectId' | 'planId'>>;
export interface ChatNoteSelectionSnapshot { blockId: string; start: number; end: number; text: string; truncated: boolean }
export interface ChatReferenceSnapshot extends Omit<ChatReferenceTarget, 'noteSelection'> { noteSelection?: ChatNoteSelectionSnapshot; content: string; truncated: boolean }
export const CHAT_REFERENCE_LIMIT = 20;
const PER_SOURCE_LIMIT = 8_000, TOTAL_CONTEXT_LIMIT = 48_000;
type Source = { target: Omit<ChatReferenceTarget, 'fingerprint'>; read: () => { content: string; revision?: unknown } };
function fingerprint(value: unknown) {
  const text = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
function metadata(source: Source): ChatReferenceTarget {
  const snapshot = source.read();
  return { ...source.target, fingerprint: fingerprint([snapshot.content, snapshot.revision]) };
}
function withNoteSelection(target: ChatReferenceTarget, selection?: ChatNoteSelection): ChatReferenceTarget {
  if (selection === undefined) return target;
  if (target.kind !== 'note' || !selection || typeof selection.blockId !== 'string' || typeof selection.original !== 'string' || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end <= selection.start || selection.end > selection.original.length) throw new Error('chatReferenceSelectionChanged');
  const note = useWorkspaceStore.getState().notes[target.id];
  const block = note?.blocks.find(block => block.id === selection.blockId);
  if (!note || note.deletedAt !== null || note.projectId !== target.projectId || !block || block.text !== selection.original) throw new Error('chatReferenceSelectionChanged');
  return { ...target, noteSelection: { ...selection } };
}
function diagramSummary(diagram: VisualArtifact['diagram']) {
  return diagram ? { title: diagram.title, explanation: diagram.explanation, assumptions: diagram.assumptions,
    parameters: diagram.parameters, labels: diagram.elements.filter(element => element.type === 'text').map(element => element.text),
    note: 'Resumo textual do diagrama; caminhos SVG, código e imagens não enviados.' } : null;
}
function modelSummary(scene: VisualArtifact['scene']) {
  return scene ? { label: scene.label, objectCount: scene.objects.length,
    objectTypes: Object.fromEntries([...new Set(scene.objects.map(object => object.type))].map(type => [type, scene.objects.filter(object => object.type === type).length])),
    note: 'Resumo textual 3D; geometria e dimensões não analisadas nem enviadas.' } : null;
}
function sources() {
  const workspace = useWorkspaceStore.getState();
  const result: Source[] = [];
  for (const managed of Object.values(workspace.projects)) {
    const projectId = managed.id;
    result.push({ target: { id: managed.id, kind: 'project', label: managed.name, detail: managed.archived ? 'Projeto arquivado' : 'Projeto', projectId, planId: null },
      read: () => ({ content: JSON.stringify({ name: managed.name, objective: managed.objective, archived: managed.archived }), revision: managed.updatedAt }) });
    for (const file of managed.attachments ?? []) {
      result.push({ target: { id: file.id, kind: 'file', label: file.name, detail: `${managed.name} · ${file.truncated ? 'Anexo parcial' : 'Anexo'}`, projectId, planId: null },
        read: () => ({ content: JSON.stringify({ filename: file.name, text: file.text, truncated: file.truncated, kind: file.kind }), revision: file.fingerprint }) });
    }
    const project = readPlanner(projectId).project;
    if (!project) continue;
    for (const node of Object.values(project.nodes)) {
      result.push({ target: { id: node.id, kind: 'node', label: node.name, detail: `${managed.name} · ${node.kind}`, projectId, planId: project.id },
        // A field allowlist keeps the independent AI criterion hidden until the existing validation contract permits it.
        read: () => ({ content: JSON.stringify({ name: node.name, kind: node.kind, oQue: node.oQue, porQue: node.porQue, notes: node.notes, comoConfirmarUsuario: node.comoConfirmarUsuario, comoConfirmarAtendido: node.comoConfirmarAtendido, ...(canRevealAICriterionNow(node) ? { comoConfirmar: node.comoConfirmar } : {}) }), revision: [node.comoConfirmarUsuarioAt, node.aiCriterionSeenAt] }) });
    }
    for (const artifact of project.visuals?.artifacts ?? []) {
      result.push({ target: { id: artifact.id, kind: artifact.kind, label: artifact.label, detail: `${managed.name} · ${artifact.kind === 'image' ? 'Imagem' : artifact.kind === 'model' ? '3D' : 'Diagrama'}`, projectId, planId: project.id },
        read: () => ({ content: JSON.stringify({ label: artifact.label, linkedNodeId: artifact.linkedNodeId, ...(artifact.kind === 'image' ? {
          source: artifact.source ? { title: artifact.source.title, description: artifact.source.description, sourcePageUrl: artifact.source.sourcePageUrl, credit: artifact.source.credit, license: artifact.source.license } : null,
          imageNote: 'Referência textual. Pixels não analisados; não inferir dimensões ou características físicas.',
        } : artifact.kind === 'diagram' ? { diagram: diagramSummary(artifact.diagram), values: artifact.diagramValues } : { model: modelSummary(artifact.scene) }) }), revision: [artifact.revisionIndex, artifact.mediaId] }) });
    }
  }
  for (const note of Object.values(workspace.notes)) {
    if (note.deletedAt !== null || note.projectId && !workspace.projects[note.projectId]) continue;
    result.push({ target: { id: note.id, kind: 'note', label: note.title || 'Nota sem título', detail: note.projectId ? `${workspace.projects[note.projectId].name} · Nota` : 'Nota pessoal', projectId: note.projectId, planId: null },
      read: () => ({ content: JSON.stringify({ title: note.title, blocks: note.blocks, canvasSummary: summarizeNoteCanvas(note.canvas, true) }), revision: note.updatedAt }) });
  }
  for (const board of Object.values(workspace.boards)) {
    if (board.archived) continue;
    result.push({ target: { id: board.id, kind: 'board', label: board.title, detail: 'Dynamic Board', projectId: null, planId: null },
      read: () => ({ content: JSON.stringify({ title: board.title, ...summarizeBoard(board.document, true), note: 'Resumo textual; pixels, geometria e pontos de desenho não enviados.' }), revision: board.updatedAt }) });
  }
  return result;
}
/** Local metadata only: @ never calls a model. Source bodies are not returned by the picker. */
export function listChatReferences(query: string, projectId: string | null): ChatReferenceTarget[] {
  const needle = query.replace(/^@/, '').trim().toLocaleLowerCase();
  return sources().filter(source => `${source.target.label} ${source.target.detail}`.toLocaleLowerCase().includes(needle))
    .sort((left, right) => Number(right.target.projectId === projectId) - Number(left.target.projectId === projectId))
    .slice(0, 100).map(metadata);
}
/** Resolve an explicit source identity without the suggestion list's result cap. */
export function resolveChatReferenceTarget(identity: ChatReferenceIdentity): ChatReferenceTarget {
  const source = sources().find(source => source.target.id === identity.id && source.target.kind === identity.kind && source.target.projectId === identity.projectId && (identity.planId === undefined || source.target.planId === identity.planId));
  if (!source) throw new Error('chatReferenceMissing');
  return withNoteSelection(metadata(source), identity.noteSelection);
}
/** Freeze explicit sources from their own origins. Their project IDs never retarget the action context. */
export function resolveChatReferences(selected: ChatReferenceTarget[], _projectId: string | null): ChatReferenceSnapshot[] {
  if (selected.length > CHAT_REFERENCE_LIMIT) throw new Error('chatReferenceLimit');
  const available = sources(), used = new Set<string>();
  let remaining = TOTAL_CONTEXT_LIMIT;
  return selected.map(target => {
    const source = available.find(source => source.target.id === target.id && source.target.kind === target.kind && source.target.projectId === target.projectId && source.target.planId === target.planId);
    if (!source) throw new Error('chatReferenceMissing');
    const current = metadata(source);
    if (current.fingerprint !== target.fingerprint) throw new Error('chatReferenceChanged');
    const { noteSelection, ...snapshotTarget } = withNoteSelection(current, target.noteSelection);
    const identity = `${target.kind}:${target.projectId}:${target.planId}:${target.id}`;
    if (used.has(identity)) throw new Error('chatReferenceDuplicate'); used.add(identity);
    if (remaining <= 0) throw new Error('chatReferenceLimit');
    const original = source.read().content;
    if (noteSelection) {
      const budget = Math.min(PER_SOURCE_LIMIT, remaining);
      if (budget <= 128) throw new Error('chatReferenceLimit');
      const passage = noteSelection.original.slice(noteSelection.start, noteSelection.end);
      // The selected text appears in both metadata and content; charge both copies.
      const text = passage.slice(0, Math.floor((budget - 128) / 2));
      const selectedPassage = { blockId: noteSelection.blockId, start: noteSelection.start, end: noteSelection.end, text, truncated: text.length < passage.length };
      const prefix = `Selected note passage (truncated=${selectedPassage.truncated}):\n${text}\n\nNote source context:\n`;
      const marker = '\n[Note context truncated]';
      const sourceExcerpt = original.slice(0, Math.max(0, budget - text.length - prefix.length - marker.length));
      const sourceTruncated = sourceExcerpt.length < original.length;
      const content = prefix + sourceExcerpt + (sourceTruncated ? marker : '');
      remaining -= content.length + text.length;
      return { ...snapshotTarget, noteSelection: selectedPassage, content, truncated: sourceTruncated || selectedPassage.truncated };
    }
    const content = original.slice(0, Math.min(PER_SOURCE_LIMIT, remaining)); remaining -= content.length;
    return { ...snapshotTarget, content, truncated: content.length < original.length };
  });
}

export function chatReferenceError(reason: unknown, english: boolean) {
  const code = reason instanceof Error ? reason.message : '';
  if (code === 'chatReferenceLimit') return english ? 'Use up to 20 references. Reduce the selection to fit the context limit.' : 'Use até 20 referências. Reduza a seleção para caber no limite de contexto.';
  if (code === 'chatReferenceChanged') return english ? 'A reference changed. Remove it and select its current version with @.' : 'Uma referência mudou. Remova e selecione a versão atual com @.';
  if (code === 'chatReferenceSelectionChanged') return english ? 'This note passage changed or is no longer available. Select it again in the note.' : 'Este trecho da nota mudou ou não está mais disponível. Selecione-o novamente na nota.';
  if (code === 'chatReferenceSelectionConflict') return english ? 'Send or remove the current passage reference before choosing another.' : 'Envie ou remova a referência do trecho atual antes de escolher outro.';
  if (code === 'chatReferenceHandoffConflict') return english ? 'Your draft contains references from another source. Review the selection before continuing.' : 'Seu rascunho contém referências de outra origem. Revise a seleção antes de continuar.';
  if (code === 'chatReferenceScope') return english ? 'The source project is no longer available. Remove it or choose another reference.' : 'O projeto de origem não está mais disponível. Remova ou escolha outra referência.';
  return english ? 'A reference is no longer available. Remove it and select another with @.' : 'Uma referência não está mais disponível. Remova e selecione outra com @.';
}
