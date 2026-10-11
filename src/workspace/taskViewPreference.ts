import { readPreference, writePreference } from '@/cloud/storage';

export type TaskView = 'board' | 'list';
const VIEW_KEY = 'dynamic_diary:task-view';
export function readTaskViewPreference(): TaskView {
  try { return readPreference(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; }
}
export function writeTaskViewPreference(view: TaskView) { writePreference(VIEW_KEY, view); }
