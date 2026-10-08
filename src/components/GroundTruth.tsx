import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ConceptNodeData, GroundTruthKind, GroundTruthRef, Project } from '@/types';
import {
  useGraphStore,
  breadcrumbFor,
  buildStagedNodes,
  CRITERION_UNLOCK_MS,
  pendingParent,
  refCountsAsSignal,
  relatedPartsFor,
  planOverviewFor,
  canRevealAICriterionNow,
} from '@/store';
import { useKBStore } from '@/kb/store';
import { useT } from '@/i18n';
import { critiqueNode, replanFromFailure, stripZeroTolerance } from '@/ai/service';
import { runResearch } from '@/ai/research';
import { requireAI } from '@/ai/availability';
import { useAIAction } from '@/hooks/useAIAction';
import { useAIReveal } from '@/hooks/useAIReveal';
import { InlineError } from './ui/InlineError';
import { toast } from './ui/Toast';
import { ExplanationContent } from './Markdown';

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste)
// ---------------------------------------------------------------------------

// Mesmo prazo do unlockCriterion no store: enquanto dá pra desfazer o lock, o
// critério da IA continua escondido — senão desfazer viraria um jeito de espiar.
export const CRITERION_UNDO_MS = CRITERION_UNLOCK_MS;

import { safeHref } from '@/safeHref';
export { safeHref };

// "www.x.com/..." colado sem protocolo vira https://.
export function normalizeLinkInput(value: string): string {
  const v = value.trim();
  return /^www\.[^\s.]+\.[^\s]+$/i.test(v) ? `https://${v}` : v;
}

export function hostnameOf(value: string): string | null {
  const href = safeHref(value);
  if (!href) return null;
  return new URL(href).hostname.replace(/^www\./, '');
}

const UNIT_RE =
  /\d\s*(mm|cm|m|km|g|kg|mg|l|ml|v|mv|kv|a|ma|mah|ah|w|kw|wh|kwh|hz|khz|mhz|ghz|rpm|s|ms|min|h|°c|ºc|°f|psi|bar|nm|n|in|ft|lb|lbs|oz|kb|mb|gb|tb|px|dpi|db|fps|%)(?![a-z])/i;

// Tipo da prova a partir do que o usuário colou: link, medida (número+unidade
// curto) ou especificação (o resto).
export function detectRefKind(value: string): GroundTruthKind {
  const v = normalizeLinkInput(value);
  if (safeHref(v)) return 'link';
  if (v.length <= 40 && UNIT_RE.test(v)) return 'medida';
  return 'spec';
}

const STOPWORDS = new Set(
  (
    // pt
    'a o as os um uma uns umas de do da dos das e em no na nos nas num numa por para pra pro com sem que se ao aos ou ' +
    'e eh ser ter tem esta este estes estas isso isto esse essa esses essas aquele aquela eu voce voces meu minha ' +
    'meus minhas seu sua seus suas ele ela eles elas mais menos muito muita ja nao sim como quando onde qual quais ' +
    'foi sao era vai vou ate entao tambem so bem todo toda todos todas cada mesmo mesma lo la los las lhe nele nela ' +
    // en
    'the an of to in on for with and or is are be been it its this that these those i you my your our their if ' +
    'when can will at by from as not no yes do does did so than then there here all any each same'
  ).split(/\s+/),
);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

export function criterionTokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(/[^a-z0-9]+/)
      .filter((tk) => tk.length >= 2 && !STOPWORDS.has(tk)),
  );
}

// Coeficiente de overlap (|A∩B| / min(|A|,|B|)): um critério curto que copia
// metade do da IA conta como cópia, mesmo que a IA tenha escrito muito mais.
export function criterionOverlap(a: string, b: string): number {
  const ta = criterionTokens(a);
  const tb = criterionTokens(b);
  const min = Math.min(ta.size, tb.size);
  if (min === 0) return 0;
  let inter = 0;
  for (const tk of ta) if (tb.has(tk)) inter++;
  return inter / min;
}

// Radicais de verbos/ações observáveis (sem acento). Casamento por prefixo.
const OBSERVABLE_STEMS = [
  // pt
  'med', 'pes', 'lig', 'acend', 'apag', 'rod', 'funcion', 'abr', 'fech', 'respond', 'mostr', 'aparec', 'consig',
  'consegu', 'test', 'cont', 'ver', 'vej', 'ouc', 'ouv', 'cronometr', 'explic', 'execut', 'compil', 'pass', 'imprim',
  'gir', 'carreg', 'encaix', 'segur', 'suport', 'aguent', 'levant', 'resolv', 'reproduz', 'refaz', 'refiz', 'escrev',
  'desenh', 'calcul', 'compar', 'confer', 'bat', 'marc', 'indic', 'exib', 'emit', 'toc', 'sob', 'dur', 'aquec',
  'esfri', 'voa', 'voo', 'anda', 'corr', 'entreg', 'envi', 'receb', 'salv', 'cab', 'fix', 'vaz', 'pisc', 'apit',
  'conect', 'sincroniz', 'inici', 'termin', 'complet', 'acert', 'responde', 'grav', 'tir', 'conclu',
  // en
  'measur', 'weigh', 'run', 'turn', 'light', 'show', 'display', 'respond', 'open', 'clos', 'print', 'explain',
  'boot', 'fly', 'flie', 'spin', 'load', 'return', 'read', 'output', 'work', 'count', 'see', 'hear', 'time',
  'fit', 'hold', 'charg', 'connect', 'beep', 'blink', 'reach', 'lift', 'draw', 'writ', 'solv', 'reproduc',
  'match', 'log', 'send', 'receiv', 'sav', 'start', 'finish', 'complet', 'record', 'build', 'cook', 'play',
];

const UNIT_WORDS = new Set(
  (
    'graus grau volts volt amperes watts segundos segundo minutos minuto horas hora metros metro centimetros ' +
    'milimetros gramas grama quilos quilo litros litro porcento percent degrees degree seconds second minutes ' +
    'minute hours hour meters meter centimeters millimeters grams gram kilos liters liter'
  ).split(/\s+/),
);

