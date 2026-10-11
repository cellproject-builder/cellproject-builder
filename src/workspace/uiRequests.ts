import { create } from 'zustand';
import { useWorkspaceStore } from './store';
import { openPlanner } from './planner';
import type { Surface } from './types';

export interface UIRequest { surface?: Surface; projectId?: string | null; noteId?: string; taskId?: string; boardId?: string; settings?: boolean }
export const useUIRequests = create<{ request: UIRequest | null }>(() => ({ request: null }));
export function requestWorkspaceUI(request: UIRequest) {
  const state = useWorkspaceStore.getState();
  if (request.surface === 'boards' || request.boardId) {
    if (request.surface && request.surface !== 'boards' || request.projectId || request.noteId || request.taskId) throw new Error('Boards are independent; choose a single board destination.');
    const board = request.boardId ? state.boards[request.boardId] : null;
    if (request.boardId && (!board || board.archived)) throw new Error('Requested board does not exist or is archived.');
    const target: UIRequest = { ...request, surface: 'boards', projectId: null };
    useWorkspaceStore.setState({ activeBoardId: board?.id ?? null, activeProjectId: null, surface: 'boards' });
    useUIRequests.setState({ request: target });
    return target;
  }
  const task = request.taskId ? state.tasks[request.taskId] : undefined;
  const note = request.noteId ? state.notes[request.noteId] : undefined;
  if ((request.taskId && !task) || (request.noteId && !note)) throw new Error('Requested record does not exist.');
  const resourceProjectId = task?.projectId ?? note?.projectId;
  if (task && note && task.projectId !== note.projectId) throw new Error('Requested records belong to different projects.');
  if (resourceProjectId !== undefined && request.projectId !== undefined && resourceProjectId !== request.projectId) throw new Error('Requested record belongs to a different project.');
  const target = { ...request, ...(resourceProjectId !== undefined ? { projectId: resourceProjectId } : {}) };
  if (target.projectId) {
    if (target.surface === 'planner') openPlanner(target.projectId);
    state.selectProject(target.projectId);
  }
  if (target.projectId === null) useWorkspaceStore.setState({ activeProjectId: null });
  if (target.surface) state.navigate(target.surface);
  useUIRequests.setState({ request: target });
  return target;
}
