import { afterEach, describe, expect, it, vi } from 'vitest';
import { importNoteImage, assertNoteImageBudget } from './noteImages';

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
afterEach(() => vi.restoreAllMocks());
describe('native note images', () => {
  it('rejects unsupported or disguised files before allocating an image', async () => {
    await expect(importNoteImage(new File(['<svg/>'], 'drawing.svg', {type:'image/svg+xml'}))).rejects.toThrow('noteImageType');
    await expect(importNoteImage(new File(['<html/>'], 'fake.png', {type:'image/png'}))).rejects.toThrow('noteImageInvalid');
  });
  it('honors cancellation before decoding', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(importNoteImage(new File([png], 'board.png', {type:'image/png'}), controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('rejects oversized PNG, JPEG and WebP headers before decoding', async () => {
    const largePng = png.slice(); new DataView(largePng.buffer).setUint32(16, 16000001);
    const largeJpeg = new Uint8Array([255,216,255,192,0,11,8,255,255,255,255,1,1,17,0]);
    const largeWebp = new Uint8Array(30); largeWebp.set([...('RIFF'.split('').map(c => c.charCodeAt(0)))],0); largeWebp.set([...('WEBPVP8X'.split('').map(c => c.charCodeAt(0)))],8); largeWebp.fill(255,24,30);
    for (const [bytes,mime] of [[largePng,'image/png'],[largeJpeg,'image/jpeg'],[largeWebp,'image/webp']] as const) {
      await expect(importNoteImage(new File([bytes],'huge',{type:mime}))).rejects.toThrow('noteImageSize');
    }
  });
  it('bounds aggregate inline media before accepting another paste', () => {
    const note = {canvas:{items:[{kind:'image',src:'a'.repeat(5_500_000)}]}};
    expect(() => assertNoteImageBudget([note], note, ['b'.repeat(1_000_000)])).toThrow('noteImageBudget');
    const many = Array.from({length:4}, () => ({canvas:{items:[{kind:'image',src:'a'.repeat(4_500_000)}]}}));
    expect(() => assertNoteImageBudget(many, {canvas:{items:[]}}, ['abc'])).toThrow('noteImageBudget');
    expect(() => assertNoteImageBudget([], {}, ['abc'])).not.toThrow();
  });
});
