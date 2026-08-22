/**
 * WCAG 2.x contrast math + Candice token extraction (FIX-008 a11y matrix).
 *
 * Zero dependencies, plain node. Shared by the static and live contrast
 * legs so both compare against the same thresholds with the same math.
 *
 * Thresholds (WCAG 2.1):
 *   - 4.5:1 normal text (AA)
 *   - 3.0:1 large text (>= 24px, or >= 18.66px bold) and UI components
 *   - 7.0:1 enhanced (AAA)
 */

/** Parse a #rgb / #rrggbb hex string. Throws on malformed input. */
export function hexToRgb(hex) {
  const h = String(hex).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Parse any CSS color the live leg can return (rgb()/rgba()/hex). */
export function parseCssColor(value) {
  const v = String(value).trim();
  if (v.startsWith('#')) return hexToRgb(v);
  const m = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  throw new Error(`unparseable CSS color: ${value}`);
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance(rgb) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colors (order-independent, 1..21). */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export const THRESHOLDS = Object.freeze({
  normalText: 4.5,
  largeTextOrUi: 3.0,
  aaa: 7.0,
});

/**
 * Extract `--candice-*` token definitions from a stylesheet text.
 * Returns a map of token name -> raw value (e.g. `--candice-text` -> `#faf7ff`).
 */
export function extractCssTokens(cssText) {
  const tokens = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/**
 * Resolve a token value through the token map (one level of var()
 * indirection, enough for the captions style text).
 */
export function resolveToken(tokens, value) {
  let v = String(value).trim();
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m && tokens.has(m[1])) v = tokens.get(m[1]);
  return v;
}
