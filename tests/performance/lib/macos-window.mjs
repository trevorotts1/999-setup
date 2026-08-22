/**
 * WS-45 macOS window probe — CGWindowList-based (no accessibility
 * permission needed; headless-safe). Measures TIME-TO-FIRST-VISIBLE for
 * the real release binary: a companion window on screen means the
 * webview painted its boot surface (index.html boot markup precedes any
 * JS — spec 3 wants Candice visible before preflight finishes).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 * Read-only over the window system; never touches controls.
 *
 * Compile-once discipline: the swift probe is compiled once into a fixed
 * temp binary so the poll loop measures the APP, not the compiler.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROBE_SOURCE = `
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var out: [String] = []
for w in list {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    if owner == "candice-companion" {
        let name = w[kCGWindowName as String] as? String ?? ""
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let x = b["X"] as? Double ?? 0
        let y = b["Y"] as? Double ?? 0
        let width = b["Width"] as? Double ?? 0
        let height = b["Height"] as? Double ?? 0
        out.append("\\(name)|\\(Int(x)),\\(Int(y)),\\(Int(width)),\\(Int(height))")
    }
}
print(out.joined(separator: "\\n"))
`;

let compiledBinary = null;

/**
 * Compile the probe once. Returns the binary path or null with reason.
 */
export function compileWindowProbe(force = false) {
  if (compiledBinary && existsSync(compiledBinary) && !force) return compiledBinary;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ws45-cg-'));
  const src = path.join(dir, 'cgprobe.swift');
  const bin = path.join(dir, 'cgprobe');
  writeFileSync(src, PROBE_SOURCE);
  const res = spawnSync('swiftc', ['-O', '-o', bin, src], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (res.status !== 0 || !existsSync(bin)) {
    return null;
  }
  compiledBinary = bin;
  return bin;
}

/**
 * One probe run: current companion windows as parsed lines.
 */
export function runWindowProbe() {
  const bin = compileWindowProbe();
  if (!bin) return { ok: false, note: 'swiftc probe compile failed (no swift toolchain?)', windows: [] };
  const res = spawnSync(bin, [], { encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) {
    return { ok: false, note: `probe exited ${res.status}: ${res.stderr.trim()}`, windows: [] };
  }
  const raw = res.stdout.trim();
  return { ok: true, windows: raw ? raw.split('\n') : [], raw };
}

/**
 * Poll until the companion window appears. `t0Ms` is the moment the app
 * was spawned — the returned mappedAtMs is relative to THAT, not to the
 * probe start, so compile/probe overhead is excluded.
 */
export function pollWindowUntil({ t0Ms, timeoutMs = 15_000, intervalMs = 50 } = {}) {
  let lastRaw = '';
  const start = Date.now();
  for (;;) {
    const probe = runWindowProbe();
    if (probe.ok && probe.windows.length > 0) {
      return {
        ok: true,
        windows: probe.windows,
        mappedAtMs: Date.now() - t0Ms,
        raw: probe.raw,
      };
    }
    lastRaw = probe.raw ?? lastRaw;
    if (Date.now() - start >= timeoutMs) {
      return {
        ok: false,
        note: `no candice-companion window within ${timeoutMs}ms (probe raw: ${lastRaw || 'empty'})`,
      };
    }
    spin(intervalMs);
  }
}

function spin(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* short spin; a 50 ms spin is fine for a test driver */
  }
}

/** Parse one probe line "title|x,y,w,h". */
export function parseWindowLine(line) {
  const idx = line.indexOf('|');
  if (idx === -1) return null;
  const title = line.slice(0, idx);
  const parts = line.slice(idx + 1).split(',').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  return { title, x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}
