/**
 * WS-15 harness — candidate filtering / rejection gates.
 *
 * The acceptance criteria are BINARY: a candidate asset either passes the
 * transparency/edge-quality gates for BOTH light and dark desktop
 * backgrounds, or it does not. Every gate here is a pure predicate over
 * decoded RGBA so the harness runs with zero DOM and zero dependencies
 * (Node 22.6+ type stripping; `node --test tests/visual/transparency.test.ts`).
 *
 * Gate constants were derived from measuring the actual supplied pack
 * (measured, not invented). The pack's measured extremes:
 *
 *   backdrop wash      : max 1.40% (light) / 1.02% (dark) of alpha>=32 px
 *   hard alpha cut     : 0.000% of horizontal adjacent pairs (all 17)
 *   isolated dust px   : 1 (06-mouth-wide-open.png, px (453,1) alpha=8
 *                        rgb(8,8,8); gate at 500 — far below, recorded)
 *   interior holes     : 0 px (any)
 *   border opacity     : all 4 edges fully transparent on 6/17 assets
 *                        (02, 03, 04, 11, 13, 17); the other 11 touch only
 *                        the BOTTOM edge (character crop contact, bottom
 *                        opaque share 0.20%..79.51%, alpha>=8), corners stay
 *                        0..1 in all 17 (QC probe 2026-08-21).
 *   corner alpha       : max 1 (pack); full-bleed flattens are 255.
 *   fringe (semi px)   : mean alpha ~124..136; mean luma ~110
 *                        (|luma - 242 light| ~132, |luma - 22 dark| ~88).
 *
 * So the discriminating gates (every one fails a synthetic known-bad
 * candidate; see transparency.test.ts negative results):
 *
 *  - corner alpha < 8        : catches flattened-on-black (alpha 255
 *    everywhere) and matte-frame candidates regardless of hue.
 *  - at most ONE "heavy" edge : an edge whose opaque share >= 8%. A baked
 *    box or letterbox is >= 2 heavy edges; the pack never exceeds one, and
 *    its single heavy edge is always the bottom (character crop contact).
 *  - full-border share < 98% : a fully opaque border rectangle.
 *  - backdrop wash share < 12% per backdrop : the pixel is invisible on
 *    that backdrop (spec 11B: preserve alphas; a washed edge fails on the
 *    backdrop it washes into).
 *  - hard alpha cut < 0.15% : matte edges instead of anti-aliased ones.
 *  - interior holes <= 4 px  : fully-transparent patches surrounded by
 *    solid pixels become visible specks when scaled down at runtime.
 *  - dust <= 500 px          : lone semi pixels with no alpha neighbor.
 *  - fringe mean alpha >= 32 : nominal semi-transparency matters.
 *  - fringe luma delta >= 5  : fringe mean raw luma must differ from the
 *    backdrop luma (a transparent halo lets the desktop show through as a
 *    pure color gradient — that is intended; a halo that literally MATCHES
 *    the backdrop on one side is the "invisible on light OR dark" defect).
 *  - light/dark verdicts AGREE (binary E.1: both backgrounds).
 *
 * The gate list and thresholds are constants on purpose (binary criteria);
 * the harness never tunes thresholds at runtime.
 */

export interface RgbaView {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** alpha(x, y) */
  a(x: number, y: number): number;
  /** r/g/b at (x, y) */
  rgb(x: number, y: number): [number, number, number];
}

export function viewOf(f: { width: number; height: number; rgba: Uint8Array }): RgbaView {
  const { width, height, rgba } = f;
  if (rgba.length !== width * height * 4) {
    throw new Error(`rgba length ${rgba.length} != ${width}*${height}*4`);
  }
  return {
    width,
    height,
    rgba,
    a(x: number, y: number): number {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      return rgba[(y * width + x) * 4 + 3];
    },
    rgb(x: number, y: number): [number, number, number] {
      const i = (y * width + x) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2]];
    },
  };
}

/** Standard backdrop colors (light / dark). */
export const BACKDROP_LIGHT = { r: 242, g: 242, b: 242 };
export const BACKDROP_DARK = { r: 22, g: 22, b: 22 };

/** Composite a pixel over a backdrop; returns the resulting color. */
export function compositeOver(
  px: [number, number, number],
  alpha: number,
  bg: { r: number; g: number; b: number },
): [number, number, number] {
  const aa = alpha / 255;
  return [
    px[0] * aa + bg.r * (1 - aa),
    px[1] * aa + bg.g * (1 - aa),
    px[2] * aa + bg.b * (1 - aa),
  ];
}

