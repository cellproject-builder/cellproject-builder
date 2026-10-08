import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';

type SnapPoint = number | string;

const DEFAULT_SNAP_POINTS: SnapPoint[] = [0.45, 0.92];

interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  snapPoints?: SnapPoint[];
  description?: string;
  // Ações fixas no pé do sheet, fora da área rolável — a ação principal fica
  // visível sem rolar, em qualquer snap.
  footer?: ReactNode;
  // O conteúdo já mostra o título (ex.: nome editável) — fica só para leitor de tela.
  titleHidden?: boolean;
  // Sempre modal (scrim em todos os snaps; tocar no scrim fecha). Para sheets
  // que não precisam do fundo tocável, como a árvore do tutor.
  alwaysModal?: boolean;
}

export function MobileSheet({
  open,
  onOpenChange,
  title,
  children,
  snapPoints,
  description,
  footer,
  titleHidden,
  alwaysModal,
}: MobileSheetProps) {
  const snaps = snapPoints ?? DEFAULT_SNAP_POINTS;
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(snaps[0]);

  useEffect(() => {
    if (open) setActiveSnap(snaps[0]);
  }, [open, snaps]);

  // No snap baixo o sheet não é modal: o grafo continua visível e tocável
  // (dá pra tocar em outro nó). Só o snap mais alto escurece o fundo.
  const lastSnap = snaps[snaps.length - 1];
  const modal = alwaysModal || activeSnap === lastSnap;

  // Nos snaps, o vaul translada o Content (96% da tela) para baixo e o pé
  // dele fica fora da tela. Medimos quanto ficou escondido e subimos o footer
  // (e damos o mesmo respiro à área rolável) — estimativa imediata pela
  // fração do snap, corrigida pela medida real ao fim da animação.
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef(activeSnap);
  snapRef.current = activeSnap;
  const [hiddenPx, setHiddenPx] = useState(0);
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const est = estimateHiddenPx(snapRef.current);
    let px = Math.round(r.bottom - window.innerHeight);
    // Medida no meio de uma animação/resize (Content ainda fora da tela ou
    // transladado para o snap antigo): vale a estimativa pelo snap ativo.
    if (Math.abs(px - est) > 64) px = est;
    // Nunca esconder mais do que o sheet tem acima do footer.
    const footerH = footerRef.current?.offsetHeight ?? 0;
    const max = Math.max(0, Math.round(r.height - footerH - 48));
    setHiddenPx(Math.min(Math.max(0, px), max));
  }, []);
  useEffect(() => {
    if (!open || !footer) return;
    setHiddenPx(estimateHiddenPx(activeSnap));
    // Mede quando o Content parar de se mover (fim da animação do vaul), em
    // vez de num instante fixo que pode cair no meio dela.
    let raf = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      cancelAnimationFrame(raf);
      const start = performance.now();
      let last = NaN;
      let still = 0;
      const tick = () => {
        const el = contentRef.current;
        const b = el ? el.getBoundingClientRect().bottom : NaN;
        still = Math.abs(b - last) < 0.5 ? still + 1 : 0;
        last = b;
        if (still >= 6 || performance.now() - start > 1500) {
          measure();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    t = setTimeout(settle, 120);
    // Resize/rotação: estimativa imediata e nova medida depois que o vaul
    // reposiciona o Content no snap.
    const onResize = () => {
      setHiddenPx(estimateHiddenPx(snapRef.current));
      clearTimeout(t);
      t = setTimeout(settle, 120);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
    // footer só importa como presença
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSnap, measure, !!footer]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snaps}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
      modal={modal}
      {...(alwaysModal ? { fadeFromIndex: 0 } : {})}
      repositionInputs
      onAnimationEnd={() => measure()}
    >
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="scrim animate-scrim-in fixed inset-0 z-40" />}
        <Drawer.Content ref={contentRef} className="glass-host bg-glass/95 fixed inset-x-0 bottom-0 z-50 flex h-[96%] flex-col rounded-t-window border-t outline-none shadow-mac-lg">
          <div
            aria-hidden
            className="mx-auto mt-2 mb-1.5 h-[5px] w-9 flex-shrink-0 rounded-full bg-text-faint/40"
          />
          <Drawer.Title
            className={
              titleHidden ? 'sr-only' : 'px-4 pt-1 pb-2 text-title3 font-semibold text-text-primary truncate'
            }
          >
            {title}
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {description ?? title}
          </Drawer.Description>
          <div
            className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${
              footer ? '' : 'pb-[env(safe-area-inset-bottom)]'
            }`}
            style={footer && hiddenPx > 0 ? { paddingBottom: hiddenPx } : undefined}
          >
            {children}
          </div>
          {footer && (
            <div
              ref={footerRef}
              className="relative shrink-0 border-t border-border-base/70 bg-glass after:absolute after:inset-x-0 after:top-full after:h-screen after:bg-glass px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
              style={hiddenPx > 0 ? { transform: `translateY(-${hiddenPx}px)` } : undefined}
            >
              {footer}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Estimativa antes da medida, com a mesma conta do vaul: no snap s ele
// translada o Content em innerHeight * (1 - s) a partir da posição aberta
// (bottom: 0), então é isso que fica abaixo da tela — independe dos 96%.
function estimateHiddenPx(activeSnap: SnapPoint | null): number {
  if (typeof activeSnap !== 'number' || typeof window === 'undefined') return 0;
  return Math.round(Math.max(0, window.innerHeight * (1 - activeSnap)));
}
