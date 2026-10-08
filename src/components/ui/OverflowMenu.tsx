import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface OverflowMenuItem {
  key: string;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  // Ícone/glyph à esquerda (ex.: ✦ em ai-accent para ações de IA).
  icon?: ReactNode;
  iconClassName?: string;
  // Visível só abaixo de sm (o item já aparece como botão no desktop).
  mobileOnly?: boolean;
}

interface OverflowMenuProps {
  label: string;
  items: OverflowMenuItem[];
  // Abre para cima (barras de rodapé) ou para baixo (cabeçalhos).
  placement?: 'up' | 'down';
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
}

// Menu "…" estilo macOS: vidro, realce accent sólido, Esc/clique fora fecham e
// devolvem o foco; setas navegam entre os itens.
export function OverflowMenu({
  label,
  items,
  placement = 'down',
  align = 'right',
  className,
  buttonClassName,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Só o teclado leva o foco ao primeiro item (como no macOS); com o ponteiro,
  // o realce segue o hover e nenhum item abre destacado.
  const openedByKeyboard = useRef(false);

  useEffect(() => {
    if (!open) return;
    const list = () =>
      Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []).filter(
        (el) => el.offsetParent !== null,
      );
    if (openedByKeyboard.current) list()[0]?.focus();
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = list();
        if (els.length === 0) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        const next =
          i < 0
            ? e.key === 'ArrowDown'
              ? 0
              : els.length - 1
            : e.key === 'ArrowDown'
            ? (i + 1) % els.length
            : (i - 1 + els.length) % els.length;
        els[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (items.length === 0) return null;
  const onlyMobile = items.every((i) => i.mobileOnly);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${onlyMobile ? 'sm:hidden' : ''} ${className ?? ''}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          // detail === 0: ativado por Enter/Espaço, não por clique.
          openedByKeyboard.current = e.detail === 0;
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openedByKeyboard.current = true;
            setOpen(true);
          }
        }}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`tap btn btn-icon ${buttonClassName ?? 'btn-secondary'} ${open ? '!bg-bg-elevated !text-text-primary' : ''}`}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="3" cy="7" r="1.25" />
          <circle cx="7" cy="7" r="1.25" />
          <circle cx="11" cy="7" r="1.25" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`glass bg-glass/90 border absolute z-40 w-max min-w-[200px] max-w-[min(300px,calc(100vw-24px))] rounded-card shadow-mac-lg p-1 animate-sheet-in ${
            placement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${align === 'right' ? 'right-0' : 'left-0'} ${
            placement === 'up'
              ? align === 'right'
                ? 'origin-bottom-right'
                : 'origin-bottom-left'
              : align === 'right'
              ? 'origin-top-right'
              : 'origin-top-left'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`tap group w-full text-left px-2.5 min-h-[28px] [@media(pointer:coarse)]:min-h-[44px] py-1 text-control rounded-chip text-text-primary outline-none transition-colors duration-120 ease-mac flex items-center gap-2 hover:bg-accent-solid hover:text-accent-fg focus-visible:bg-accent-solid focus-visible:text-accent-fg focus-visible:outline-none disabled:opacity-45 disabled:pointer-events-none ${
                item.mobileOnly ? 'sm:hidden' : ''
              }`}
            >
              {item.icon && (
                <span
                  aria-hidden
                  className={`w-4 shrink-0 text-center group-hover:!text-accent-fg group-focus-visible:!text-accent-fg ${
                    item.iconClassName ?? 'text-text-muted'
                  }`}
                >
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
