import type { DiagramElement } from './model';

export type RGB = [number, number, number];
export interface DiagramPalette { background: RGB; foreground: RGB }
type Paint = { rgb: RGB; alpha: number };

export function parsePaint(value: string | undefined, currentColor: RGB): Paint | null {
  if (value === 'none') return null;
  if (value === 'currentColor') return { rgb: currentColor, alpha: 1 };
  if (!value) return { rgb: [0, 0, 0], alpha: 1 }; // SVG's default fill.
  if (/^#[\da-f]{3}$/i.test(value)) value = `#${[...value.slice(1)].map(c => c + c).join('')}`;
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return {
    rgb: [1, 3, 5].map(index => parseInt(value!.slice(index, index + 2), 16)) as RGB,
    alpha: value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1,
  };
  const css = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
  return css ? { rgb: css.slice(1, 4).map(Number) as RGB, alpha: css[4] === undefined ? 1 : Number(css[4]) } : null;
}

export function composite(paint: Paint, background: RGB): RGB {
  return paint.rgb.map((channel, index) => channel * paint.alpha + background[index] * (1 - paint.alpha)) as RGB;
}
function luminance(rgb: RGB) {
  const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a: RGB, b: RGB) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}
function readablePaint(value: string, background: RGB, foreground: RGB) {
  const paint = parsePaint(value, foreground);
  if (!paint || paint.alpha === 0 || contrast(composite(paint, background), background) >= 4.5) return value;
  const white: RGB = [255, 255, 255], black: RGB = [0, 0, 0];
  const target = contrast(white, background) > contrast(black, background) ? white : black;
  const targetContrast = Math.min(7.05, contrast(target, background));
  // Change only insufficient colors, keeping as much of the original hue as possible.
  let low = 0, high = 1;
  const mix = (amount: number) => paint.rgb.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)) as RGB;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (contrast(mix(middle), background) >= targetContrast) high = middle; else low = middle;
  }
  return `#${mix(high).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Filled cards use resolved geometry, so slider-driven positions also affect label contrast.
 * Arbitrary path interiors are not inferred. No document/persisted color is modified. */
export function readableDiagramElements(elements: DiagramElement[], palette: DiagramPalette): DiagramElement[] {
  return elements.map((element, index) => {
    if (element.type !== 'text') return element;
    const x = element.x! + 1, y = element.y! - (element.fontSize ?? 16) / 2;
    let background = palette.background;
    for (const shape of elements.slice(0, index)) {
      const inside = shape.type === 'rect'
        ? x >= shape.x! && x <= shape.x! + shape.width! && y >= shape.y! && y <= shape.y! + shape.height!
        : shape.type === 'circle' && (x - shape.cx!) ** 2 + (y - shape.cy!) ** 2 <= shape.r! ** 2;
      const paint = inside ? parsePaint(shape.fill, palette.foreground) : null;
      if (paint) background = composite(paint, background);
    }
    return { ...element, fill: readablePaint(element.fill ?? 'currentColor', background, palette.foreground),
      ...(element.stroke ? { stroke: readablePaint(element.stroke, background, palette.foreground) } : {}) };
  });
}
