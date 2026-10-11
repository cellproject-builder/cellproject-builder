import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { getPlannerOwnerId } from '@/workspace/planner';
import { getCloudRuntime } from '@/cloud/runtime';
import { getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from '@/visuals/domain';
import { storeCanvasFile } from '@/visuals/media';
import { canvasAttachmentsSchema, canvasResourceSchema, EMPTY_CANVAS_ATTACHMENTS, type CanvasAttachments, type CanvasResource } from './canvasModel';

export type CanvasAttachmentScope = { kind: 'board' | 'planner'; id: string };
export function getCanvasAttachments(scope: CanvasAttachmentScope): CanvasAttachments {
  if (scope.kind === 'board') return useWorkspaceStore.getState().boards[scope.id]?.attachments ?? EMPTY_CANVAS_ATTACHMENTS;
  const project = useGraphStore.getState().project;
  return project?.id === scope.id ? getVisualWorkspace(project).attachments ?? EMPTY_CANVAS_ATTACHMENTS : EMPTY_CANVAS_ATTACHMENTS;
}
export function updateCanvasAttachments(scope: CanvasAttachmentScope, update: (value: CanvasAttachments) => CanvasAttachments): void {
  const next = canvasAttachmentsSchema.parse(update(getCanvasAttachments(scope)));
  if (scope.kind === 'board') {
    const state = useWorkspaceStore.getState(), board = state.boards[scope.id];
    if (!board || board.archived || state.activeBoardId !== scope.id) throw new Error('attachmentContextChanged');
    state.updateBoard(scope.id, { attachments: next });
  } else {
    if (useGraphStore.getState().project?.id !== scope.id) throw new Error('attachmentContextChanged');
    mutateVisualWorkspace(workspace => ({ ...workspace, attachments: next }));
  }
}
/** Existing project text sources and studio/image originals appear without another upload. */
export function availableCanvasResources(scope: CanvasAttachmentScope): CanvasResource[] {
  const library = getCanvasAttachments(scope), resources = new Map(library.resources.map(resource => [resource.id, resource]));
  const add = (raw: unknown) => { const parsed = canvasResourceSchema.safeParse(raw); if (parsed.success && !resources.has(parsed.data.id)) resources.set(parsed.data.id, parsed.data); };
  if (scope.kind === 'planner') {
    const project = useGraphStore.getState().project;
    if (project?.id === scope.id) {
      const managed = useWorkspaceStore.getState().projects[getPlannerOwnerId() ?? ''];
      for (const file of managed?.attachments ?? []) add({ id: `file-${file.id}`, name: file.name, kind: file.kind === 'pdf' ? 'pdf' : 'text', mediaId: null, mime: file.kind === 'pdf' ? 'application/pdf' : 'text/plain', size: file.size, text: file.text, url: null, addedAt: file.addedAt, ...(file.pages ? { pages: file.pages } : {}) });
      const workspace = getVisualWorkspace(project);
      for (const artifact of workspace.artifacts) if (artifact.kind === 'image' && artifact.mediaId) add({ id: `image-${artifact.id}`, name: artifact.label || 'Imagem', kind: 'image', mediaId: artifact.mediaId, mime: 'image/png', size: 0, text: null, url: null, addedAt: 0 });
      const inputs = [...Object.values(workspace.drafts), ...workspace.proposals.map(proposal => proposal.input), ...workspace.artifacts.flatMap(artifact => artifact.revisions.flatMap(revision => revision.input ? [revision.input] : []))];
      for (const input of inputs) for (const file of input.attachments) add({ id: `studio-${file.id}`, name: file.name, kind: file.mime === 'application/pdf' ? 'pdf' : file.mime.startsWith('image/') ? 'image' : 'text', mediaId: file.mediaId, mime: file.mime, size: file.byteLength, text: file.text, url: null, addedAt: 0 });
    }
  }
  const hidden = new Set(library.hiddenResourceIds ?? []);
  return [...resources.values()].filter(resource => !hidden.has(resource.id)).slice(0, 100);
}
export function watchCanvasAttachmentScope(scope: CanvasAttachmentScope) {
  const owner = getCloudRuntime(), visual = scope.kind === 'planner' ? watchVisualScope() : null;
  let stale = false;
  const check = () => {
    if (getCloudRuntime() !== owner) stale = true;
    if (scope.kind === 'board') { const state = useWorkspaceStore.getState(); if (state.activeBoardId !== scope.id || !state.boards[scope.id] || state.boards[scope.id].archived) stale = true; }
    else if (useGraphStore.getState().project?.id !== scope.id) stale = true;
    try { visual?.assert(); } catch { stale = true; }
  };
  const off = useWorkspaceStore.subscribe(check);
  return { assert() { check(); if (stale) throw new Error('attachmentContextChanged'); }, dispose() { off(); visual?.dispose(); } };
}
export async function importCanvasResource(file: File, scope: CanvasAttachmentScope, signal?: AbortSignal): Promise<CanvasResource> {
  const guard = watchCanvasAttachmentScope(scope);
  try {
    guard.assert(); signal?.throwIfAborted();
    // Match original-file storage's legacy inference without uploading first.
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mime = file.type || ({ pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[ext] || '';
    const id = nanoid(12);
    const pending = canvasResourceSchema.parse({ id, name: file.name.slice(0, 240), kind: mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'text', mediaId: id, mime, size: file.size, text: null, url: null, addedAt: Date.now() });
    const initial = getCanvasAttachments(scope);
    canvasAttachmentsSchema.parse({ ...initial, resources: [...initial.resources, pending] });
    let text: string | null = null, pages: number | undefined;
    if (mime === 'application/pdf') {
      const header = file.slice(0, 5);
      const signature = typeof header.text === 'function' ? await header.text() : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(header);
      });
      guard.assert(); signal?.throwIfAborted();
      if (signature !== '%PDF-') throw new Error('visualPdfInvalid');
      const { extractPdfText } = await import('@/kb/extract');
      guard.assert(); signal?.throwIfAborted();
      const extracted = await extractPdfText(file, undefined, { signal, maxPages: 100, maxChars: 24_000 });
      text = extracted.text || null; pages = extracted.pageCount;
    } else if (mime.startsWith('text/')) text = (await file.text()).slice(0, 24_000);
    guard.assert(); signal?.throwIfAborted();
    const resource = canvasResourceSchema.parse({ ...pending, text, ...(pages !== undefined ? { pages } : {}) });
    // Extraction may outlive a concurrent library edit; validate its latest budget.
    const latest = getCanvasAttachments(scope);
    canvasAttachmentsSchema.parse({ ...latest, resources: [...latest.resources, resource] });
    const media = await storeCanvasFile(file, `${scope.kind}:${scope.id}`, signal);
    guard.assert(); signal?.throwIfAborted();
    return canvasResourceSchema.parse({ ...resource, mediaId: media.id, mime: media.mime, size: media.size });
  } finally { guard.dispose(); }
}