export function meanColor(rgb: [number, number, number]): number {
  return (rgb[0] + rgb[1] + rgb[2]) / 3;
}

// ---- Gate constants (binary; see header comment). -------------------------

export const GATE = {
  /** Pixel is "visible" against a backdrop when its alpha >= this. */
  visibleAlpha: 32,
  /** |composited - backdrop| mean over RGB must be > this to be visible. */
  washEps: 4,
  /** Max share of visible pixels that wash out (per backdrop). */
  washShareMax: 0.12,
  /** Alpha jump (adjacent px) >= this counts as a hard cut. */
  hardCutDelta: 128,
  /** Max hard-cut share of horizontal edges. */
  hardCutShareMax: 0.0015,
  /** Max alpha of any of the 4 corner pixels (baked boxes have 255). */
  cornerAlphaMax: 8,
  /** Border-cell alpha >= this counts as an opaque border cell. */
  borderOpaque: 8,
  /** An edge whose opaque share >= this is a "heavy" edge. */
  heavyEdgeShareThreshold: 0.08,
  /** Baked box / letterbox has >= 2 heavy edges. Pack max: 1 (bottom). */
  heavyEdgesMax: 1,
  /** A fully opaque border rectangle (share >= this) fails outright. */
  fullBorderShareMax: 0.98,
  /** Alpha >= this counts as px in a solid run. */
  solidAlpha: 250,
  /** Interior hole: contiguous region of pixels with alpha < holeAlpha... */
  holeAlpha: 16,
  /** ...whose 1px-expanded bounding ring is all >= holeRingAlpha. */
  holeRingAlpha: 200,
  /** Hole regions smaller than this (px) are ignored (AA between limbs). */
  holeMinRegionPx: 36,
  /** Hole region must keep this margin from the image edge. */
  holeMargin: 4,
  /** Max total hole pixels (all regions). */
  holePxMax: 4,
  /** Lone semi pixel (alpha 8..246, no 8-neighbor with alpha >= dustMinAlpha). */
  dustMinAlpha: 8,
  dustMaxAlpha: 246,
  /** Max dust pixel count. */
  dustMax: 500,
  /** Fringe = semi-transparent pixels (alpha 8..246). */
  fringeMinAlpha: 8,
  fringeMaxAlpha: 246,
  /** Mean alpha of fringe pixels must be at least this. */
  fringeMeanAlphaMin: 32,
  /** |fringe raw luma - backdrop luma| must be >= this. */
  fringeLumaMin: 5,
} as const;

