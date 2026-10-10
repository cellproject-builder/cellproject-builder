import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '@/store';
import { findMentionTarget, listMentionTargets } from '../domain';
import { attachVisualFile } from '../media';
import { reviseVisualModel } from '../modelRevision';
import { reviseVisualDiagram } from '../diagram/generation';
import type { VisualArtifact, VisualPromptInput } from '../types';
import { PromptComposer } from './PromptComposer';
import { useVisualStrings, visualError } from './strings';
import './model-editing.css';

export function ModelArtifactEditor({ artifact, onClose }: { artifact: VisualArtifact; onClose: () => void }) {
  const s = useVisualStrings(), en = s.generate === 'Generate model';
  const isDiagram = artifact.kind === 'diagram';
  const objectLabel = isDiagram ? (en ? 'diagram' : 'diagrama') : (en ? 'model' : 'modelo');
  const previousInput = artifact.revisions?.[artifact.revisionIndex]?.input;
  const [input, setInput] = useState<VisualPromptInput>(() => ({ text: '', mentions: [
    ...(artifact.linkedNodeId ? [findMentionTarget(artifact.linkedNodeId, 'node')] : []),
    ...(artifact.origin?.imageIds ?? []).map(id => findMentionTarget(id, 'image')),
    ...(previousInput?.mentions ?? []).map(item => findMentionTarget(item.id, item.kind)),
  ].filter((item): item is NonNullable<typeof item> => !!item).filter((item, index, all) => all.findIndex(other => other.id === item.id && other.kind === item.kind) === index).slice(0, 20), attachments: previousInput?.attachments ?? [], ...(previousInput?.analyzeImages ? { analyzeImages: true } : {}), artifactKind: isDiagram ? 'diagram' : 'model', generationMode: artifact.assembly ? 'advanced' : 'standard' }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const controller = useRef<AbortController | null>(null), projectId = useGraphStore(state => state.project?.id);
  useEffect(() => () => controller.current?.abort(), [projectId, artifact.id]);
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); }
  async function submit() {
    if (!input.text.trim() || busy) return;
    const operation = new AbortController(); controller.current = operation; setBusy(true); setError(''); setProgress('');
    try {
      await (isDiagram ? reviseVisualDiagram : reviseVisualModel)(artifact.id, input, { signal: operation.signal, onProgress: text => { if (!operation.signal.aborted) setProgress(text); } });
      if (!operation.signal.aborted) onClose();
    } catch (reason) { if (!operation.signal.aborted) setError(visualError(reason, s)); }
    finally { if (controller.current === operation && !operation.signal.aborted) { controller.current = null; setBusy(false); } }
  }
  return <section className="visual-model-editor nodrag nopan nowheel" role="group" aria-label={isDiagram ? (en ? 'Diagram adjustment' : 'Ajuste do diagrama') : (en ? 'Model adjustment' : 'Ajuste do modelo')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); onClose(); } }}>
    <div className="visual-model-editor-heading"><span>{en ? `Adjust this ${objectLabel}` : `Ajustar este ${objectLabel}`}</span><button type="button" aria-label={en ? 'Close adjustment' : 'Fechar ajuste'} onClick={() => { cancel(); onClose(); }}>×</button></div>
    <PromptComposer kind="model" value={input} onChange={setInput} listMentions={listMentionTargets} onAttach={attachVisualFile} onSubmit={() => void submit()} onCancel={cancel} busy={busy} rows={2} canSubmit={!!input.text.trim()} submitLabel="OK" inputLabel={en ? `Describe the ${objectLabel} adjustment` : `Descreva o ajuste do ${objectLabel}`} placeholder={en ? 'What should change? Use @ or attach a reference…' : 'O que deve mudar? Use @ ou anexe uma referência…'}/>
    {busy && <p className="visual-progress" role="status"><span className="visual-spinner" aria-hidden="true"/>{progress || (en ? 'Creating a revision…' : 'Criando uma revisão…')}</p>}
    {error && <p className="visual-error" role="alert">{error}</p>}
  </section>;
}
