import { AudioTextInput } from '@/audio/AudioField';
import { useEffect, useRef, useState } from 'react';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { findMentionTarget, watchVisualScope } from '../domain';
import { applyDecompositionAssembly, decompositionAssemblyCurrent, decompositionIsCurrent, decompositionTxt, generateDecompositionAssembly, researchArtifactDecomposition } from '../decomposition';
import type { DecompositionAssemblyProposal } from '../decomposition';
import { useVisualViewStore } from '../rendering/viewStore';
import { useVisualPopupStore } from './uiStore';
import type { VisualToolActivity } from './uiStore';
import { modelAssemblyCurrent } from '../modelAssembly';
import { ModelAssemblyInspector } from './ModelAssemblyInspector';
import './decomposition.css';

const copy = {
  en: {
    title: 'Components', intro: 'Research a real product and create a linked view of its parts. The complete original stays on the canvas.',
    childIntro: 'A linked view of the selected parts. The original stays visible on the canvas.',
    original: 'Back to original', openChild: 'Open decomposition', modeled: 'Parts in this view',
    geometry: { source: 'Original geometry preserved. Groups are identified by AI and require review.', mixed: 'Original geometry with newly approximated parts. Review the grouping and shape.', generated: 'New illustrative geometry. Shape and dimensions are not verified against the product.' },
    identity: 'Product and variant', confirm: 'Confirm the real product and variant', confirmHint: 'Use the manufacturer and exact revision when known.',
    research: 'Research specifications', researching: 'Researching documentation…', generating: 'Building documented components…',
    selection: 'Components to model', selected: 'selected · maximum 8', evidence: 'Source evidence', specs: 'Specifications', unknowns: 'Still unknown',
    interpretationHint: 'Names and functions are AI interpretations. Check the cited excerpts before modeling.',
    generate: 'Generate selected components', apply: 'Create linked decomposition', ready: 'Ready to review', readyHint: 'Creates a separate linked object; the original model stays visible.',
    coverage: (count: number, total: number) => `${count} of ${total} documented parts${count < total ? ' · partial view' : ''}`,
    assembled: 'Assembled', exploded: 'Exploded', didactic: 'A didactic exploded view. Geometry and spacing are illustrative; soldered parts are not mechanically detachable.',
    separation: 'Separation distance', context: (count: number) => `${count} original shape${count === 1 ? '' : 's'} kept as context · not yet classified by the research.`,
    incomplete: 'The researched list may be incomplete. Context shapes are not documented components.',
    inspect: 'Inspect part', noConnections: 'Connections are not inferred without documented evidence.', download: 'Download TXT',
    stale: 'The model or its references changed. Research again before generating or exporting this dossier.',
    cancel: 'Cancel', sources: 'Documentation', empty: 'Research will show only components supported by retrieved documentation.',
    missing: 'This object is no longer available in the current plan.', back: 'Create another model', base: 'Use image as 3D reference', imageHint: 'Research this image’s real product first. Generate a 3D model to explore its components on the canvas.',
    noSources: 'No usable documentation was retrieved. Refine the product name or variant and try again.',
    noEvidence: 'No component was supported by the retrieved documentation. Specify the exact product or revision.',
    unavailable: 'Documentation research is unavailable. Try again shortly.',
    invalid: 'The documentation response could not be validated. Try researching again.',
    assemblyInvalid: 'The generated components could not be validated. Generate again with fewer selected parts.',
    identityRequired: 'Enter the real product and variant before researching.',
    selectionInvalid: 'Select one to eight documented components.',
    failed: 'The operation could not finish. Your current model is preserved.',
  },
  pt: {
    title: 'Componentes', intro: 'Pesquise um produto real e crie uma vista vinculada de suas peças. O original completo continua no canvas.',
    childIntro: 'Vista vinculada das peças selecionadas. O original continua visível no canvas.',
    original: 'Voltar ao original', openChild: 'Abrir decomposição', modeled: 'Peças nesta vista',
    geometry: { source: 'Geometria original preservada. Os grupos são identificados pela IA e precisam de revisão.', mixed: 'Geometria original com peças aproximadas novas. Revise o agrupamento e a forma.', generated: 'Nova geometria ilustrativa. Forma e dimensões não foram verificadas com o produto.' },
    identity: 'Produto e variante', confirm: 'Confirmo o produto real e sua variante', confirmHint: 'Inclua o fabricante e a revisão exata quando conhecidos.',
    research: 'Pesquisar especificações', researching: 'Pesquisando documentação…', generating: 'Construindo componentes documentados…',
    selection: 'Componentes para modelar', selected: 'selecionados · máximo 8', evidence: 'Evidência na fonte', specs: 'Especificações', unknowns: 'Ainda não sabemos',
    interpretationHint: 'Nomes e funções são interpretações da IA. Confira os trechos antes de modelar.',
    generate: 'Gerar componentes selecionados', apply: 'Criar decomposição vinculada', ready: 'Pronto para revisar', readyHint: 'Cria um objeto separado e vinculado; o modelo original continua visível.',
    coverage: (count: number, total: number) => `${count} de ${total} peças documentadas${count < total ? ' · vista parcial' : ''}`,
    assembled: 'Montado', exploded: 'Explodido', didactic: 'Visão explodida didática. Geometria e afastamentos são ilustrativos; peças soldadas não são mecanicamente destacáveis.',
    separation: 'Distância de separação', context: (count: number) => `${count} forma${count === 1 ? '' : 's'} origina${count === 1 ? 'l mantida' : 'is mantidas'} como contexto · ainda sem classificação pela pesquisa.`,
    incomplete: 'A lista pesquisada pode estar incompleta. Formas de contexto não são componentes documentados.',
    inspect: 'Inspecionar peça', noConnections: 'Conexões não são inferidas sem evidências documentadas.', download: 'Baixar TXT',
    stale: 'O modelo ou suas referências mudaram. Pesquise novamente antes de gerar ou exportar esta ficha.',
    cancel: 'Cancelar', sources: 'Documentação', empty: 'A pesquisa mostrará apenas componentes sustentados pela documentação consultada.',
    missing: 'Este objeto não está mais disponível no plano atual.', back: 'Criar outro modelo', base: 'Usar imagem como base 3D', imageHint: 'Pesquise primeiro o produto real desta imagem. Gere um modelo 3D para explorar seus componentes no canvas.',
    noSources: 'Não encontramos documentação utilizável. Refine o nome ou a variante do produto e tente novamente.',
    noEvidence: 'Nenhum componente foi sustentado pela documentação consultada. Informe o produto ou a revisão exata.',
    unavailable: 'A pesquisa de documentação está indisponível. Tente novamente em instantes.',
    invalid: 'Não foi possível validar a documentação recebida. Pesquise novamente.',
    assemblyInvalid: 'Não foi possível validar os componentes gerados. Tente gerar novamente com menos peças selecionadas.',
    identityRequired: 'Informe o produto real e sua variante antes de pesquisar.',
    selectionInvalid: 'Selecione de um a oito componentes documentados.',
    failed: 'Não foi possível concluir a operação. Seu modelo atual foi preservado.',
  },
};

function sourceUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

/** PDF metadata can retain a document author's local conversion URL. Keep it in provenance, not in the link label. */
function sourceLabel(source: { title: string; url: string }): string {
  if (/\blocalhost\b|\b127(?:\.\d{1,3}){3}\b|\[::1\]|(?:^|\s)::1(?:$|\s)/i.test(source.title)) {
    const href = sourceUrl(source.url);
    if (href) { const url = new URL(href); return `${url.host}${url.pathname}`; }
  }
  return source.title;
}

export function DecompositionPanel({ artifactId, onActivity }: { artifactId: string; onActivity?: (activity: VisualToolActivity) => void }) {
  const project = useGraphStore(state => state.project);
  const ownerId = useWorkspaceStore(state => state.activeProjectId);
  const s = copy[useLocaleStore(state => state.locale) === 'en' ? 'en' : 'pt'];
  const artifact = project?.visuals?.artifacts.find(item => item.id === artifactId);
  const [showDocumentaryResearch, setShowDocumentaryResearch] = useState(false);
  const isChild = !!artifact?.sourceArtifactId;
  const original = isChild ? project?.visuals?.artifacts.find(item => item.id === artifact!.sourceArtifactId) : artifact;
  const linkedChild = !isChild ? project?.visuals?.artifacts.find(item => item.sourceArtifactId === artifactId && (!artifact?.decomposition?.assemblyArtifactId || item.id === artifact.decomposition.assemblyArtifactId) && decompositionAssemblyCurrent(item)) : undefined;
  const dossier = artifact?.decomposition;
  const modularCurrent = !!artifact && modelAssemblyCurrent(artifact);
  const [identity, setIdentity] = useState(dossier?.identity ?? artifact?.label ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<DecompositionAssemblyProposal | null>(null);
  const [busy, setBusy] = useState<'research' | 'generate' | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const activityCallback = useRef(onActivity); activityCallback.current = onActivity;
  useEffect(() => {
    onActivity?.({ state: busy ? 'running' : error ? 'error' : pending || dossier || modularCurrent ? 'ready' : 'idle', label: busy ? progress || (busy === 'research' ? s.researching : s.generating) : '' });
  }, [busy, progress, error, pending, dossier, modularCurrent, s.researching, s.generating, onActivity]);
  useEffect(() => () => { activityCallback.current?.({ state: 'idle', label: '' }); }, []);
  const operation = useRef<AbortController | null>(null);
  const dossierId = useRef<string | undefined>();
  const scopeKey = JSON.stringify([project?.id, ownerId, artifactId, artifact?.revisionIndex, artifact?.scene, artifact?.mediaId, artifact?.linkedNodeId]);
  const scope = useRef(scopeKey); scope.current = scopeKey;
  const partIds = JSON.stringify(dossier?.parts.map(part => part.id) ?? []);
  const appliedPartIds = JSON.stringify(dossier?.assembly?.selectedPartIds ?? []);
  const fresh = !!artifact && !!dossier && decompositionIsCurrent(artifact) && identity.trim() === dossier.identity;
  const assemblyCurrent = isChild && fresh && decompositionAssemblyCurrent(artifact!);
  const availableAssembly = isChild ? (assemblyCurrent ? dossier?.assembly : undefined) : linkedChild?.decomposition?.assembly;
  const contextCount = availableAssembly && original?.scene ? original.scene.objects.filter(object => !availableAssembly.scene.objects.some(part => part.id === object.id)).length : 0;
  const displayedParts = isChild ? dossier?.parts.filter(part => dossier.assembly?.selectedPartIds.includes(part.id)) : dossier?.parts;
  const explosion = useVisualViewStore(state => state.explosions[artifactId] ?? 0);
  const inspectedPart = useVisualViewStore(state => state.selectedParts[artifactId] ?? null);
  const PartHeading = isChild ? 'div' : 'label';

  function cancel() { operation.current?.abort(); operation.current = null; setBusy(null); setProgress(''); }
  useEffect(() => {
    cancel(); setPending(null); setError('');
  }, [scopeKey]);
  useEffect(() => {
    setIdentity(dossier?.identity ?? artifact?.label ?? ''); setConfirmed(false);
  }, [artifactId, project?.id, ownerId]);
  useEffect(() => {
    const ids: string[] = JSON.parse(partIds);
    const sameDossier = dossierId.current === dossier?.id;
    const applied: string[] = fresh && decompositionAssemblyCurrent(artifact!) ? JSON.parse(appliedPartIds) : [];
    setSelected(previous => sameDossier ? previous.filter(id => ids.includes(id)).slice(0, 8) : (applied.length ? applied.filter(id => ids.includes(id)) : ids).slice(0, 8));
    dossierId.current = dossier?.id;
  }, [dossier?.id, partIds, appliedPartIds, assemblyCurrent]);
  useEffect(() => () => { operation.current?.abort(); }, []);

  function message(reason: unknown) {
    const code = reason instanceof Error ? reason.message : '';
    if (code === 'decompositionResearchNoSources') return s.noSources;
    if (code === 'decompositionResearchNoEvidence' || code === 'decompositionNoEvidence') return s.noEvidence;
    if (code === 'decompositionResearchUnavailable') return s.unavailable;
    if (code === 'decompositionResearchInvalid') return s.invalid;
    if (code === 'decompositionIdentityRequired') return s.identityRequired;
    if (code === 'decompositionSelectionInvalid') return s.selectionInvalid;
    if (code === 'decompositionAssemblyInvalid' || code === 'visualGenerationIncomplete') return s.assemblyInvalid;
    if (code === 'decompositionStale' || code === 'visualContextChanged' || code === 'visualProjectChanged') return s.stale;
    if (code === 'decompositionArtifactMissing') return s.missing;
    return s.failed;
  }

  async function run(kind: 'research' | 'generate') {
    if (!artifact || isChild || busy || (kind === 'research' ? !confirmed || !identity.trim() : !fresh || !selected.length || selected.length > 8)) return;
    cancel(); const controller = new AbortController(); operation.current = controller;
    const sentScope = scope.current;
    const guard = watchVisualScope();
    const mode = project?.visuals?.mode;
    const current = () => !controller.signal.aborted && operation.current === controller && sentScope === scope.current;
    const options = { signal: controller.signal, onProgress: (next: string) => { if (current()) setProgress(next); } };
    setBusy(kind); setProgress(''); setError(''); setPending(null);
    try {
      if (kind === 'research') {
        await researchArtifactDecomposition(artifactId, identity.trim(), options);
      } else {
        const result = await generateDecompositionAssembly(artifactId, selected, options);
        if (!current()) return;
        guard.assert();
        if (mode === 'automatic' && useGraphStore.getState().project?.visuals?.mode === 'automatic') {
          const child = applyDecompositionAssembly(artifactId, result);
          useVisualPopupStore.getState().inspectArtifact(child.id);
        }
        else setPending(result);
      }
    } catch (reason) { if (current()) setError(message(reason)); }
    finally { guard.dispose(); if (current()) { operation.current = null; setBusy(null); setProgress(''); } }
  }
  function apply() {
    if (!pending || !fresh || busy) return;
    try { const child = applyDecompositionAssembly(artifactId, pending); setPending(null); setError(''); useVisualPopupStore.getState().inspectArtifact(child.id); }
    catch (reason) { setError(message(reason)); }
  }
  function download() {
    if (!fresh || busy) return;
    try {
      const blob = new Blob([decompositionTxt(artifactId)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a'); link.href = url;
        link.download = `${identity.trim().replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 100) || 'componentes'}-componentes.txt`;
        document.body.append(link); link.click(); link.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (reason) { setError(message(reason)); }
  }
  if (!artifact) return <div className="visual-decomposition"><p role="status">{s.missing}</p><button type="button" className="visual-button" onClick={() => useVisualPopupStore.getState().open('model')}>{s.back}</button></div>;
  if (modelAssemblyCurrent(artifact) && !showDocumentaryResearch) return <ModelAssemblyInspector artifact={artifact} onResearch={() => setShowDocumentaryResearch(true)} />;

  return <section className={`visual-decomposition${isChild ? ' is-linked-view' : ''}`} aria-label={s.title}>
    {modelAssemblyCurrent(artifact) && <button type="button" className="visual-refinement-back" disabled={!!busy} onClick={() => setShowDocumentaryResearch(false)}>{useLocaleStore.getState().locale === 'en' ? 'Back to modular assembly' : 'Voltar ao conjunto modular'}</button>}
    <div className="visual-decomposition-heading"><span aria-hidden="true">⊞</span><div><h3>{s.title}</h3><p>{isChild ? s.childIntro : s.intro}</p></div></div>
    {isChild ? <div className="visual-decomposition-origin"><span title={dossier?.identity ?? original?.label}>{dossier?.identity ?? original?.label}</span><button type="button" className="visual-button" disabled={!original} onClick={() => { if (original) useVisualPopupStore.getState().inspectArtifact(original.id); }}>{s.original}</button></div> : <>
    <label className="visual-decomposition-identity"><span>{s.identity}</span><AudioTextInput audioScope={`artifact:${artifactId}:product-identity`} audioLanguage={useLocaleStore.getState().locale === 'en' ? 'en' : 'pt'} aria-label={s.identity} value={identity} maxLength={200} disabled={!!busy}
      onChange={event => { setIdentity(event.target.value); setConfirmed(false); setPending(null); setError(''); }} /></label>
    <label className="visual-decomposition-confirm"><input type="checkbox" aria-label={s.confirm} checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} /><span>{s.confirm}<small>{s.confirmHint}</small></span></label>
    <div className="visual-decomposition-research"><button className="visual-button" type="button" disabled={!!busy || !confirmed || !identity.trim()} onClick={() => void run('research')}>{s.research}</button>{dossier && <button className="visual-button" type="button" disabled={!fresh || !!busy} onClick={download}>{s.download}</button>}</div>
    </>}
    {isChild && dossier && <button className="visual-button" type="button" disabled={!fresh || !!busy} onClick={download}>{s.download}</button>}
    {busy && <div className="visual-progress" role="status"><span className="visual-spinner" aria-hidden="true" />{progress || (busy === 'research' ? s.researching : s.generating)}<button className="visual-button" type="button" onClick={cancel}>{s.cancel}</button></div>}
    {error && <p className="visual-error" role="alert">{error}</p>}
    {dossier && !fresh && <p className="visual-decomposition-stale" role="status">{s.stale}</p>}
    {linkedChild && <div className="visual-decomposition-view"><p className="visual-decomposition-coverage">{s.coverage(linkedChild.decomposition!.assembly!.selectedPartIds.length, linkedChild.decomposition!.parts.length)}</p><button type="button" className="visual-button" disabled={!!busy} onClick={() => useVisualPopupStore.getState().inspectArtifact(linkedChild.id)}>{s.openChild}</button></div>}
    {availableAssembly?.geometryBasis && <p className="visual-decomposition-footnote" data-geometry-basis={availableAssembly.geometryBasis}>{s.geometry[availableAssembly.geometryBasis]}</p>}
    {availableAssembly && contextCount > 0 && <p className="visual-decomposition-context" role="status">{s.context(contextCount)}</p>}
    {assemblyCurrent && <div className="visual-decomposition-view"><div className="visual-segmented" aria-label={s.title}>
      <button type="button" aria-pressed={explosion === 0} onClick={() => useVisualViewStore.getState().setExplosion(artifactId, 0)}>{s.assembled}</button>
      <button type="button" aria-pressed={explosion === 1} onClick={() => useVisualViewStore.getState().setExplosion(artifactId, 1)}>{s.exploded}</button>
    </div><label className="visual-decomposition-separation"><span>{s.separation}<output>{Math.round(explosion * 100)}%</output></span><input type="range" aria-label={s.separation} min="0" max="100" step="1" value={Math.round(explosion * 100)} onChange={event => useVisualViewStore.getState().setExplosion(artifactId, Number(event.target.value) / 100)} /></label><p className="visual-decomposition-coverage">{s.coverage(dossier!.assembly!.selectedPartIds.length, dossier!.parts.length)}</p><p>{s.didactic}</p><p>{s.incomplete}</p></div>}
    {dossier ? <>
      <div className="visual-decomposition-list-title"><h4>{isChild ? s.modeled : s.selection}</h4>{!isChild && <span>{selected.length} {s.selected}</span>}</div>
      <p className="visual-decomposition-footnote">{s.interpretationHint}</p>
      <div className="visual-decomposition-parts">{displayedParts?.map(part => <article className={`visual-decomposition-part ${inspectedPart === part.id ? 'is-inspected' : ''}`} key={part.id}>
        <div className="visual-decomposition-part-heading"><PartHeading className="visual-decomposition-part-label">{!isChild && <input type="checkbox" data-part-choice={part.id} aria-label={`${part.name}${part.partNumber ? ` · ${part.partNumber}` : ''}`} checked={selected.includes(part.id)} disabled={!!busy || !fresh || (!selected.includes(part.id) && selected.length >= 8)}
          onChange={event => { setSelected(previous => event.target.checked ? [...previous, part.id].slice(0, 8) : previous.filter(id => id !== part.id)); setPending(null); }} />}<span><strong>{part.partNumber ?? part.name}</strong>{part.partNumber && <small>{part.name}</small>}</span></PartHeading>
          {part.quantity !== null && <span className="visual-decomposition-quantity">×{part.quantity}</span>}
          {assemblyCurrent && dossier.assembly?.groups.some(group => group.partId === part.id) && <button className="visual-icon-button" type="button" aria-label={`${s.inspect}: ${part.name}`} title={`${s.inspect}: ${part.name}`} aria-pressed={inspectedPart === part.id} onClick={() => useVisualViewStore.getState().selectPart(artifactId, inspectedPart === part.id ? null : part.id)}>◎</button>}
        </div>
        <p>{part.role}</p>
        <details><summary>{s.evidence}</summary>{part.evidence.map((evidence, index) => {
          const source = dossier.sources.find(item => item.id === evidence.sourceId), href = source && sourceUrl(source.url);
          return <div className="visual-decomposition-evidence" key={index}><blockquote>{evidence.quote}</blockquote>{source && (href ? <a href={href} target="_blank" rel="noopener noreferrer">{sourceLabel(source)} ↗</a> : <span>{sourceLabel(source)}</span>)}</div>;
        })}{part.specifications.length > 0 && <div className="visual-decomposition-detail"><strong>{s.specs}</strong><ul>{part.specifications.map((spec, index) => <li key={index}>{spec}</li>)}</ul></div>}{part.unknowns.length > 0 && <div className="visual-decomposition-detail"><strong>{s.unknowns}</strong><ul>{part.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></div>}</details>
      </article>)}</div>
      {dossier.unknowns.length > 0 && <details className="visual-decomposition-unknowns"><summary>{s.unknowns}</summary><ul>{dossier.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details>}
      <details className="visual-decomposition-sources"><summary>{s.sources} · {dossier.sources.length}</summary>{dossier.sources.map(source => { const href = sourceUrl(source.url); return href ? <a key={source.id} href={href} target="_blank" rel="noopener noreferrer">{sourceLabel(source)} ↗</a> : <span key={source.id}>{sourceLabel(source)}</span>; })}</details>
      {!isChild && artifact.kind === 'model' && <button className="visual-button visual-primary visual-decomposition-generate" type="button" disabled={!fresh || !!busy || !selected.length || selected.length > 8} aria-busy={!!busy} title={busy ? progress || (busy === 'research' ? s.researching : s.generating) : undefined} onClick={() => void run('generate')}>{busy ? <><span className="visual-spinner" aria-hidden="true" />{busy === 'research' ? s.researching : s.generating}</> : s.generate}</button>}
      {pending && fresh && <div className="visual-decomposition-pending" role="status"><strong>{s.ready}</strong><p className="visual-decomposition-coverage">{s.coverage(pending.assembly.selectedPartIds.length, pending.dossier.parts.length)}</p><p>{pending.assembly.scene.objects.length} {useLocaleStore.getState().locale === 'en' ? 'objects' : 'objetos'}</p>{pending.assembly.geometryBasis && <p data-geometry-basis={pending.assembly.geometryBasis}>{s.geometry[pending.assembly.geometryBasis]}</p>}<p>{s.readyHint}</p><button className="visual-button visual-primary" type="button" disabled={!!busy} onClick={apply}>{s.apply}</button></div>}
      {assemblyCurrent && <p className="visual-decomposition-footnote">{s.noConnections}</p>}
    </> : <p className="visual-decomposition-empty">{s.empty}</p>}
    {artifact.kind === 'image' && <div className="visual-decomposition-image"><p>{s.imageHint}</p><button className="visual-button" type="button" disabled={!!busy} onClick={() => { const target = findMentionTarget(artifactId, 'image'); if (target) useVisualPopupStore.getState().useAsBase(target); }}>{s.base}</button></div>}
    {!isChild && <button type="button" className="visual-refinement-back" disabled={!!busy} onClick={() => useVisualPopupStore.getState().open('model')}>{s.back}</button>}
  </section>;
}
