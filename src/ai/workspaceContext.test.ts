import { beforeEach, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/workspace/store';
import { readWorkspace } from './workspaceTools';
beforeEach(() => useWorkspaceStore.setState({ projects: {}, notes: {}, boards: {}, tasks: {}, sprints: {}, comments: {}, folders: {} }));
it('returns bounded public text by default and provides exact source text in explicit chunks', () => {
  const objective = 'requirements '.repeat(15_000).trim(), projectId = useWorkspaceStore.getState().createProject('Long project', objective);
  const first = readWorkspace({ collection: 'projects', id: projectId });
  expect(JSON.stringify(first).length).toBeLessThan(10_000);
  expect(first.items[0]).toMatchObject({ id: projectId, truncatedFields: expect.arrayContaining(['objective']) });
  const chunk = readWorkspace({ collection: 'projects', id: projectId, textField: 'objective', textOffset: 4000 });
  expect(chunk.text).toMatchObject({ content: objective.slice(4000, 8000), offset: 4000, totalCharacters: objective.length, nextOffset: 8000 });
  expect(useWorkspaceStore.getState().projects[projectId].objective).toBe(objective);
});
it('bounds list pages and note blocks together rather than returning every full source body', () => {
  for (let i = 0; i < 30; i++) useWorkspaceStore.getState().createProject(`Project ${i}`, 'long '.repeat(10_000));
  const result = readWorkspace({ collection: 'projects', limit: 100 });
  expect(result.items.length).toBe(20); expect(result.nextOffset).toBe(20);
  expect(JSON.stringify(result).length).toBeLessThan(20_000);
  const noteId = useWorkspaceStore.getState().createNote({ title: 'Long note' });
  useWorkspaceStore.getState().updateNote(noteId, { blocks: Array.from({ length: 50 }, (_, i) => ({ id: `block-${i}`, type: 'text', text: 'large '.repeat(1000) })) });
  const note = readWorkspace({ collection: 'notes', id: noteId });
  expect(JSON.stringify(note).length).toBeLessThan(10_000);
  expect(note.items[0].truncatedFields).toContain('blocks');
  expect(readWorkspace({ collection: 'notes', id: noteId, textField: 'blocks' }).text?.nextOffset).toBe(4000);
});
