import { useEffect, useState, type RefObject } from 'react';
import { resolveOrientation, type Orientation } from './autoLayout';

export function useCanvasSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0, orientation: 'vertical' as Orientation });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth, height = el.clientHeight;
      if (width <= 0 || height <= 0) return;
      setSize((previous) => width === previous.width && height === previous.height ? previous : {
        width, height, orientation: resolveOrientation(width, height, previous.width ? previous.orientation : undefined),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
