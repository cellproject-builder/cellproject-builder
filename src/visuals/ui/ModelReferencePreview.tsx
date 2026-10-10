import { useEffect, useState } from 'react';
import type { VisualPromptInput, VisualWorkspace } from '../types';
import { useVisualStrings } from './strings';

/** Show the actual local image to the person confirming the model's references. */
export function ModelReferencePreview({ input, workspace, onMedia }: {
  input: VisualPromptInput;
  workspace: VisualWorkspace;
  onMedia: (id: string) => Promise<Blob | null>;
}) {
  const s = useVisualStrings();
  const images = [
    ...input.mentions.filter(item => item.kind === 'image').map(item => ({
      id: `image:${item.id}`, label: item.label,
      mediaId: workspace.artifacts.find(artifact => artifact.id === item.id)?.mediaId ?? null,
    })),
    ...input.attachments.filter(item => item.mime.startsWith('image/')).map(item => ({ id: `attachment:${item.id}`, label: item.name, mediaId: item.mediaId })),
  ];
  const [selected, setSelected] = useState('');
  const active = images.find(item => item.id === selected) ?? images[0];
  const [preview, setPreview] = useState<{ mediaId: string; url: string } | null>(null);
  useEffect(() => {
    const mediaId = active?.mediaId;
    if (!mediaId) return;
    let disposed = false, url: string | null = null;
    void onMedia(mediaId).then(blob => {
      if (!blob || disposed) return;
      url = URL.createObjectURL(blob);
      setPreview({ mediaId, url });
    }).catch(() => { /* The source remains identified even if its preview is missing. */ });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [active?.mediaId, onMedia]);
  if (!active) return null;
  const url = preview?.mediaId === active.mediaId ? preview.url : null;
  return <figure className="visual-refinement-reference">
    <figcaption>{s.chosenReferences}</figcaption>
    <div className="visual-refinement-reference-image">
      {url ? <img src={url} alt={active.label} /> : <span>{s.previewUnavailable}</span>}
    </div>
    <div className="visual-refinement-reference-tabs">
      {images.map((image, index) => <button key={image.id} type="button" aria-pressed={active.id === image.id} title={image.label} onClick={() => setSelected(image.id)}>{index + 1}. {image.label}</button>)}
    </div>
  </figure>;
}
