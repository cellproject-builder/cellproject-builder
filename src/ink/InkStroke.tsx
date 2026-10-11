import { memo, useId, useMemo, type SVGProps } from 'react';
import { inkGeometry, type InkLegacyMode } from './geometry';
import type { InkStrokeData } from './model';

export interface InkStrokeProps extends Omit<SVGProps<SVGPathElement>, 'stroke' | 'fill' | 'opacity'> {
  stroke: InkStrokeData;
  legacyMode?: InkLegacyMode;
  selected?: boolean;
  'data-note-stroke'?: string;
  'data-board-stroke'?: string;
}

/** Completed strokes stay out of pointer-frame reconciliation; changed geometry, selection and handlers still update. */
export const InkStroke = memo(function InkStroke({ stroke, legacyMode = 'board', selected, className, ...props }: InkStrokeProps) {
  const grainId = `ink-grain-${useId().replaceAll(':', '')}`;
  const geometry = useMemo(() => inkGeometry(stroke, legacyMode), [stroke.points, stroke.width, stroke.color, stroke.tool, stroke.opacity, legacyMode]);
  return <>
    {stroke.tool === 'pencil' && <defs><filter id={grainId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" seed="17" result="grain" />
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .5 0 0 0 .45" result="grainAlpha" />
      <feComposite in="SourceGraphic" in2="grainAlpha" operator="in" />
    </filter></defs>}
    <path {...props} {...geometry} filter={stroke.tool === 'pencil' ? `url(#${grainId})` : props.filter} strokeLinecap="round" strokeLinejoin="round" className={[className, selected && 'is-selected'].filter(Boolean).join(' ') || undefined} />
  </>;
});
