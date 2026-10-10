import { describe, expect, it } from 'vitest';
import { createIsolatedDocument, classifyFrameMessage } from './isolation';
describe('isolated generated React boundary', () => {
  it('requires opaque origin, the actual iframe source and declared node IDs', () => {
    const frame = {};
    expect(classifyFrameMessage(frame, frame, 'null', { type: 'lab-node', nodeId: 'servo' })).toEqual({ type: 'select', nodeId: 'servo' });
    expect(classifyFrameMessage({}, frame, 'null', { type: 'lab-node', nodeId: 'servo' })).toBeNull();
    expect(classifyFrameMessage(frame, frame, 'https://foreign.test', { type: 'lab-node', nodeId: 'servo' })).toBeNull();
    expect(classifyFrameMessage(frame, frame, 'null', { type: 'lab-node', nodeId: 'unknown' })).toBeNull();
    expect(classifyFrameMessage(frame, frame, 'null', { type: 'lab-node', nodeId: 'servo', action: 'rewrite-plan' })).toBeNull();
  });
  it('blocks connections, keeps transparent dark canvas and escapes script terminators', () => {
    const document = createIsolatedDocument('const x="</script><img src=evil>";', 'abc123');
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("default-src 'none'");
    expect(document).toContain('color-scheme:dark');
    expect(document).toContain('background:transparent');
    expect((document.match(/<\/script>/g) ?? []).length).toBe(1);
    expect(() => createIsolatedDocument('', '\" unsafe')).toThrow();
  });
});
