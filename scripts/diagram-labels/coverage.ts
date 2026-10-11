export const expectedServoLabels = ['A', 'B'].flatMap(arm => ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'Garra'].map(joint => `${arm}-${joint}`));

/** Textual coverage only. The renderer/screenshot must be inspected separately. */
export function assessCoverage(raw: unknown) {
  const elements = raw && typeof raw === 'object' && 'elements' in raw && Array.isArray(raw.elements) ? raw.elements : [];
  const labels = elements.flatMap(element => element && typeof element === 'object' && element.type === 'text' && typeof element.text === 'string' ? [element.text as string] : []);
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const normalized = labels.map(normalize);
  const has = (pattern: RegExp) => normalized.some(label => pattern.test(label));
  const missingServoLabels = expectedServoLabels.filter(name => !has(new RegExp(`\\b${normalize(name)}\\b`)));
  const parts = { esp32: has(/\bESP\s?32\b/), pca9685: has(/\bPCA\s?9685\b/), source: has(/\bFONTE\b/), capacitor: has(/\bCAPACITOR\b/), legend: has(/\bLEGENDA\b/) };
  return { ...parts, distinctServoLabels: expectedServoLabels.length - missingServoLabels.length, missingServoLabels, textElements: labels.length, complete: Object.values(parts).every(Boolean) && !missingServoLabels.length };
}
