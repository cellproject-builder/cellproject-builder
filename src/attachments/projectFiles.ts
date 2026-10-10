import { useWorkspaceStore } from '@/workspace/store';
import { mergePlanFiles, type PlanFile } from './files';

export function projectFiles(projectId: string | null): PlanFile[] {
  return projectId ? useWorkspaceStore.getState().projects[projectId]?.attachments ?? [] : [];
}
export function addProjectFiles(projectId: string, files: PlanFile[]) {
  return setProjectFiles(projectId, mergePlanFiles(projectFiles(projectId), files));
}
export function setProjectFiles(projectId: string, files: PlanFile[]) {
  const state = useWorkspaceStore.getState(), project = state.projects[projectId];
  if (!project) throw new Error('projectMissing');
  const attachments = mergePlanFiles([], files);
  useWorkspaceStore.setState({ projects: { ...state.projects, [projectId]: { ...project, attachments, updatedAt: Date.now() } } });
  return attachments;
}
export function removeProjectFile(projectId: string, fileId: string) {
  const state = useWorkspaceStore.getState(), project = state.projects[projectId];
  if (!project) throw new Error('projectMissing');
  useWorkspaceStore.setState({ projects: { ...state.projects, [projectId]: { ...project, attachments: (project.attachments ?? []).filter(file => file.id !== fileId), updatedAt: Date.now() } } });
}
