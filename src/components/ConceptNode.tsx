import { memo } from 'react';
import { Handle, Position, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import type { ConceptNodeData, NodeKind } from '@/types';
import { useGraphStore, confidenceBand } from '@/store';
import { useT } from '@/i18n';

const confidenceDot = (band: 'high' | 'mid' | 'low') => {
  if (band === 'high') return 'bg-conf-high';
  if (band === 'mid') return 'bg-conf-mid';
  return 'bg-conf-low';
};

const kindAccent: Record<NodeKind, string> = {
  root: 'text-ai-accent border-ai-accent/60',
  categoria: 'text-text-primary border-text-primary/40',
  recurso: 'text-conf-mid border-conf-mid/40',
  passo: 'text-state-executing border-state-executing/40',
  decisao: 'text-ai-accent border-ai-accent/60',
  concept: 'text-text-secondary border-border-base',
};

interface NodeExtras {
  childCount: number;
  edgeCount: number;
  isSuggestion?: boolean;
  tempId?: string;
  blocked?: boolean;
}

type Props = NodeProps & { data: ConceptNodeData & NodeExtras };

function ConceptNodeImpl({ data, selected }: Props) {
  const tr = useT();
  // Subscribe only to the discrete zoom bucket (re-render on crossing, not on
  // every zoom frame), and read `blocked` from precomputed data instead of
  // subscribing to the whole project — so memo() actually holds.
  const level = useRfStore<'far' | 'mid' | 'near'>((s) =>
    s.transform[2] < 0.6 ? 'far' : s.transform[2] < 1.1 ? 'mid' : 'near',
  );
  const acceptSuggestion = useGraphStore((s) => s.acceptSuggestion);
  const rejectSuggestion = useGraphStore((s) => s.rejectSuggestion);
  const confirmNode = useGraphStore((s) => s.confirmNode);

  const kindLabel = tr.conceptNode[data.kind];
  const band = confidenceBand(data.confidence);
  const isFocused = selected;
  const blocked = !data.confirmado && !!data.blocked;

  const kindStyle = kindAccent[data.kind] ?? kindAccent.concept;
  // Signal-gated resolution made visible (the ground-truth gate): 'done' =
  // anchored against real signal (green); confirmado-but-not-done = confirmed
  // WITHOUT an anchor (amber — a hunch must not look verified); takenAsKnown =
  // a deliberate axiom / known floor (accent).
  const anchored = data.state === 'done';
  const known = !!data.takenAsKnown;
  const hunch = data.confirmado && !anchored && !known;
  const confirmedStyle = anchored
    ? 'opacity-80 border-state-done'
    : known
    ? 'opacity-80 border-ai-accent/40'
    : hunch
    ? 'opacity-80 border-conf-mid'
    : blocked
    ? 'opacity-40 grayscale'
    : '';

  const baseClass = [
    'rounded-sm bg-bg-secondary border-2 font-sans text-text-primary select-none touch-manipulation',
    'transition-[box-shadow,transform,opacity] duration-150',
    kindStyle,
    confirmedStyle,
    isFocused ? 'shadow-[0_0_0_2px_#8b5cf680]' : '',
    data.isSuggestion ? '!border-dashed !border-ai-accent bg-bg-secondary/70' : '',
  ].join(' ');

  if (data.isSuggestion) {
    return (
      <div className={`${baseClass} w-[240px] p-3`}>
        <Handle type="target" position={Position.Top} className="!bg-ai-accent !border-none" />
        <div className="flex items-center gap-2 mb-1">
          <span className="text-ai-accent text-[10px] font-mono uppercase tracking-wider">
            ◆ {kindLabel}
          </span>
          <span className="ml-auto font-mono text-xs text-text-secondary">
            {data.confidence}%
          </span>
        </div>
        <div className="font-semibold text-sm mb-1 leading-tight">{data.name}</div>
        <div className="text-[11px] text-text-secondary leading-snug mb-2 line-clamp-2">
          {data.oQue || data.fx}
        </div>
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              acceptSuggestion(data.tempId as string);
            }}
            className="flex-1 bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-xs py-2 min-h-[36px] rounded-sm border border-conf-high/40 transition-colors"
          >
            {tr.conceptNode.accept}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              rejectSuggestion(data.tempId as string);
            }}
            className="flex-1 bg-bg-elevated hover:bg-state-problem/20 text-text-secondary hover:text-state-problem text-xs py-2 min-h-[36px] rounded-sm border border-border-base transition-colors"
          >
            {tr.conceptNode.reject}
          </button>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-ai-accent !border-none" />
      </div>
    );
  }

  const canQuickConfirm =
    !blocked && !data.confirmado && (data.kind === 'recurso' || data.kind === 'passo');

  if (level === 'far') {
    return (
      <div className={`${baseClass} w-[200px] px-3 py-2 flex items-center gap-2`}>
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        {anchored ? (
          <span className="w-2 h-2 rounded-full bg-state-done" />
        ) : known ? (
          <span className="text-ai-accent text-[11px] leading-none" title={tr.conceptNode.axiom}>⊢</span>
        ) : hunch ? (
          <span className="w-2 h-2 rounded-full bg-conf-mid" title={tr.conceptNode.noAnchor} />
        ) : (
          <span className={`w-2 h-2 rounded-full ${confidenceDot(band)}`} />
        )}
        <span className="text-sm truncate flex-1">{data.name}</span>
        {data.kind !== 'categoria' && data.kind !== 'root' && (
          <span className="font-mono text-[10px] text-text-muted uppercase">
            {data.kind.slice(0, 3)}
          </span>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
      </div>
    );
  }

  if (level === 'mid') {
    return (
      <div className={`${baseClass} w-[260px] p-2.5`}>
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
            {kindLabel}
          </span>
          {data.kind === 'passo' && (
            <span className="font-mono text-[10px] text-text-muted">#{data.order + 1}</span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {anchored && <span className="text-state-done text-xs">✓</span>}
            {known && <span className="text-ai-accent text-xs" title={tr.conceptNode.axiom}>⊢</span>}
            {hunch && <span className="text-conf-mid text-xs" title={tr.conceptNode.noAnchor}>✓</span>}
            {blocked && <span className="text-text-muted text-[10px]">{tr.conceptNode.blocked}</span>}
            <span className="font-mono text-[11px] text-text-secondary">{data.confidence}%</span>
          </span>
        </div>
        <div className="text-sm font-semibold leading-tight mb-1">{data.name}</div>
        <div className="text-[11px] text-text-secondary leading-snug line-clamp-2">
          {data.oQue}
        </div>
        {canQuickConfirm && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              confirmNode(data.id);
            }}
            className="mt-2 w-full bg-conf-high/10 hover:bg-conf-high/25 text-conf-high text-[11px] py-1 rounded-sm border border-conf-high/30 transition-colors"
          >
            {data.kind === 'recurso' ? tr.conceptNode.quickHaveResource : tr.conceptNode.quickHaveStep}
          </button>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
      </div>
    );
  }

  return (
    <div className={`${baseClass} w-[300px] p-3`}>
      <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
          {kindLabel}
        </span>
        {data.kind === 'passo' && (
          <span className="font-mono text-[10px] text-text-muted">#{data.order + 1}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {data.confirmado && <span className="text-state-done text-xs">✓</span>}
          {blocked && <span className="text-text-muted text-[10px]">{tr.conceptNode.blocked}</span>}
          <span className={`w-2 h-2 rounded-full ${confidenceDot(band)}`} />
          <span className="font-mono text-[11px] text-text-secondary">{data.confidence}%</span>
        </span>
      </div>
      <div className="text-sm font-semibold leading-tight mb-2">{data.name}</div>
      <div className="border-t border-border-base pt-2 space-y-1.5">
        {data.oQue && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">
              {tr.conceptNode.whatPrefix}
            </span>{' '}
            <span className="text-text-secondary">{data.oQue}</span>
          </div>
        )}
        {data.porQue && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">
              {tr.conceptNode.whyPrefix}
            </span>{' '}
            <span className="text-text-secondary">{data.porQue}</span>
          </div>
        )}
        {data.comoConfirmar &&
          (data.kind === 'recurso' || data.kind === 'passo' || data.kind === 'concept') && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">
              {tr.conceptNode.checkPrefix}
            </span>{' '}
            <span className="text-text-secondary italic">{data.comoConfirmar}</span>
          </div>
        )}
      </div>
      {canQuickConfirm && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            confirmNode(data.id);
          }}
          className="mt-2.5 w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-xs py-2.5 min-h-[40px] rounded-sm border border-conf-high/40 transition-colors font-medium"
        >
          {data.kind === 'recurso' ? tr.detail.alreadyHave : tr.detail.alreadyDid}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeImpl);
