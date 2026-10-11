import type { CSSProperties, ReactNode } from 'react';
import type { Messages } from '@/i18n';
import type { Lens } from '@/store';
import type { GraphLayoutMode, Orientation } from '@/graph/autoLayout';
import './PlannerCanvasControls.css';

export interface PlannerCanvasControlsProps {
  tr: Messages;
  lens: Lens;
  onLensChange: (lens: Lens) => void;
  layoutMode: GraphLayoutMode;
  onLayoutChange: (mode: GraphLayoutMode) => void;
  orientation: Orientation;
  onTidy: () => void;
  zoomButtons: readonly { label: string; glyph: string; onClick: () => void }[];
  maximized: boolean;
  onToggleMaximized?: () => void;
  isMobile: boolean;
  canvasWidth: number;
  legend: ReactNode;
}

const LENS_LABELS = {
  structure: 'lensStructure', flow: 'lensFlow', risk: 'lensRisk', state: 'lensState', connections: 'lensConnections',
} as const satisfies Record<Lens, keyof Messages['topBar']>;
const LAYOUT_LABELS = {
  auto: 'layoutAuto', horizontal: 'layoutHorizontal', vertical: 'layoutVertical', manual: 'layoutManual',
} as const satisfies Record<GraphLayoutMode, keyof Messages['graph']>;
const LENSES: readonly Lens[] = ['structure', 'flow', 'risk', 'state', 'connections'];
const LAYOUT_MODES: readonly GraphLayoutMode[] = ['auto', 'horizontal', 'vertical', 'manual'];

/** Screen-space controls; every layout action is independent of its visual arrangement. */
export function PlannerCanvasControls({ tr, lens, onLensChange, layoutMode, onLayoutChange, orientation, onTidy,
  zoomButtons, maximized, onToggleMaximized, isMobile, canvasWidth, legend }: PlannerCanvasControlsProps) {
  const compact = maximized;
  const showLens = isMobile || maximized;
  const narrow = isMobile || (canvasWidth > 0 && canvasWidth < 720);
  const orientationLabel = orientation === 'horizontal' ? tr.graph.layoutHorizontal : tr.graph.layoutVertical;
  const maximizeLabel = maximized ? tr.graph.restoreCanvas : tr.graph.maximizeCanvas;
  const style = canvasWidth > 0 ? { '--planner-controls-available': `${Math.max(0, canvasWidth - 24)}px` } as CSSProperties : undefined;

  return <div className={`planner-canvas-toolbar planner-controls${compact ? ' is-compact' : ''}${maximized ? ' is-maximized' : ''}${showLens ? ' has-lens' : ''}${isMobile ? ' is-touch' : ''}${narrow ? ' is-narrow' : ''}`} style={style}>
    {showLens && <label className="planner-controls-lens">
      <span className="planner-controls-label">{tr.topBar.lensSelectAria}</span>
      <select name="lens" value={lens} aria-label={tr.topBar.lensSelectAria} onChange={(event) => onLensChange(event.target.value as Lens)}>
        {LENSES.map((value) => <option key={value} value={value}>{tr.topBar[LENS_LABELS[value]]}</option>)}
      </select>
    </label>}

    {lens === 'structure' && <div className="planner-controls-layout" role="group" aria-label={tr.graph.layoutMode} title={tr.graph.layoutHint}>
      <span className="planner-controls-label" aria-hidden="true">{tr.graph.layoutMode}</span>
      <div className="planner-controls-layout-buttons">
        {LAYOUT_MODES.map((mode) => <button type="button" key={mode} data-layout-choice={mode} aria-label={tr.graph[LAYOUT_LABELS[mode]]}
          aria-pressed={layoutMode === mode} title={mode === 'auto' ? `${tr.graph.layoutAuto} · ${orientationLabel}` : tr.graph[LAYOUT_LABELS[mode]]}
          onClick={() => onLayoutChange(mode)}>
          <span>{tr.graph[LAYOUT_LABELS[mode]]}</span>
          {mode === 'auto' && layoutMode === 'auto' && <small aria-hidden="true">{orientationLabel}</small>}
        </button>)}
      </div>
    </div>}

    <div className="planner-controls-actions">
      <button type="button" className="planner-controls-tidy" onClick={onTidy} aria-label={tr.graph.tidy} title={tr.graph.tidyTitle}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="6" y="1.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="1.5" y="11.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="10.5" y="11.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 4.5V8M3.5 11.5V8h9v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <span>{tr.graph.tidy}</span>
      </button>

      {(!isMobile || maximized) && <div className="planner-controls-zoom" role="group" aria-label={tr.graph.zoomGroup}>
        {zoomButtons.map((button) => <button type="button" key={button.label} onClick={button.onClick} title={button.label} aria-label={button.label}>
          <span aria-hidden="true">{button.glyph}</span>
        </button>)}
      </div>}

      {onToggleMaximized && <button type="button" className="planner-controls-maximize" onClick={onToggleMaximized}
        aria-label={maximizeLabel} title={maximizeLabel} aria-pressed={maximized}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={maximized ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} />
        </svg>
      </button>}
    </div>
    <div className="planner-controls-legend">{legend}</div>
  </div>;
}
