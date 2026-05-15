import { useEffect, useMemo, useState } from 'react';
import {
  useGraphStore,
  nextPendingForTutor,
  projectProgress,
  breadcrumbFor,
} from '@/store';
import { explainNode } from '@/ai/service';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import type { ConceptNodeData } from '@/types';
import { GroundTruthInlineTutor } from './GroundTruth';
import { MobileSheet } from './MobileSheet';

export function TutorMode() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setViewMode = useGraphStore((s) => s.setViewMode);

  const next = useMemo(() => nextPendingForTutor(project), [project]);
  const progress = projectProgress(project);

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, sidebarOpen]);

  if (!project) return null;

  const recursos = Object.values(project.nodes).filter((n) => n.kind === 'recurso');
  const passos = Object.values(project.nodes)
    .filter((n) => n.kind === 'passo')
    .sort((a, b) => {
      if (a.parentId !== b.parentId) return (a.parentId ?? '').localeCompare(b.parentId ?? '');
      return a.order - b.order;
    });

  const resourcesConfirmed = recursos.filter((r) => r.confirmado).length;
  const allResourcesDone = resourcesConfirmed === recursos.length && recursos.length > 0;

  const sidebarBody = (
    <>
      <Section title={tr.tutor.sectionResources} count={recursos.length} done={resourcesConfirmed}>
        {recursos.map((r) => (
          <Row
            key={r.id}
            node={r}
            isNext={next?.id === r.id}
            onClick={() => {
              selectNode(r.id);
              setSidebarOpen(false);
            }}
            onToggle={() => (r.confirmado ? unconfirmNode(r.id) : confirmNode(r.id))}
            tr={tr}
          />
        ))}
        {recursos.length === 0 && (
          <div className="text-xs text-text-muted italic px-2 py-1">{tr.tutor.emptyResources}</div>
        )}
      </Section>
      <Section
        title={tr.tutor.sectionExecution}
        count={passos.length}
        done={passos.filter((p) => p.confirmado).length}
      >
        {passos.map((p) => (
          <Row
            key={p.id}
            node={p}
            isNext={next?.id === p.id}
            onClick={() => {
              selectNode(p.id);
              setSidebarOpen(false);
            }}
            onToggle={() => (p.confirmado ? unconfirmNode(p.id) : confirmNode(p.id))}
            project={project}
            tr={tr}
          />
        ))}
        {passos.length === 0 && (
          <div className="text-xs text-text-muted italic px-2 py-1">{tr.tutor.emptySteps}</div>
        )}
      </Section>
    </>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-bg-primary">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="border-b border-border-base bg-bg-secondary px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ai-accent">
              {tr.tutor.modeKicker}
            </div>
            <div className="hidden md:block text-text-muted text-xs">{tr.tutor.focusHint}</div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden text-xs text-text-secondary hover:text-text-primary border border-border-base rounded-sm px-2.5 py-1 transition-colors min-h-[32px] font-mono"
              >
                {tr.tutor.mobileStepsBtn(progress.done, progress.total)}
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                {tr.tutor.viewGraphShort}
              </button>
            </div>
          </div>
          <ProgressBar
            percent={progress.percent}
            done={progress.done}
            total={progress.total}
            tr={tr}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {next ? (
            <TutorCard
              node={next}
              project={project}
              onConfirm={() => confirmNode(next.id)}
              onViewInGraph={() => {
                selectNode(next.id);
                setViewMode('graph');
              }}
              tr={tr}
            />
          ) : (
            <DoneCard projectName={project.name} tr={tr} />
          )}

          {next && next.kind === 'passo' && !allResourcesDone && (
            <div className="max-w-2xl mx-auto mt-6 p-4 bg-conf-mid/5 border border-conf-mid/30 rounded-sm">
              <div className="text-conf-mid text-xs font-mono uppercase tracking-wider mb-1">
                {tr.tutor.resourcesLeftWarning}
              </div>
              <div className="text-sm text-text-secondary">
                {tr.tutor.resourcesLeftBody(recursos.length - resourcesConfirmed)}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="hidden md:flex md:w-[260px] lg:w-[340px] shrink-0 border-l border-border-base bg-bg-secondary overflow-y-auto flex-col">
        {sidebarBody}
      </aside>

      {isMobile && (
        <MobileSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          title={tr.tutor.sheetTitle}
        >
          {sidebarBody}
        </MobileSheet>
      )}
    </div>
  );
}

function ProgressBar({
  percent,
  done,
  total,
  tr,
}: {
  percent: number;
  done: number;
  total: number;
  tr: Messages;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-text-secondary text-xs font-mono">{tr.tutor.confirmedOf(done, total)}</span>
        <span className="ml-auto font-mono text-lg font-semibold">
          <span className={percent === 100 ? 'text-state-done' : 'text-text-primary'}>
            {percent}%
          </span>
        </span>
      </div>
      <div className="h-1.5 bg-bg-primary rounded-sm overflow-hidden border border-border-base">
        <div
          className="h-full bg-gradient-to-r from-ai-accent to-conf-high transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface TutorCardProps {
  node: ConceptNodeData;
  project: NonNullable<ReturnType<typeof useGraphStore.getState>['project']>;
  onConfirm: () => void;
  onViewInGraph: () => void;
  tr: Messages;
}

function TutorCard({ node, project, onConfirm, onViewInGraph, tr }: TutorCardProps) {
  const crumbs = breadcrumbFor(project, node.id);
  const kindLabel = node.kind === 'recurso' ? tr.tutor.nextResource : tr.tutor.nextStep;
  const verb = node.kind === 'recurso' ? tr.tutor.iGotItVerbResource : tr.tutor.iGotItVerbStep;
  const setNodeExplanation = useGraphStore((s) => s.setNodeExplanation);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleExplain = async () => {
    if (node.explicacao) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    try {
      const text = await explainNode({
        projectName: project.name,
        projectObjective: project.objective,
        breadcrumb: crumbs.map((c) => c.name),
        nodeName: node.name,
        nodeKind: node.kind,
        oQue: node.oQue,
        porQue: node.porQue,
        comoConfirmar: node.comoConfirmar,
      });
      setNodeExplanation(node.id, text);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1">
        {crumbs
          .slice(0, -1)
          .map((c) => c.name)
          .join(' › ')}
      </div>
      <div className="flex items-baseline gap-3 mb-4 sm:mb-6">
        <span className="text-[11px] font-mono uppercase tracking-wider text-ai-accent">
          ◆ {kindLabel}
        </span>
        {node.kind === 'passo' && (
          <span className="text-text-muted text-xs font-mono">{tr.tutor.stepNumber(node.order + 1)}</span>
        )}
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary leading-tight mb-4 sm:mb-6">
        {node.name}
      </h1>

      {node.oQue && (
        <TutorBlock label={tr.tutor.whatIs}>
          <p className="text-text-secondary leading-relaxed">{node.oQue}</p>
        </TutorBlock>
      )}
      {node.porQue && (
        <TutorBlock label={tr.tutor.whyNeeded}>
          <p className="text-text-secondary leading-relaxed">{node.porQue}</p>
        </TutorBlock>
      )}

      <div className="mt-4">
        <button
          onClick={handleExplain}
          disabled={loading}
          className="w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-sm transition-colors disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-left">
            <span>◆</span>
            {loading
              ? tr.tutor.generatingExplain
              : node.explicacao
              ? open
                ? tr.tutor.closeExplain
                : tr.tutor.viewExplain
              : tr.tutor.explain}
          </span>
          {node.explicacao && <span className="text-xs">{open ? '▲' : '▼'}</span>}
        </button>
        {open && node.explicacao && (
          <div className="mt-3 p-4 sm:p-5 bg-bg-secondary border border-border-base rounded-sm">
            <ExplanationContent text={node.explicacao} />
          </div>
        )}
      </div>

      <GroundTruthInlineTutor node={node} project={project} />

      <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <button
          onClick={onConfirm}
          className="flex-1 bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-base py-3 min-h-[48px] rounded-sm border-2 border-conf-high/40 transition-colors font-medium"
        >
          {tr.tutor.alreadyVerb(verb)}
        </button>
        <button
          onClick={onViewInGraph}
          className="px-4 py-3 min-h-[44px] text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
        >
          {tr.tutor.viewInGraph}
        </button>
      </div>
    </div>
  );
}

export function ExplanationContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="text-sm text-text-secondary leading-relaxed space-y-1">
      {lines.map((line, i) => {
        if (line.trim() === '') return <div key={i} className="h-2" />;
        const boldMatch = line.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          return (
            <div
              key={i}
              className="text-[10px] font-mono uppercase tracking-widest text-ai-accent pt-2 first:pt-0"
            >
              {boldMatch[1]}
            </div>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <div key={i} className="pl-4 relative">
              <span className="absolute left-0 text-text-muted">•</span>
              {renderInline(line.slice(2))}
            </div>
          );
        }
        const numMatch = line.match(/^(\d+)\.\s(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="pl-6 relative">
              <span className="absolute left-0 text-text-muted font-mono text-xs">
                {numMatch[1]}.
              </span>
              {renderInline(numMatch[2])}
            </div>
          );
        }
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*(.+?)\*\*$/);
    if (m) {
      return (
        <strong key={i} className="text-text-primary font-semibold">
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function TutorBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-2">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function DoneCard({ projectName, tr }: { projectName: string; tr: Messages }) {
  return (
    <div className="max-w-xl mx-auto text-center py-12 sm:py-20">
      <div className="text-state-done text-5xl sm:text-6xl mb-4">✓</div>
      <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-3">
        {tr.tutor.projectDoneTitle}
      </h1>
      <p className="text-text-secondary">{tr.tutor.projectDoneBody(projectName)}</p>
    </div>
  );
}

interface SectionProps {
  title: string;
  count: number;
  done: number;
  children: React.ReactNode;
}

function Section({ title, count, done, children }: SectionProps) {
  return (
    <div className="border-b border-border-base">
      <div className="px-3 py-2 flex items-baseline gap-2 bg-bg-primary/50">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {title}
        </span>
        <span className="ml-auto text-[11px] font-mono text-text-secondary">
          <span className="text-state-done">{done}</span>
          <span className="text-text-muted">/{count}</span>
        </span>
      </div>
      <div className="py-1">{children}</div>
    </div>
  );
}

interface RowProps {
  node: ConceptNodeData;
  isNext?: boolean;
  onClick: () => void;
  onToggle: () => void;
  project?: ReturnType<typeof useGraphStore.getState>['project'];
  tr: Messages;
}

function Row({ node, isNext, onClick, onToggle, project, tr }: RowProps) {
  const blocked =
    node.kind === 'passo' && !node.confirmado && project
      ? isBlockedLocal(project, node.id)
      : false;

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer min-h-[36px] ${
        isNext ? 'bg-ai-accent/10 border-l-2 border-ai-accent' : 'hover:bg-bg-elevated/50 border-l-2 border-transparent'
      } ${blocked ? 'opacity-40' : ''}`}
      onClick={onClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!blocked) onToggle();
        }}
        disabled={blocked}
        aria-label={node.confirmado ? tr.tutor.ariaUnconfirm : tr.tutor.ariaConfirm}
        className={`w-5 h-5 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${
          node.confirmado
            ? 'bg-state-done/20 border-state-done text-state-done'
            : 'border-border-base group-hover:border-text-muted'
        }`}
      >
        {node.confirmado && <span className="text-[10px]">✓</span>}
      </button>
      <span
        className={`truncate flex-1 ${
          node.confirmado ? 'text-text-muted line-through' : 'text-text-secondary'
        }`}
      >
        {node.kind === 'passo' && (
          <span className="text-text-muted font-mono mr-1">{node.order + 1}.</span>
        )}
        {node.name}
      </span>
    </div>
  );
}

function isBlockedLocal(
  project: NonNullable<ReturnType<typeof useGraphStore.getState>['project']>,
  nodeId: string,
): boolean {
  const node = project.nodes[nodeId];
  if (!node || node.kind !== 'passo') return false;
  const siblings = Object.values(project.nodes)
    .filter((n) => n.parentId === node.parentId && n.kind === 'passo')
    .sort((a, b) => a.order - b.order);
  for (const s of siblings) {
    if (s.id === node.id) return false;
    if (!s.confirmado) return true;
  }
  return false;
}
