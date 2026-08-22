/**
 * WS-15 harness — minimal PNG codec (zero deps, Node built-ins only).
 *
 * decode: zlib inflate + full unfiltering of all five PNG filter types
 * (None/Sub/Up/Average/Paeth), verified by round-trip re-encode equality
 * against the IDAT stream of all 17 checked-in assets (see
 * transparency.test.ts "codec honesty" test).
 *
 * encode: filter type 0 only — used to synthesize fixture PNGs at test
 * time so the harness can PROVE its gates fail on known-bad images
 * (negative-result contract: a harness that cannot fail proves nothing).
 *
 * Runs under `node --test` (Node 22.6+ type stripping, Node 26 native).
 */

import zlib from 'node:zlib';
import fs from 'node:fs';

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export interface FrameInfo {
  width: number;
  height: number;
  /** RGBA8, row-major, len = width*height*4. */
  rgba: Uint8Array;
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** PNG color type; Candice assets must be 6 (RGBA). */
  colorType: number;
  interlace: number;
}

/** Parse only IHDR. Throws on anything but 8-bit non-interlaced. */
export function readHeader(bytes: Uint8Array): PngHeader {
  if (bytes.length < 33) throw new Error('png too small');
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG signature');
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new Error('IHDR not first chunk');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth: ${bitDepth}`);
  if (interlace !== 0) throw new Error(`unsupported interlace: ${interlace}`);
  return { width, height, bitDepth, colorType, interlace };
}

/** Collect the concatenated IDAT payload of a PNG. */
function idatBytes(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let off = 8;
  while (off < bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    const type = String.fromCharCode(
      bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7],
    );
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IDAT') parts.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Paeth predictor (PNG spec). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Full decode: inflate + unfilter into RGBA8. */
export function decodeRgba(bytes: Uint8Array): FrameInfo {
  const { width, height, colorType } = readHeader(bytes);
  if (colorType !== 6) {
    throw new Error(`expected RGBA (colorType 6), got ${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.from(idatBytes(bytes)));
  const bpp = 4;
  const stride = width * bpp;
  const rgba = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filterType) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (v + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`unknown filter type ${filterType}`);
      }
      cur[x] = v;
    }
  }
  return { width, height, rgba };
}

export function decodePngFile(path: string): FrameInfo {
  return decodeRgba(fs.readFileSync(path));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (PNG chunk checksum). Exported for test-side chunk builders. */
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.forEach((b, i) => { out[8 + i] = b; });
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGBA8 as a PNG using filter type 0 on every scanline. */
export function encodeRgba(frame: FrameInfo): Buffer {
  const { width, height, rgba } = frame;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // interlace
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) {
      filtered[y * (stride + 1) + 1 + x] = rgba[y * stride + x];
    }
  }
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(zlib.deflateSync(Buffer.from(filtered)))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