export interface EdgeShares {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface GateMeasurement {
  /** Share of alpha>=visibleAlpha pixels lost into the backdrop. */
  washShare: number;
  /** Hard alpha-cut share of horizontal adjacent pairs. */
  hardCutShare: number;
  /** Opaque share per border edge. */
  edges: EdgeShares;
  /** Alpha of the 4 corner pixels (TL, TR, BL, BR). */
  corners: [number, number, number, number];
  /** Opaque share of the whole border ring. */
  fullBorderShare: number;
  /** Interior hole pixel count. */
  holePx: number;
  /** Lone semi-transparent pixel count. */
  dustPx: number;
  /** Mean alpha of fringe pixels (8..246). */
  fringeMeanAlpha: number;
  /** |mean fringe raw luma - backdrop luma|. */
  fringeLumaDelta: number;
}

export interface AlphaMeasured {
  min: number;
  max: number;
  mean: number;
}

export interface GateResult {
  pass: boolean;
  measurement: GateMeasurement;
  /** Conditions that failed (empty when pass). */
  failures: string[];
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

/** Full-transparency structural scan (alpha extrema + mean). */
export function alphaStats(f: RgbaView): AlphaMeasured {
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 3; i < f.rgba.length; i += 4) {
    const v = f.rgba[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / (f.rgba.length / 4) };
}

/** Measure every gate metric for a frame against one backdrop. */
export function measure(v: RgbaView, bg: { r: number; g: number; b: number }): GateMeasurement {
  const { width: w, height: h } = v;

  let visible = 0;
  let washed = 0;
  let pairs = 0;
  let hard = 0;
  let dustPx = 0;
  let fringeN = 0;
  let fringeAlphaSum = 0;
  let fringeLumaSum = 0;
  const borderBad = [0, 0, 0, 0]; // top, bottom, left, right
  const edgeLen = [w, w, h, h];
  const cornerA: [number, number, number, number] = [
    v.a(0, 0), v.a(w - 1, 0), v.a(0, h - 1), v.a(w - 1, h - 1),
  ];
  let borderRing = 0;
  let borderRingBad = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const al = v.a(x, y);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        borderRing++;
        const bad = al >= GATE.borderOpaque;
        if (bad) {
          borderRingBad++;
          if (y === 0) borderBad[0]++;
          else if (y === h - 1) borderBad[1]++;
          else if (x === 0) borderBad[2]++;
          else borderBad[3]++;
        }
      }
      if (al >= GATE.visibleAlpha) {
        visible++;
        const [r, g, b] = v.rgb(x, y);
        const [cr, cg, cb] = compositeOver([r, g, b], al, bg);
        const dev = (Math.abs(cr - bg.r) + Math.abs(cg - bg.g) + Math.abs(cb - bg.b)) / 3;
        if (dev < GATE.washEps) washed++;
      }
      if (x > 0) {
        pairs++;
        if (Math.abs(al - v.a(x - 1, y)) >= GATE.hardCutDelta) hard++;
      }
      if (al >= GATE.fringeMinAlpha && al <= GATE.fringeMaxAlpha) {
        fringeN++;
        fringeAlphaSum += al;
        fringeLumaSum += meanColor(v.rgb(x, y));
        let nb = false;
        for (let dy = -1; dy <= 1 && !nb; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (v.a(x + dx, y + dy) >= GATE.dustMinAlpha) {
              nb = true;
              break;
            }
          }
        }
        if (!nb) dustPx++;
      }
    }
  }

  const fringeMeanAlpha = fringeN > 0 ? fringeAlphaSum / fringeN : 0;
  const fringeMeanLuma = fringeN > 0 ? fringeLumaSum / fringeN : 0;
  const bgLuma = meanColor([bg.r, bg.g, bg.b]);

  return {
    washShare: visible > 0 ? washed / visible : 1,
    hardCutShare: pairs > 0 ? hard / pairs : 1,
    edges: {
      top: borderBad[0] / edgeLen[0],
      bottom: borderBad[1] / edgeLen[1],
      left: borderBad[2] / edgeLen[2],
      right: borderBad[3] / edgeLen[3],
    },
    corners: cornerA,
    fullBorderShare: borderRing > 0 ? borderRingBad / borderRing : 1,
    holePx: interiorHolePx(v),
    dustPx,
    fringeMeanAlpha,
    fringeLumaDelta: Math.abs(fringeMeanLuma - bgLuma),
  };
}

/** Number of border edges whose opaque share >= the heavy threshold. */
export function heavyEdgeCount(m: GateMeasurement): number {
  const t = GATE.heavyEdgeShareThreshold;
  let n = 0;
  for (const s of [m.edges.top, m.edges.bottom, m.edges.left, m.edges.right]) {
    if (s >= t) n++;
  }
  return n;
}

/**
 * Interior alpha-hole scan — connected-component (region) based.
 *
 * A hole is a contiguous region of low-alpha pixels (alpha < holeAlpha) of
 * at least holeMinRegionPx, at least holeMargin px away from every image
 * edge, whose 1px-expanded bounding ring is fully opaque (>= holeRingAlpha).
 * Anti-aliasing gaps between limbs are small and do not form opaque rings
 * at this size; a genuine hole (a transparent gap inside a solid body)
 * survives downscaling at runtime and shows as a desktop-colored speck.
 */
export function interiorHolePx(v: RgbaView): number {
  const { width: w, height: h } = v;
  const A = v.a;
  const LOW = GATE.holeAlpha;
  const MINPX = GATE.holeMinRegionPx;
  const MARGIN = GATE.holeMargin;
  const RING = GATE.holeRingAlpha;

  interface Region { x0: number; x1: number; y0: number; y1: number; size: number; }
  const regions: Region[] = [];
  let actives: Region[] = [];

  for (let y = 0; y < h; y++) {
    const newActives: Region[] = [];
    let x = 0;
    while (x < w) {
      if (A(x, y) < LOW) {
        let x1 = x;
        while (x1 + 1 < w && A(x1 + 1, y) < LOW) x1++;
        const touching = actives.filter((r) => r.x1 >= x - 1 && r.x0 <= x1 + 1);
        if (touching.length === 0) {
          const r: Region = { x0: x, x1, y0: y, y1: y, size: x1 - x + 1 };
          regions.push(r);
          newActives.push(r);
        } else {
          const base = touching[0]!;
          base.x0 = Math.min(base.x0, x);
          base.x1 = Math.max(base.x1, x1);
          base.y1 = y;
          base.size += x1 - x + 1;
          for (const o of touching.slice(1)) {
            base.x0 = Math.min(base.x0, o.x0);
            base.x1 = Math.max(base.x1, o.x1);
            base.y1 = Math.max(base.y1, o.y1);
            base.size += o.size;
          }
          newActives.push(base);
        }
        x = x1 + 1;
      } else {
        x++;
      }
    }
    actives = newActives;
  }

  let holePx = 0;
  for (const r of regions) {
    if (r.x0 < MARGIN || r.y0 < MARGIN || r.x1 > w - 1 - MARGIN || r.y1 > h - 1 - MARGIN) continue;
    if (r.size < MINPX) continue;
    const ex0 = r.x0 - 1;
    const ey0 = r.y0 - 1;
    const ex1 = r.x1 + 1;
    const ey1 = r.y1 + 1;
    if (ex0 < 0 || ey0 < 0 || ex1 >= w || ey1 >= h) continue;
    let solid = true;
    for (let x = ex0; x <= ex1; x++) {
      if (A(x, ey0) < RING || A(x, ey1) < RING) { solid = false; break; }
    }
    if (solid) {
      for (let y = ey0; y <= ey1; y++) {
        if (A(ex0, y) < RING || A(ex1, y) < RING) { solid = false; break; }
      }
    }
    if (solid) holePx += r.size;
  }
  return holePx;
}

