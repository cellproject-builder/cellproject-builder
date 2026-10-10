import { describe, expect, it } from 'vitest';
import type { PlannerSnapshot } from '@/workspace/types';
import { createWorkspaceBackup, restoreWorkspaceBackup, workspaceToDatabaseRows, chatToDatabaseRows, type ChatData, type WorkspaceData } from './workspaceTransfer';

const owner = 'da552827-202d-4adb-b035-ae25e71a0e6a';
const planner: PlannerSnapshot = {
  project: null, selectedNodeId: null, focusedParentId: null, lens: 'structure', viewMode: 'graph',
  detailPanelOpen: true, lastTutorNodeId: null, drafts: { node: { criterion: 'Measured result' } },
  objectiveDraft: {
    name: 'Plan draft', objective: 'Deliver', rules: ['Budget'], ruleDraft: '', plans: null,
    outlines: null, expanded: {}, expansion: null, outlineResearch: null, plansFor: null,
    selectedId: null, generatingSince: null, updatedAt: 1000,
  },
  pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null,
};

function fixture(): WorkspaceData {
  return {
    projects: { 'project-10': { id: 'project-10', name: 'Project', objective: 'Deliver', archived: false, createdAt: 1000, updatedAt: 2000, planner } },
    tasks: { 'task-10': { id: 'task-10', projectId: 'project-10', title: 'Build', description: 'Details', status: 'done', priority: 'high', dueDate: '', sprintId: 'sprint-10', sourceNodeId: 'node-10', sourcePlanId: 'plan-10', createdAt: 2000, updatedAt: 3000 } },
    sprints: { 'sprint-10': { id: 'sprint-10', projectId: 'project-10', name: 'Sprint', goal: 'Ship', startDate: '2026-10-08', endDate: '2026-10-22', status: 'completed', createdAt: 1000, completedAt: 4000 } },
    notes: {
      'note-10': { id: 'note-10', title: 'Diary', blocks: [{ id: 'block-10', type: 'check', text: 'Verify', checked: true, bold: true, italic: false }], projectId: 'project-10', taskId: 'task-10', folderId: 'folder-10', pinned: true, deletedAt: 4000, createdAt: 1000, updatedAt: 4000 },
      independent: { id: 'independent', title: '', blocks: [], projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: 0, updatedAt: 0 },
    },
    folders: { 'folder-10': { id: 'folder-10', name: 'Work' } },
    comments: { 'comment-10': { id: 'comment-10', projectId: 'project-10', taskId: 'task-10', body: 'Ready', author: 'assistant', createdAt: 3000, updatedAt: 4000 } },
    legacyImported: true,
  };
}

describe('portable workspace exports', () => {
  it('round-trips a versioned JSON backup without actions, credentials or view state', () => {
    const data = fixture();
    const runtime = { ...data, apiKey: 'private', activeProjectId: 'project-10', surface: 'notes', createProject: () => 'id' };
    const backup = createWorkspaceBackup(runtime, 5000);
    expect(backup).toMatchObject({ format: 'cellproject-workspace-backup', version: 1, exportedAt: '1970-01-01T00:00:05.000Z' });
    const restored = restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)));
    expect(restored).toEqual(data);
    expect(JSON.stringify(backup)).not.toContain('private');
    restored.notes['note-10'].blocks[0].text = 'Changed';
    expect(data.notes['note-10'].blocks[0].text).toBe('Verify');
  });

  it('accepts legacy records without comments and rejects an unsupported backup version', () => {
    const data = fixture();
    delete data.comments;
    const backup = createWorkspaceBackup(data, 5000);
    expect(restoreWorkspaceBackup(backup).comments).toEqual({});
    expect(workspaceToDatabaseRows(data, owner, 5000).rows.task_comments).toEqual([]);
    expect(() => restoreWorkspaceBackup({ ...backup, version: 2 })).toThrow('Unsupported workspace backup');
    expect(() => restoreWorkspaceBackup({ ...backup, data: { projects: {} } })).toThrow('Invalid workspace backup');
  });

  it('maps text IDs, owner-scoped links, timestamps, optional dates and structured content to SQL rows', () => {
    const data = fixture();
    const snapshot = workspaceToDatabaseRows(data, owner, 5000);
    expect(snapshot).toMatchObject({ format: 'cellproject-workspace-rows', version: 1, exportedAt: '1970-01-01T00:00:05.000Z', ownerId: owner });
    expect(snapshot.rows.projects).toEqual([{ owner_id: owner, id: 'project-10', name: 'Project', objective: 'Deliver', archived: false, created_at: '1970-01-01T00:00:01.000Z', updated_at: '1970-01-01T00:00:02.000Z', planner_snapshot: planner }]);
    expect(snapshot.rows.tasks).toEqual([{ owner_id: owner, id: 'task-10', project_id: 'project-10', title: 'Build', description: 'Details', status: 'done', priority: 'high', due_date: null, sprint_id: 'sprint-10', source_node_id: 'node-10', source_plan_id: 'plan-10', created_at: '1970-01-01T00:00:02.000Z', updated_at: '1970-01-01T00:00:03.000Z' }]);
    expect(snapshot.rows.sprints[0]).toMatchObject({ owner_id: owner, id: 'sprint-10', project_id: 'project-10', start_date: '2026-10-08', end_date: '2026-10-22', completed_at: '1970-01-01T00:00:04.000Z' });
    expect(snapshot.rows.notes[0]).toMatchObject({ owner_id: owner, id: 'note-10', project_id: 'project-10', task_id: 'task-10', folder_id: 'folder-10', blocks: data.notes['note-10'].blocks, deleted_at: '1970-01-01T00:00:04.000Z' });
    expect(snapshot.rows.notes[1]).toMatchObject({ project_id: null, task_id: null, folder_id: null, deleted_at: null, created_at: '1970-01-01T00:00:00.000Z' });
    expect(snapshot.rows.folders).toEqual([{ owner_id: owner, id: 'folder-10', name: 'Work' }]);
    expect(snapshot.rows.task_comments).toEqual([{ owner_id: owner, id: 'comment-10', project_id: 'project-10', task_id: 'task-10', body: 'Ready', author: 'assistant', created_at: '1970-01-01T00:00:03.000Z', updated_at: '1970-01-01T00:00:04.000Z' }]);
    expect(snapshot.rows.workspace_settings).toEqual([{ owner_id: owner, legacy_imported: true }]);
    snapshot.rows.notes[0].blocks[0].text = 'Changed';
    snapshot.rows.projects[0].planner_snapshot!.drafts.node.criterion = 'Changed';
    expect(data.notes['note-10'].blocks[0].text).toBe('Verify');
    expect(data.projects['project-10'].planner!.drafts.node.criterion).toBe('Measured result');
  });

  it('preserves present dates and converts absent optional values to null', () => {
    const data = fixture();
    const task = data.tasks['task-10'];
    task.dueDate = '2026-10-10';
    task.sprintId = null;
    delete task.sourcePlanId;
    delete task.sourceNodeId;
    delete data.projects['project-10'].planner;
    delete data.sprints['sprint-10'].completedAt;
    data.sprints['sprint-10'].status = 'planned';
    const rows = workspaceToDatabaseRows(data, owner, 5000).rows;
    expect(rows.tasks[0]).toMatchObject({ due_date: '2026-10-10', sprint_id: null, source_node_id: null, source_plan_id: null });
    expect(rows.projects[0].planner_snapshot).toBeNull();
    expect(rows.sprints[0].completed_at).toBeNull();
  });

  it('rejects invalid ownership and timestamps instead of silently corrupting an export', () => {
    const data = fixture();
    expect(() => workspaceToDatabaseRows(data, '', 5000)).toThrow('Invalid owner ID');
    data.tasks['task-10'].createdAt = Number.NaN;
    expect(() => workspaceToDatabaseRows(data, owner, 5000)).toThrow('Invalid timestamp');
  });
});

