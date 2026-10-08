import { memo } from 'react';
import { Handle, Position, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import type { ConceptNodeData, NodeKind } from '@/types';
import { useGraphStore, confidenceBand, isActionableKind } from '@/store';
import { useAIReveal } from '@/hooks/useAIReveal';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';

// Tipo = glifo pequeno + rótulo discreto; a BORDA e o ponto de 8px ficam só
// para o estado (antes tipo e estado disputavam a mesma border-color).
export const KIND_ICON: Record<NodeKind, string> = {
  root: '◎',
  categoria: '▤',
  recurso: '▪',
  passo: '▸',
  decisao: '⑂',
  concept: '◇',
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
// Bordas discretas (/50–/70): o ponto de 8px carrega a cor; a borda só reforça.
const statusBorder: Record<NodeVisualStatus, string> = {
  problem: 'border-state-problem/70',
  done: 'border-state-done/45',
  noProof: 'border-conf-mid/70 border-dashed',
  known: 'border-ai-accent/40',
  open: 'border-transparent',
};

// Ponto de 8px: o estado de relance (aberto = anel vazio).
const statusDot: Record<NodeVisualStatus, string> = {
  problem: 'bg-state-problem',
  done: 'bg-state-done',
  noProof: 'bg-conf-mid',
  known: 'bg-ai-accent',
  open: 'ring-1 ring-inset ring-text-faint/60',
};

const confidenceText = (band: 'high' | 'mid' | 'low') =>
  band === 'high' ? 'text-conf-high' : band === 'mid' ? 'text-conf-mid' : 'text-conf-low';

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

function KindTag({ kind, tr, compact }: { kind: NodeKind; tr: Messages; compact?: boolean }) {
  const label = tr.conceptNode[kind];
  return (
    <span title={label} className="inline-flex items-center gap-1 shrink-0 text-caption text-text-muted">
      <span aria-hidden className="text-text-faint">
        {KIND_ICON[kind] ?? '◇'}
      </span>
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  );
}

function statusTitle(status: NodeVisualStatus, tr: Messages): string | null {
  if (status === 'done') return tr.conceptNode.withProof;
  if (status === 'noProof') return tr.conceptNode.noAnchor;
  if (status === 'known') return tr.conceptNode.axiom;
  if (status === 'problem') return tr.conceptNode.problem;
  return null;
}

function StatusDot({ status, tr }: { status: NodeVisualStatus; tr: Messages }) {
  const title = statusTitle(status, tr);
  return (
    <span
      title={title ?? undefined}
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDot[status]}`}
    >
      {title && <span className="sr-only">{title}</span>}
    </span>
  );
}

function LockMark({ tr }: { tr: Messages }) {
  return (
    <span title={tr.conceptNode.blocked} className="inline-flex text-text-faint shrink-0">
      <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden>
        <rect x="1" y="4.5" width="8" height="6" rx="1.5" fill="currentColor" />
        <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span className="sr-only">{tr.conceptNode.blocked}</span>
    </span>
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
  // Mesmo gate do tutor: só depois do lock E da janela de desfazer.
  const { revealed: revealCheck } = useAIReveal(data);

  const band = confidenceBand(data.confidence);
  const blocked = !data.confirmado && !!data.blocked;
  const status = visualStatusOf(data);
  const structural = data.kind === 'root' || data.kind === 'categoria';
  // Raiz/categoria têm confiança fixa (100) — mostrar o número só confunde.
  const showConfidence = !structural;

  const baseClass = [
    'rounded-card bg-bg-secondary border-[1.5px] font-sans select-none touch-manipulation',
    'transition-[box-shadow,opacity] duration-180 ease-mac',
    data.isSuggestion ? 'border-dashed border-ai-accent/70 shadow-mac' : `${statusBorder[status]} shadow-mac-sm`,
    // Bloqueado continua legível (AA): cadeado + título em text-muted, sem
    // esmaecer o card inteiro.
    blocked ? 'text-text-muted' : 'text-text-primary',
    selected
      ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-primary'
      : data.isNext
      ? 'ring-[3px] ring-accent/30'
      : '',
  ].join(' ');

  if (data.isSuggestion) {
    return (
      <div className={`${baseClass} w-[260px] p-3`}>
        <Handle type="target" position={Position.Top} className="!bg-ai-accent !border-none" />
        <div className="flex items-center gap-2 mb-1.5">
          <span className="ai-icon text-footnote" aria-hidden>
            ✦
          </span>
          <KindTag kind={data.kind} tr={tr} />
          <span className="ml-auto font-mono text-caption tabular-nums text-text-muted">{data.confidence}%</span>
        </div>
        <div className="font-semibold text-control mb-1">{data.name}</div>
        <div className="text-footnote text-text-secondary mb-2.5 line-clamp-2">{data.oQue || data.fx}</div>
        {data.ruleConflict && (
          <div className="text-footnote text-state-problem mb-2.5 line-clamp-2">⛓ {data.ruleConflict}</div>
        )}
        <div className="flex gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              acceptSuggestion(data.tempId as string);
            }}
            className="tap btn btn-primary flex-1"
          >
            {tr.conceptNode.accept}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              rejectSuggestion(data.tempId as string);
            }}
            aria-label={tr.conceptNode.rejectAria}
            title={tr.conceptNode.rejectAria}
            className="tap btn btn-secondary btn-icon hover:!text-state-problem"
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
      <span className="text-caption tabular-nums text-text-faint">#{data.stepNo}</span>
    ) : null;

  const nextTag = data.isNext ? (
    <span className="chip !h-[18px] bg-accent/12 text-accent">{tr.conceptNode.next}</span>
  ) : null;

  if (level === 'far') {
    // Visão geral: estado pelo ponto, tipo pelo glifo, nome em até 2 linhas.
    return (
      <div
        className={`${baseClass} ${
          structural ? 'w-[280px] px-3.5 py-3' : 'w-[250px] px-3 py-2.5'
        } flex items-center gap-2`}
      >
        <Handle type="target" position={Position.Top} />
        {!structural && <StatusDot status={status} tr={tr} />}
        <KindTag kind={data.kind} tr={tr} compact />
        <span
          className={`flex-1 min-w-0 line-clamp-2 ${
            structural ? 'text-title3 font-semibold' : 'text-control font-medium'
          }`}
        >
          {data.name}
        </span>
        <span className="shrink-0 flex items-center gap-1.5">
          {stepTag}
          {blocked && <LockMark tr={tr} />}
        </span>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-1.5 mb-1.5 min-h-[18px]">
      {!structural && <StatusDot status={status} tr={tr} />}
      <KindTag kind={data.kind} tr={tr} />
      {stepTag}
      {nextTag}
      <span className="ml-auto flex items-center gap-1.5">
        {blocked && <LockMark tr={tr} />}
        {showConfidence && (
          <span
            title={tr.detail.confidence}
            className={`font-mono text-caption tabular-nums ${
              status === 'open' ? confidenceText(band) : 'text-text-muted'
            }`}
          >
            {data.confidence}%
          </span>
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
      className={`tap btn btn-secondary w-full !text-state-done ${level === 'near' ? 'mt-3' : 'mt-2'}`}
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
      <div className={`${baseClass} w-[260px] p-3`}>
        <Handle type="target" position={Position.Top} />
        {header}
        <div className={`${structural ? 'text-title3' : 'text-control'} font-semibold mb-1`}>{data.name}</div>
        <div className="text-footnote text-text-secondary line-clamp-2">{data.oQue}</div>
        {quickConfirm}
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  // Critério do usuário ANTES do da IA: o "como saber" da IA só aparece
  // depois do lock (ou do nó fechado por outro caminho). Zoom não fura o gate.
  const showCheckLine = !!data.comoConfirmar && isActionableKind(data.kind) && data.kind !== 'decisao';

  return (
    <div className={`${baseClass} w-[300px] p-3.5`}>
      <Handle type="target" position={Position.Top} />
      {header}
      <div className={`${structural ? 'text-title3' : 'text-control'} font-semibold mb-2`}>{data.name}</div>
      {(data.oQue || data.porQue || showCheckLine) && (
        <div className="border-t border-border-base/70 pt-2 space-y-1.5">
          {data.oQue && (
            <div className="text-footnote">
              <span className="text-text-muted font-medium">{tr.conceptNode.whatPrefix}</span>{' '}
              <span className="text-text-secondary">{data.oQue}</span>
            </div>
          )}
          {data.porQue && (
            <div className="text-footnote">
              <span className="text-text-muted font-medium">{tr.conceptNode.whyPrefix}</span>{' '}
              <span className="text-text-secondary">{data.porQue}</span>
            </div>
          )}
          {showCheckLine && (
            <div className="text-footnote">
              <span className="text-text-muted font-medium">{tr.conceptNode.checkPrefix}</span>{' '}
              {revealCheck ? (
                <span className="text-text-secondary">{data.comoConfirmar}</span>
              ) : (
                <span className="text-text-muted">{tr.conceptNode.criterionLocked}</span>
              )}
            </div>
          )}
        </div>
      )}
      {quickConfirm}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeImpl);
