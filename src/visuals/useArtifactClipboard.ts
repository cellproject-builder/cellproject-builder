import { useEffect, useRef, type RefObject } from 'react';
import { toast } from '@/components/ui/Toast';
import { flushGraphPersistence } from '@/store';
import { flushWorkspacePersistence } from '@/workspace/store';
import { assertVisualScope, currentVisualScope, removeVisualArtifact } from './domain';
import { ARTIFACT_CLIPBOARD_TYPE, copyArtifactSnapshot, parseArtifactClipboard, pasteArtifactSnapshot } from './artifactClipboard';

interface Options {
  containerRef: RefObject<HTMLDivElement>;
  projectId: string;
  selectedArtifactId: string | null;
  onSelectArtifact?: (id: string | null) => void;
  english: boolean;
}
const isEditor = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[data-visual-popup]');

export function useArtifactClipboard(options: Options) {
  const latest = useRef(options); latest.current = options;
  const { containerRef, projectId, english } = options;
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    let canvasActive = false;
    const inCanvas = (target: EventTarget | null) => target instanceof Node && container.contains(target) && !isEditor(target);
    const pointer = (event: Event) => { canvasActive = inCanvas(event.target); };
    const focus = (event: Event) => { if (event.target !== document.body) canvasActive = inCanvas(event.target); };
    const eligible = (event: ClipboardEvent) => !event.defaultPrevented && !isEditor(event.target) && (canvasActive || inCanvas(event.target));
    const fail = (reason: unknown) => {
      const code = reason instanceof Error ? reason.message : '';
      const message = code === 'visualProjectChanged' ? (english ? 'Paste this object in its original project.' : 'Cole este objeto no projeto de origem.')
        : code === 'visualMediaMissing' ? (english ? 'The copied image file is no longer available.' : 'O arquivo da imagem copiada não está mais disponível.')
        : code === 'visualArtifactLimit' ? (english ? 'This canvas has reached its limit of 512 objects.' : 'Este canvas atingiu o limite de 512 objetos.')
        : english ? 'Could not copy or paste this object.' : 'Não foi possível copiar ou colar este objeto.';
      toast.show({ message, tone: 'warn' });
    };
    const copy = (event: ClipboardEvent) => {
      if (!eligible(event) || !latest.current.selectedArtifactId || !event.clipboardData || window.getSelection()?.isCollapsed === false) return;
      try {
        if (currentVisualScope().projectId !== projectId) return;
        const text = copyArtifactSnapshot(latest.current.selectedArtifactId);
        event.clipboardData.setData('text/plain', text);
        // Plain text keeps the native clipboard interoperable when custom types are stripped.
        try { event.clipboardData.setData(ARTIFACT_CLIPBOARD_TYPE, text); } catch { /* text/plain is sufficient */ }
        event.preventDefault();
        toast.show({ message: english ? 'Object copied · Ctrl+V to duplicate.' : 'Objeto copiado · Ctrl+V para duplicar.' });
      } catch (reason) { fail(reason); }
    };
    const paste = (event: ClipboardEvent) => {
      if (!eligible(event) || !event.clipboardData) return;
      try {
        const snapshot = parseArtifactClipboard(event.clipboardData.getData(ARTIFACT_CLIPBOARD_TYPE) || event.clipboardData.getData('text/plain'));
        if (!snapshot) return;
        event.preventDefault();
        const scope = currentVisualScope();
        if (scope.projectId !== projectId) return;
        void pasteArtifactSnapshot(snapshot).then(async artifact => {
          await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
          assertVisualScope(scope);
          latest.current.onSelectArtifact?.(artifact.id);
          toast.show({ message: english ? 'Object duplicated.' : 'Objeto duplicado.', tone: 'ok', action: {
            label: english ? 'Undo' : 'Desfazer', onClick: async () => {
              try {
                assertVisualScope(scope); removeVisualArtifact(artifact.id); latest.current.onSelectArtifact?.(null);
                await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
              }
              catch (reason) { fail(reason); }
            },
          } });
        }).catch(fail);
      } catch (reason) { event.preventDefault(); fail(reason); }
    };
    window.addEventListener('pointerdown', pointer, true); window.addEventListener('focusin', focus, true);
    window.addEventListener('copy', copy); window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('focusin', focus, true);
      window.removeEventListener('copy', copy); window.removeEventListener('paste', paste);
    };
  }, [containerRef, projectId, english]);
}
