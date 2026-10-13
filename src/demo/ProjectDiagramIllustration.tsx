import { lazy, Suspense } from 'react';
import { isPublicDemo } from './session';
import type { VisualArtifact } from '@/visuals/types';
const ServoSignal = lazy(() => import('./ServoSignal').then(module => ({ default: module.ServoSignal })));
const ServoTorque = lazy(() => import('./ServoTorque').then(module => ({ default: module.ServoTorque })));

/** A richer drawing of the same parameters stored in the native project artifact. */
export function projectDiagramIllustration(artifact: VisualArtifact, english: boolean) {
  if (!isPublicDemo()) return undefined;
  const prefix = 'cellproject-public-demo-v1:robot:';
  if (artifact.id === `${prefix}diagram`) return <Suspense fallback={null}><ServoTorque scenario={{ mass: (artifact.diagramValues?.mass ?? .2) * 1000, reach: (artifact.diagramValues?.reach ?? .1) * 100, angle: 0, reference: .18 }} english={english}/></Suspense>;
  if (artifact.id === `${prefix}servo-signal`) return <Suspense fallback={null}><ServoSignal angle={artifact.diagramValues?.position ?? 90} english={english}/></Suspense>;
  return undefined;
}
