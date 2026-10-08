import { memo } from 'react';
import { Handle, Position, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import type { ConceptNodeData, NodeKind } from '@/types';
import { useGraphStore, confidenceBand, canRevealAICriterion, isActionableKind } from '@/store';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';

const confidenceDot = (band: 'high' | 'mid' | 'low') => {
  if (band === 'high') return 'bg-conf-high';
  if (band === 'mid') return 'bg-conf-mid';
  return 'bg-conf-low';
};

// Tipo = ícone + rótulo traduzido num chip; a BORDA fica só para o estado.
// Antes tipo e estado disputavam a mesma border-color e quem vencia era a
// ordem do CSS gerado.
export const KIND_ICON: Record<NodeKind, string> = {
  root: '◎',
  categoria: '▤',
  recurso: '▪',
  passo: '▸',
  decisao: '⑂',
  concept: '◇',
};

const kindChip: Record<NodeKind, string> = {
  root: 'text-ai-accent border-ai-accent/40 bg-ai-accent/10',
  categoria: 'text-text-secondary border-border-base bg-bg-elevated',
  recurso: 'text-conn-independent border-conn-independent/40 bg-conn-independent/10',
  passo: 'text-state-executing border-state-executing/40 bg-state-executing/10',
  decisao: 'text-ai-accent border-ai-accent/40 bg-ai-accent/10',
  concept: 'text-text-muted border-border-base bg-bg-elevated',
};

// Estado visual de um nó, derivado do gate de sinal real.
export type NodeVisualStatus = 'problem' | 'done' | 'noProof' | 'known' | 'open';

export const visualStatusOf = (
  d: Pick<ConceptNodeData, 'state' | 'failureContext' | 'confirmado' | 'takenAsKnown'>,
): NodeVisualStatus => {
  if (d.state === 'problem' || d.failureContext) return 'problem';
  if (d.state === 'done') return 'done';
  if (d.takenAsKnown) return 'known';
  if (d.confirmado) return 'noProof';
  return 'open';
};

// Verde = com prova · âmbar tracejado = sem prova · vermelho = problema.
const statusBorder: Record<NodeVisualStatus, string> = {
  problem: 'border-state-problem',
  done: 'border-state-done',
  noProof: 'border-conf-mid border-dashed',
  known: 'border-ai-accent/50',
  open: 'border-border-base',
};

export interface NodeExtras {
  childCount: number;
  edgeCount: number;
  isSuggestion?: boolean;
  tempId?: string;
  blocked?: boolean;
  // Posição do passo entre os passos irmãos (o "#n"), via stepSequence.
  stepNo?: number | null;
  // Próximo nó pendente do tutor — ganha um anel.
  isNext?: boolean;
  // canConcludeNode(...).ready, pré-calculado no GraphCanvas.
  canConclude?: boolean;
}

type Props = NodeProps & { data: ConceptNodeData & NodeExtras };

function KindChip({ kind, tr, compact }: { kind: NodeKind; tr: Messages; compact?: boolean }) {
  const label = tr.conceptNode[kind];
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 shrink-0 border rounded-[2px] font-mono uppercase tracking-wider ${
        compact ? 'px-1 text-[11px] leading-4' : 'px-1.5 py-[1px] text-[9px]'
      } ${kindChip[kind] ?? kindChip.concept}`}
    >
      <span aria-hidden>{KIND_ICON[kind] ?? '◇'}</span>
      {!compact && <span>{label}</span>}
      {compact && <span className="sr-only">{label}</span>}
    </span>
  );
}

function StatusMarks({
  status,
  blocked,
  tr,
}: {
  status: NodeVisualStatus;
  blocked: boolean;
  tr: Messages;
}) {
  return (
    <>
      {blocked && (
        <span className="text-text-muted text-[10px]" title={tr.conceptNode.blocked}>
          🔒
        </span>
      )}
      {status === 'done' && (
        <span className="text-state-done text-xs" title={tr.conceptNode.withProof}>
          ✓
        </span>
      )}
      {status === 'noProof' && (
        <span className="text-conf-mid text-xs" title={tr.conceptNode.noAnchor}>
          ✓?
        </span>
      )}
      {status === 'known' && (
        <span className="text-ai-accent text-xs" title={tr.conceptNode.axiom}>
          ⊢
        </span>
      )}
      {status === 'problem' && (
        <span className="text-state-problem text-xs" title={tr.conceptNode.problem}>
          ⚠
        </span>
      )}
    </>
  );
}

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

  const band = confidenceBand(data.confidence);
  const blocked = !data.confirmado && !!data.blocked;
  const status = visualStatusOf(data);
  const structural = data.kind === 'root' || data.kind === 'categoria';
  // Raiz/categoria têm confiança fixa (100) — mostrar o número só confunde.
  const showConfidence = !structural;

  const baseClass = [
    'rounded-sm bg-bg-secondary border-2 font-sans text-text-primary select-none touch-manipulation',
    'transition-[box-shadow,transform,opacity] duration-150',
    data.isSuggestion ? 'border-dashed border-ai-accent shadow-lg' : statusBorder[status],
    // Bloqueado continua legível: só esmaece um pouco e ganha cadeado.
    blocked ? 'opacity-70' : '',
    data.isNext && !selected ? 'shadow-[0_0_0_4px_rgba(139,92,246,0.35)]' : '',
    selected ? 'ring-2 ring-white ring-offset-2 ring-offset-bg-primary' : '',
  ].join(' ');

  if (data.isSuggestion) {
    return (
      <div className={`${baseClass} w-[260px] p-3`}>
        <Handle type="target" position={Position.Top} className="!bg-ai-accent !border-none" />
        <div className="flex items-center gap-2 mb-1">
          <span className="text-ai-accent text-[10px] font-mono uppercase tracking-wider">◆</span>
          <KindChip kind={data.kind} tr={tr} />
          <span className="ml-auto font-mono text-xs text-text-secondary">{data.confidence}%</span>
        </div>
        <div className="font-semibold text-sm mb-1 leading-tight">{data.name}</div>
        <div className="text-[11px] text-text-secondary leading-snug mb-2 line-clamp-2">
          {data.oQue || data.fx}
        </div>
        {data.ruleConflict && (
          <div className="text-[11px] text-state-problem leading-snug mb-2 line-clamp-2">
            ⛓ {data.ruleConflict}
          </div>
        )}
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
            aria-label={tr.conceptNode.rejectAria}
            className="px-3 bg-bg-elevated hover:bg-state-problem/20 text-text-secondary hover:text-state-problem text-xs py-2 min-h-[36px] rounded-sm border border-border-base transition-colors"
          >
            {tr.conceptNode.reject}
          </button>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-ai-accent !border-none" />
      </div>
    );
  }

  // The fast one-click confirm on the canvas is reserved for nodes that already
  // carry real signal (canConcludeNode.ready). An unanchored node must be
  // confirmed through the detail/tutor friction step instead, so the
  // unfaithful path is never the easiest click.
  const canQuickConfirm =
    !blocked &&
    !data.confirmado &&
    !!data.canConclude &&
    (data.kind === 'recurso' || data.kind === 'passo' || data.kind === 'concept');

  const stepTag =
    data.kind === 'passo' && data.stepNo ? (
      <span className="font-mono text-[10px] text-text-muted">#{data.stepNo}</span>
    ) : null;

  const nextTag = data.isNext ? (
    <span className="font-mono text-[9px] uppercase tracking-wider text-ai-accent">
      {tr.conceptNode.next}
    </span>
  ) : null;

  if (level === 'far') {
    // Visão geral: tipo pelo ícone, nome em até 2 linhas, cards mais largos.
    return (
      <div
        className={`${baseClass} ${
          structural ? 'w-[280px] px-3 py-2.5' : 'w-[250px] px-3 py-2'
        } flex items-center gap-2`}
      >
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        <KindChip kind={data.kind} tr={tr} compact />
        <span
          className={`flex-1 min-w-0 line-clamp-2 leading-tight ${
            structural ? 'text-[15px] font-semibold' : 'text-sm'
          }`}
        >
          {data.name}
        </span>
        <span className="shrink-0 flex items-center gap-1">
          {stepTag}
          <StatusMarks status={status} blocked={blocked} tr={tr} />
          {status === 'open' && !structural && (
            <span className={`w-2 h-2 rounded-full ${confidenceDot(band)}`} />
          )}
        </span>
        <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-1.5 mb-1.5">
      <KindChip kind={data.kind} tr={tr} />
      {stepTag}
      {nextTag}
      <span className="ml-auto flex items-center gap-1.5">
        <StatusMarks status={status} blocked={blocked} tr={tr} />
        {showConfidence && (
          <>
            {level === 'near' && <span className={`w-2 h-2 rounded-full ${confidenceDot(band)}`} />}
            <span className="font-mono text-[11px] text-text-secondary">{data.confidence}%</span>
          </>
        )}
      </span>
    </div>
  );

  const quickConfirm = canQuickConfirm ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        confirmNode(data.id);
      }}
      className={`w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high rounded-sm border border-conf-high/40 transition-colors font-medium ${
        level === 'near' ? 'mt-2.5 text-xs py-2.5 min-h-[40px]' : 'mt-2 text-[11px] py-1.5 min-h-[32px]'
      }`}
    >
      {data.kind === 'recurso'
        ? tr.conceptNode.quickHaveResource
        : data.kind === 'concept'
        ? tr.conceptNode.quickUnderstood
        : tr.conceptNode.quickHaveStep}
    </button>
  ) : null;

  if (level === 'mid') {
    return (
      <div className={`${baseClass} w-[260px] p-2.5`}>
        <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
        {header}
        <div className="text-sm font-semibold leading-tight mb-1">{data.name}</div>
        <div className="text-[11px] text-text-secondary leading-snug line-clamp-2">{data.oQue}</div>
        {quickConfirm}
        <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
      </div>
    );
  }

  // Critério do usuário ANTES do da IA: o "como saber" da IA só aparece
  // depois do lock (ou do nó fechado por outro caminho). Zoom não fura o gate.
  const showCheckLine = !!data.comoConfirmar && isActionableKind(data.kind) && data.kind !== 'decisao';
  const revealCheck = canRevealAICriterion(data);

  return (
    <div className={`${baseClass} w-[300px] p-3`}>
      <Handle type="target" position={Position.Top} className="!bg-border-base !border-none" />
      {header}
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
        {showCheckLine && (
          <div className="text-[11px] leading-snug">
            <span className="text-text-muted font-mono text-[10px] uppercase">
              {tr.conceptNode.checkPrefix}
            </span>{' '}
            {revealCheck ? (
              <span className="text-text-secondary italic">{data.comoConfirmar}</span>
            ) : (
              <span className="text-text-muted">{tr.conceptNode.criterionLocked}</span>
            )}
          </div>
        )}
      </div>
      {quickConfirm}
      <Handle type="source" position={Position.Bottom} className="!bg-border-base !border-none" />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeImpl);
