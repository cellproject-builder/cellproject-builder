import { beforeEach, expect, it } from 'vitest';
import { useWorkspaceStore as store } from '@/workspace/store';
import type { NoteBlock } from '@/workspace/types';
import { captureChatTurnContext, publishChatNoteFocus } from '@/chat/turnContext';
import { createAssistantTools } from './workspaceTools';

const request = 'Revise a nota preservando conteúdo';
const toolOptions = { toolCallId: 'read-coverage', messages: [] };
type Tools = ReturnType<typeof createAssistantTools>;
type ReadResult = {
  ok: boolean;
  result: {
    items: { id: string; blocks?: NoteBlock[]; truncatedFields?: string[] }[];
    text?: { content: string; offset: number; totalCharacters: number; nextOffset: number | null };
  };
};

beforeEach(async () => {
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, boards: {}, activeBoardId: null,
    legacyImported: true, surface: 'projects', activeProjectId: null });
});

function noteWithBlocks(count = 11, bodyLength = 24) {
  const noteId = store.getState().createNote({ title: 'Coverage fixture' });
  const blocks: NoteBlock[] = Array.from({ length: count }, (_, index) => ({ id: `block-${index}`, type: 'text', text: `${index}: ${'a'.repeat(bodyLength)}` }));
  store.getState().updateNote(noteId, { blocks });
  return { noteId, blocks: store.getState().notes[noteId].blocks };
}

function noteTools(noteId: string, focused = true, userText = request) {
  store.getState().navigate(focused ? 'notes' : 'projects');
  const clear = focused ? publishChatNoteFocus(noteId, null) : () => {};
  const turnContext = captureChatTurnContext();
  clear();
  return createAssistantTools(new AbortController().signal, () => {}, userText, {
    turnContext, beforeRequest: async () => {}, onRateLimit: () => {},
  });
}

async function read(tools: Tools, noteId: string, textOffset?: number): Promise<ReadResult['result']> {
  const response = await tools.workspace_read.execute!({ collection: 'notes', id: noteId,
    ...(textOffset !== undefined ? { textField: 'blocks', textOffset } : {}) }, toolOptions) as unknown as ReadResult;
  expect(response.ok).toBe(true);
  return response.result;
}

async function fullBlocks(tools: Tools, noteId: string): Promise<NoteBlock[]> {
  let offset: number | null = 0, source = '';
  while (offset !== null) {
    const result = await read(tools, noteId, offset);
    expect(result.text?.offset).toBe(offset);
    expect(result.text?.content.length).toBeLessThanOrEqual(4000);
    source += result.text!.content;
    offset = result.text!.nextOffset;
  }
  return JSON.parse(source) as NoteBlock[];
}

it.each([true, false])('rejects replacing blocks from a partial note projection (focused=%s)', async focused => {
  const { noteId, blocks } = noteWithBlocks(), tools = noteTools(noteId, focused);
  const projected = (await read(tools, noteId)).items[0];
  expect(projected.blocks).toHaveLength(10);
  expect(projected.truncatedFields).toContain('blocks');
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { blocks: projected.blocks! } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(blocks);
});

it('rejects replacing note text with a truncated single block', async () => {
  const { noteId, blocks } = noteWithBlocks(1, 2000), tools = noteTools(noteId);
  const projected = (await read(tools, noteId)).items[0];
  expect(projected.blocks![0].text.length).toBeLessThan(blocks[0].text.length);
  expect(projected.truncatedFields).toContain('blocks');
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { text: projected.blocks![0].text } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(blocks);
});

it('does not let literal text bypass validation of the blocks actually applied', async () => {
  const { noteId, blocks } = noteWithBlocks(), tools = noteTools(noteId, true, 'Use o título e o texto Novo texto literal');
  const projected = (await read(tools, noteId)).items[0];
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId,
    patch: { text: 'Novo texto literal', blocks: projected.blocks! } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(blocks);
});

it('allows replacing the body with the exact new text supplied by the human', async () => {
  const { noteId } = noteWithBlocks(), body = 'Replacement explicitly supplied by the human.';
  const tools = noteTools(noteId, true, `Substitua o corpo por: ${body}`);
  await read(tools, noteId);
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { text: body } }, toolOptions)).toMatchObject({ ok: true });
  expect(store.getState().notes[noteId].blocks.map(block => block.text)).toEqual([body]);
});

it('does not reuse a partial projection from an earlier run as replacement permission', async () => {
  const { noteId, blocks } = noteWithBlocks();
  const projected = (await read(noteTools(noteId), noteId)).items[0];
  const nextRun = noteTools(noteId);
  expect(await nextRun.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { blocks: projected.blocks! } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(blocks);
});

it('allows a title-only update after a partial body read without replacing the body', async () => {
  const { noteId, blocks } = noteWithBlocks(), tools = noteTools(noteId);
  await read(tools, noteId);
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { title: 'Revised title' } }, toolOptions)).toMatchObject({ ok: true });
  expect(store.getState().notes[noteId]).toMatchObject({ title: 'Revised title', blocks });
});

it('appends safely after a partial read without unlocking a partial replacement', async () => {
  const { noteId, blocks } = noteWithBlocks(), tools = noteTools(noteId);
  const projected = (await read(tools, noteId)).items[0];
  expect(await tools.workspace_action.execute!({ action: 'append_note_block', id: noteId,
    block: { id: 'new-block', type: 'text', text: 'Additional finding' } }, toolOptions)).toMatchObject({ ok: true });
  expect(store.getState().notes[noteId].blocks).toEqual([...blocks, { id: 'new-block', type: 'text', text: 'Additional finding' }]);
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { blocks: projected.blocks! } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toHaveLength(12);
});

it.each([true, false])('allows replacement after reading every exact source chunk (focused=%s)', async focused => {
  const { noteId, blocks } = noteWithBlocks(11, 900), tools = noteTools(noteId, focused);
  await read(tools, noteId);
  const complete = await fullBlocks(tools, noteId);
  expect(complete).toEqual(blocks);
  const revised = complete.map((block, index) => index === 0 ? { ...block, text: `${block.text} Revised finding.` } : block);
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { blocks: revised } }, toolOptions)).toMatchObject({ ok: true });
  expect(store.getState().notes[noteId].blocks).toEqual(revised);
});

it('does not combine source chunks from different revisions into replacement permission', async () => {
  const { noteId, blocks } = noteWithBlocks(11, 900), tools = noteTools(noteId, false);
  await read(tools, noteId);
  const first = await read(tools, noteId, 0);
  const current = blocks.map((block, index) => index === 0 ? { ...block, text: block.text.replaceAll('a', 'b') } : block);
  store.getState().updateNote(noteId, { blocks: current });
  let offset = first.text!.nextOffset;
  while (offset !== null) offset = (await read(tools, noteId, offset)).text!.nextOffset;
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { text: 'Replacement generated from stale fragments' } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(current);
});

it('invalidates completed source coverage after the note changes outside the focused editor', async () => {
  const { noteId, blocks } = noteWithBlocks(11, 900), tools = noteTools(noteId, false);
  await read(tools, noteId);
  await fullBlocks(tools, noteId);
  const current = [...blocks, { id: 'local-block', type: 'text' as const, text: 'A later human edit' }];
  store.getState().updateNote(noteId, { blocks: current });
  expect(await tools.workspace_action.execute!({ action: 'update_note', id: noteId, patch: { blocks } }, toolOptions)).toMatchObject({ ok: false });
  expect(store.getState().notes[noteId].blocks).toEqual(current);
});
