const DEFAULT_LIMIT = 8192;
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).byteLength;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown) => typeof value === 'string' ? value : '';

/** Find the largest prefix that fits without splitting a surrogate pair. */
function prefix(text: string, fits: (value: string) => boolean): string {
  let low = 0, high = text.length, best = '';
  while (low <= high) {
    const middle = (low + high) >>> 1;
    let value = text.slice(0, middle);
    if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
    if (fits(value)) { best = value; low = middle + 1; } else high = middle - 1;
  }
  return best;
}
const clip = (value: unknown, limit: number) => prefix(string(value), value => bytes(value) <= limit);

function excerpt(metadata: Record<string, string>, text: string, budget: number) {
  // Leave space for source content even when a label or MIME is unusually long.
  while (bytes(JSON.stringify({ ...metadata, text: '', truncated: true })) > budget - 48) {
    const longest = Object.keys(metadata).sort((a, b) => bytes(metadata[b]) - bytes(metadata[a]))[0];
    if (!longest || !metadata[longest]) break;
    metadata[longest] = clip(metadata[longest], Math.floor(bytes(metadata[longest]) / 2));
  }
  const content = prefix(text, value => bytes(JSON.stringify({ ...metadata, text: value, truncated: value !== text })) <= budget);
  return { ...metadata, text: content, truncated: content !== text };
}

function projectContext(value: unknown, budget: number) {
  const source = record(value) ? value : {};
  const name = clip(source.name, 128);
  const rules = Array.isArray(source.rules) ? source.rules.filter(rule => typeof rule === 'string').slice(0, 12).map(rule => clip(rule, 128)) : [];
  while (rules.length && bytes(JSON.stringify({ name, objective: '', rules })) > budget - 128) rules.pop();
  const objective = prefix(string(source.objective), value => bytes(JSON.stringify({ name, objective: value, rules })) <= budget);
  return { name, objective, rules };
}

/** Compact only the already-authorized context; no store lookup or new references. */
export function compactSearchContext(text: string, budget = DEFAULT_LIMIT): string {
  const limit = Number.isFinite(budget) ? Math.max(DEFAULT_LIMIT, Math.min(48000, Math.floor(budget))) : DEFAULT_LIMIT;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* Legacy context can be plain text. */ }
  if (!record(parsed) || (!Array.isArray(parsed.selected) && !Array.isArray(parsed.attachments) && !record(parsed.project))) {
    if (bytes(text) <= limit) return text;
    const notice = '\n[Selected context truncated for image search.]';
    return prefix(text, value => bytes(value) <= limit - bytes(notice)) + notice;
  }
  const selected = Array.isArray(parsed.selected) ? parsed.selected.filter(record).slice(0, 20) : [];
  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments.filter(record).slice(0, 8) : [];
  const selectedInputs = selected.map(source => ({ metadata: { kind: clip(source.kind, 16), label: clip(source.label, 80) }, text: string(source.text) }));
  const attachmentInputs = attachments.map(source => ({ metadata: { name: clip(source.name, 80), mime: clip(source.mime, 48), ...(typeof source.imageNote === 'string' ? { imageNote: clip(source.imageNote, 96) } : {}) }, text: string(source.text) }));
  // Every explicit source gets its own share; a verbose first source cannot consume the next one.
  const sourceBudget = limit - 256 - 16;
  const perSource = Math.floor((sourceBudget - 128) / Math.max(1, selected.length + attachments.length));
  const compact = {
    selected: selectedInputs.map(source => excerpt({ ...source.metadata }, source.text, perSource)),
    attachments: attachmentInputs.map(source => excerpt({ ...source.metadata }, source.text, perSource)),
  };
  const inputs = [...selectedInputs, ...attachmentInputs], entries = [...compact.selected, ...compact.attachments];
  // Reclaim unused shares before spending on background context. Repeating also
  // redistributes a source's second share if it becomes complete in this pass.
  for (let round = 0; round <= entries.length; round++) {
    const before = bytes(JSON.stringify(compact)), pending = entries.flatMap((entry, index) => entry.truncated ? [index] : []);
    const available = sourceBudget - before;
    if (!pending.length || available <= 0) break;
    const bonus = Math.max(1, Math.floor(available / pending.length));
    for (const index of pending) {
      const remaining = sourceBudget - bytes(JSON.stringify(compact));
      if (remaining <= 0) break;
      const budget = bytes(JSON.stringify(entries[index])) + Math.min(bonus, remaining);
      Object.assign(entries[index], excerpt({ ...inputs[index].metadata }, inputs[index].text, budget));
    }
    if (bytes(JSON.stringify(compact)) === before) break;
  }
  const remaining = limit - bytes(JSON.stringify(compact)) - 16;
  return JSON.stringify({ ...compact, project: projectContext(parsed.project, remaining) });
}
