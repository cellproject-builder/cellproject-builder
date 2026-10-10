import { useState } from 'react';
import { useLocaleStore } from '@/i18n';
import { PixelEngineer } from './PixelEngineer';
import { WorkshopSceneProps } from './WorkshopSceneProps';
import './ascii-workshop.css';

export function AsciiWorkshop({ interest }: { interest: number | null }) {
  const english = useLocaleStore(state => state.locale === 'en');
  const [paused, setPaused] = useState(false);
  const pauseLabel = english ? (paused ? 'Resume animation' : 'Pause animation') : (paused ? 'Retomar animação' : 'Pausar animação');
  return <div className={`ws-drift-workshop${paused ? ' is-paused' : ''}${interest !== null ? ' is-engaged' : ''}`}>
    <div className="ws-scene-stage" aria-hidden="true">
      <WorkshopSceneProps />
      <div className="ws-scene-character"><div className="ws-scene-facing">
        {(['idle', 'walk', 'write', 'hammer', 'observe'] as const).map(pose => <div key={pose} className={`ws-scene-pose ws-scene-pose-${pose}`}><PixelEngineer pose={pose} /></div>)}
      </div></div>
    </div>
    <button type="button" className="ws-drift-pause" aria-label={pauseLabel} title={pauseLabel} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        {paused ? <path d="m4 2 6 4-6 4z" /> : <><path d="M3 2h2v8H3z" /><path d="M7 2h2v8H7z" /></>}
      </svg>
    </button>
  </div>;
}
