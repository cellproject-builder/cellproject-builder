import { useEffect, useState, type ReactNode } from 'react';
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
}

export function MobileSheet({
  open,
  onOpenChange,
  title,
  children,
  snapPoints,
  description,
}: MobileSheetProps) {
  const snaps = snapPoints ?? DEFAULT_SNAP_POINTS;
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(snaps[0]);

  useEffect(() => {
    if (open) setActiveSnap(snaps[0]);
  }, [open, snaps]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snaps}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
      repositionInputs
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[96%] flex-col rounded-t-2xl border border-b-0 border-border-base bg-bg-secondary outline-none">
          <div
            aria-hidden
            className="mx-auto mt-2 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-border-base"
          />
          <Drawer.Title className="px-4 py-2 text-sm font-semibold text-text-primary">
            {title}
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {description ?? title}
          </Drawer.Description>
          <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
