import { create } from 'zustand';
import { useWorkspaceStore } from '@/workspace/store';
import { readPlanner } from '@/workspace/planner';
import type { Surface } from '@/workspace/types';
import { useChatPresentation } from './presentation';

/** Frozen at human submission. References are separate, explicit sources, not navigation or an action target. */
export interface ChatTurnContext {
  surface: Surface;
  displayMode: 'popup' | 'expanded';
  visibleProjectId: string | null;
  projectId: string | null;
  projectName: string | null;
  planId: string | null;
  selectedNodeId: string | null;
  nodeName: string | null;
  noteId: string | null;
  noteTitle: string | null;
  boardId: string | null;
  boardTitle: string | null;
  viewMode: string | null;
  lens: string | null;
  excerpt: string;
  date: string;
}

/** Ephemeral editor identity only; note bodies and chat state stay in their owning stores. */
export const useChatFocusStore = create<{ noteId: string | null; noteScopeProjectId: string | null }>(() => ({ noteId: null, noteScopeProjectId: null }));
let noteFocusOwner: symbol | null = null;
export function publishChatNoteFocus(noteId: string | null, noteScopeProjectId: string | null) {
  const owner = Symbol('note-editor'); noteFocusOwner = owner;
  useChatFocusStore.setState({ noteId, noteScopeProjectId });
  return () => {
    if (noteFocusOwner !== owner) return;
    noteFocusOwner = null;
    useChatFocusStore.setState({ noteId: null, noteScopeProjectId: null });
  };
}

function noteExcerpt(blocks: { text: string }[]) {
  let excerpt = '';
  for (const block of blocks) {
    if (excerpt.length >= 1200) break;
    const separator = excerpt ? '\n' : '';
    excerpt += (separator + block.text).slice(0, 1200 - excerpt.length);
  }
  return excerpt;
}

export function captureChatTurnContext(): ChatTurnContext {
  const state = useWorkspaceStore.getState(), focus = useChatFocusStore.getState();
  const surface = state.surface;
  const candidateNote = surface === 'notes' && focus.noteId ? state.notes[focus.noteId] : null;
  const note = candidateNote?.deletedAt === null ? candidateNote : null;
  const projectSurface = ['overview', 'planner', 'kanban', 'scrum'].includes(surface);
  const candidateProjectId = projectSurface ? state.activeProjectId : surface === 'notes' ? note ? note.projectId : focus.noteScopeProjectId : null;
  const project = candidateProjectId ? state.projects[candidateProjectId] : null;
  const visibleProjectId = project?.id ?? null;
  // A loaded graph may belong to a different project; resolve through the planner's ownership boundary.
  const planner = surface === 'planner' && visibleProjectId ? readPlanner(visibleProjectId) : null;
  const plan = planner?.project;
  const node = planner?.selectedNodeId && plan ? plan.nodes[planner.selectedNodeId] : null;
  const candidateBoard = surface === 'boards' && state.activeBoardId ? state.boards[state.activeBoardId] : null;
  const board = candidateBoard && !candidateBoard.archived ? candidateBoard : null;
  // Public visible prose only. Never serialize the node, hidden independent criterion, geometry or pixels.
  const excerpt = (note ? noteExcerpt(note.blocks) : node ? [node.oQue, node.porQue].filter(Boolean).join('\n') : project?.objective ?? '').slice(0, 1200);
  return Object.freeze({
    surface, displayMode: useChatPresentation.getState().expanded ? 'expanded' : 'popup', visibleProjectId, projectId: visibleProjectId, projectName: project?.name ?? null,
    planId: plan?.id ?? null, selectedNodeId: node?.id ?? null, nodeName: node?.name ?? null,
    noteId: note?.id ?? null, noteTitle: note?.title ?? null, boardId: board?.id ?? null, boardTitle: board?.title ?? null,
    viewMode: planner?.viewMode ?? null, lens: planner?.lens ?? null, excerpt, date: new Date().toLocaleDateString('en-CA'),
  });
}
