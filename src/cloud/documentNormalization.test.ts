import { describe, expect, it } from 'vitest';
import { mergeCloudDocument } from './documentMerge';
import { normalizePlannerDocument } from './documentNormalization';

const envelope = (state: unknown, version = 6) => ({ state, version });

describe('normalizePlannerDocument', () => {
  it('equates a legacy graph with its hydrated planner defaults', () => {
    const legacy = envelope({ project: { id: 'p1' }, objectiveDraft: { premise: 'Original' } });
    const hydrated = envelope({ project: { id: 'p1' }, objectiveDraft: { premise: 'Original', expanded: {} }, archivedSession: null });

    expect(normalizePlannerDocument('cellproject-graph', legacy)).toEqual(hydrated);
    expect(normalizePlannerDocument('cellproject-graph', hydrated)).toBe(hydrated);
    expect(legacy).toEqual(envelope({ project: { id: 'p1' }, objectiveDraft: { premise: 'Original' } }));
  });

  it('normalizes every existing managed planner, including its archived objective draft', () => {
    const input = envelope({ projects: {
      p1: { id: 'p1', planner: { project: { id: 'plan1' }, objectiveDraft: { premise: 'Active' } } },
      p2: { id: 'p2', planner: { archivedSession: { projectId: 'old', objectiveDraft: { premise: 'Archived' } } } },
      p3: { id: 'p3' },
    } }, 2);

    expect(normalizePlannerDocument('cellproject-workspace', input)).toEqual(envelope({ projects: {
      p1: { id: 'p1', planner: { project: { id: 'plan1' }, objectiveDraft: { premise: 'Active', expanded: {} }, archivedSession: null } },
      p2: { id: 'p2', planner: { archivedSession: { projectId: 'old', objectiveDraft: { premise: 'Archived', expanded: {} } } } },
      p3: { id: 'p3' },
    } }, 2));
  });

  it('normalizes a graph archived objective draft without filling unrelated missing fields', () => {
    const input = envelope({ archivedSession: { projectId: 'old', objectiveDraft: { premise: 'Kept' } } });
    expect(normalizePlannerDocument('cellproject-graph', input)).toEqual(envelope({
      archivedSession: { projectId: 'old', objectiveDraft: { premise: 'Kept', expanded: {} } },
    }));
  });

  it('preserves populated defaults and unrelated content', () => {
    const input = envelope({
      plannerOwnerId: 'managed-p1', project: { id: 'plan1', name: 'Untouched' },
      objectiveDraft: { premise: 'Active', expanded: { child: { title: 'Retained' } } },
      archivedSession: { projectId: 'old', objectiveDraft: { expanded: { older: { title: 'Archived' } } }, drafts: { n1: 'Draft' } },
    });
    expect(normalizePlannerDocument('cellproject-graph', input)).toBe(input);
  });

  it.each([null, false, 3, 'invalid', []])('preserves an explicitly supplied invalid expanded value: %j', (expanded) => {
    const input = envelope({ archivedSession: null, objectiveDraft: { expanded } });
    expect(normalizePlannerDocument('cellproject-graph', input)).toBe(input);
  });

  it.each([null, false, 3, 'invalid', []])('does not replace an explicitly supplied malformed planner: %j', (planner) => {
    const input = envelope({ projects: { p1: { planner } } }, 2);
    expect(normalizePlannerDocument('cellproject-workspace', input)).toBe(input);
  });

  it('preserves malformed and absent objective drafts and archived sessions for validation', () => {
    const input = envelope({ projects: {
      p1: { planner: { archivedSession: { objectiveDraft: null }, objectiveDraft: false } },
      p2: { planner: { archivedSession: false } },
      p3: { planner: { archivedSession: null } },
    } }, 2);
    expect(normalizePlannerDocument('cellproject-workspace', input)).toBe(input);
  });

  it('never normalizes planner-like objects outside the exact planner paths', () => {
    const untouched = { objectiveDraft: { premise: 'Not a planner' }, archivedSession: { objectiveDraft: { premise: 'Not archived' } } };
    const input = envelope({
      ...untouched,
      tasks: { t1: untouched }, notes: { n1: untouched },
      projects: { p1: { ...untouched, planner: {
        archivedSession: null,
        project: untouched,
        metadata: untouched,
        objectiveDraft: { expanded: {}, archivedSession: untouched },
      } } },
    }, 2);
    expect(normalizePlannerDocument('cellproject-workspace', input)).toBe(input);
  });

  it.each(['cellproject-preferences', 'cellproject-chat', 'cellproject-unknown'])('ignores other document keys: %s', (key) => {
    const input = envelope({ objectiveDraft: {}, projects: { p1: { planner: {} } } });
    expect(normalizePlannerDocument(key, input)).toBe(input);
  });

  it.each([null, false, 'invalid', [], {}, { state: null }, { state: [] }, { state: { projects: [] } }])('does not synthesize missing envelopes or planner containers: %j', (input) => {
    expect(normalizePlannerDocument('cellproject-workspace', input)).toBe(input);
  });

  it('does not mutate frozen input and is idempotent', () => {
    const input = Object.freeze({ state: Object.freeze({
      objectiveDraft: Object.freeze({ premise: 'Active' }),
      archivedSession: Object.freeze({ objectiveDraft: Object.freeze({ premise: 'Archived' }) }),
    }), version: 6 });
    const normalized = normalizePlannerDocument('cellproject-graph', input);
    expect(normalized).toEqual(envelope({
      objectiveDraft: { premise: 'Active', expanded: {} },
      archivedSession: { objectiveDraft: { premise: 'Archived', expanded: {} } },
    }));
    expect(normalizePlannerDocument('cellproject-graph', normalized)).toBe(normalized);
  });
});