// Critério vago: curto demais, ou sem número/unidade/ação que dê pra observar.
export function isVagueCriterion(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 5) return true;
  const norm = normalize(text);
  if (/\d/.test(norm)) return false;
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((tk) => UNIT_WORDS.has(tk))) return false;
  return !tokens.some((tk) => OBSERVABLE_STEMS.some((st) => tk.startsWith(st)));
}

export type CriterionAssessment = 'similar' | 'vague' | 'independent';

// Três faixas: parecido com o da IA (≥0,4) → aviso; vago → pedir mais
// testável; só então o selo "independente".
export function assessCriterion(ai: string, user: string): CriterionAssessment {
  if (ai.trim() && criterionOverlap(ai, user) >= 0.4) return 'similar';
  if (isVagueCriterion(user)) return 'vague';
  return 'independent';
}

// Ctrl/Cmd+Enter envia.
const submitOnModEnter = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    fn();
  }
};

const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));

const isActionable = (node: ConceptNodeData) =>
  node.kind === 'recurso' ||
  node.kind === 'passo' ||
  node.kind === 'decisao' ||
  node.kind === 'concept';

// ---------------------------------------------------------------------------
// Glifos (SVG, herdam currentColor)
// ---------------------------------------------------------------------------

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={`h-3 w-3 shrink-0 ${className ?? ''}`}>
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph({ className, animate }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={className}>
      <path
        d="M2.5 6.3l2.3 2.3 4.7-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        className={animate ? 'animate-check-draw' : undefined}
      />
    </svg>
  );
}

const glyphPath: Record<GroundTruthKind, ReactNode> = {
  // globo: link
  link: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.5 8h11M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75M8 2.25C6.4 3.85 5.6 5.75 5.6 8s.8 4.15 2.4 5.75" />
    </>
  ),
  // régua: medida
  medida: (
    <>
      <rect x="1.75" y="5" width="12.5" height="6" rx="1.25" />
      <path d="M4.5 5v2.25M7 5v1.5M9.5 5v2.25M12 5v1.5" />
    </>
  ),
  // folha: especificação
  spec: (
    <>
      <path d="M4 1.75h5l3 3v9.5H4z" />
      <path d="M9 1.75v3h3M6 8h4M6 10.5h4" />
    </>
  ),
};

function KindGlyph({ kind, title }: { kind: GroundTruthKind; title: string }) {
  return (
    <span
      title={title}
      className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-chip bg-bg-elevated text-text-muted"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glyphPath[kind]}
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ai-accent/25 border-t-ai-accent"
    />
  );
}

