import { describe, expect, it } from 'vitest';
import { mergeCloudDocument } from './documentMerge';

const task = { id: 't', projectId: 'p', title: 'Shared task', description: 'Original', status: 'todo', updatedAt: 100 };
const envelope = (value: unknown) => JSON.stringify({ version: 2, state: { tasks: { t: value } } });
const merge = (local: object, remote: object) => {
  const value = mergeCloudDocument('cellproject-workspace', envelope(task), envelope({ ...task, ...local }), envelope({ ...task, ...remote }));
  return value === null ? null : JSON.parse(value).state.tasks.t;
};

describe('task workflow reconciliation', () => {
  it.each([['review', 'doing'], ['todo', 'done'], ['doing', 'review'], ['done', 'review']])('rebases a pending %s command over %s and retains remote prose', (local, remote) => {
    const base = { ...task, status: local === 'todo' ? 'doing' : 'todo' };
    const result = mergeCloudDocument('cellproject-workspace', envelope(base), envelope({ ...base, status: local, updatedAt: 2 }),
      envelope({ ...base, status: remote, description: 'Remote details', updatedAt: 9000 }));
    expect(result && JSON.parse(result).state.tasks.t).toEqual({ ...base, status: local, description: 'Remote details', updatedAt: 9000 });
  });

  it('does not replay an unchanged stale status while another field changes', () => {
    expect(merge({ title: 'Local title' }, { status: 'doing', description: 'Remote details' }))
      .toEqual({ ...task, title: 'Local title', status: 'doing', description: 'Remote details' });
  });

  it('still blocks conflicting prose even when statuses also changed', () => {
    expect(merge({ status: 'review', description: 'Local details' }, { status: 'doing', description: 'Remote details' })).toBeNull();
  });

  it.each([{ status: 'invalid' }, { projectId: 'other', status: 'review' }, { id: 'other', status: 'review' }])('does not apply workflow policy to invalid or reassigned task identities: %j', local => {
    expect(merge(local, { status: 'doing' })).toBeNull();
  });

  it.each([{ projectId: 'other' }, { projectId: 'other', status: 'doing' }, { status: 'invalid' }])('keeps a remote move or invalid status conflicted with a local workflow command: %j', remote => {
    expect(merge({ status: 'review' }, remote)).toBeNull();
  });

  it('keeps a local move conflicted with remote edits even when only one status changed', () => {
    expect(merge({ projectId: 'other', status: 'review' }, { description: 'Remote details' })).toBeNull();
  });

  it('keeps deletion versus status editing conflicted', () => {
    expect(mergeCloudDocument('cellproject-workspace', envelope(task), envelope({ ...task, status: 'review' }),
      JSON.stringify({ version: 2, state: { tasks: {} } }))).toBeNull();
  });

  it('keeps status fields outside the task collection conservative', () => {
    const wrap = (status: string) => JSON.stringify({ version: 2, state: { other: { ...task, status } } });
    expect(mergeCloudDocument('cellproject-workspace', wrap('todo'), wrap('review'), wrap('doing'))).toBeNull();
  });
});
