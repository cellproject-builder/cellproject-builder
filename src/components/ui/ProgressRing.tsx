// ---------------------------------------------------------------------------
// Anel de progresso da decomposição (o elemento "memorável" da toolbar).
// Fino e monocromático: trilho hairline, arco accent para concluído e, por
// cima a partir do topo, o segmento verde do que foi concluído COM prova.
// Anima (stroke-dasharray) quando os números mudam; respeita reduced-motion
// via a regra global do index.css.
// ---------------------------------------------------------------------------

export interface ProgressRingProps {
  /** Total de folhas/itens. */
  total: number;
  /** Concluídos com prova (subconjunto de `done`). */
  withProof: number;
  /** Concluídos (com ou sem prova). */
  done: number;
  /** Diâmetro em px (padrão 22). */
  size?: number;
  /** Espessura do traço em px (padrão 2.5). */
  strokeWidth?: number;
  /** Nome acessível; padrão "done/total". Passe um texto traduzido. */
  label?: string;
  className?: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function ProgressRing({
  total,
  withProof,
  done,
  size = 22,
  strokeWidth = 2.5,
  label,
  className,
}: ProgressRingProps) {
  const safeTotal = Math.max(0, total);
  const doneFrac = safeTotal > 0 ? clamp01(done / safeTotal) : 0;
  const proofFrac = safeTotal > 0 ? Math.min(doneFrac, clamp01(withProof / safeTotal)) : 0;
  const complete = safeTotal > 0 && done >= safeTotal;

  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  // pathLength=100 deixa o dasharray em porcentagem.
  const dash = (frac: number) => `${(frac * 100).toFixed(2)} 100`;
  const arc = 'transition-[stroke-dasharray] duration-[600ms] ease-mac';

  return (
    <svg
      role="img"
      aria-label={label ?? `${done}/${total}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`shrink-0 ${className ?? ''}`}
    >
      <g transform={`rotate(-90 ${c} ${c})`} fill="none" strokeWidth={strokeWidth}>
        <circle cx={c} cy={c} r={r} className="stroke-border-base" />
        <circle
          cx={c}
          cy={c}
          r={r}
          pathLength={100}
          strokeLinecap="round"
          strokeDasharray={dash(doneFrac)}
          strokeOpacity={doneFrac > 0 ? 1 : 0}
          className={`stroke-accent ${arc}`}
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          pathLength={100}
          strokeLinecap="round"
          strokeDasharray={dash(proofFrac)}
          strokeOpacity={proofFrac > 0 ? 1 : 0}
          className={`stroke-state-done ${arc}`}
        />
      </g>
      {complete && size >= 16 && (
        <path
          d={`M ${c - r * 0.42} ${c + r * 0.02} L ${c - r * 0.1} ${c + r * 0.34} L ${c + r * 0.45} ${c - r * 0.3}`}
          pathLength={1}
          strokeDasharray="1"
          fill="none"
          strokeWidth={Math.max(1.5, strokeWidth * 0.7)}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`animate-check-draw ${proofFrac >= doneFrac ? 'stroke-state-done' : 'stroke-accent'}`}
        />
      )}
    </svg>
  );
}
