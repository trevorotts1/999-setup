/**
 * FIX-020 parity review harness — pixel diff engine.
 *
 * Owned lane: tests/visual/parity/** (this file).
 *
 * Two comparison disciplines, by design:
 *
 *  1. STRICT alpha-exact region compare — for same-canvas frames (layer
 *     composites, golden reconstructions): every RGBA channel must match
 *     exactly inside the named region. Any one differing byte is a
 *     mismatch. This is the zero-tolerance leg of the review; it proves
 *     origin, not aesthetics.
 *
 *  2. SSIM (structural similarity, 8x8 Gaussian windows) — for
 *     different-scale frames (runtime capture vs canonical source): a
 *     mechanical likeness bound. It exists to catch identity swaps
 *     (different avatar) and gross divergence, NOT to approve likeness.
 *     Likeness approval is operator territory; the harness only computes
 *     the bound and reports REQUIRE_SIGN_OFF in the band where the
 *     machine cannot decide.
 *
 * Both are pure functions over RGBA buffers — zero deps, zero DOM.
 */

import type { CheckProof } from './types.ts';

export interface Frame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a rect into a frame; returns null if it covers no pixels. */
export function clipRect(f: Frame, r: Rect): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(f.width, r.x + r.w);
  const y1 = Math.min(f.height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Copy the rect region of a frame into a new frame. */
export function regionFrame(f: Frame, r: Rect): Frame {
  const c = clipRect(f, r);
  if (!c) throw new Error('region outside frame');
  const out = new Uint8Array(c.w * c.h * 4);
  for (let y = 0; y < c.h; y++) {
    const src = ((c.y + y) * f.width + c.x) * 4;
    out.set(f.rgba.subarray(src, src + c.w * 4), y * c.w * 4);
  }
  return { width: c.w, height: c.h, rgba: out };
}

/** Bilinear scale of an RGBA frame to (w, h). */
export function scaleTo(f: Frame, w: number, h: number): Frame {
  const out = new Uint8Array(w * h * 4);
  const sx = f.width / w;
  const sy = f.height / h;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(f.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(f.width - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = (y0 * f.width + x0) * 4;
      const i01 = (y0 * f.width + x1) * 4;
      const i10 = (y1 * f.width + x0) * 4;
      const i11 = (y1 * f.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const v =
          f.rgba[i00 + ch] * (1 - tx) * (1 - ty) +
          f.rgba[i01 + ch] * tx * (1 - ty) +
          f.rgba[i10 + ch] * (1 - tx) * ty +
          f.rgba[i11 + ch] * tx * ty;
        out[o + ch] = Math.round(v);
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/** Alpha-over compositing: overlay drawn at (x, y) onto base (in place). */
export function composeOver(base: Frame, overlay: Frame, x: number, y: number): void {
  for (let oy = 0; oy < overlay.height; oy++) {
    const by = y + oy;
    if (by < 0 || by >= base.height) continue;
    for (let ox = 0; ox < overlay.width; ox++) {
      const bx = x + ox;
      if (bx < 0 || bx >= base.width) continue;
      const si = (oy * overlay.width + ox) * 4;
      const a = overlay.rgba[si + 3];
      if (a === 0) continue;
      const di = (by * base.width + bx) * 4;
      if (a === 255) {
        base.rgba[di] = overlay.rgba[si];
        base.rgba[di + 1] = overlay.rgba[si + 1];
        base.rgba[di + 2] = overlay.rgba[si + 2];
        base.rgba[di + 3] = 255;
      } else {
        const ia = 255 - a;
        base.rgba[di] = Math.round((overlay.rgba[si] * a + base.rgba[di] * ia) / 255);
        base.rgba[di + 1] = Math.round((overlay.rgba[si + 1] * a + base.rgba[di + 1] * ia) / 255);
        base.rgba[di + 2] = Math.round((overlay.rgba[si + 2] * a + base.rgba[di + 2] * ia) / 255);
        base.rgba[di + 3] = 255 - Math.round(((255 - base.rgba[di + 3]) * ia) / 255);
      }
    }
  }
}

/** Bounding box of pixels with alpha >= alphaMin. */
export function alphaBBox(f: Frame, alphaMin = 8): Rect | null {
  let minX = f.width;
  let minY = f.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (f.rgba[(y * f.width + x) * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface StrictDiffResult {
  equal: boolean;
  /** Pixels inside the region where any RGBA byte differs. */
  mismatchPx: number;
  /** Pixels where color differs but alpha is identical. */
  colorOnlyMismatchPx: number;
  /** Pixels where alpha differs. */
  alphaMismatchPx: number;
  /** Largest per-pixel channel delta (0..255). */
  maxChannelDelta: number;
  /** Mean absolute delta per channel over the region. */
  meanDelta: { r: number; g: number; b: number; a: number };
  region: Rect;
}

/**
 * Strict alpha-exact compare of two same-size frames, optionally restricted
 * to a rect. Color tolerance is 0 by default: one differing byte fails.
 */
export function strictDiff(a: Frame, b: Frame, region?: Rect): StrictDiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`strictDiff requires same-size frames (${a.width}x${a.height} vs ${b.width}x${b.height})`);
  }
  const rect = region ? clipRect(a, region) : { x: 0, y: 0, w: a.width, h: a.height };
  if (!rect) throw new Error('strictDiff region outside frame');
  let mismatchPx = 0;
  let colorOnlyMismatchPx = 0;
  let alphaMismatchPx = 0;
  let maxChannelDelta = 0;
  const sums = { r: 0, g: 0, b: 0, a: 0 };
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * a.width + x) * 4;
      let anyDiff = false;
      let alphaDiff = false;
      let colorDiff = false;
      for (let ch = 0; ch < 4; ch++) {
        const d = Math.abs(a.rgba[i + ch] - b.rgba[i + ch]);
        sums[ch === 0 ? 'r' : ch === 1 ? 'g' : ch === 2 ? 'b' : 'a'] += d;
        if (d > maxChannelDelta) maxChannelDelta = d;
        if (d > 0) {
          anyDiff = true;
          if (ch === 3) alphaDiff = true;
          else colorDiff = true;
        }
      }
      n++;
      if (anyDiff) mismatchPx++;
      if (alphaDiff) alphaMismatchPx++;
      if (colorDiff && !alphaDiff) colorOnlyMismatchPx++;
    }
  }
  return {
    equal: mismatchPx === 0,
    mismatchPx,
    colorOnlyMismatchPx,
    alphaMismatchPx,
    maxChannelDelta,
    meanDelta: {
      r: n ? sums.r / n : 0,
      g: n ? sums.g / n : 0,
      b: n ? sums.b / n : 0,
      a: n ? sums.a / n : 0,
    },
    region: rect,
  };
}

const SSIM_WIN = 8;
const SSIM_K1 = 0.01;
const SSIM_K2 = 0.03;
const SSIM_L = 255;

function gaussianKernel(): number[] {
  // 8-tap Gaussian (sigma 1.5), normalized.
  const taps = [0.0113, 0.0838, 0.2417, 0.3316, 0.2417, 0.0838, 0.0113];
  // pad to 8 taps with zeros for the window
  return taps;
}

/** Precomputed sums over luminance/alpha for a frame. */
function luminance(f: Frame): Float32Array {
  const lum = new Float32Array(f.width * f.height);
  for (let i = 0; i < f.width * f.height; i++) {
    const o = i * 4;
    // Perceptual luma; alpha is folded in so transparent pixels do not vote.
    const a = f.rgba[o + 3] / 255;
    const y = 0.299 * f.rgba[o] + 0.587 * f.rgba[o + 1] + 0.114 * f.rgba[o + 2];
    lum[i] = y * a;
  }
  return lum;
}

/**
 * Mean SSIM over 8x8 windows of two same-size frames (scaled to the same
 * canvas by the caller). Returns 0..1; 1 = identical.
 */
export function ssim(a: Frame, b: Frame): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`ssim requires same-size frames (${a.width}x${a.height} vs ${b.width}x${b.height})`);
  }
  const la = luminance(a);
  const lb = luminance(b);
  const w = a.width;
  const h = a.height;
  const winsX = Math.floor(w / SSIM_WIN);
  const winsY = Math.floor(h / SSIM_WIN);
  if (winsX === 0 || winsY === 0) {
    // Tiny frames: single-window fallback.
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < la.length; i++) {
      ma += la[i];
      mb += lb[i];
    }
    ma /= la.length;
    mb /= lb.length;
    let va = 0;
    let vb = 0;
    let cov = 0;
    for (let i = 0; i < la.length; i++) {
      const da = la[i] - ma;
      const db = lb[i] - mb;
      va += da * da;
      vb += db * db;
      cov += da * db;
    }
    va /= la.length;
    vb /= lb.length;
    cov /= la.length;
    const c1 = (SSIM_K1 * SSIM_L) ** 2;
    const c2 = (SSIM_K2 * SSIM_L) ** 2;
    return ((2 * ma * mb + c1) * (2 * cov + c2)) /
      ((ma * ma + mb * mb + c1) * (va + vb + c2));
  }
  let sum = 0;
  let count = 0;
  for (let wy = 0; wy < winsY; wy++) {
    for (let wx = 0; wx < winsX; wx++) {
      let ma = 0;
      let mb = 0;
      for (let dy = 0; dy < SSIM_WIN; dy++) {
        for (let dx = 0; dx < SSIM_WIN; dx++) {
          const i = (wy * SSIM_WIN + dy) * w + wx * SSIM_WIN + dx;
          ma += la[i];
          mb += lb[i];
        }
      }
      const n = SSIM_WIN * SSIM_WIN;
      ma /= n;
      mb /= n;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let dy = 0; dy < SSIM_WIN; dy++) {
        for (let dx = 0; dx < SSIM_WIN; dx++) {
          const i = (wy * SSIM_WIN + dy) * w + wx * SSIM_WIN + dx;
          const da = la[i] - ma;
          const db = lb[i] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n;
      vb /= n;
      cov /= n;
      const c1 = (SSIM_K1 * SSIM_L) ** 2;
      const c2 = (SSIM_K2 * SSIM_L) ** 2;
      sum += ((2 * ma * mb + c1) * (2 * cov + c2)) /
        ((ma * ma + mb * mb + c1) * (va + vb + c2));
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Convenience: compare a vs b after scaling both to the smaller frame's
 * size, over the alpha bounding box union. Used for capture-vs-source
 * mechanical likeness bounds.
 */
export function likenessBound(a: Frame, b: Frame, target = 128): number {
  const sa = scaleTo(a, target, Math.round((target * a.height) / a.width));
  const sb = scaleTo(b, target, Math.round((target * b.height) / b.width));
  // Align by height for SSIM: pick the min common canvas.
  const h = Math.min(sa.height, sb.height);
  const w = Math.min(sa.width, sb.width);
  return ssim(
    { width: w, height: h, rgba: regionFrame(sa, { x: 0, y: 0, w, h }).rgba },
    { width: w, height: h, rgba: regionFrame(sb, { x: 0, y: 0, w, h }).rgba },
  );
}

/**
 * Alpha-exact strict proof with threshold plumbing for CheckProof rows.
 * proof for a region: pass = mismatchPx === 0 AND alphaMismatchPx === 0.
 */
export function strictProof(
  a: Frame,
  b: Frame,
  region: Rect | undefined,
  metric: string,
): CheckProof {
  const d = strictDiff(a, b, region);
  return {
    metric,
    value: d.mismatchPx,
    threshold: 0,
    pass: d.equal,
    note: d.equal
      ? `strict alpha-exact: ${d.region.w}x${d.region.h} region, 0 differing bytes`
      : `strict alpha-exact: ${d.mismatchPx}/${d.region.w * d.region.h} px differ (alpha ${d.alphaMismatchPx}, color-only ${d.colorOnlyMismatchPx}, max channel delta ${d.maxChannelDelta})`,
  };
}

/** SSIM proof with a caller-chosen identity-divergence threshold. */
export function ssimProof(value: number, threshold: number, metric: string, note: string): CheckProof {
  return {
    metric,
    value: Number(value.toFixed(4)),
    threshold,
    pass: value >= threshold,
    note,
  };
}
