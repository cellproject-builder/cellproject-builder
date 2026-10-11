import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PenIcon, FountainPenIcon, Pencil1Icon, Pencil2Icon, HighlighterIcon, OptionsIcon } from '@/components/ui/SoftIcons';
import { InkStroke } from './InkStroke';
import { InkPaletteOverlayContext } from './InkPaletteOverlay';
import { createInkSettings, inkTools, type InkSettings, type InkTool } from './model';
import './ink.css';
import './inkPalette.css';

export interface InkToolbarProps { value: InkSettings; onChange(value: InkSettings): void; english?: boolean; disabled?: boolean; className?: string }
const names: Record<InkTool, [string, string]> = { pen: ['Caneta', 'Pen'], fountain: ['Bico de pena', 'Fountain pen'], monoline: ['Monoline', 'Monoline'], pencil: ['Lápis', 'Pencil'], highlighter: ['Marca-texto', 'Highlighter'] };
const icons = { pen: PenIcon, fountain: FountainPenIcon, monoline: Pencil1Icon, pencil: Pencil2Icon, highlighter: HighlighterIcon };

export function InkToolbar({ value, onChange, english = false, disabled = false, className }: InkToolbarProps) {
  const t = (pt: string, en: string) => english ? en : pt;
  const [popup, setPopup] = useState<'brush' | 'appearance' | null>(null);
  const host = useRef<HTMLDivElement>(null), brushTrigger = useRef<HTMLButtonElement>(null), settingsTrigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), panel = useId();
  const expanded = popup !== null, trigger = popup === 'brush' ? brushTrigger : settingsTrigger;
  const overlay = useContext(InkPaletteOverlayContext), overlayTarget = overlay?.target ?? null, dock = overlay?.dock;
  const [position, setPosition] = useState<CSSProperties>();
  useEffect(() => {
    if (!expanded) return;
    const close = (event: globalThis.PointerEvent) => { if (!host.current?.contains(event.target as Node) && !dialog.current?.contains(event.target as Node)) setPopup(null); };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded || !overlayTarget || !dock) return;
    const update = () => {
      if (!trigger.current || !dialog.current) return;
      const bounds = overlayTarget.getBoundingClientRect(), anchor = trigger.current.getBoundingClientRect(), viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth), viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const left = Math.max(bounds.left, viewportLeft) + 8, top = Math.max(bounds.top, viewportTop) + 8;
      const right = Math.min(bounds.width ? bounds.right : viewportRight, viewportRight) - 8, bottom = Math.min(bounds.height ? bounds.bottom : viewportBottom, viewportBottom) - 8;
      const width = Math.min(254, Math.max(1, right - left)), availableHeight = Math.max(1, bottom - top);
      const inwardHeight = dock === 'top' ? bottom - anchor.bottom - 8 : dock === 'bottom' ? anchor.top - 8 - top : availableHeight;
      const maxHeight = Math.min(availableHeight, Math.max(44, inwardHeight));
      // Measure after narrowing so wrapped labels also fit the available height.
      dialog.current.style.width = `${width}px`;
      const height = Math.min(dialog.current.scrollHeight || dialog.current.getBoundingClientRect().height, maxHeight);
      const x = dock === 'left' ? anchor.right + 8 : dock === 'right' ? anchor.left - width - 8 : anchor.left + (anchor.width - width) / 2;
      const y = dock === 'top' ? anchor.bottom + 8 : dock === 'bottom' ? anchor.top - height - 8 : anchor.top;
      const next: CSSProperties = {
        position: 'absolute', left: Math.max(left, Math.min(x, right - width)) - bounds.left,
        top: Math.max(top, Math.min(y, bottom - height)) - bounds.top, right: 'auto', bottom: 'auto',
        width, maxWidth: 'none', maxHeight, margin: 0, boxSizing: 'border-box',
      };
      setPosition(previous => previous?.left === next.left && previous?.top === next.top && previous?.width === width && previous?.maxHeight === maxHeight ? previous : next);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(overlayTarget); if (trigger.current) observer?.observe(trigger.current); if (dialog.current) observer?.observe(dialog.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [popup, overlayTarget, dock, trigger]);
  useLayoutEffect(() => {
    if (expanded) dialog.current?.querySelector<HTMLElement>(popup === 'brush' ? '[aria-pressed=true]' : 'input[type=range]')?.focus({ preventScroll: true });
  }, [popup, overlayTarget]);
  useEffect(() => { if (disabled) setPopup(null); }, [disabled]);
  const settings = expanded && <div ref={dialog} id={panel} className={`ink-settings-panel ink-tool-popover${overlayTarget ? ' ink-settings-panel--overlay' : ''}`} style={overlayTarget ? position : undefined} role="dialog" aria-label={popup === 'brush' ? t('Tipo de traço', 'Brush type') : t('Aparência do traço', 'Stroke appearance')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPopup(null); trigger.current?.focus(); } }}>
    {popup === 'brush' ? <>
      <div className="ink-settings-heading">{t('Tipo de traço', 'Brush type')}</div>
      <div className="ink-brush-options" role="group" aria-label={t('Tipo de traço', 'Brush type')}>
        {inkTools.map(tool => { const Brush = icons[tool]; return <button type="button" key={tool} data-ink-brush-option={tool} disabled={disabled} title={names[tool][english ? 1 : 0]} aria-label={names[tool][english ? 1 : 0]} aria-pressed={value.tool === tool}
          onClick={() => { onChange({ ...createInkSettings(tool), color: value.color }); setPopup(null); brushTrigger.current?.focus(); }}><Brush size={18} /><span>{names[tool][english ? 1 : 0]}</span></button>; })}
      </div>
    </> : <>
    <div className="ink-settings-heading"><span>{names[value.tool][english ? 1 : 0]}</span><svg className="ink-preview" viewBox="0 0 64 28" aria-hidden="true"><InkStroke stroke={{ ...value, points: [{ x: 5, y: 21, pressure: .2 }, { x: 18, y: 7, pressure: .45 }, { x: 32, y: 21, pressure: .7 }, { x: 46, y: 7, pressure: .9 }, { x: 59, y: 14, pressure: .6 }] }} /></svg></div>
    <label className="ink-appearance-color"><span>{t('Cor', 'Color')}</span><input type="color" aria-label={t('Cor do traço', 'Stroke color')} value={value.color} disabled={disabled} onChange={event => onChange({ ...value, color: event.target.value })} /></label>
    <label className="ink-range"><span>{t('Espessura', 'Width')}</span><input type="range" min=".25" max="24" step=".25" aria-label={t('Espessura do traço', 'Stroke width')} value={value.width} disabled={disabled} onChange={event => onChange({ ...value, width: Number(event.target.value) })} /><output>{value.width}</output></label>
    <label className="ink-range"><span>{t('Opacidade', 'Opacity')}</span><input type="range" min="5" max="100" step="1" aria-label={t('Opacidade do traço', 'Stroke opacity')} value={Math.round(value.opacity * 100)} disabled={disabled} onChange={event => onChange({ ...value, opacity: Number(event.target.value) / 100 })} /><output>{Math.round(value.opacity * 100)}%</output></label>
    </>}
    </div>;
  const Brush = icons[value.tool], brushLabel = names[value.tool][english ? 1 : 0];
  return <div ref={host} className={`ink-toolbar is-compact${className ? ` ${className}` : ''}`} role="group" aria-label={t('Pincéis e aparência do traço', 'Brushes and stroke appearance')}>
    <button ref={brushTrigger} type="button" className="ink-brush-trigger" data-ink-brush-trigger data-tool={value.tool} disabled={disabled}
      title={brushLabel} aria-label={`${t('Escolher caneta', 'Choose brush')}: ${brushLabel}`} aria-haspopup="dialog" aria-expanded={popup === 'brush'} aria-controls={popup === 'brush' ? panel : undefined}
      onClick={() => setPopup(popup === 'brush' ? null : 'brush')}><Brush size={19} /><i aria-hidden="true" style={{ backgroundColor: value.color }} /></button>
    <button ref={settingsTrigger} type="button" className="ink-settings-trigger" disabled={disabled} title={t('Ajustar traço', 'Stroke settings')} aria-label={t('Ajustar traço', 'Stroke settings')} aria-haspopup="dialog" aria-expanded={popup === 'appearance'} aria-controls={popup === 'appearance' ? panel : undefined} onClick={() => setPopup(popup === 'appearance' ? null : 'appearance')}><OptionsIcon width={17} height={17} /></button>
    {overlayTarget ? createPortal(settings, overlayTarget) : settings}
  </div>;
}
