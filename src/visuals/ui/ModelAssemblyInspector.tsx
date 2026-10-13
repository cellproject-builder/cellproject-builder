import { useLocaleStore } from '@/i18n';
import { useVisualViewStore } from '../rendering/viewStore';
import { modelAssemblyTxt } from '../modelAssembly';
import { useVisualPopupStore } from './uiStore';
import type { VisualArtifact, VisualModelAssembly } from '../types';
import './decomposition.css';

export function AssemblyPlanSummary({ assembly }: { assembly: VisualModelAssembly }) {
  const en = useLocaleStore(state => state.locale) === 'en';
  return <details className="visual-assembly-plan"><summary>{en ? 'Construction plan' : 'Planejamento da construção'} · {assembly.groups.length} {en ? 'modules' : 'módulos'}</summary>
    <p>{assembly.summary}</p>
    <p>{en ? 'Common scale' : 'Escala comum'}: {assembly.plan.units === 'mm' ? 'mm' : en ? 'illustrative units' : 'unidades ilustrativas'}</p>
    {assembly.plan.sharedConstraints.length > 0 && <ul>{assembly.plan.sharedConstraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>}
    {assembly.plan.modules.map(module => <details key={module.id}><summary>{module.name}</summary><p className="visual-assembly-module-prompt">{module.prompt}</p><p>{en ? 'Envelope · center / size' : 'Envelope · centro / tamanho'}: [{module.center.join(', ')}] / [{module.size.join(', ')}]</p><small>{module.primitiveBudget} {en ? 'shapes maximum' : 'formas no máximo'}</small></details>)}
    {assembly.plan.interfaces.length > 0 && <details><summary>{en ? 'Shared interfaces' : 'Interfaces compartilhadas'} · {assembly.plan.interfaces.length}</summary>{assembly.plan.interfaces.map(item => <p key={item.id}><strong>{item.moduleIds.map(id => assembly.plan.modules.find(module => module.id === id)?.name ?? id).join(' ↔ ')}</strong><br />{item.description}<br /><small>[{item.anchor.join(', ')}] · {en ? 'illustrative contact anchor' : 'ponto de contato ilustrativo'}</small></p>)}</details>}
    {assembly.sources.length > 0 && <details><summary>{en ? 'Read documentation' : 'Documentação lida'} · {assembly.sources.length}</summary>{assembly.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</details>}
    {assembly.unknowns.length > 0 && <details><summary>{en ? 'Open specifications' : 'Especificações em aberto'}</summary><ul>{assembly.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul></details>}
  </details>;
}

export function ModelAssemblyInspector({ artifact, onResearch }: { artifact: VisualArtifact; onResearch: () => void }) {
  const en = useLocaleStore(state => state.locale) === 'en', assembly = artifact.assembly!;
  const explosion = useVisualViewStore(state => state.explosions[artifact.id] ?? 0);
  const selection = useVisualViewStore(state => state.selectedParts[artifact.id] ?? null);
  const separationLabel = en ? 'Separation distance' : 'Distância de separação';
  function download() {
    const url = URL.createObjectURL(new Blob([modelAssemblyTxt(artifact)], { type: 'text/plain;charset=utf-8' }));
    try { const link = document.createElement('a'); link.href = url; link.download = 'conjunto-modular-3d.txt'; document.body.append(link); link.click(); link.remove(); }
    finally { URL.revokeObjectURL(url); }
  }
  return <section className="visual-decomposition visual-assembly-inspector" aria-label={en ? 'Modular assembly' : 'Conjunto modular'}>
    <div className="visual-decomposition-heading"><span aria-hidden="true">⊞</span><div><h3>{en ? 'Modular assembly' : 'Conjunto modular'}</h3><p>{artifact.label}</p></div></div>
    <p className="visual-decomposition-footnote">{en ? 'These modules share an assembly contract. Explore their relationship to the project; geometry and contact anchors remain illustrative, without a verified physical fit.' : 'Os módulos compartilham um contrato de montagem. Explore sua relação com o projeto; geometria e pontos de contato são ilustrativos, sem validação de encaixe físico.'}</p>
    <div className="visual-decomposition-view"><div className="visual-segmented" role="group" aria-label={en ? 'Assembly view' : 'Vista do conjunto'}>
      <button type="button" aria-pressed={explosion === 0} onClick={() => useVisualViewStore.getState().setExplosion(artifact.id, 0)}>{en ? 'Assembled' : 'Montado'}</button>
      <button type="button" aria-pressed={explosion === 1} onClick={() => useVisualViewStore.getState().setExplosion(artifact.id, 1)}>{en ? 'Exploded' : 'Explodido'}</button>
    </div><label className="visual-decomposition-separation"><span>{separationLabel}<output>{Math.round(explosion * 100)}%</output></span><input type="range" aria-label={separationLabel} min="0" max="100" step="1" value={Math.round(explosion * 100)} onChange={event => useVisualViewStore.getState().setExplosion(artifact.id, Number(event.target.value) / 100)} /></label></div>
    <div className="visual-decomposition-list-title"><h4>{en ? 'Modules' : 'Módulos'}</h4><span>{assembly.groups.length}</span></div>
    <div className="visual-decomposition-parts">{assembly.groups.map(group => <article className={`visual-decomposition-part${selection === group.partId ? ' is-inspected' : ''}`} key={group.partId}><div className="visual-decomposition-part-heading"><strong>{group.name}</strong><small>{group.objectIds.length} {en ? 'shapes' : 'formas'}</small><button className="visual-icon-button" type="button" aria-label={`${en ? 'Inspect part' : 'Inspecionar peça'}: ${group.name}`} aria-pressed={selection === group.partId} onClick={() => useVisualViewStore.getState().selectPart(artifact.id, selection === group.partId ? null : group.partId)}>◎</button></div></article>)}</div>
    <AssemblyPlanSummary assembly={assembly} />
    <div className="visual-assembly-actions"><button className="visual-button" type="button" onClick={download}>{en ? 'Download TXT' : 'Baixar TXT'}</button><button className="visual-button" type="button" onClick={onResearch}>{en ? 'Research real components' : 'Pesquisar componentes reais'}</button></div>
    <button type="button" className="visual-refinement-back" onClick={() => useVisualPopupStore.getState().open('model')}>{en ? 'Create another model' : 'Criar outro modelo'}</button>
  </section>;
}
