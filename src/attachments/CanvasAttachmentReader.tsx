import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornersIcon, ArrowLeftIcon, ArrowRightIcon, ChatBubbleIcon } from '@/components/ui/SoftIcons';
import { Download as DownloadIcon } from 'lucide-react';
import { FloatingPopup, type PopupFrame } from '@/visuals/ui/FloatingPopup';
import { readVisualMedia } from '@/visuals/media';
import { CanvasResourcePreview } from './CanvasResourcePreview';
import { safeResourceUrl, type CanvasResource } from './canvasModel';
import './canvas-resource.css';
import '@/visuals/ui/visuals.css';

export function CanvasAttachmentReader({ resources, english = false, onClose, onDiscuss }: {
  resources: CanvasResource[]; english?: boolean; onClose(): void; onDiscuss?(resource: CanvasResource): void;
}) {
  const [index, setIndex] = useState(0), [page, setPage] = useState(1), [pages, setPages] = useState(1), [maximized, setMaximized] = useState(false), [error, setError] = useState('');
  const [frame, setFrame] = useState<PopupFrame>(() => ({ x: Math.max(8, (window.innerWidth - 700) / 2), y: 70, width: 700, height: Math.min(740, window.innerHeight - 100) }));
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null), alive = useRef(true);
  const libraryTrigger = useRef<HTMLButtonElement | null>(null);
  const safeIndex = Math.min(index, Math.max(0, resources.length - 1));
  const resource = resources[safeIndex];
  const t = (pt: string, en: string) => english ? en : pt;
  useEffect(() => {
    alive.current = true;
    const library = trigger.current?.closest('.canvas-attachment-panel');
    if (library?.id) libraryTrigger.current = [...document.querySelectorAll<HTMLButtonElement>('.canvas-attachment-trigger')].find(button => button.getAttribute('aria-controls') === library.id) ?? null;
    return () => {
      alive.current = false;
      const target = trigger.current?.isConnected ? trigger.current : libraryTrigger.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { setPage(1); setPages(1); setError(''); }, [resource?.id]);
  useEffect(() => { if (index !== safeIndex) setIndex(safeIndex); }, [index, safeIndex]);
  if (!resource) return null;
  const download = async () => {
    try {
      const blob = resource.mediaId ? await readVisualMedia(resource.mediaId) : new Blob([resource.text ?? resource.url ?? ''], { type: 'text/plain' });
      if (!alive.current) return; if (!blob) throw new Error('attachmentMissing');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = resource.mediaId ? resource.name : `${resource.name}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (alive.current) setError(t('Não foi possível baixar este anexo.', 'Could not download this attachment.')); }
  };
  const content = <>
    <div className="canvas-reader-controls">
      {resources.length > 1 && <select aria-label={t('Arquivo do deck', 'Deck file')} value={safeIndex} onChange={event => setIndex(Number(event.target.value))}>{resources.map((item, i) => <option value={i} key={item.id}>{item.name}</option>)}</select>}
      {resource.kind === 'pdf' && resource.mediaId && <div className="canvas-reader-pages"><button aria-label={t('Página anterior', 'Previous page')} disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ArrowLeftIcon /></button><span>{page} / {pages}</span><button aria-label={t('Próxima página', 'Next page')} disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ArrowRightIcon /></button></div>}
      <span className="canvas-reader-spacer" />
      {onDiscuss && <button aria-label={t('Conversar sobre este anexo', 'Discuss this attachment')} title={t('Conversar sobre este anexo', 'Discuss this attachment')} onClick={() => onDiscuss(resource)}><ChatBubbleIcon /></button>}
      <button aria-label={t('Baixar anexo', 'Download attachment')} title={t('Baixar anexo', 'Download attachment')} onClick={() => void download()}><DownloadIcon /></button>
      <button aria-label={maximized ? t('Restaurar leitor', 'Restore reader') : t('Maximizar leitor', 'Maximize reader')} title={t('Expandir ou restaurar', 'Expand or restore')} onClick={() => setMaximized(value => !value)}><CornersIcon /></button>
    </div>
    {resource.kind === 'link' && resource.url && <div className="canvas-reader-source"><a href={safeResourceUrl(resource.url)} target="_blank" rel="noopener noreferrer">{t('Abrir página original', 'Open original page')} ↗</a><p>{resource.url}</p><small>{t('Use o chat para pesquisar o conteúdo desta referência.', 'Use chat to research this reference.')}</small></div>}
    <CanvasResourcePreview key={resource.id} resource={resource} english={english} expanded page={page} onPages={setPages} />
    {error && <p role="alert">{error}</p>}
  </>;
  return createPortal(<div className="canvas-attachment-reader">
    <FloatingPopup kind="search" title={resource.name} subtitle={t('Anexos', 'Attachments')} onClose={onClose} onMinimize={onClose} frame={maximized ? { x: 8, y: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 } : frame} onFrameChange={value => { if (!maximized) setFrame(value); }} actionLabels={{ minimize: t('Minimizar leitor', 'Minimize reader'), close: t('Fechar leitor', 'Close reader') }}>{content}</FloatingPopup>
  </div>, document.body);
}
