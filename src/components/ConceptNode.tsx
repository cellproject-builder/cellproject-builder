import { memo } from 'react';
import { Handle, Position, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import type { ConceptNodeData, NodeKind } from '@/types';
import { useGraphStore, confidenceBand, isBlocked } from '@/store';

const confidenceDot = (band: 'high' | 'mid' | 'low') => {
  if (band === 'high') return 'bg-conf-high';
  if (band === 'mid') return 'bg-conf-mid';
  return 'bg-conf-low';
};

const kindLabel: Record<NodeKind, string> = {
  root: 'OBJETIVO',
  categoria: 'CATEGORIA',
  recurso: 'RECURSO',
  passo: 'PASSO',
  decisao: 'DECISÃO',
  concept: 'CONCEITO',
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

function ConceptNodeImpl({ id, data, selected }: Props) {
  const zoom = useRfStore((s) => s.transform[2]);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const project = useGraphStore((s) => s.project);
  const acceptSuggestion = useGraphStore((s) => s.acceptSuggestion);
  const rejectSuggestion = useGraphStore((s) => s.rejectSuggestion);
  const confirmNode = useGraphStore((s) => s.confirmNode);

  const band = confidenceBand(data.confidence);
  const isFocused = selected || selectedNodeId === id;
  const blocked = data.kind === 'passo' && !data.confirmado && isBlocked(project, data.id);

  const level: 'far' | 'mid' | 'near' = zoom < 0.6 ? 'far' : zoom < 1.1 ? 'mid' : 'near';

  const kindStyle = kindAccent[data.kind] ?? kindAccent.concept;
  const confirmedStyle = data.confirmado
    ? 'opacity-80 border-state-done'
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

  // ---------- Suggestion preview ----------
  if (data.isSuggestion) {
    return (
      <div className={`${baseClass} w-[240px] p-3`}>
        <Handle type="target" position={Position.Top} className="!bg-ai-accent !border-none" />
        <div className="flex items-center gap-2 mb-1">
          <span className="text-ai-accent text-[10px] font-mono uppercase tracking-wider">
            ◆ {kindLabel[data.kind]}
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
            ✓ Aceitar
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              rejectSuggestion(data.tempId as string);
            }}
            className="flex-1 bg-bg-elevated hover:bg-state-problem/20 text-text-secondary hover:text-state-problem text-xs py-2 min-h-[36px] rounded-sm border border-border-base transition-colors"
          >
            ✕
          </button>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-ai-accent !border-none" />
      </div>
    );
  }

  // ---------- Confirm quick action (only for recurso/passo at mid+ zoom) ----------
  const canQuickConfirm =
    !blocked && !data.confirmado && (data.kind === 'recurso' || data.kind === 'passo');

  // ---------- Far zoom ----------
  if (level === 'far') {
    return (
      <div className={`${baseClass} w-[200px] px-3 py-2 flex items-center gap-2`}>
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        {data.confirmado ? (
          <span className="w-2 h-2 rounded-full bg-state-done" />
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

  // ---------- Mid zoom ----------
  if (level === 'mid') {
    return (
      <div className={`${baseClass} w-[260px] p-2.5`}>
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
            {kindLabel[data.kind]}
          </span>
          {data.kind === 'passo' && <span className="font-mono text-[10px] text-text-muted">#{data.order + 1}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            {data.confirmado && <span className="text-state-done text-xs">✓</span>}
            {blocked && <span className="text-text-muted text-[10px]">bloqueado</span>}
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
            ✓ Já {data.kind === 'recurso' ? 'tenho' : 'fiz'}
          </button>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
      </div>
    );
  }

  // ---------- Near zoom (full detail) ----------
  return (
    <div className={`${baseClass} w-[300px] p-3`}>
      <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
          {kindLabel[data.kind]}
        </span>
        {data.kind === 'passo' && (
          <span className="font-mono text-[10px] text-text-muted">#{data.order + 1}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {data.confirmado && <span className="text-state-done text-xs">✓</span>}
          {blocked && <span className="text-text-muted text-[10px]">bloqueado</span>}
          <span className={`w-2 h-2 rounded-full ${confidenceDot(band)}`} />
          <span className="font-mono text-[11px] text-text-secondary">{data.confidence}%</span>
        </span>
      </div>
      <div className="text-sm font-semibold leading-tight mb-2">{data.name}</div>
      <div className="border-t border-border-base pt-2 space-y-1.5">
        {data.oQue && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">o que:</span>{' '}
            <span className="text-text-secondary">{data.oQue}</span>
          </div>
        )}
        {data.porQue && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">por quê:</span>{' '}
            <span className="text-text-secondary">{data.porQue}</span>
          </div>
        )}
        {data.comoConfirmar && (data.kind === 'recurso' || data.kind === 'passo') && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">check:</span>{' '}
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
          ✓ {data.kind === 'recurso' ? 'Já tenho este item' : 'Já executei este passo'}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeImpl);
