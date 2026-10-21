/**
 * Shades derived from the site's primary colour. Colours are "r g b" triplets,
 * the form the theme tokens use (`rgb(var(--color-gray-200) / 0.7)`).
 *
 * The neutral scale keeps fixed OKLCH lightness steps and takes its hue from
 * the primary colour, with a small chroma that follows the primary's own: a
 * vivid brand tints the greys, a grey brand leaves them grey.
 */

type Rgb = readonly [number, number, number];

/** Lightness and tint chroma for each step of the neutral scale. */
const NEUTRAL_STEPS = [
  [50, 0.985, 0.006],
  [100, 0.965, 0.009],
  [200, 0.92, 0.013],
  [300, 0.87, 0.017],
  [400, 0.71, 0.024],
  [500, 0.555, 0.028],
  [600, 0.445, 0.03],
  // The darkest steps carry half the tint: they fill code cards and the
  // dark page, which read as charcoal with a hint of the brand, not as brown
  // or navy.
  [700, 0.37, 0.016],
  [800, 0.28, 0.015],
  [900, 0.21, 0.013],
  [950, 0.15, 0.01],
] as const;

/** The dark-mode page background, one step below the darkest neutral. */
const DARK_BACKGROUND = [0.14, 0.006] as const;

/** A primary with this OKLCH chroma or more tints the scale at full strength. */
const FULL_TINT_CHROMA = 0.1;

export interface ShadedNeutrals {
  /** Neutral scale keyed by step, 50 to 950. */
  gray: Record<number, string>;
  /** Dark-mode page background. */
  backgroundDark: string;
}

export function shadedNeutrals(primary: string): ShadedNeutrals {
  const [, chroma, hue] = rgbToOklch(parseRgb(primary));
  const strength = Math.min(1, chroma / FULL_TINT_CHROMA);
  const shade = (lightness: number, tint: number) =>
    oklchToRgb(lightness, tint * strength, hue).join(" ");
  return {
    gray: Object.fromEntries(NEUTRAL_STEPS.map(([step, l, c]) => [step, shade(l, c)])),
    backgroundDark: shade(...DARK_BACKGROUND),
  };
}

/** Text reads at this contrast or more (WCAG AA for body text). */
const TEXT_CONTRAST = 4.5;
const READER_HUE = (286 * Math.PI) / 180;
/** The light pages that primary-coloured text sits on: the page and the reader theme's paper. */
const LIGHT_PAGES: readonly Rgb[] = [[255, 255, 255], [247, 248, 251]];
/** The dark pages for the same text: the dark page and the reader theme's dark paper. */
const DARK_PAGES: readonly Rgb[] = [[11, 12, 16], [20, 22, 28]];
/** The reader theme's selection, behind its current chapter, in each scheme. */
const LIGHT_SELECTION = oklchToRgb(0.93, 0.025, READER_HUE);
const DARK_SELECTION = oklchToRgb(0.27, 0.04, READER_HUE);
/** The strongest tint of the colour itself laid on a page behind text in it, an active item's background. */
const LIGHT_TINT = 0.12;
const DARK_TINT = 0.14;

export interface TextShades {
  /** For text on light surfaces, and fills behind white text. */
  ink: string;
  /** For text on dark surfaces. */
  light: string;
}

/**
 * The primary colour as text in each scheme: the colour itself where it
 * reads, otherwise the nearest OKLCH lightness of its hue and chroma that
 * does, darker for light surfaces and lighter for dark ones.
 */
export function textShades(primary: string): TextShades {
  const colour = parseRgb(primary);
  return {
    ink: readableShade(colour, LIGHT_PAGES, LIGHT_SELECTION, LIGHT_TINT, -1),
    light: readableShade(colour, DARK_PAGES, DARK_SELECTION, DARK_TINT, 1),
  };
}

function readableShade(colour: Rgb, pages: readonly Rgb[], selection: Rgb, tint: number, direction: 1 | -1): string {
  const reads = (candidate: Rgb) =>
    contrast(candidate, selection) >= TEXT_CONTRAST &&
    pages.every((page) => contrast(candidate, page) >= TEXT_CONTRAST && contrast(candidate, blend(candidate, page, tint)) >= TEXT_CONTRAST);
  if (reads(colour)) return colour.join(" ");
  const [lightness, chroma, hue] = rgbToOklch(colour);
  for (let next = lightness; next >= 0 && next <= 1; next += direction * 0.005) {
    const candidate = oklchToRgb(next, chroma, hue);
    if (reads(candidate)) return candidate.join(" ");
  }
  return direction < 0 ? "0 0 0" : "255 255 255";
}

/** WCAG contrast ratio of two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** `colour` at `alpha` over `base`, composited as CSS composites a translucent fill. */
function blend(colour: Rgb, base: Rgb, alpha: number): Rgb {
  const channel = (i: 0 | 1 | 2) => Math.round(colour[i] * alpha + base[i] * (1 - alpha));
  return [channel(0), channel(1), channel(2)];
}

function parseRgb(triplet: string): Rgb {
  const parts = triplet.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid colour triplet: "${triplet}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

/** sRGB to OKLCH: lightness, chroma and hue in radians. */
export function rgbToOklch([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH to sRGB, clamped into the sRGB gamut. */
export function oklchToRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const A = chroma * Math.cos(hue);
  const B = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (lightness - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (lightness - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
