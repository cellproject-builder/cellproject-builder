import { useId, useRef, useState } from 'react';
import { Icon } from '../ui';
import { DEFAULT_PROJECT_APPEARANCE, type ProjectAppearance } from './projectAppearance';
import { ProjectIcon, projectIconCatalog, searchProjectIcons } from './projectIcons';
import './project-icons.css';

export const PROJECT_ICON_COLORS = ['#60a5fa','#a78bfa','#f472b6','#fb7185','#fb923c','#fbbf24','#4ade80','#2dd4bf','#94a3b8'];

export function ProjectIconPicker({value, onChange, english = false}: {value: ProjectAppearance; onChange(value: ProjectAppearance): void; english?: boolean}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const [cursor, setCursor] = useState(value.icon);
  const results = searchProjectIcons(query);
  const active = results.some(icon => icon.id === cursor) ? cursor : results[0]?.id;
  const chosen = projectIconCatalog.find(icon => icon.id === value.icon);
  const label = chosen ? english ? chosen.english : chosen.label : english ? 'Plan' : 'Plano';
  const choose = (icon: string) => {setCursor(icon); onChange({...value, icon});};
  const focus = (index: number) => {
    const target = results[Math.max(0, Math.min(index, results.length - 1))];
    if (!target) return;
    setCursor(target.id); grid.current?.querySelector<HTMLButtonElement>(`[data-icon-id="${target.id}"]`)?.focus();
  };
  const safeColor = /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULT_PROJECT_APPEARANCE.color;
  return <section className="ws-project-appearance" aria-label={english ? 'Project appearance' : 'Aparência do projeto'}>
    <div className="ws-project-appearance-row">
      <button ref={trigger} type="button" className="ws-project-icon-trigger" aria-label={english ? 'Choose project icon' : 'Escolher ícone do projeto'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ProjectIcon appearance={value} size={25} decorated/>
        <span><strong>{english ? 'Project icon' : 'Ícone do projeto'}</strong><small>{label}</small></span><Icon name="edit" size={14}/>
      </button>
      <div className="ws-project-color-options" role="group" aria-label={english ? 'Icon color' : 'Cor do ícone'}>
        {PROJECT_ICON_COLORS.map(color => <button type="button" key={color} data-icon-color={color} className="ws-project-color" style={{backgroundColor:color}} aria-label={`${english ? 'Color' : 'Cor'} ${color}`} aria-pressed={safeColor.toLowerCase() === color} title={color} onClick={() => onChange({...value,color})}/>) }
        <label className="ws-project-custom-color" title={english ? 'Custom color' : 'Cor personalizada'} style={{backgroundColor:safeColor}}><input type="color" aria-label={english ? 'Custom color' : 'Cor personalizada'} value={safeColor} onChange={event => onChange({...value,color:event.target.value})}/><Icon name="plus" size={12}/></label>
      </div>
    </div>
    {open && <div id={id} className="ws-project-icon-library">
      <div className="ws-project-icon-search"><Icon name="search" size={15}/><input autoFocus type="search" maxLength={100} aria-label={english ? 'Search icons' : 'Buscar ícones'} placeholder={english ? 'Search icons…' : 'Buscar ícones…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') event.preventDefault();
        if (event.key === 'ArrowDown' && results.length) {event.preventDefault(); focus(0);}
      }}/><small aria-live="polite">{results.length}</small><button type="button" className="ws-icon-button" aria-label={english ? 'Close icon library' : 'Fechar biblioteca de ícones'} onClick={() => {setOpen(false); trigger.current?.focus();}}><Icon name="close" size={13}/></button></div>
      <div ref={grid} className="ws-project-icon-grid" role="group" aria-label={english ? 'Icon library' : 'Biblioteca de ícones'}>
        {results.map((icon, index) => <button type="button" key={icon.id} data-icon-id={icon.id} aria-label={english ? icon.english : icon.label} title={english ? icon.english : icon.label} aria-pressed={value.icon === icon.id} tabIndex={active === icon.id ? 0 : -1} onFocus={() => setCursor(icon.id)} onClick={() => choose(icon.id)} onKeyDown={event => {
          const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
          const step = columns > 1 ? columns : 8;
          const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + step : event.key === 'ArrowUp' ? index - step : event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : null;
          if (next !== null) {event.preventDefault(); focus(next);}
          if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); choose(icon.id);}
        }}><ProjectIcon appearance={{icon:icon.id,color:safeColor}} size={21}/></button>)}
      </div>
      {!results.length && <p className="ws-project-icons-empty">{english ? 'No icons found.' : 'Nenhum ícone encontrado.'}</p>}
    </div>}
  </section>;
}
