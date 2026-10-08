import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ConceptNodeData, GroundTruthKind, GroundTruthRef, Project } from '@/types';
import {
  useGraphStore,
  breadcrumbFor,
  buildStagedNodes,
  CRITERION_UNLOCK_MS,
  pendingParent,
  refCountsAsSignal,
} from '@/store';
import { useKBStore } from '@/kb/store';
import { useT } from '@/i18n';
import { critiqueNode, replanFromFailure } from '@/ai/service';
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

// Só http(s) vira href — nada de javascript:, data: etc. vindos da IA/import.
export function safeHref(value: string): string | null {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

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

// Seção recolhível do card do tutor: título + resumo de uma linha.
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
      className="group/fold border-b border-border-base last:border-b-0 scroll-mt-4"
    >
      <summary className="tap list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex items-center gap-2 px-3 py-2.5 hover:bg-bg-elevated/40 transition-colors">
        <span
          aria-hidden
          className="text-[10px] text-text-muted transition-transform group-open/fold:rotate-90"
        >
          ▸
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted shrink-0">
          {title}
        </span>
        <span
          className={`ml-auto min-w-0 truncate text-[10px] font-mono ${summaryClass ?? 'text-text-secondary'}`}
        >
          {summary}
        </span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
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
    <div className="flex items-center gap-2 text-[11px] text-ai-accent border border-ai-accent/30 bg-ai-accent/5 rounded-sm px-2 py-1.5">
      <span className="inline-block w-3 h-3 border-2 border-ai-accent/40 border-t-ai-accent rounded-full animate-spin shrink-0" />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="font-mono text-[10px] text-text-muted tabular-nums">{secs(elapsedMs)}s</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="tap text-[10px] font-mono text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2 py-0.5 transition-colors"
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
}

export function UserCriterionField(props: CriterionProps) {
  return <UserCriterionBody key={props.node.id} {...props} />;
}

