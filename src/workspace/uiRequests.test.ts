import { beforeEach, expect, it } from 'vitest';
import { useWorkspaceStore } from './store';
import { requestWorkspaceUI, useUIRequests } from './uiRequests';

beforeEach(async () => {
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ projects: {}, boards: {}, notes: {}, tasks: {}, surface: 'projects', activeProjectId: null, activeBoardId: null, legacyImported: true });
  useUIRequests.setState({ request: null });
});

it('rejects absent, archived or mixed board targets before changing navigation', () => {
  const projectId = useWorkspaceStore.getState().createProject('Current project');
  const boardId = useWorkspaceStore.getState().createBoard('Archived board');
  useWorkspaceStore.getState().updateBoard(boardId, { archived: true });
  useWorkspaceStore.getState().navigate('projects');
  const before = useWorkspaceStore.getState();
  expect(() => requestWorkspaceUI({ surface: 'boards', boardId: 'missing' })).toThrow('Requested board');
  expect(() => requestWorkspaceUI({ surface: 'boards', boardId })).toThrow('archived');
  expect(() => requestWorkspaceUI({ surface: 'boards', projectId })).toThrow('independent');
  expect(() => requestWorkspaceUI({ surface: 'notes', boardId })).toThrow('independent');
  expect(useWorkspaceStore.getState()).toBe(before);
  expect(useUIRequests.getState().request).toBeNull();
});

it('opens a board by its stable ID and opens the board library without a stale project', () => {
  const boardId = useWorkspaceStore.getState().createBoard('Specific board');
  useWorkspaceStore.getState().createProject('Previous project');
  expect(requestWorkspaceUI({ boardId })).toMatchObject({ surface: 'boards', boardId, projectId: null });
  expect(useWorkspaceStore.getState()).toMatchObject({ surface: 'boards', activeBoardId: boardId, activeProjectId: null });
  requestWorkspaceUI({ surface: 'boards' });
  expect(useWorkspaceStore.getState().activeBoardId).toBeNull();
});
