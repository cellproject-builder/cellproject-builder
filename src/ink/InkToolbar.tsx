import { useEffect, useId, useRef, useState } from 'react';
import { PenIcon, FountainPenIcon, Pencil1Icon, Pencil2Icon, HighlighterIcon, OptionsIcon } from '@/components/ui/SoftIcons';
import { InkStroke } from './InkStroke';
import { createInkSettings, inkTools, type InkSettings, type InkTool } from './model';
import './ink.css';

export interface InkToolbarProps { value: InkSettings; onChange(value: InkSettings): void; english?: boolean; disabled?: boolean; className?: string }
const names: Record<InkTool, [string, string]> = { pen: ['Caneta', 'Pen'], fountain: ['Bico de pena', 'Fountain pen'], monoline: ['Monoline', 'Monoline'], pencil: ['Lápis', 'Pencil'], highlighter: ['Marca-texto', 'Highlighter'] };
const icons = { pen: PenIcon, fountain: FountainPenIcon, monoline: Pencil1Icon, pencil: Pencil2Icon, highlighter: HighlighterIcon };

export function InkToolbar({ value, onChange, english = false, disabled = false, className }: InkToolbarProps) {
  const t = (pt: string, en: string) => english ? en : pt;
  const [expanded, setExpanded] = useState(false), host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useId();
  useEffect(() => {
    if (!expanded) return;
    const close = (event: globalThis.PointerEvent) => { if (!host.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [expanded]);
  useEffect(() => { if (disabled) setExpanded(false); }, [disabled]);
  return <div ref={host} className={`ink-toolbar${className ? ` ${className}` : ''}`} role="group" aria-label={t('Pincéis e aparência do traço', 'Brushes and stroke appearance')}>
    <div className="ink-brushes" role="group" aria-label={t('Tipo de traço', 'Brush type')}>
      {inkTools.map(tool => { const Brush = icons[tool]; return <button type="button" key={tool} disabled={disabled} title={names[tool][english ? 1 : 0]} aria-label={names[tool][english ? 1 : 0]} aria-pressed={value.tool === tool}
        onClick={() => onChange({ ...createInkSettings(tool), color: value.color })}>
        <Brush width={19} height={19} />
      </button>; })}
    </div>
    <label className="ink-color" title={t('Cor do traço', 'Stroke color')}><span className="ink-label">{t('Cor', 'Color')}</span><input type="color" aria-label={t('Cor do traço', 'Stroke color')} value={value.color} disabled={disabled} onChange={event => onChange({ ...value, color: event.target.value })} /></label>
    <button ref={trigger} type="button" className="ink-settings-trigger" disabled={disabled} title={t('Ajustar traço', 'Stroke settings')} aria-label={t('Ajustar traço', 'Stroke settings')} aria-expanded={expanded} aria-controls={expanded ? panel : undefined} onClick={() => setExpanded(!expanded)}><OptionsIcon width={17} height={17} /></button>
    {expanded && <div id={panel} className="ink-settings-panel" role="dialog" aria-label={t('Aparência do traço', 'Stroke appearance')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
    <div className="ink-settings-heading"><span>{names[value.tool][english ? 1 : 0]}</span><svg className="ink-preview" viewBox="0 0 64 28" aria-hidden="true"><InkStroke stroke={{ ...value, points: [{ x: 5, y: 21, pressure: .2 }, { x: 18, y: 7, pressure: .45 }, { x: 32, y: 21, pressure: .7 }, { x: 46, y: 7, pressure: .9 }, { x: 59, y: 14, pressure: .6 }] }} /></svg></div>
    <label className="ink-range"><span>{t('Espessura', 'Width')}</span><input type="range" min=".25" max="24" step=".25" aria-label={t('Espessura do traço', 'Stroke width')} value={value.width} disabled={disabled} onChange={event => onChange({ ...value, width: Number(event.target.value) })} /><output>{value.width}</output></label>
    <label className="ink-range"><span>{t('Opacidade', 'Opacity')}</span><input type="range" min="5" max="100" step="1" aria-label={t('Opacidade do traço', 'Stroke opacity')} value={Math.round(value.opacity * 100)} disabled={disabled} onChange={event => onChange({ ...value, opacity: Number(event.target.value) / 100 })} /><output>{Math.round(value.opacity * 100)}%</output></label>
    </div>}
  </div>;
}
