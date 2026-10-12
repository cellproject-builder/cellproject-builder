// Rules pasted into the planning form may be separated by lines or semicolons.
export function parseRules(text: string): string[] {
  return text.split(/[;\n\r]+/).map(rule => rule.trim()).filter(Boolean);
}

// Keep authored order while comparing without surrounding whitespace or case.
export function mergeRules(rules: string[], extra: string[]): string[] {
  const seen = new Set(rules.map(rule => rule.trim().toLowerCase()));
  const out = [...rules];
  for (const rule of extra) {
    const key = rule.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rule.trim());
  }
  return out;
}

export function sameRules(a: string[], b: string[]): boolean {
  const normalize = (rules: string[]) => [...new Set(rules.map(rule => rule.trim().toLowerCase()))].sort().join('\n');
  return normalize(a) === normalize(b);
}
