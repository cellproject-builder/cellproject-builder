import { useId, useState } from 'react';
import { ExplanationContent } from '@/components/Markdown';
import { ChevronDownIcon } from '@/components/ui/SoftIcons';
import { useT } from '@/i18n';
import './ProjectDescription.css';

/** A display excerpt only. The original objective remains the source of truth. */
export function projectDescriptionPreview(text: string) {
  const paragraph = text.split(/\n\s*\n/).find(block => {
    const line = block.trim();
    return line && !/^(?:#{1,6}\s|```|\|)/.test(line) && !/^\*\*[^*\n]+\*\*:?$/.test(line);
  }) ?? text;
  const plain = paragraph.replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, '')
    .replace(/\*\*|__|`|\|/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= 320) return plain;
  return plain.slice(0, 320).replace(/\s+\S*$/, '').trimEnd() + '…';
}

export function ProjectDescription({ text }: { text: string }) {
  const tr = useT().workspace;
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const value = text.trim();
  if (!value) return null;
  // Medium paragraphs already occupy many lines on a phone.
  const expandable = value.length > 160 || value.split('\n').length > 3;
  const showFull = !expandable || expanded;
  return <section className="ws-project-description" aria-labelledby={`${id}-heading`}>
    <div className="ws-project-description-heading">
      <h2 id={`${id}-heading`}>{tr.projectContext}</h2>
      {expandable && <button className="ws-project-description-toggle" aria-expanded={expanded} aria-controls={`${id}-content`} onClick={() => setExpanded(!expanded)}>
        {expanded ? tr.collapseProjectDescription : tr.readProjectDescription}<ChevronDownIcon size={14} aria-hidden="true"/>
      </button>}
    </div>
    {showFull ? <div id={`${id}-content`} className={`ws-project-description-content ${expandable ? 'is-expanded' : ''}`} {...(expandable ? { role: 'region', 'aria-labelledby': `${id}-heading`, tabIndex: 0 } : {})}>
      <ExplanationContent text={value} preserveHeadingCase/>
    </div> : <p id={`${id}-content`} className="ws-project-description-preview">{projectDescriptionPreview(value)}</p>}
  </section>;
}