function UserCriterionBody({ node, domIds }: CriterionProps) {
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
    toast.show({
      message: tr.groundTruth.lockedToast,
      tone: 'ok',
      durationMs: CRITERION_UNDO_MS,
      action: { label: tr.groundTruth.undoWithin(CRITERION_UNDO_MS / 1000), onClick: undoLock },
    });
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
      className="p-3 border-b border-border-base space-y-2 scroll-mt-4"
    >
      <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted">
        {tr.groundTruth.howToConfirm}
      </label>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-1">
          {tr.groundTruth.yourCriterion}{' '}
          {locked && <span className="text-state-done">{tr.groundTruth.locked}</span>}
        </div>
        {locked ? (
          <div className="space-y-1.5">
            <div className="flex items-start gap-2 text-xs bg-bg-elevated border border-ai-accent/30 rounded-sm px-2 py-1.5 text-text-primary">
              <span className="flex-1 min-w-0 break-words">{node.comoConfirmarUsuario}</span>
              {inUndoWindow && (
                <button
                  type="button"
                  onClick={undoLock}
                  className="tap shrink-0 text-[10px] font-mono text-text-muted hover:text-ai-accent border border-border-base rounded-sm px-1.5 py-0.5 transition-colors"
                >
                  {tr.groundTruth.undoWithin(secs(remainingMs))}
                </button>
              )}
            </div>
            {node.comoConfirmarAtendido ? (
              <div className="text-[11px] text-state-done bg-state-done/5 border border-state-done/20 rounded-sm px-2 py-1">
                ✓ {tr.groundTruth.criterionMet}:{' '}
                <span className="text-text-secondary">{node.comoConfirmarAtendido.observacao}</span>
              </div>
            ) : (
              <div id={domIds ? 'gt-attest' : undefined} className="space-y-1 scroll-mt-4">
                <label
                  htmlFor={`gt-met-${node.id}`}
                  className="block text-[10px] font-mono uppercase tracking-wider text-conf-mid"
                >
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
                  className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-state-done outline-none"
                />
                <button
                  type="button"
                  onClick={handleAttest}
                  disabled={!metDraft.trim()}
                  title={tr.groundTruth.submitHint}
                  className="tap w-full text-[11px] bg-state-done/15 hover:bg-state-done/30 disabled:opacity-40 disabled:cursor-not-allowed text-state-done border border-state-done/40 rounded-sm py-1 transition-colors"
                >
                  {tr.groundTruth.criterionMetBtn}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <textarea
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
              className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-ai-accent outline-none"
            />
            {showVagueLive && (
              <div className="text-[10px] font-mono text-conf-mid">{tr.groundTruth.vagueHint}</div>
            )}
            <div className="mt-1 space-y-1">
              <button
                type="button"
                onClick={handleLock}
                disabled={!draft.trim()}
                title={tr.groundTruth.submitHint}
                className="tap w-full text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent border border-ai-accent/40 rounded-sm py-1 transition-colors"
              >
                {tr.groundTruth.lockBtn}
              </button>
              <p className="text-[10px] text-text-muted leading-snug">{tr.groundTruth.lockHelp}</p>
            </div>
          </>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
          {tr.groundTruth.aiCriterion}{' '}
          {!revealed && (
            <span className="italic normal-case">
              {inUndoWindow ? tr.groundTruth.revealIn(secs(remainingMs)) : tr.groundTruth.hiddenUntilLock}
            </span>
          )}
        </div>
        {revealed ? (
          <div className="text-xs bg-bg-elevated border border-border-base rounded-sm px-2 py-1.5 font-mono italic text-text-secondary">
            {node.comoConfirmar || <span className="text-text-muted">{tr.groundTruth.emptyAI}</span>}
          </div>
        ) : (
          <div className="text-xs bg-bg-elevated/40 border border-dashed border-border-base rounded-sm px-2 py-1.5 text-text-muted italic">
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

function DivergenceHint({ ai, user }: { ai: string; user: string }) {
  const tr = useT();
  const verdict = assessCriterion(ai, user);
  if (verdict === 'similar') {
    return (
      <div className="text-[10px] font-mono text-conf-mid bg-conf-mid/5 border border-conf-mid/30 rounded-sm px-2 py-1">
        {tr.groundTruth.convergenceCopy}
      </div>
    );
  }
  if (verdict === 'vague') {
    return (
      <div className="text-[10px] font-mono text-conf-mid bg-conf-mid/5 border border-conf-mid/20 rounded-sm px-2 py-1">
        {tr.groundTruth.vagueHint}
      </div>
    );
  }
  return (
    <div className="text-[10px] font-mono text-state-done/80 bg-state-done/5 border border-state-done/20 rounded-sm px-2 py-1">
      {tr.groundTruth.convergenceIndependent}
    </div>
  );
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
  const jobKind = useGraphStore((s) => s.aiJobs[node.id]?.kind);
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
  const runningElsewhere = !action.running && jobKind === 'critique';
  const busy = action.running || runningElsewhere;
  void project;

  const generatedDate = node.critica
    ? new Date(node.critica.generatedAt).toLocaleDateString(tr.detail.locale)
    : null;

  const body = (
    <>
      {busy && (
        <div className="mb-2">
          <RunningRow
            label={node.critica ? tr.groundTruth.regenerating : tr.groundTruth.generatingCritique}
            elapsedMs={action.elapsedMs}
            onCancel={action.running ? action.cancel : undefined}
          />
        </div>
      )}

      {!node.critica && !busy && (
        <button
          type="button"
          onClick={run}
          className="tap w-full text-[11px] bg-conf-mid/10 hover:bg-conf-mid/25 text-conf-mid border border-conf-mid/30 rounded-sm py-1.5 transition-colors"
        >
          {tr.groundTruth.askSecondOpinion}
        </button>
      )}

      {node.critica && (
        <div className="space-y-2 text-xs">
          <CritiqueGroup label={tr.groundTruth.weaknesses} items={node.critica.fraquezas} />
          {node.critica.premissasOcultas.length > 0 && (
            <CritiqueGroup label={tr.groundTruth.hiddenPremises} items={node.critica.premissasOcultas} />
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-1">
              {tr.groundTruth.altCriterion}
            </div>
            {revealed ? (
              <div className="bg-bg-elevated border border-ai-accent/30 rounded-sm px-2 py-1.5 text-text-primary italic">
                {node.critica.criterioAlternativo}
              </div>
            ) : (
              <div className="bg-bg-elevated/40 border border-dashed border-border-base rounded-sm px-2 py-1.5 text-text-muted italic">
                {tr.groundTruth.altCriterionHidden}
              </div>
            )}
          </div>
          {node.critica.fontes && node.critica.fontes.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                {tr.groundTruth.criticSources}
              </div>
              <ul className="space-y-0.5 pl-3">
                {node.critica.fontes.map((f) => {
                  const href = safeHref(f.url);
                  return (
                    <li key={f.url} className="relative leading-relaxed">
                      <span className="absolute -left-3 text-ai-accent">⌖</span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-text-secondary underline decoration-ai-accent/40 hover:text-ai-accent transition-colors break-all"
                        >
                          {f.title}
                        </a>
                      ) : (
                        <span className="text-text-secondary break-all">{f.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!busy && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={run}
                className="tap flex-1 text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border-base rounded-sm py-1 transition-colors"
              >
                {tr.groundTruth.regenerate}
              </button>
              <button
                type="button"
                onClick={() => clearCritica(node.id)}
                className="tap text-[10px] font-mono text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2 py-1 transition-colors"
              >
                {tr.groundTruth.discard}
              </button>
            </div>
          )}
        </div>
      )}

      {action.error && (
        <InlineError error={action.error} onRetry={run} className="mt-2" />
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
              ? `${tr.groundTruth.summaryOpinionGenerated} · ${generatedDate}`
              : tr.groundTruth.summaryOpinionNone
        }
        summaryClass={node.critica || busy ? 'text-conf-mid' : 'text-text-muted'}
        autoOpen={Boolean(action.error)}
      >
        {body}
      </Fold>
    );
  }

  return (
    <section className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.adversarial}
        </label>
        {generatedDate && (
          <span className="text-[10px] font-mono text-conf-mid">
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
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">{label}</div>
      <ul className="space-y-0.5 pl-3">
        {items.map((item, i) => (
          <li key={i} className="relative text-text-secondary leading-relaxed">
            <span className="absolute -left-3 text-conf-mid">·</span>
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
  const jobKind = useGraphStore((s) => s.aiJobs[node.id]?.kind);

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
  const researchingElsewhere = !research.running && jobKind === 'research';
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
      label: label.trim() || defaultLabel || value,
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
        <div className="text-[11px] text-text-muted italic mb-2">{tr.groundTruth.noAnchorsHint}</div>
      )}

      {refs.length > 0 && (
        <ul className="space-y-1 mb-2">
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

      {adding ? (
        <div className="space-y-1.5 border border-ai-accent/30 rounded-sm p-2 bg-bg-elevated">
          <div className="flex gap-1.5 items-center">
            <button
              type="button"
              onClick={() =>
                setKindOverride(KIND_CYCLE[(KIND_CYCLE.indexOf(kind) + 1) % KIND_CYCLE.length])
              }
              title={tr.groundTruth.kindChipTitle}
              className="tap shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-sm border bg-ai-accent/15 border-ai-accent/60 text-ai-accent"
            >
              {tr.groundTruth.kindNames[kind]} ⇄
            </button>
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onFormKey}
              aria-label={tr.groundTruth.addPlaceholder}
              placeholder={tr.groundTruth.addPlaceholder}
              className="flex-1 min-w-0 bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-[11px] font-mono focus:border-ai-accent outline-none"
            />
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onFormKey}
            aria-label={tr.groundTruth.addLabelOptional}
            placeholder={defaultLabel || tr.groundTruth.addLabelOptional}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-[11px] focus:border-ai-accent outline-none"
          />
          {linkInvalid && (
            <div className="text-[10px] font-mono text-state-problem">{tr.groundTruth.invalidLink}</div>
          )}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAdd}
              className="tap flex-1 text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 text-ai-accent border border-ai-accent/40 rounded-sm py-1 transition-colors"
            >
              {tr.groundTruth.anchorAddBtn}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="tap text-[11px] text-text-muted hover:text-text-secondary border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.common.cancel.toLowerCase()}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="tap w-full text-[11px] text-text-muted hover:text-ai-accent border border-dashed border-border-base hover:border-ai-accent/40 rounded-sm py-1 transition-colors"
        >
          {tr.groundTruth.addAnchor}
        </button>
      )}

      {/* Pesquisa web da célula — ação explícita, fontes viram provas */}
      <div className="mt-2 space-y-1.5">
        {researching ? (
          <RunningRow
            label={tr.groundTruth.researchingBtn}
            elapsedMs={research.elapsedMs}
            onCancel={research.running ? research.cancel : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={handleResearch}
            className="tap w-full text-[11px] bg-ai-accent/10 hover:bg-ai-accent/25 text-ai-accent border border-ai-accent/30 rounded-sm py-1.5 transition-colors"
          >
            {research_ ? tr.groundTruth.researchAgainBtn : tr.groundTruth.researchMicrocopy}
          </button>
        )}

        {newCount !== null && !researching && (
          <div
            className={`text-[10px] font-mono ${newCount > 0 ? 'text-state-done' : 'text-text-muted'}`}
          >
            {tr.groundTruth.researchNewSources(newCount)}
          </div>
        )}

        {research_ && researchDate && (
          <button
            type="button"
            onClick={() => setShowFindings((v) => !v)}
            aria-expanded={showFindings}
            className="w-full text-left text-[10px] font-mono text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1.5"
          >
            <span>{showFindings ? '▾' : '▸'}</span>
            <span>
              {tr.groundTruth.researchSummary(research_.sources.length, researchDate)} ·{' '}
              {tr.groundTruth.researchFindings}
            </span>
          </button>
        )}

        {showFindings && research_ && (
          <div className="border border-border-base bg-bg-elevated/40 rounded-sm p-2 max-h-56 overflow-y-auto">
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
    <section className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.anchors}
        </label>
        <span className="text-[10px] font-mono text-text-secondary ml-auto shrink-0">
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
  const valueIsLabel = refData.kind !== 'link' && refData.value.trim() === refData.label.trim();
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
      className={`group px-2 py-1.5 rounded-sm border transition-colors duration-700 ${
        highlighted
          ? 'border-ai-accent bg-ai-accent/10'
          : counts
            ? 'border-state-done/40 bg-state-done/5'
            : 'border-border-base bg-bg-elevated/40'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={counts}
          aria-label={`${checkboxTitle}: ${refData.label}`}
          onClick={onCheckbox}
          disabled={!counts && mustOpenFirst}
          title={checkboxTitle}
          className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            counts
              ? 'bg-state-done/20 border-state-done text-state-done'
              : 'border-border-base hover:border-text-muted'
          }`}
        >
          {counts && <span className="text-[10px]">✓</span>}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted shrink-0">
              {tr.groundTruth.kindNames[refData.kind]}
            </span>
            <span
              className={`text-[11px] text-text-primary ${valueIsLabel ? 'min-w-0 break-words' : 'truncate'}`}
            >
              {refData.label}
            </span>
            {refData.addedByAI && (
              <span className="text-[9px] font-mono text-ai-accent/70 ml-auto shrink-0">
                {tr.groundTruth.anchorAIBadge}
              </span>
            )}
          </div>
          {!valueIsLabel && (
            <div className="text-[11px] font-mono text-text-secondary break-all">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onOpen}
                  onAuxClick={onOpen}
                  className="text-ai-accent hover:underline"
                >
                  {refData.value}
                </a>
              ) : (
                <>
                  {refData.value}
                  {refData.kind === 'link' && (
                    <span className="ml-1 text-[10px] text-state-problem">({tr.groundTruth.invalidLink})</span>
                  )}
                </>
              )}
            </div>
          )}
          {refData.verificado && refData.observacao && (
            <div className="mt-0.5 text-[10px] text-state-done/90 break-words">
              {tr.groundTruth.checkedNote} <span className="text-text-secondary">{refData.observacao}</span>
            </div>
          )}
          {refData.verificado && !counts && !verifying && (
            <div className="mt-0.5 text-[10px] font-mono text-conf-mid">{tr.groundTruth.needsObservation}</div>
          )}
          {mustOpenFirst && (
            <div className="mt-0.5 text-[10px] font-mono text-text-muted">{tr.groundTruth.openLinkFirst}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${tr.groundTruth.anchorRemoveTitle}: ${refData.label}`}
          title={tr.groundTruth.anchorRemoveTitle}
          className="shrink-0 w-8 h-8 sm:w-6 sm:h-6 -mr-1 -mt-1 flex items-center justify-center rounded-sm opacity-40 hover:opacity-100 focus-visible:opacity-100 text-text-muted hover:text-state-problem text-[13px] transition-opacity"
        >
          ×
        </button>
      </div>

      {verifying && (
        <div className="mt-1.5 pl-6 space-y-1">
          <label
            htmlFor={`gt-verify-${refData.id}`}
            className="block text-[10px] font-mono uppercase tracking-wider text-conf-mid"
          >
            {tr.groundTruth.verifyPrompt}
          </label>
          <div className="flex gap-1">
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
              className="flex-1 min-w-0 bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-[11px] focus:border-state-done outline-none"
            />
            <button
              type="button"
              onClick={submitVerify}
              disabled={!obs.trim()}
              className="tap shrink-0 text-[11px] bg-state-done/15 hover:bg-state-done/30 disabled:opacity-40 disabled:cursor-not-allowed text-state-done border border-state-done/40 rounded-sm px-2 py-1 transition-colors"
            >
              {tr.groundTruth.verifyBtn}
            </button>
          </div>
        </div>
      )}
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
  const selectNode = useGraphStore((s) => s.selectNode);
  const draft = useGraphStore((s) => s.drafts[node.id]?.failure ?? '');
  const pendingNode = useGraphStore(pendingParent);
  const jobKind = useGraphStore((s) => s.aiJobs[node.id]?.kind);

  const [opening, setOpening] = useState(() => draft.trim() !== '');
  const [diagnosis, setDiagnosis] = useState<string | null>(
    () => replanDiagnoses.get(node.id) ?? null,
  );

  const failed = Boolean(node.failureContext);
  const pendingHere = pendingNode?.id === node.id;
  const pendingElsewhere = pendingNode !== null && !pendingHere;
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
          comoConfirmar: cur.comoConfirmar || undefined,
          failedAnchors: failedAnchors.length > 0 ? failedAnchors : undefined,
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
    if (!failure.trim() || pendingNode !== null) return;
    if (!requireAI()) return;
    const diag = await replan.run(failure.trim());
    if (diag !== undefined) setDiagnosis(diag);
  };

  const replanningElsewhere = !replan.running && jobKind === 'replan';
  const replanning = replan.running || replanningElsewhere;

  const record = (andReplan: boolean) => {
    const text = draft.trim();
    if (!text) return;
    reportFailure(node.id, text);
    setOpening(false);
    if (andReplan && !pendingElsewhere) void runReplan(text);
  };

  const cancelReport = () => {
    setOpening(false);
    clearDraft(node.id, 'failure');
  };

  const goToPending = pendingNode ? (
    <button
      type="button"
      onClick={() => selectNode(pendingNode.id)}
      className="tap w-full text-[11px] bg-ai-accent/10 hover:bg-ai-accent/25 text-ai-accent border border-ai-accent/40 rounded-sm py-1.5 transition-colors"
    >
      {tr.groundTruth.viewPendingIn(pendingNode.name)} →
    </button>
  ) : null;

  const body = (
    <>
      {!failed && !opening && (
        <button
          type="button"
          onClick={() => setOpening(true)}
          className="tap w-full text-[11px] text-text-muted hover:text-state-problem border border-dashed border-border-base hover:border-state-problem/40 rounded-sm py-1 transition-colors"
        >
          {tr.groundTruth.failedInPractice}
        </button>
      )}

      {!failed && opening && (
        <div className="space-y-1.5 border border-state-problem/30 rounded-sm p-2 bg-state-problem/5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(node.id, 'failure', e.target.value)}
            onKeyDown={submitOnModEnter(() => record(true))}
            rows={3}
            aria-label={tr.groundTruth.failureContextLabel}
            placeholder={tr.groundTruth.failurePlaceholder}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-state-problem outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {pendingElsewhere ? (
              <button
                type="button"
                onClick={() => record(false)}
                disabled={!draft.trim()}
                className="tap flex-1 text-[11px] bg-state-problem/15 hover:bg-state-problem/30 disabled:opacity-40 text-state-problem border border-state-problem/40 rounded-sm py-1 transition-colors"
              >
                {tr.groundTruth.recordFailure}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => record(true)}
                  disabled={!draft.trim()}
                  title={tr.groundTruth.submitHint}
                  className="tap flex-1 text-[11px] bg-state-problem/15 hover:bg-state-problem/30 disabled:opacity-40 text-state-problem border border-state-problem/40 rounded-sm py-1 transition-colors"
                >
                  {tr.groundTruth.registerAndReplan}
                </button>
                <button
                  type="button"
                  onClick={() => record(false)}
                  disabled={!draft.trim()}
                  className="tap text-[11px] text-text-muted hover:text-state-problem disabled:opacity-40 border border-border-base rounded-sm px-2 py-1 transition-colors"
                >
                  {tr.groundTruth.recordOnly}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={cancelReport}
              className="tap text-[11px] text-text-muted hover:text-text-secondary border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.common.cancel.toLowerCase()}
            </button>
          </div>
          {pendingElsewhere && goToPending}
        </div>
      )}

      {failed && (
        <div className="space-y-2">
          <div className="text-xs bg-state-problem/5 border border-state-problem/30 rounded-sm px-2 py-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-state-problem mb-0.5">
              {tr.groundTruth.failureContextLabel}
            </div>
            <div className="text-text-primary break-words">{node.failureContext}</div>
            {node.failureReportedAt && (
              <div className="text-[10px] font-mono text-text-muted mt-1">
                {new Date(node.failureReportedAt).toLocaleString(tr.detail.locale)}
              </div>
            )}
          </div>

          {pendingHere && diagnosis && (
            <div className="text-xs bg-ai-accent/5 border border-ai-accent/30 rounded-sm px-2 py-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-0.5">
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
          ) : pendingElsewhere ? (
            goToPending
          ) : pendingHere ? (
            <div className="text-[10px] font-mono text-ai-accent text-center">
              {tr.groundTruth.pendingHereHint} ↓
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void runReplan(node.failureContext ?? '')}
              className="tap w-full text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 text-ai-accent border border-ai-accent/40 rounded-sm py-1.5 transition-colors flex items-center justify-center gap-2"
            >
              <span>◆</span>
              {tr.groundTruth.replanWithFailure}
            </button>
          )}

          {replan.error && (
            <InlineError
              error={replan.error}
              onRetry={() => void runReplan(node.failureContext ?? '')}
            />
          )}

          <button
            type="button"
            onClick={() => clearFailure(node.id)}
            className="tap w-full text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border-base rounded-sm py-1 transition-colors"
          >
            {tr.groundTruth.clearFailure}
          </button>
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
    <section id={domIds ? 'gt-failure' : undefined} className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.reality}
        </label>
        {failed && (
          <span className="text-[10px] font-mono text-state-problem ml-auto">{tr.groundTruth.failed}</span>
        )}
      </div>
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card "Como saber que deu certo" do tutor: ① critério aberto; provas,
// segunda opinião e falha recolhidas com resumo de uma linha.
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
    <div className="mt-6 border-t border-border-base pt-6 space-y-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
        ◆ {tr.groundTruth.sectionTitle}
      </div>
      <div className="rounded-sm border border-border-base bg-bg-secondary overflow-hidden">
        <UserCriterionField node={node} domIds />
        <GroundTruthRefsList node={node} project={project} collapsible />
        <CritiqueSection node={node} project={project} collapsible />
        <FailureSection node={node} project={project} collapsible domIds />
      </div>
    </div>
  );
}
