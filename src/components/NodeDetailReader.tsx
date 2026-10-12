import { useEffect } from 'react';
import { breadcrumbFor, useGraphStore } from '@/store';
import { ReadingMode } from './ReadingMode';

export interface NodeDetailRequest { planId: string; nodeId: string }

/** Canvas inspection stays available when its ordinary Details rail is hidden. */
export function NodeDetailReader({ request, onClose }: { request: NodeDetailRequest | null; onClose: () => void }) {
  const project = useGraphStore(state => state.project);
  const node = request && project?.id === request.planId ? project.nodes[request.nodeId] : null;
  useEffect(() => { if (request && !node) onClose(); }, [request, node, onClose]);
  if (!node || !project) return null;
  return <ReadingMode compact node={node} breadcrumb={breadcrumbFor(project, node.id).map(part => part.name)} onClose={onClose} />;
}
