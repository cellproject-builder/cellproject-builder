/** Public workspace records are read lazily. Limits describe a projection,
 * never alter the original source, and are recoverable through text chunks. */
export function projectWorkspaceRecord(record: Record<string, unknown>, budget: { remaining: number }): Record<string, unknown> & { truncatedFields: string[]; detailNote?: string } {
  const truncated = new Set<string>();
  const visit = (value: unknown, path: string, depth: number): unknown => {
    if (typeof value === 'string') {
      const identity = /(^|\.)(id|projectId|taskId|folderId|sprintId|frontId)$/.test(path);
      const limit = identity ? 100 : /(^|\.)(name|title|type|kind)$/.test(path) ? 240 : 1200;
      const text = value.slice(0, identity ? limit : Math.max(0, Math.min(limit, budget.remaining)));
      if (!identity) budget.remaining -= text.length;
      if (text.length < value.length) truncated.add(path);
      return text;
    }
    if (Array.isArray(value)) {
      if (value.length > 10) truncated.add(path);
      if (depth >= 4) { truncated.add(path); return { count: value.length, omitted: true }; }
      return value.slice(0, 10).map((item, index) => visit(item, `${path}.${index}`, depth + 1));
    }
    if (value && typeof value === 'object') {
      if (depth >= 4) { truncated.add(path); return { omitted: true }; }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, path ? `${path}.${key}` : key, depth + 1)]));
    }
    return value;
  };
  const result = visit(record, '', 0) as Record<string, unknown>;
  // An array's field name also signals that not all entries/body was returned.
  for (const field of [...truncated]) if (field.includes('.')) truncated.add(field.split('.')[0]);
  return { ...result, truncatedFields: [...truncated], ...(truncated.size ? { detailNote: 'Partial public text. Use this record id + textField/textOffset to read the original field in chunks before replacing it.' } : {}) };
}
