import { generateText } from 'ai';
import { aiModel, assertAIReady, callOpts } from '@/ai/client';
import { registerAIAction } from '@/ai/actions';
import type { DiagramV1 } from '@/visuals/diagram/model';
import { buildDiagramSystem } from '@/visuals/diagram/prompt';
import { DiagramLabelsMissingError, parseGeneratedDiagram } from '@/visuals/diagram/quality';
import { useWorkspaceStore } from './store';
import type { Note } from './types';

// Read only semantic labels. Image data, pen strokes, layout and unrelated notes
// never become an implicit attachment to an AI request.
type SemanticItem = { id: string; kind: string; text: string };
function semanticContent(note: Note) {
  const canvas = note.canvas;
  return {
    title: note.title,
    blocks: note.blocks.map(block => ({ type: block.type, text: block.text, ...(block.type === 'check' ? { checked: !!block.checked } : {}) })),
    canvas: (canvas?.items ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)).flatMap<SemanticItem>(item => {
      if (item.kind === 'text') return [{ id: item.id, kind: item.kind, text: item.text ?? '' }];
      if (item.kind === 'image') return [{ id: item.id, kind: item.kind, text: item.label ?? '' }];
      if (item.kind !== 'diagram' || !item.diagram) return [];
      const diagram = item.diagram;
      return [{ id: item.id, kind: item.kind, text: JSON.stringify({ title: diagram.title, explanation: diagram.explanation, assumptions: diagram.assumptions,
        labels: diagram.elements.filter(element => element.type === 'text').map(element => element.text),
        parameters: diagram.parameters.map(parameter => ({ label: parameter.label, value: item.values?.[parameter.id] ?? parameter.value, unit: parameter.unit })),
      }) }];
    }),
  };
}

function currentNote(noteId: string): Note {
  const note = useWorkspaceStore.getState().notes[noteId];
  if (!note || note.deletedAt !== null) throw new Error('noteDiagramContextChanged');
  return note;
}

/** Stable across positioning, resizing, ink, paper changes and note metadata. */
export function noteDiagramSignature(noteId: string, useContent: boolean): string {
  const note = currentNote(noteId);
  return JSON.stringify([note.id, note.createdAt, useContent ? semanticContent(note) : null]);
}

function boundedContent(note: Note) {
  const semantic = semanticContent(note);
  let remaining = 24000;
  const text = (value: string) => { const result = value.slice(0, Math.max(0, remaining)); remaining -= result.length; return result; };
  return { title: text(semantic.title), blocks: semantic.blocks.slice(0, 200).map(block => ({ ...block, text: text(block.text) })),
    canvas: semantic.canvas.slice(0, 100).map(item => ({ ...item, text: text(item.text) })), truncated: remaining <= 0 || semantic.blocks.length > 200 || semantic.canvas.length > 100 };
}

const system = buildDiagramSystem('note');

/** One bounded inference; no paid repair retry and no dependency on an active plan. */
export async function generateNoteDiagram(input: { noteId: string; prompt: string; useContent: boolean }, options: { signal: AbortSignal; beforeRequest?: () => Promise<void> }): Promise<DiagramV1> {
  const finish = registerAIAction(), controller = new AbortController();
  let off = () => {}, changed = false;
  const cancel = () => controller.abort(options.signal.reason);
  options.signal.addEventListener('abort', cancel, { once: true });
  try {
    options.signal.throwIfAborted();
    const instruction = input.prompt.trim();
    if (!instruction || instruction.length > 4000) throw new Error('noteDiagramPromptRequired');
    const signature = noteDiagramSignature(input.noteId, input.useContent);
    const source = input.useContent ? boundedContent(currentNote(input.noteId)) : undefined;
    const check = () => {
      try { if (noteDiagramSignature(input.noteId, input.useContent) !== signature) changed = true; } catch { changed = true; }
      if (changed) controller.abort(new Error('noteDiagramContextChanged'));
    };
    const assertCurrent = () => { options.signal.throwIfAborted(); check(); if (changed) throw new Error('noteDiagramContextChanged'); };
    off = useWorkspaceStore.subscribe(check);
    assertAIReady(); assertCurrent();
    let result;
    try {
      await options.beforeRequest?.(); assertCurrent();
      result = await generateText({ model: aiModel, system, prompt: JSON.stringify({ instruction, ...(source ? { note: source } : {}) }),
        abortSignal: controller.signal, maxRetries: 0, ...callOpts('plans', .3) });
    } catch (error) { assertCurrent(); throw error; }
    assertCurrent();
    if (result.finishReason === 'length' || result.text.length > 150000) throw new Error('noteDiagramIncomplete');
    try { return parseGeneratedDiagram(JSON.parse(result.text.trim()), []); }
    catch (error) { if (error instanceof DiagramLabelsMissingError) throw error; throw new Error('noteDiagramInvalid', { cause: error }); }
  } finally { off(); options.signal.removeEventListener('abort', cancel); finish(); }
}
