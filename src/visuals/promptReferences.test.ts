import { describe, expect, it } from 'vitest';
import * as promptReferences from './promptReferences';
import type { MentionTarget, VisualArtifact, VisualPromptInput, VisualWorkspace } from './types';

const mention = (id: string, kind: MentionTarget['kind'] = 'image'): MentionTarget => ({ id, kind, label: id, detail: '', fingerprint: `fingerprint-${id}` });
const image = (id: string): VisualArtifact => ({ id, label: id, kind: 'image', x: 0, y: 0, width: 100, height: 100, mediaId: `media-${id}`, scene: null, source: null, revisions: [{ scene: null, mediaId: `media-${id}`, createdAt: 1 }], revisionIndex: 0 });
const workspace = (artifacts: VisualArtifact[]): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts, proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } });

describe('image prompt reference recovery', () => {
  it('removes only absent image references and preserves the remaining draft data without mutation', () => {
    const missing = mention('cable'), board = mention('board'), note = mention('missing-note', 'note'), node = mention('missing-node', 'node');
    const input: VisualPromptInput = { text: 'Keep this instruction', mentions: [missing, note, board, node], attachments: [{ id: 'file', name: 'part.txt', mime: 'text/plain', byteLength: 4, mediaId: 'file-media', text: 'part' }] };
    const current = workspace([image('board')]);
    const beforeInput = structuredClone(input), beforeWorkspace = structuredClone(current);

    const result = promptReferences.reconcileVisualImageReferences(input, current);

    expect(result.removed).toEqual([missing]);
    expect(result.input).toEqual({ text: 'Keep this instruction', mentions: [note, board, node], attachments: input.attachments });
    expect(result.input.attachments).toBe(input.attachments);
    expect(input).toEqual(beforeInput);
    expect(current).toEqual(beforeWorkspace);
  });

  it('keeps valid images beyond 100 items and preserves draft identity when nothing is removed', () => {
    const current = workspace(Array.from({ length: 130 }, (_, index) => image(`image-${index}`)));
    const input = { text: '', mentions: [mention('image-129')], attachments: [] };

    const result = promptReferences.reconcileVisualImageReferences(input, current);

    expect(result.input).toBe(input);
    expect(result.removed).toEqual([]);
  });

  it('does not treat a model with the same ID as an available image', () => {
    const missing = mention('replaced-image');
    const input = { text: '', mentions: [missing], attachments: [] };
    const model: VisualArtifact = { ...image(missing.id), kind: 'model', mediaId: null, scene: { version: 1, label: 'Model', objects: [] } };

    const result = promptReferences.reconcileVisualImageReferences(input, workspace([model]));

    expect(result.input.mentions).toEqual([]);
    expect(result.removed).toEqual([missing]);
  });
});
