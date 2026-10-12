import { useWorkspaceStore } from '@/workspace/store';

type Collection = 'projects' | 'tasks' | 'sprints' | 'notes' | 'comments';
const fields: Record<Collection, string[]> = { projects: ['objective'], tasks: ['description'], sprints: ['goal'], notes: ['blocks'], comments: ['body'] };
const sourceText = (value: unknown) => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
interface Coverage { source: string; complete: boolean; ranges: [number, number][] }
type Replacement = { action: string; id?: string; patch?: Record<string, unknown>; body?: string };
const replacementTarget = (input: Replacement): [Collection, string] | null => input.action === 'update_project' ? ['projects', 'objective'] : input.action === 'update_task' ? ['tasks', 'description']
  : input.action === 'update_note' ? ['notes', 'blocks'] : input.action === 'update_comment' ? ['comments', 'body'] : null;
const replacementValue = (input: Replacement, collection: Collection, field: string) => collection === 'comments' ? input.body : collection === 'notes'
  ? input.patch?.blocks !== undefined ? input.patch.blocks : input.patch?.text : input.patch?.[field];

/** Per-run read receipts, kept private. Partial reads never bless destructive
 * text replacement; append and unrelated metadata edits remain independent. */
export function createWorkspaceReadCoverage() {
  const coverage = new Map<string, Coverage>();
  const record = (collection: Collection, id: string) => (useWorkspaceStore.getState()[collection] as unknown as Record<string, Record<string, unknown>>)[id];
  const get = (collection: Collection, id: string, field: string, source: string) => {
    const key = `${collection}:${id}:${field}`, previous = coverage.get(key);
    if (previous?.source === source) return previous;
    const next: Coverage = { source, complete: false, ranges: [] }; coverage.set(key, next); return next;
  };
  const observe = (input: { collection: string; id?: string; textField?: string }, result: { items: Record<string, unknown>[]; text?: { field?: string; offset: number; content?: string } }) => {
    if (!(input.collection in fields)) return;
    const collection = input.collection as Collection;
    for (const item of result.items) {
      if (typeof item.id !== 'string') continue;
      const current = record(collection, item.id); if (!current) continue;
      if (input.textField && result.text) {
        const field = input.textField; if (!fields[collection].includes(field)) continue;
        const source = sourceText(current[field]), entry = get(collection, item.id, field, source);
        const { offset, content = '' } = result.text;
        if (source.slice(offset, offset + content.length) !== content) continue;
        entry.ranges.push([offset, offset + content.length]);
        let end = 0;
        for (const range of entry.ranges.sort((a, b) => a[0] - b[0])) { if (range[0] > end) break; end = Math.max(end, range[1]); }
        entry.complete = end >= source.length;
      } else {
        const truncated = Array.isArray(item.truncatedFields) ? item.truncatedFields : [];
        for (const field of fields[collection]) {
          const source = sourceText(current[field]), entry = get(collection, item.id, field, source);
          if (field in item && item[field] !== undefined && !truncated.some(path => path === field || typeof path === 'string' && path.startsWith(`${field}.`))) entry.complete = true;
        }
      }
    }
  };
  const assertReplacement = (input: Replacement, userText: string) => {
    const target = replacementTarget(input);
    if (!target || !input.id) return;
    const [collection, field] = target as [Collection, string];
    const value = replacementValue(input, collection, field);
    if (value === undefined) return;
    // New literal text supplied by the human need not be derived from a source.
    if (typeof value === 'string' && value.trim() && userText.includes(value)) return;
    const entry = coverage.get(`${collection}:${input.id}:${field}`);
    const current = record(collection, input.id), currentSource = sourceText(current?.[field]);
    const blocks = collection === 'notes' ? current?.blocks as { type: string; text: string }[] | undefined : undefined;
    const empty = blocks ? blocks.length === 0 || blocks.length === 1 && blocks[0].type === 'text' && !blocks[0].text : !currentSource;
    if (!empty && (!entry || !entry.complete || entry.source !== currentSource)) {
      throw new Error(`Incomplete source: read the complete current ${field} using textField/textOffset before replacing it. Preserve the original content or append instead.`);
    }
  };
  // Capture the synchronous own write before awaiting persistence. A later
  // external edit cannot become part of this receipt.
  const captureOwnReplacement = (input: Replacement) => {
    const target = replacementTarget(input);
    if (!target || !input.id || replacementValue(input, ...target) === undefined) return () => {};
    const [collection, field] = target, key = `${collection}:${input.id}:${field}`, source = sourceText(record(collection, input.id)?.[field]);
    return () => coverage.set(key, { source, complete: true, ranges: [] });
  };
  return { observe, assertReplacement, captureOwnReplacement };
}