// Seção recolhível do card do tutor (disclosure estilo System Settings):
// título + resumo de uma linha à direita.
function Fold({
  id,
  title,
  summary,
  summaryClass,
  autoOpen = false,
  children,
}: {
  id?: string;
  title: string;
  summary: string;
  summaryClass?: string;
  autoOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group/fold scroll-mt-4 border-t border-border-base/70"
    >
      <summary className="tap flex min-h-[40px] [@media(pointer:coarse)]:min-h-11 cursor-pointer select-none list-none items-center gap-2.5 px-4 py-2 transition-colors duration-120 ease-mac hover:bg-bg-elevated/50 [&::-webkit-details-marker]:hidden">
        <Chevron className="text-text-faint transition-transform duration-180 ease-mac group-open/fold:rotate-90" />
        <span className="min-w-0 flex-1 text-control font-medium text-text-primary">{title}</span>
        <span
          className={`max-w-[50%] shrink-0 truncate text-right text-footnote ${summaryClass ?? 'text-text-muted'}`}
        >
          {summary}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

function RunningRow({
  label,
  elapsedMs,
  onCancel,
}: {
  label: string;
  elapsedMs: number;
  onCancel?: () => void;
}) {
  const tr = useT();
  return (
    <div className="flex min-h-[36px] items-center gap-2.5 rounded-control bg-ai-accent/8 px-3 py-1.5 text-control text-text-secondary">
      <Spinner />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-footnote tabular-nums text-text-muted">{secs(elapsedMs)}s</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="tap btn btn-ghost btn-sm -mr-1.5"
        >
          {tr.common.cancelRunning}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (a) Critério do usuário — travado antes de ver o da IA
// ---------------------------------------------------------------------------

interface CriterionProps {
  node: ConceptNodeData;
  // Card do tutor: expõe ids DOM (gt-criterion, gt-attest) pra rolar/focar.
  domIds?: boolean;
  // Primeira linha do grupo do tutor: sem borda própria (as seções abaixo
  // trazem a hairline de cima).
  inGroup?: boolean;
}

export function UserCriterionField(props: CriterionProps) {
  return <UserCriterionBody key={props.node.id} {...props} />;
}

function UserCriterionBody({ node, domIds, inGroup }: CriterionProps) {
  const tr = useT();
  const setUserCriterion = useGraphStore((s) => s.setUserCriterion);
  const unlockCriterion = useGraphStore((s) => s.unlockCriterion);
  const attestCriterion = useGraphStore((s) => s.attestCriterion);
  const setDraft = useGraphStore((s) => s.setDraft);
  const draft = useGraphStore((s) => s.drafts[node.id]?.criterion ?? '');
  const metDraft = useGraphStore((s) => s.drafts[node.id]?.met ?? '');
  const metRef = useRef<HTMLTextAreaElement>(null);
  const { revealed, remainingMs } = useAIReveal(node);

  const locked = Boolean(node.comoConfirmarUsuarioAt);
  const inUndoWindow = locked && remainingMs > 0 && !node.comoConfirmarAtendido;

  if (!isActionable(node)) return null;

  const undoLock = () => {
    if (!unlockCriterion(node.id)) {
      toast.show({ message: tr.groundTruth.undoExpired, tone: 'warn' });
    }
  };

  const handleLock = () => {
    const text = draft.trim();
    if (!text) return;
    setUserCriterion(node.id, text);
    // Sem toast: o selo "Travado" + Desfazer inline já confirmam (o toast
    // cobria a linha logo abaixo).
    // Aferir é o passo seguinte, logo abaixo.
    requestAnimationFrame(() => metRef.current?.focus());
  };

  const handleAttest = () => {
    if (!metDraft.trim()) return;
    attestCriterion(node.id, metDraft.trim());
  };

  const showVagueLive = !locked && draft.trim().split(/\s+/).length >= 3 && isVagueCriterion(draft);

  return (
    <section
      id={domIds ? 'gt-criterion' : undefined}
      className={`scroll-mt-4 space-y-4 ${inGroup ? 'px-4 pb-4 pt-3.5' : 'border-b border-border-base/70 p-4'}`}
    >
      {!inGroup && (
        <div className="text-control font-semibold text-text-primary">{tr.groundTruth.howToConfirm}</div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="label">{tr.groundTruth.yourCriterion}</span>
          {locked && (
            <span className="chip bg-state-done/12 text-state-done">
              <CheckGlyph className="h-3 w-3" />
              {tr.groundTruth.locked}
            </span>
          )}
        </div>
        {locked ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-control bg-bg-elevated/60 px-3 py-2 text-control text-text-primary">
              <span className="min-w-0 flex-1 break-words py-0.5">{node.comoConfirmarUsuario}</span>
              {inUndoWindow && (
                <button
                  type="button"
                  onClick={undoLock}
                  className="tap btn btn-secondary btn-sm shrink-0 tabular-nums"
                >
                  {tr.groundTruth.undoWithin(secs(remainingMs))}
                </button>
              )}
            </div>
            {node.comoConfirmarAtendido ? (
              <div className="flex items-start gap-2 text-control">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-state-done text-accent-fg">
                  <CheckGlyph className="h-3 w-3" animate />
                </span>
                <span className="min-w-0 break-words">
                  <span className="font-medium text-state-done">{tr.groundTruth.criterionMet}:</span>{' '}
                  <span className="text-text-secondary">{node.comoConfirmarAtendido.observacao}</span>
                </span>
              </div>
            ) : (
              <div id={domIds ? 'gt-attest' : undefined} className="scroll-mt-4 space-y-2">
                <label htmlFor={`gt-met-${node.id}`} className="label block">
                  {tr.groundTruth.criterionMetPrompt}
                </label>
                <textarea
                  id={`gt-met-${node.id}`}
                  ref={metRef}
                  value={metDraft}
                  onChange={(e) => setDraft(node.id, 'met', e.target.value)}
                  onKeyDown={submitOnModEnter(handleAttest)}
                  rows={2}
                  placeholder={tr.groundTruth.criterionMetPlaceholder}
                  className="field resize-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAttest}
                    disabled={!metDraft.trim()}
                    title={tr.groundTruth.submitHint}
                    className="tap btn btn-primary w-full sm:w-auto"
                  >
                    {tr.groundTruth.criterionMetBtn}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <textarea name="user-criterion"
              value={draft}
              onChange={(e) => setDraft(node.id, 'criterion', e.target.value)}
              onKeyDown={submitOnModEnter(handleLock)}
              rows={2}
              aria-label={tr.groundTruth.yourCriterion}
              placeholder={
                node.kind === 'concept'
                  ? tr.groundTruth.criterionPlaceholderUnderstand
                  : tr.groundTruth.criterionPlaceholder
              }
              className="field resize-none"
            />
            {showVagueLive && (
              <p className="text-footnote text-conf-mid">{tr.groundTruth.vagueHint}</p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-start sm:gap-4">
              <p className="flex-1 text-footnote text-text-muted">{tr.groundTruth.lockHelp}</p>
              <button
                type="button"
                onClick={handleLock}
                disabled={!draft.trim()}
                title={tr.groundTruth.submitHint}
                className="tap btn btn-primary w-full shrink-0 sm:w-auto"
              >
                {tr.groundTruth.lockBtn}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="label inline-flex items-center gap-1.5">
            <span className="ai-icon" aria-hidden>
              ✦
            </span>
            {tr.groundTruth.aiCriterion}
          </span>
          {!revealed && (
            <span className="text-footnote tabular-nums text-text-faint">
              {inUndoWindow ? tr.groundTruth.revealIn(secs(remainingMs)) : tr.groundTruth.hiddenUntilLock}
            </span>
          )}
        </div>
        {revealed ? (
          <div className="rounded-control bg-ai-accent/8 px-3 py-2 text-control text-text-secondary">
            {node.comoConfirmar || <span className="text-text-muted">{tr.groundTruth.emptyAI}</span>}
          </div>
        ) : (
          <div className="text-footnote text-text-muted">
            {locked ? tr.groundTruth.aiAfterUndoWindow : tr.groundTruth.writeYoursFirst}
          </div>
        )}
      </div>

      {locked && revealed && node.comoConfirmarUsuario && (
        <DivergenceHint ai={node.comoConfirmar ?? ''} user={node.comoConfirmarUsuario} />
      )}
    </section>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'ok'; children: ReactNode }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-control px-3 py-2 text-footnote ${
        tone === 'warn' ? 'bg-conf-mid/8 text-conf-mid' : 'bg-state-done/8 text-state-done'
      }`}
    >
      <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function DivergenceHint({ ai, user }: { ai: string; user: string }) {
  const tr = useT();
  const verdict = assessCriterion(ai, user);
  if (verdict === 'similar') return <Note tone="warn">{tr.groundTruth.convergenceCopy}</Note>;
  if (verdict === 'vague') return <Note tone="warn">{tr.groundTruth.vagueHint}</Note>;
  return <Note tone="ok">{tr.groundTruth.convergenceIndependent}</Note>;
}

// ---------------------------------------------------------------------------
// (b) Segunda opinião cética
// ---------------------------------------------------------------------------

interface SectionProps {
  node: ConceptNodeData;
  project: Project;
  // Card do tutor: vira <details> fechado com resumo de uma linha.
  collapsible?: boolean;
}

export function CritiqueSection(props: SectionProps) {
  return <CritiqueBody key={props.node.id} {...props} />;
}

function CritiqueBody({ node, project, collapsible }: SectionProps) {
  const tr = useT();
  const clearCritica = useGraphStore((s) => s.clearCritica);
  const jobRunning = useGraphStore((s) => Boolean(s.aiJobs[node.id]?.critique));
  const { revealed } = useAIReveal(node);

  const action = useAIAction(
    async (signal) => {
      const st = useGraphStore.getState();
      const proj = st.project;
      const cur = proj?.nodes[node.id];
      if (!proj || !cur) return;
      const result = await critiqueNode(
        {
          projectName: proj.name,
          projectObjective: proj.objective,
          breadcrumb: breadcrumbFor(proj, cur.id).map((c) => c.name),
          nodeName: cur.name,
          nodeKind: cur.kind,
          nodeFx: cur.fx,
          oQue: cur.oQue,
          porQue: cur.porQue,
          // O critério da IA só entra no prompt depois de revelado ao usuário —
          // a crítica não pode virar um atalho pra ele.
          comoConfirmar: revealed ? cur.comoConfirmar : '',
          comoConfirmarUsuario: cur.comoConfirmarUsuario,
          rules: proj.rules,
          research: cur.webResearch,
          relatedParts: relatedPartsFor(proj, cur.id),
          planOverview: planOverviewFor(proj, cur.id),
        },
        { signal },
      );
      if (signal.aborted) return;
      useGraphStore.getState().setCritica(cur.id, result);
    },
    { job: { nodeId: node.id, kind: 'critique' } },
  );

  const run = () => {
    if (!requireAI()) return;
    void action.run();
  };

  // Rodando em outra instância do card (troca de nó/view no meio da chamada).
  const runningElsewhere = !action.running && jobRunning;
  const busy = action.running || runningElsewhere;
  void project;

  const generatedDate = node.critica
    ? new Date(node.critica.generatedAt).toLocaleDateString(tr.detail.locale)
    : null;

  const body = (
    <>
      {busy && (
        <div className="mb-3">
          <RunningRow
            label={node.critica ? tr.groundTruth.regenerating : tr.groundTruth.generatingCritique}
            elapsedMs={action.elapsedMs}
            onCancel={action.running ? action.cancel : undefined}
          />
        </div>
      )}

      {!node.critica && !busy && (
        <button type="button" onClick={run} className="tap btn btn-ai w-full sm:w-auto">
          <span className="ai-icon" aria-hidden>
            ✦
          </span>
          {tr.groundTruth.askSecondOpinion}
        </button>
      )}

      {node.critica && (
        <div className="space-y-4 text-control">
          <CritiqueGroup label={tr.groundTruth.weaknesses} items={node.critica.fraquezas} />
          {node.critica.premissasOcultas.length > 0 && (
            <CritiqueGroup label={tr.groundTruth.hiddenPremises} items={node.critica.premissasOcultas} />
          )}
          <div className="space-y-1.5">
            <div className="label inline-flex items-center gap-1.5">
              <span className="ai-icon" aria-hidden>
                ✦
              </span>
              {tr.groundTruth.altCriterion}
            </div>
            {revealed ? (
              <div className="rounded-control bg-ai-accent/8 px-3 py-2 text-text-primary">
                {node.critica.criterioAlternativo}
              </div>
            ) : (
              <div className="text-footnote text-text-muted">
                {tr.groundTruth.altCriterionHidden}
              </div>
            )}
          </div>
          {node.critica.fontes && node.critica.fontes.length > 0 && (
            <div className="space-y-1.5">
              <div className="label">{tr.groundTruth.criticSources}</div>
              <ul className="space-y-1">
                {node.critica.fontes.map((f) => {
                  const href = safeHref(f.url);
                  return (
                    <li key={f.url} className="flex items-start gap-2">
                      <KindGlyph kind="link" title={tr.groundTruth.kindNames.link} />
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 break-words pt-px text-accent hover:underline"
                        >
                          {f.title}
                        </a>
                      ) : (
                        <span className="min-w-0 break-words pt-px text-text-secondary">{f.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!busy && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={run} className="tap btn btn-secondary btn-sm">
                {tr.groundTruth.regenerate}
              </button>
              <button
                type="button"
                onClick={() => clearCritica(node.id)}
                className="tap btn btn-ghost btn-sm hover:!text-state-problem"
              >
                {tr.groundTruth.discard}
              </button>
            </div>
          )}
        </div>
      )}

      {action.error && (
        <InlineError error={action.error} onRetry={run} className="mt-3" />
      )}
    </>
  );

  if (collapsible) {
    return (
      <Fold
        title={tr.groundTruth.adversarial}
        summary={
          busy
            ? tr.groundTruth.generatingCritique
            : generatedDate
              ? `${tr.groundTruth.summaryOpinionGenerated}, ${generatedDate}`
              : tr.groundTruth.summaryOpinionNone
        }
        summaryClass={node.critica || busy ? 'text-text-secondary' : 'text-text-muted'}
        autoOpen={Boolean(action.error)}
      >
        {body}
      </Fold>
    );
  }

  return (
    <section className="border-b border-border-base/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-control font-semibold text-text-primary">{tr.groundTruth.adversarial}</span>
        {generatedDate && (
          <span className="ml-auto text-footnote text-text-muted">
            {tr.groundTruth.generatedOn(generatedDate)}
          </span>
        )}
      </div>
      {body}
    </section>
  );
}

function CritiqueGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="label">{label}</div>
      <ul className="list-disc space-y-1 pl-4 text-text-secondary marker:text-text-faint">
        {items.map((item, i) => (
          <li key={i} className="pl-0.5">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (d) Provas (links, medidas, especificações)
// ---------------------------------------------------------------------------

const KIND_CYCLE: GroundTruthKind[] = ['link', 'spec', 'medida'];
const HIGHLIGHT_MS = 3000;

export function GroundTruthRefsList(props: SectionProps) {
  return <RefsBody key={props.node.id} {...props} />;
}

function RefsBody({ node, project, collapsible }: SectionProps) {
  const tr = useT();
  const addGroundTruthRef = useGraphStore((s) => s.addGroundTruthRef);
  const removeGroundTruthRef = useGraphStore((s) => s.removeGroundTruthRef);
  const researchJob = useGraphStore((s) => Boolean(s.aiJobs[node.id]?.research));

  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [kindOverride, setKindOverride] = useState<GroundTruthKind | null>(null);
  const [showFindings, setShowFindings] = useState(false);
  const [newCount, setNewCount] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(() => new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const refs = node.groundTruthRefs ?? [];
  const checkedCount = refs.filter(refCountsAsSignal).length;

  // Pesquisa web DESTA célula: busca fontes reais e adiciona cada uma como
  // prova kind="link". O digest fica no nó e vira contexto grátis pra
  // explicar/criticar/decompor/replanejar. Devolve as URLs novas.
  const research = useAIAction(
    async (signal): Promise<string[] | undefined> => {
      const proj = useGraphStore.getState().project;
      const cur = proj?.nodes[node.id];
      if (!proj || !cur) return undefined;
      const before = new Set((cur.groundTruthRefs ?? []).map((r) => r.value));
      const digest = await runResearch(
        `${cur.name} — ${cur.oQue || cur.fx}`,
        `Project goal: ${proj.objective}. Find official docs, real prices/specs/availability and tutorials usable as verifiable references for this part.${proj.rules && proj.rules.length > 0 ? ` Hard constraints: ${proj.rules.join(' · ')}` : ''}`,
        { signal },
      );
      if (signal.aborted) return undefined;
      useGraphStore.getState().applyWebResearch(cur.id, digest);
      return [...new Set(digest.sources.map((s) => s.url).filter((u) => !before.has(u)))];
    },
    { job: { nodeId: node.id, kind: 'research' } },
  );

  const handleResearch = async () => {
    if (!requireAI()) return;
    setNewCount(null);
    const fresh = await research.run();
    if (!fresh) return;
    setNewCount(fresh.length);
    setShowFindings(true);
    setHighlight(new Set(fresh));
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(new Set()), HIGHLIGHT_MS);
  };
  const researchingElsewhere = !research.running && researchJob;
  const researching = research.running || researchingElsewhere;
  void project;

  const detected = detectRefKind(input);
  const kind = kindOverride ?? detected;
  const value = kind === 'link' ? normalizeLinkInput(input) : input.trim();
  const linkInvalid = kind === 'link' && input.trim() !== '' && !safeHref(value);
  const defaultLabel =
    kind === 'link' ? (hostnameOf(value) ?? '') : value.length > 40 ? `${value.slice(0, 40)}…` : value;
  const canAdd = value !== '' && !linkInvalid;

  const resetForm = () => {
    setAdding(false);
    setInput('');
    setLabel('');
    setKindOverride(null);
  };

  const handleAdd = () => {
    if (!canAdd) return;
    addGroundTruthRef(node.id, {
      kind,
      // Sem rótulo: o rótulo é o valor inteiro (o card mostra uma linha só).
      label: label.trim() || (kind === 'link' ? defaultLabel : value) || value,
      value,
      verificado: false,
      addedByAI: false,
    });
    resetForm();
  };

  const handleRemove = (r: GroundTruthRef) => {
    removeGroundTruthRef(node.id, r.id);
    const { id: _id, addedAt: _at, ...rest } = r;
    void _id;
    void _at;
    toast.show({
      message: tr.groundTruth.removedToast(r.label),
      action: { label: tr.common.undo, onClick: () => addGroundTruthRef(node.id, rest) },
    });
  };

  const onFormKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetForm();
    }
  };

  const research_ = node.webResearch;
  const researchDate = research_
    ? new Date(research_.searchedAt).toLocaleDateString(tr.detail.locale)
    : null;

  const body = (
    <>
      {refs.length === 0 && !adding && (
        <p className="mb-3 text-footnote text-text-muted">{tr.groundTruth.noAnchorsHint}</p>
      )}

      {refs.length > 0 && (
        <ul className="-mx-2 mb-3 divide-y divide-border-base/70">
          {refs.map((r) => (
            <RefRow
              key={r.id}
              nodeId={node.id}
              refData={r}
              highlighted={highlight.has(r.value)}
              onRemove={() => handleRemove(r)}
            />
          ))}
        </ul>
      )}

      {adding && (
        <div className="mb-3 space-y-2 rounded-card bg-bg-elevated/50 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setKindOverride(KIND_CYCLE[(KIND_CYCLE.indexOf(kind) + 1) % KIND_CYCLE.length])
              }
              title={tr.groundTruth.kindChipTitle}
              className="tap btn btn-secondary btn-sm shrink-0"
            >
              {tr.groundTruth.kindNames[kind]}
              <span aria-hidden className="text-text-faint">
                ⇄
              </span>
            </button>
            <input name="proof-value"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onFormKey}
              aria-label={tr.groundTruth.addPlaceholder}
              aria-invalid={linkInvalid || undefined}
              placeholder={tr.groundTruth.addPlaceholder}
              className="field min-w-0 flex-1"
            />
          </div>
          <input name="proof-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onFormKey}
            aria-label={tr.groundTruth.addLabelOptional}
            placeholder={defaultLabel || tr.groundTruth.addLabelOptional}
            className="field"
          />
          {linkInvalid && (
            <p className="text-footnote text-state-problem">{tr.groundTruth.invalidLink}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={resetForm} className="tap btn btn-ghost">
              {tr.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAdd}
              className="tap btn btn-primary"
            >
              {tr.groundTruth.anchorAddBtn}
            </button>
          </div>
        </div>
      )}

      {/* Pesquisa web da célula — ação explícita, fontes viram provas */}
      <div className="space-y-2">
        {(!adding || !researching) && (
          <div className="flex flex-wrap items-center gap-2">
            {!adding && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="tap btn btn-secondary btn-sm"
              >
                <span aria-hidden className="text-text-muted">
                  +
                </span>
                {tr.groundTruth.addAnchor}
              </button>
            )}
            {!researching && (
              <>
                <button
                  type="button"
                  onClick={handleResearch}
                  title={tr.groundTruth.researchCostHint}
                  className="tap btn btn-ai btn-sm"
                >
                  <span className="ai-icon" aria-hidden>
                    ✦
                  </span>
                  {research_ ? tr.groundTruth.researchAgainBtn : tr.groundTruth.researchMicrocopy}
                </button>
                {!research_ && (
                  <span className="text-caption text-text-muted">{tr.groundTruth.researchCostHint}</span>
                )}
              </>
            )}
          </div>
        )}

        {researching && (
          <RunningRow
            label={tr.groundTruth.researchingBtn}
            elapsedMs={research.elapsedMs}
            onCancel={research.running ? research.cancel : undefined}
          />
        )}

        {newCount !== null && !researching && (
          <p className={`text-footnote ${newCount > 0 ? 'text-state-done' : 'text-text-muted'}`}>
            {tr.groundTruth.researchNewSources(newCount)}
          </p>
        )}

        {research_ && researchDate && (
          <button
            type="button"
            onClick={() => setShowFindings((v) => !v)}
            aria-expanded={showFindings}
            className="tap -mx-1 flex items-center gap-1.5 rounded-chip px-1 py-0.5 text-left text-footnote text-text-muted transition-colors duration-120 ease-mac hover:text-text-primary"
          >
            <Chevron
              className={`text-text-faint transition-transform duration-180 ease-mac ${showFindings ? 'rotate-90' : ''}`}
            />
            <span>
              {tr.groundTruth.researchSummary(research_.sources.length, researchDate)},{' '}
              {tr.groundTruth.researchFindings}
            </span>
          </button>
        )}

        {showFindings && research_ && (
          <div className="max-h-56 overflow-y-auto rounded-control bg-bg-elevated/50 px-3 py-2.5">
            <ExplanationContent text={research_.findings} />
          </div>
        )}

        {research.error && <InlineError error={research.error} onRetry={handleResearch} />}
      </div>
    </>
  );

  if (collapsible) {
    return (
      <Fold
        title={tr.groundTruth.anchors}
        summary={tr.groundTruth.summaryProofs(refs.length, checkedCount)}
        summaryClass={checkedCount > 0 ? 'text-state-done' : 'text-text-muted'}
        autoOpen={researching || Boolean(research.error) || highlight.size > 0}
      >
        {body}
      </Fold>
    );
  }

  return (
    <section className="border-b border-border-base/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-control font-semibold text-text-primary">{tr.groundTruth.anchors}</span>
        <span className="ml-auto shrink-0 text-footnote text-text-muted">
          {tr.groundTruth.summaryProofs(refs.length, checkedCount)}
        </span>
      </div>
      {body}
    </section>
  );
}

function RefRow({
  nodeId,
  refData,
  highlighted,
  onRemove,
}: {
  nodeId: string;
  refData: GroundTruthRef;
  highlighted: boolean;
  onRemove: () => void;
}) {
  const tr = useT();
  const verifyRef = useGraphStore((s) => s.verifyGroundTruthRef);
  const toggleRef = useGraphStore((s) => s.toggleGroundTruthVerified);
  const markRefOpened = useGraphStore((s) => s.markRefOpened);
  const [verifying, setVerifying] = useState(false);
  const [obs, setObs] = useState('');

  const href = refData.kind === 'link' ? safeHref(refData.value) : null;
  // Prova sem rótulo próprio: o rótulo É o valor — não repete a linha.
  // Rótulo antigo gerado como valor truncado ("…") também conta como sem rótulo.
  const lbl = refData.label.trim();
  const val = refData.value.trim();
  const valueIsLabel =
    refData.kind !== 'link' && (val === lbl || (lbl.endsWith('…') && val.startsWith(lbl.slice(0, -1))));
  // Prova da IA com link: só dá pra conferir depois de abrir a fonte.
  const mustOpenFirst = refData.addedByAI && href !== null && !refData.openedAt;
  const counts = refCountsAsSignal(refData);

  const onCheckbox = () => {
    if (counts) {
      toggleRef(nodeId, refData.id); // desmarca (descarta a observação)
      return;
    }
    if (mustOpenFirst) return;
    setVerifying((v) => !v);
  };

  const submitVerify = () => {
    const text = obs.trim();
    if (!text) return;
    verifyRef(nodeId, refData.id, text);
    setVerifying(false);
    setObs('');
  };

  const onOpen = () => {
    if (!refData.openedAt) markRefOpened(nodeId, refData.id);
  };

  const checkboxTitle = counts
    ? tr.groundTruth.anchorToggleVerify.unmark
    : mustOpenFirst
      ? tr.groundTruth.openLinkFirst
      : tr.groundTruth.anchorToggleVerify.mark;

  return (
    <li
      className={`group rounded-control px-2 py-2.5 transition-colors duration-700 ease-mac ${
        highlighted ? 'bg-ai-accent/8' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={counts}
          aria-label={`${checkboxTitle}: ${refData.label}`}
          onClick={onCheckbox}
          disabled={!counts && mustOpenFirst}
          title={checkboxTitle}
          className={`relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-check transition-[background-color,box-shadow] duration-120 ease-mac before:absolute before:-inset-2.5 disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:before:-inset-3.5 ${
            counts
              ? 'bg-accent-solid text-accent-fg shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]'
              : 'bg-bg-secondary shadow-[inset_0_0_0_1px_rgb(var(--text-faint)/0.55)] hover:shadow-[inset_0_0_0_1px_rgb(var(--text-muted))]'
          }`}
        >
          {counts && <CheckGlyph className="h-3 w-3" animate />}
        </button>
        <KindGlyph kind={refData.kind} title={tr.groundTruth.kindNames[refData.kind]} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span
              className={`min-w-0 text-control text-text-primary ${valueIsLabel ? 'break-words' : 'truncate'}`}
            >
              {valueIsLabel ? (refData.kind === 'medida' ? stripZeroTolerance(refData.value) : refData.value) : refData.label}
            </span>
            {refData.addedByAI && (
              <span className="chip ml-auto h-[18px] shrink-0 gap-1 bg-ai-accent/12 px-1.5 text-ai-accent">
                <span aria-hidden>✦</span>
                {tr.groundTruth.anchorAIBadge}
              </span>
            )}
          </div>
          {!valueIsLabel && (
            <div className="mt-0.5 break-all text-footnote text-text-muted">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onOpen}
                  onAuxClick={onOpen}
                  className="text-accent hover:underline"
                >
                  {refData.value}
                </a>
              ) : (
                <>
                  {refData.kind === 'medida' ? stripZeroTolerance(refData.value) : refData.value}
                  {refData.kind === 'link' && (
                    <span className="ml-1 text-state-problem">({tr.groundTruth.invalidLink})</span>
                  )}
                </>
              )}
            </div>
          )}
          {refData.verificado && refData.observacao && (
            <div className="mt-1 break-words text-footnote text-text-secondary">
              <span className="font-medium text-state-done">{tr.groundTruth.checkedNote}</span>{' '}
              {refData.observacao}
            </div>
          )}
          {refData.verificado && !counts && !verifying && (
            <div className="mt-1 text-footnote text-conf-mid">{tr.groundTruth.needsObservation}</div>
          )}
          {mustOpenFirst && (
            <div className="mt-1 text-footnote text-text-muted">{tr.groundTruth.openLinkFirst}</div>
          )}

          {verifying && (
            <div className="mt-2.5 space-y-1.5">
              <label htmlFor={`gt-verify-${refData.id}`} className="label block">
                {tr.groundTruth.verifyPrompt}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id={`gt-verify-${refData.id}`}
                  autoFocus
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitVerify();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setVerifying(false);
                    }
                  }}
                  placeholder={tr.groundTruth.verifyPlaceholder}
                  className="field min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={submitVerify}
                  disabled={!obs.trim()}
                  className="tap btn btn-primary shrink-0"
                >
                  {tr.groundTruth.verifyBtn}
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${tr.groundTruth.anchorRemoveTitle}: ${refData.label}`}
          title={tr.groundTruth.anchorRemoveTitle}
          className="tap btn btn-ghost btn-icon btn-sm -my-1 -mr-1 shrink-0 text-footnote hover:!text-state-problem focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// (c) Deu errado na prática? — falha registrada + replanejar com contexto
// ---------------------------------------------------------------------------

// Diagnóstico do último replanejamento por nó — sobrevive à remontagem do card
// enquanto as sugestões estão pendentes (o store não guarda o diagnóstico).
const replanDiagnoses = new Map<string, string>();

export function FailureSection(props: SectionProps & { domIds?: boolean }) {
  return <FailureBody key={props.node.id} {...props} />;
}

function FailureBody({ node, project, collapsible, domIds }: SectionProps & { domIds?: boolean }) {
  const tr = useT();
  const reportFailure = useGraphStore((s) => s.reportFailure);
  const clearFailure = useGraphStore((s) => s.clearFailure);
  const setDraft = useGraphStore((s) => s.setDraft);
  const clearDraft = useGraphStore((s) => s.clearDraft);
  const draft = useGraphStore((s) => s.drafts[node.id]?.failure ?? '');
  const pendingNode = useGraphStore(pendingParent);
  const replanJob = useGraphStore((s) => Boolean(s.aiJobs[node.id]?.replan));

  const [opening, setOpening] = useState(() => draft.trim() !== '');
  const [diagnosis, setDiagnosis] = useState<string | null>(
    () => replanDiagnoses.get(node.id) ?? null,
  );

  const failed = Boolean(node.failureContext);
  // Só as sugestões DESTE nó seguram o replanejar — as de outro nó estacionam.
  const pendingHere = pendingNode?.id === node.id;
  void project;

  const replan = useAIAction(
    async (signal, failure: string): Promise<string | null | undefined> => {
      const proj = useGraphStore.getState().project;
      const cur = proj?.nodes[node.id];
      if (!proj || !cur) return undefined;
      const all = Object.values(proj.nodes);
      const siblings = all
        .filter((n) => n.parentId === cur.parentId && n.id !== cur.id)
        .map((n) => ({ name: n.name, fx: n.fx }));
      // A decomposição que falhou — o modelo precisa vê-la pra não repeti-la.
      const currentChildren = all
        .filter((n) => n.parentId === cur.id)
        .map((n) => ({ name: n.name, oQue: n.oQue, state: n.state }));
      // Provas que não viraram sinal real (não conferidas ou sem observação).
      const failedAnchors = (cur.groundTruthRefs ?? [])
        .filter((r) => !refCountsAsSignal(r))
        .map((r) => `${r.label}: ${r.value}`);

      const kbContext = await useKBStore.getState().getContextFor({
        label: tr.notify.failurePromptLabel(proj.objective),
        extra: tr.notify.failurePromptExtra(cur.name, failure),
      });
      if (signal.aborted) return undefined;

      const result = await replanFromFailure(
        {
          projectName: proj.name,
          projectObjective: proj.objective,
          breadcrumb: breadcrumbFor(proj, cur.id).map((c) => c.name),
          nodeName: cur.name,
          nodeKind: cur.kind,
          nodeFx: cur.fx,
          oQue: cur.oQue,
          failureContext: failure,
          siblings,
          strategy: proj.constructionStrategy,
          archetype: proj.archetype,
          rules: proj.rules,
          research: cur.webResearch,
          currentChildren: currentChildren.length > 0 ? currentChildren : undefined,
          // Critério da IA só depois de revelado: senão o diagnóstico mostraria
          // o limiar da IA antes de o usuário escrever o dele.
          comoConfirmar: canRevealAICriterionNow(cur)
            ? cur.comoConfirmar || undefined
            : cur.comoConfirmarUsuario || undefined,
          failedAnchors: failedAnchors.length > 0 ? failedAnchors : undefined,
          planOverview: planOverviewFor(proj, cur.id),
        },
        kbContext,
        { signal },
      );
      if (signal.aborted) return undefined;

      const staged = buildStagedNodes(cur, result.nodes, {
        notes: tr.groundTruth.failureReplanNotes(failure),
      });
      useGraphStore.getState().stageSuggestions(cur.id, staged, result.edges);
      const diag = result.diagnosis?.trim() || null;
      if (diag) replanDiagnoses.set(cur.id, diag);
      else replanDiagnoses.delete(cur.id);
      return diag;
    },
    { job: { nodeId: node.id, kind: 'replan' } },
  );

  const runReplan = async (failure: string) => {
    if (!failure.trim() || useGraphStore.getState().pendingSuggestions?.parentId === node.id) return;
    if (!requireAI()) return;
    const diag = await replan.run(failure.trim());
    if (diag !== undefined) setDiagnosis(diag);
  };

  const replanningElsewhere = !replan.running && replanJob;
  const replanning = replan.running || replanningElsewhere;

  const record = (andReplan: boolean) => {
    const text = draft.trim();
    if (!text) return;
    reportFailure(node.id, text);
    setOpening(false);
    if (andReplan) void runReplan(text);
  };

  const cancelReport = () => {
    setOpening(false);
    clearDraft(node.id, 'failure');
  };

  const body = (
    <>
      {!failed && !opening && (
        <button
          type="button"
          onClick={() => setOpening(true)}
          className="tap btn btn-secondary w-full sm:w-auto"
        >
          {tr.groundTruth.failedInPractice}
        </button>
      )}

      {!failed && opening && (
        <div className="space-y-2">
          <textarea name="failure-context"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(node.id, 'failure', e.target.value)}
            onKeyDown={submitOnModEnter(() => record(true))}
            rows={3}
            aria-label={tr.groundTruth.failureContextLabel}
            placeholder={tr.groundTruth.failurePlaceholder}
            className="field resize-none"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={cancelReport} className="tap btn btn-ghost">
              {tr.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => record(false)}
              disabled={!draft.trim()}
              className="tap btn btn-secondary"
            >
              {tr.groundTruth.recordOnly}
            </button>
            <button
              type="button"
              onClick={() => record(true)}
              disabled={!draft.trim()}
              title={tr.groundTruth.submitHint}
              className="tap btn btn-primary"
            >
              {tr.groundTruth.registerAndReplan}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <div className="space-y-3">
          <div className="rounded-control bg-bg-elevated/60 border-l-2 border-state-problem pl-3 pr-3 py-2.5 text-control">
            <div className="mb-0.5 flex items-center gap-2 text-footnote font-medium text-text-primary">
              <span aria-hidden className="w-2 h-2 rounded-full bg-state-problem shrink-0" />
              {tr.groundTruth.failureContextLabel}
            </div>
            <div className="break-words text-text-primary">{node.failureContext}</div>
            {node.failureReportedAt && (
              <div className="mt-1 text-footnote tabular-nums text-text-muted">
                {new Date(node.failureReportedAt).toLocaleString(tr.detail.locale)}
              </div>
            )}
          </div>

          {pendingHere && diagnosis && (
            <div className="rounded-control bg-ai-accent/8 px-3 py-2.5 text-control">
              <div className="mb-0.5 inline-flex items-center gap-1.5 text-footnote font-medium text-ai-accent">
                <span aria-hidden>✦</span>
                {tr.groundTruth.diagnosisLabel}
              </div>
              <div className="text-text-primary">{diagnosis}</div>
            </div>
          )}

          {replanning ? (
            <RunningRow
              label={tr.groundTruth.replanning}
              elapsedMs={replan.elapsedMs}
              onCancel={replan.running ? replan.cancel : undefined}
            />
          ) : pendingHere ? (
            <p className="text-footnote text-ai-accent">{tr.groundTruth.pendingHereHint}</p>
          ) : null}

          {replan.error && (
            <InlineError
              error={replan.error}
              onRetry={() => void runReplan(node.failureContext ?? '')}
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!replanning && !pendingHere && (
              <button
                type="button"
                onClick={() => void runReplan(node.failureContext ?? '')}
                className="tap btn btn-ai"
              >
                <span className="ai-icon" aria-hidden>
                  ✦
                </span>
                {tr.groundTruth.replanWithFailure}
              </button>
            )}
            <button
              type="button"
              onClick={() => clearFailure(node.id)}
              className="tap btn btn-secondary"
            >
              {tr.groundTruth.clearFailure}
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (collapsible) {
    return (
      <Fold
        id={domIds ? 'gt-failure' : undefined}
        title={tr.groundTruth.reality}
        summary={failed ? tr.groundTruth.summaryFailureOpen : tr.groundTruth.summaryFailureNone}
        summaryClass={failed ? 'text-state-problem' : 'text-text-muted'}
        autoOpen={failed || opening || replanning || Boolean(replan.error)}
      >
        {body}
      </Fold>
    );
  }

  return (
    <section id={domIds ? 'gt-failure' : undefined} className="border-b border-border-base/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-control font-semibold text-text-primary">{tr.groundTruth.reality}</span>
        {failed && (
          <span className="chip ml-auto bg-state-problem/12 text-state-problem">{tr.groundTruth.failed}</span>
        )}
      </div>
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card "Como saber que deu certo" do tutor (grupo estilo System Settings):
// critério aberto; provas, segunda opinião e falha recolhidas com resumo.
// ---------------------------------------------------------------------------

export function GroundTruthInlineTutor({
  node,
  project,
}: {
  node: ConceptNodeData;
  project: Project;
}) {
  const tr = useT();
  return (
    // Seção plana dentro do card do tutor: título + espaço, sem cartão aninhado
    // nem hairlines entre os acordeões.
    <div className="mt-8 space-y-1">
      <h2 className="text-title3 font-semibold text-text-primary">{tr.groundTruth.sectionTitle}</h2>
      <div className="-mx-4 space-y-1 [&>details]:border-t-0 [&_summary]:rounded-control">
        <UserCriterionField node={node} domIds inGroup />
        <GroundTruthRefsList node={node} project={project} collapsible />
        <CritiqueSection node={node} project={project} collapsible />
        <FailureSection node={node} project={project} collapsible domIds />
      </div>
    </div>
  );
}
