import type { ComponentFit } from '@/visuals/componentFit';
export function ImageProjectFit({ fit, english }: { fit?: ComponentFit; english: boolean }) {
  const status = fit?.status ?? 'unknown';
  const labels = english ? { supported: 'Reviewed requirements supported', conflict: 'Conflict found', unknown: 'Compatibility pending' } : { supported: 'Requisitos consultados atendidos', conflict: 'Conflito encontrado', unknown: 'Compatibilidade pendente' };
  return <div className="dd-chat-image-fit" data-status={status}>
    <strong>{status === 'conflict' ? '!' : status === 'supported' ? '✓' : '?'} {labels[status]}</strong>
    {fit && <details><summary>{english ? 'Review sources and pending checks' : 'Ver fontes e pendências'}</summary>
      {fit.checks.map((check, index) => <div className="dd-chat-fit-check" key={index} data-status={check.status}>
        <b>{check.aspect}</b><p>{check.explanation}</p>
        {!!check.relatedProducts?.length && <p><small>{english ? 'Compared with' : 'Comparado com'}: {check.relatedProducts.map(product => product.name).join(', ')}</small></p>}
        {check.requirement && <p><small>{check.requirement.label}</small><q>{check.requirement.quote}</q></p>}
        {check.evidence.map((source, i) => <p key={i}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><q>{source.quote}</q></p>)}
      </div>)}
      {fit.unknowns.length > 0 && <ul>{fit.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul>}
    </details>}
    <small>{english ? 'Documentary comparison of the available requirements. Physical fit and operation still require testing.' : 'Comparação documental dos requisitos disponíveis. Encaixe e funcionamento ainda precisam de ensaio.'}</small>
  </div>;
}