describe('separate chat export', () => {
  it('maps visible messages, action traces and safe model history without copying credentials', () => {
    const data: ChatData = {
      sessionId: 'session-10',
      messages: [
        { id: 'message-1', role: 'user', text: 'Create a task', createdAt: 1000 },
        { id: 'message-2', role: 'assistant', text: 'Created', createdAt: 2000, interrupted: true, actions: [{ id: 'action-1', name: 'workspace_action', action: 'create_task', status: 'done', detail: 'Task created' }] },
      ],
      modelHistory: [
        { role: 'user', content: 'Create a task', providerOptions: { private: { apiKey: 'never-export' } } },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'workspace_action', output: { type: 'json', value: { ok: true, api_key: 'never-export', nested: { authorization: 'never-export', label: 'safe' } } } }] },
      ],
    };
    const runtime = { ...data, apiKey: 'never-export' };
    const rows = chatToDatabaseRows(runtime, owner).rows;
    expect(rows.chat_sessions).toEqual([{ owner_id: owner, id: 'session-10', model_history: [
      { role: 'user', content: 'Create a task' },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'workspace_action', output: { type: 'json', value: { ok: true, nested: { label: 'safe' } } } }] },
    ] }]);
    expect(rows.chat_messages).toEqual([
      { owner_id: owner, id: 'message-1', session_id: 'session-10', position: 0, role: 'user', content: 'Create a task', actions: [], interrupted: false, created_at: '1970-01-01T00:00:01.000Z' },
      { owner_id: owner, id: 'message-2', session_id: 'session-10', position: 1, role: 'assistant', content: 'Created', actions: [{ id: 'action-1', name: 'workspace_action', action: 'create_task', status: 'done', detail: 'Task created' }], interrupted: true, created_at: '1970-01-01T00:00:02.000Z' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('never-export');
    rows.chat_messages[1].actions[0].detail = 'Changed';
    expect(data.messages[1].actions![0].detail).toBe('Task created');
  });

  it('includes archived sessions and preserves message order within each session', () => {
    const data: ChatData = {
      sessionId: 'current', messages: [], modelHistory: [],
      archivedSessions: [{ sessionId: 'old', messages: [{ id: 'old-message', role: 'user', text: 'Earlier', createdAt: 0 }], modelHistory: [{ role: 'user', content: 'Earlier' }] }],
    };
    const snapshot = chatToDatabaseRows(data, owner);
    expect(snapshot).toMatchObject({ format: 'cellproject-chat-rows', version: 1, ownerId: owner });
    expect(snapshot.rows.chat_sessions.map((session) => session.id)).toEqual(['old', 'current']);
    expect(snapshot.rows.chat_messages[0]).toMatchObject({ session_id: 'old', position: 0, content: 'Earlier', created_at: '1970-01-01T00:00:00.000Z' });
    expect(() => chatToDatabaseRows(data, 'invalid')).toThrow('Invalid owner ID');
  });
});
