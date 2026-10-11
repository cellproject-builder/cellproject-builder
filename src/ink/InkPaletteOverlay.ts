import { createContext } from 'react';

export type InkPaletteDock = 'left' | 'right' | 'top' | 'bottom';

// Popovers stay inside the palette's event boundary, outside its scrolling rail.
export const InkPaletteOverlayContext = createContext<{
  target: HTMLDivElement | null;
  dock: InkPaletteDock;
} | null>(null);
