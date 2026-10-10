import { useLayoutEffect, useState, type RefObject } from 'react';
import { useThemeStore, type Theme } from '@/theme';
import { composite, parsePaint, type DiagramPalette } from './contrast';

// Fallbacks for SSR/tests without stylesheets; the mounted view reads the actual CSS surfaces.
const fallback = (theme: Theme): DiagramPalette => ({
  background: theme === 'light' ? [245, 245, 247] : theme === 'dark' ? [28, 28, 30] : [0, 0, 0],
  foreground: theme === 'light' ? [29, 29, 31] : [245, 245, 247],
});

export function useDiagramPalette(ref: RefObject<HTMLDivElement>, valid: boolean) {
  const theme = useThemeStore(state => state.theme);
  const [palette, setPalette] = useState(() => fallback(theme));
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const next = fallback(theme), svg = host.querySelector('svg');
    next.foreground = parsePaint(getComputedStyle(svg ?? host).color, next.foreground)?.rgb ?? next.foreground;
    const layers = [];
    for (let ancestor: Element | null = host; ancestor; ancestor = ancestor.parentElement) {
      const paint = parsePaint(getComputedStyle(ancestor).backgroundColor, next.foreground);
      if (paint) layers.push(paint);
    }
    for (const layer of layers.reverse()) next.background = composite(layer, next.background);
    setPalette(next);
  }, [theme, valid, ref]);
  return palette;
}