describe('planner default normalization during cloud reconciliation', () => {
  const project = { id: 'plan1', nodes: {}, edges: {} };
  const state = (planner: object, title = 'Original note') => ({
    projects: { p1: { id: 'p1', planner } },
    notes: { n1: { id: 'n1', title } },
  });
  const reconcile = (base: object, local: object, remote: object) => {
    const result = mergeCloudDocument('cellproject-workspace', JSON.stringify(envelope(base, 2)),
      JSON.stringify(envelope(local, 2)), JSON.stringify(envelope(remote, 2)));
    return result === null ? null : JSON.parse(result).state;
  };

  it('retains the remote archived session when a local note edit only hydrated the missing null default', () => {
    const legacyPlanner = { project, objectiveDraft: { premise: 'Current' } };
    const archivedSession = {
      projectId: 'old-plan', drafts: { old: 'Preserved draft' },
      objectiveDraft: { premise: 'Retained objective', expanded: { paid: { content: 'Retained paid expansion' } } },
    };
    const remotePlanner = { ...legacyPlanner, archivedSession };

    expect(reconcile(state(legacyPlanner), state({
      ...legacyPlanner, archivedSession: null, objectiveDraft: { premise: 'Current', expanded: {} },
    }, 'Edited locally'), state(remotePlanner))).toEqual(state({
      ...remotePlanner, objectiveDraft: { premise: 'Current', expanded: {} },
    }, 'Edited locally'));
  });

  it('retains the remote paid expansion when a local note edit only hydrated an empty expanded map', () => {
    const legacyPlanner = { project, archivedSession: null, objectiveDraft: { premise: 'Current' } };
    const remotePlanner = { ...legacyPlanner, objectiveDraft: {
      premise: 'Current', expanded: { paid: { content: 'Paid result retained exactly', cost: 0.03 } },
    } };

    expect(reconcile(state(legacyPlanner), state({
      ...legacyPlanner, objectiveDraft: { premise: 'Current', expanded: {} },
    }, 'Edited locally'), state(remotePlanner))).toEqual(state(remotePlanner, 'Edited locally'));
  });

  it('keeps concurrent prose edits to the same expanded child conflicted', () => {
    const planner = (content: string) => ({ project, archivedSession: null,
      objectiveDraft: { premise: 'Current', expanded: { paid: { content } } },
    });
    expect(reconcile(state(planner('Original result')), state(planner('Local revision')),
      state(planner('Remote revision')))).toBeNull();
  });
});