/** One-backdrop verdict. */
export function gateForBackground(v: RgbaView, bg: { r: number; g: number; b: number }): GateResult {
  const m = measure(v, bg);
  const failures: string[] = [];
  if (m.washShare > GATE.washShareMax) {
    failures.push(`wash share ${pct(m.washShare)} > ${pct(GATE.washShareMax)}`);
  }
  if (m.hardCutShare > GATE.hardCutShareMax) {
    failures.push(`hard edge ${pct(m.hardCutShare)} > ${pct(GATE.hardCutShareMax)}`);
  }
  const cornersOk = m.corners.every((c) => c < GATE.cornerAlphaMax);
  if (!cornersOk) {
    failures.push(`corner opaque: ${m.corners.join('/')} (max ${GATE.cornerAlphaMax})`);
  }
  const heavy = heavyEdgeCount(m);
  if (heavy > GATE.heavyEdgesMax) {
    failures.push(`${heavy} heavy edges (${pct(m.edges.top)}/${pct(m.edges.bottom)}/${pct(m.edges.left)}/${pct(m.edges.right)}) > ${GATE.heavyEdgesMax}`);
  }
  if (m.fullBorderShare > GATE.fullBorderShareMax) {
    failures.push(`full border ${pct(m.fullBorderShare)} > ${pct(GATE.fullBorderShareMax)}`);
  }
  if (m.holePx > GATE.holePxMax) {
    failures.push(`interior leak ${m.holePx}px > ${GATE.holePxMax}px`);
  }
  if (m.dustPx > GATE.dustMax) {
    failures.push(`dust ${m.dustPx}px > ${GATE.dustMax}px`);
  }
  if (m.fringeMeanAlpha < GATE.fringeMeanAlphaMin) {
    failures.push(`fringe mean alpha ${m.fringeMeanAlpha.toFixed(1)} < ${GATE.fringeMeanAlphaMin}`);
  }
  if (m.fringeLumaDelta < GATE.fringeLumaMin) {
    failures.push(`fringe luma delta ${m.fringeLumaDelta.toFixed(1)} < ${GATE.fringeLumaMin} vs backdrop`);
  }
  return { pass: failures.length === 0, measurement: m, failures };
}

/**
 * BINARY gate: the E.1 criterion needs BOTH backgrounds. Light and dark
 * verdicts must agree with each other.
 */
export function gateAll(v: RgbaView): { light: GateResult; dark: GateResult; agree: boolean } {
  const light = gateForBackground(v, BACKDROP_LIGHT);
  const dark = gateForBackground(v, BACKDROP_DARK);
  const agree = light.pass === dark.pass;
  return { light, dark, agree };
}

export interface AssetVerdict {
  file: string;
  width: number;
  height: number;
  colorType: number;
  alpha: AlphaMeasured;
  /** Full gate result (failures included) per backdrop. */
  lightResult: GateResult;
  darkResult: GateResult;
  pass: boolean;
  agree: boolean;
}

/** Run the full E.1 harness over one decoded frame. */
export function verdict(file: string, frame: { width: number; height: number; rgba: Uint8Array }): AssetVerdict {
  const v = viewOf(frame);
  const alpha = alphaStats(v);
  const { light, dark, agree } = gateAll(v);
  return {
    file,
    width: v.width,
    height: v.height,
    colorType: 6,
    alpha,
    lightResult: light,
    darkResult: dark,
    pass: light.pass && dark.pass && agree,
    agree,
  };
}
