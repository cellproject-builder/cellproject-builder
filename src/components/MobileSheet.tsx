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
}: MobileSheetProps) {
  const snaps = snapPoints ?? DEFAULT_SNAP_POINTS;
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(snaps[0]);

  useEffect(() => {
    if (open) setActiveSnap(snaps[0]);
  }, [open, snaps]);

  // No snap baixo o sheet não é modal: o grafo continua visível e tocável
  // (dá pra tocar em outro nó). Só o snap mais alto escurece o fundo.
  const lastSnap = snaps[snaps.length - 1];
  const modal = activeSnap === lastSnap;

  // Nos snaps, o vaul translada o Content (96% da tela) para baixo e o pé
  // dele fica fora da tela. Medimos quanto ficou escondido e subimos o footer
  // (e damos o mesmo respiro à área rolável) — estimativa imediata pela
  // fração do snap, corrigida pela medida real ao fim da animação.
  const contentRef = useRef<HTMLDivElement>(null);
  const [hiddenPx, setHiddenPx] = useState(0);
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setHiddenPx(Math.max(0, Math.round(r.bottom - window.innerHeight)));
  }, []);
  useEffect(() => {
    if (!open || !footer) return;
    setHiddenPx(estimateHiddenPx(activeSnap));
    const t = setTimeout(measure, 550);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
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
      repositionInputs
      onAnimationEnd={() => measure()}
    >
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />}
        <Drawer.Content ref={contentRef} className="fixed inset-x-0 bottom-0 z-50 flex h-[96%] flex-col rounded-t-2xl border border-b-0 border-border-base bg-bg-secondary outline-none shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
          <div
            aria-hidden
            className="mx-auto mt-2 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-border-base"
          />
          <Drawer.Title
            className={
              titleHidden ? 'sr-only' : 'px-4 py-2 text-sm font-semibold text-text-primary truncate'
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
              className="shrink-0 border-t border-border-base bg-bg-secondary px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
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

// Estimativa antes da medida: o Content tem 96% de window.innerHeight e só a
// fração do snap fica visível.
function estimateHiddenPx(activeSnap: SnapPoint | null): number {
  if (typeof activeSnap !== 'number' || typeof window === 'undefined') return 0;
  return Math.round(Math.max(0, window.innerHeight * (0.96 - activeSnap)));
}
