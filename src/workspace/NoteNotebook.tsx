import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { nanoid } from 'nanoid';
import { toast } from '@/components/ui/Toast';
import { parseArtifactClipboard, ARTIFACT_CLIPBOARD_TYPE } from '@/visuals/artifactClipboard';
import { readVisualMedia } from '@/visuals/media';
import { parseDiagram, type DiagramV1 } from '@/visuals/diagram/model';
import { useWorkspaceStore } from './store';
import type { Note } from './types';
import { NoteCanvas } from './NoteCanvas';
import { createNoteCanvas, type NoteCanvasDocument, type NoteCanvasItem } from './noteCanvasModel';
import { importNoteImage, assertNoteImageBudget } from './noteImages';
import { NoteDiagramComposer } from './NoteDiagramComposer';
import { registerDataIngestion } from '@/cloud/activity';

export interface NoteNotebookTools { addImage(): void; generate(): void }
export const NoteNotebook = forwardRef<NoteNotebookTools, {
  note: Note; editorRef: RefObject<HTMLDivElement>; visible: boolean;
  onReveal(): void; english: boolean; toolsRef?: RefObject<HTMLDivElement>; toolsVisible?: boolean;
}>(function NoteNotebook({note, editorRef, visible, onReveal, english, toolsRef, toolsVisible}, ref) {
  const input = useRef<HTMLInputElement>(null);
  const blank = useRef(createNoteCanvas());
  const current = useRef({note, onReveal, english}); current.current = {note, onReveal, english};
  const alive = useRef(true), requests = useRef(new Set<AbortController>());
  const [composer, setComposer] = useState(false), [importing, setImporting] = useState(false);
  const [drawing, onDrawingChange] = useState(false);
  const readOnly = note.deletedAt !== null;
  const document = note.canvas ?? blank.current;
  const save = (canvas: NoteCanvasDocument) => {
    const state = useWorkspaceStore.getState(), latest = state.notes[note.id];
    if (!alive.current || !latest || latest.deletedAt !== null) return;
    try {state.updateNote(note.id, {canvas});}
    catch {toast.show({message: english ? 'Could not save the notebook. Check its size.' : 'Não foi possível salvar o caderno. Confira o tamanho.', tone:'warn'});}
  };
  const insertDiagram = (diagram: DiagramV1, values: Record<string, number> = {}) => {
    const state = useWorkspaceStore.getState(), latest = state.notes[note.id]; if (!latest || latest.deletedAt !== null || !alive.current) throw new Error('noteDiagramContextChanged');
    const canvas = latest.canvas ?? blank.current;
    const width = Math.min(620, canvas.width - 80), height = Math.min(520, canvas.height - 80);
    const item: NoteCanvasItem = {id:nanoid(10),kind:'diagram',x:40,y:40,width,height,diagram:parseDiagram(diagram, []),values:{...values}};
    state.updateNote(note.id, {canvas:{...canvas,items:[...canvas.items,item]}}); onReveal(); setComposer(false);
  };
  // One guard covers remote reads, raster conversion and the final workspace mutation.
  const ingestImages = async (loadFiles: (signal: AbortSignal) => Promise<File[]>) => {
    const snapshot = current.current;
    if (snapshot.note.deletedAt !== null || !alive.current) return;
    const controller = new AbortController(), release = registerDataIngestion();
    const finish = () => {release(); requests.current.delete(controller); if (alive.current) setImporting(requests.current.size > 0);};
    requests.current.add(controller); controller.signal.addEventListener('abort', finish, {once:true}); setImporting(true);
    try {
      const files = await loadFiles(controller.signal); controller.signal.throwIfAborted();
      const images = [];
      for (const file of files) images.push(await importNoteImage(file, controller.signal));
      controller.signal.throwIfAborted();
      const state = useWorkspaceStore.getState(), latest = state.notes[snapshot.note.id];
      if (!alive.current || !latest || latest.deletedAt !== null) return;
      assertNoteImageBudget(Object.values(state.notes), latest, images.map(image => image.src));
      const canvas = latest.canvas ?? blank.current;
      const items: NoteCanvasItem[] = images.map((image, index) => {
        const factor = Math.min(1, (canvas.width - 100) / image.width, (canvas.height - 100) / image.height, 420 / Math.max(image.width, image.height));
        const width = Math.max(24, image.width * factor), height = Math.max(24, image.height * factor);
        return {id:nanoid(10),kind:'image',src:image.src,label:image.label,width,height,x:Math.min(canvas.width - width,40 + (canvas.items.length + index) * 22 % 200),y:Math.min(canvas.height - height,40 + (canvas.items.length + index) * 22 % 200)};
      });
      state.updateNote(latest.id, {canvas:{...canvas,items:[...canvas.items,...items]}});
      snapshot.onReveal();
    } catch (error) {
      if (!controller.signal.aborted && alive.current) toast.show({message: error instanceof Error && error.message === 'noteImageBudget'
        ? snapshot.english ? 'The notebook image limit has been reached.' : 'O limite de imagens do caderno foi atingido.'
        : error instanceof Error && error.message === 'noteImageMissing' ? snapshot.english ? 'This image is unavailable. Copy it again from the canvas.' : 'Esta imagem não está disponível. Copie-a novamente do canvas.'
        : error instanceof Error && error.message === 'noteImageSize' ? snapshot.english ? 'This image is too large for the notebook. Reduce its resolution or file size.' : 'A imagem excede o limite do caderno. Reduza a resolução ou o tamanho do arquivo.'
        : snapshot.english ? 'Use a PNG, JPEG or WebP image up to 10 MB.' : 'Use uma imagem PNG, JPEG ou WebP de até 10 MB.',tone:'warn'});
    } finally {controller.signal.removeEventListener('abort', finish); finish();}
  };
  const addImages = async (files: File[]) => {
    if (!files.length) return;
    if (files.length > 8) {toast.show({message:english ? 'Paste up to 8 images at once.' : 'Cole até 8 imagens por vez.',tone:'warn'}); return;}
    await ingestImages(async () => files);
  };
  const pasteCanvasImage = (mediaId: string, label: string) => ingestImages(async signal => {
    const blob = await readVisualMedia(mediaId).catch(reason => {throw new Error('noteImageMissing', {cause:reason});});
    signal.throwIfAborted();
    if (!blob) throw new Error('noteImageMissing');
    return [new File([blob], label || 'Image', {type:blob.type})];
  });
  const actions = useRef({addImages, insertDiagram, pasteCanvasImage}); actions.current = {addImages, insertDiagram, pasteCanvasImage};
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false; for (const controller of requests.current) controller.abort(); requests.current.clear();};
  }, []);
  useEffect(() => {
    const editor = editorRef.current; if (!editor) return;
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || current.current.note.deletedAt !== null) return;
      const data = event.clipboardData; if (!data) return;
      const files = Array.from(data.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (!files.length) files.push(...Array.from(data.files ?? []).filter(file => file.type.startsWith('image/')));
      if (files.length) {event.preventDefault(); void actions.current.addImages(files); return;}
      const text = data.getData(ARTIFACT_CLIPBOARD_TYPE) || data.getData('text/plain');
      if (!text.startsWith('cellproject-visual-artifact:v1\n')) return;
      event.preventDefault();
      try {
        const snapshot = parseArtifactClipboard(text);
        if (snapshot?.artifact.kind === 'image' && snapshot.artifact.mediaId) {void actions.current.pasteCanvasImage(snapshot.artifact.mediaId, snapshot.artifact.label); return;}
        if (snapshot?.artifact.kind !== 'diagram' || !snapshot.artifact.diagram) {toast.show({message:current.current.english ? 'Paste an image or diagram into this notebook.' : 'Cole uma imagem ou um diagrama neste caderno.',tone:'warn'}); return;}
        // A pasted note diagram is independent of the source project's node IDs.
        actions.current.insertDiagram({...snapshot.artifact.diagram,elements:snapshot.artifact.diagram.elements.map(element => ({...element,nodeId:null}))}, snapshot.artifact.diagramValues);
      } catch {event.preventDefault(); toast.show({message: current.current.english ? 'Invalid diagram.' : 'Diagrama inválido.',tone:'warn'});}
    };
    editor.addEventListener('paste', paste);
    return () => editor.removeEventListener('paste', paste);
  }, [editorRef]);
  const generate = () => {if (!readOnly) {onReveal(); setComposer(true);}};
  useImperativeHandle(ref, () => ({addImage:() => {if (!readOnly) input.current?.click();}, generate}));
  return <div className="ws-note-notebook" hidden={!visible}>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label={english ? 'Choose note images' : 'Escolher imagens para a nota'} disabled={readOnly} onChange={event => {const files = Array.from(event.target.files ?? []); event.target.value = ''; void addImages(files);}} />
    {composer && !readOnly && <NoteDiagramComposer noteId={note.id} onInsert={insertDiagram} onClose={() => setComposer(false)} english={english} />}
    {importing && <span className="ws-note-image-progress" role="status">{english ? 'Adding image…' : 'Adicionando imagem…'}</span>}
    <NoteCanvas document={document} onChange={save} readOnly={readOnly} drawing={drawing} onDrawingChange={onDrawingChange} onAddImage={() => input.current?.click()} onGenerate={generate} english={english} toolsRef={toolsRef} toolsVisible={toolsVisible} liveDocumentId={note.id}/>
  </div>;
});
