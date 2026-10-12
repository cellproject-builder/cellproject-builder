import type { GraphState } from '@/store';

/** Editor selection, lens and panel state stay local until the next content snapshot. */
const fields = ['project', 'drafts', 'objectiveDraft', 'archivedProject', 'pendingSuggestions', 'parkedSuggestions', 'archivedPending', 'archivedSession'] as const;
export type PlannerContentSnapshot = Pick<GraphState, typeof fields[number]>;
export function plannerContentValues(state: PlannerContentSnapshot): readonly unknown[] { return fields.map(field => state[field]); }
export function plannerContentChanged(state: PlannerContentSnapshot, previous: PlannerContentSnapshot): boolean { return fields.some(field => state[field] !== previous[field]); }

/** Ownership travels with the singleton editor, outside each managed snapshot. */
export type EditorContentSnapshot = PlannerContentSnapshot & Pick<GraphState, 'plannerOwnerId'>;
export function editorContentValues(state: EditorContentSnapshot): readonly unknown[] { return [...plannerContentValues(state), state.plannerOwnerId]; }
