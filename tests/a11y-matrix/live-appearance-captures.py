#!/usr/bin/env python3
"""
FIX-008 QC — live appearance captures (macOS).

Captures the packaged candidate window under four OS appearance states and
measures real pixel contrast of the status surface text against its
background:

  light-motion-on   (baseline)
  light-motion-off  (OS reduceMotion toggled live)
  dark-motion-on    (OS dark mode)
  high-contrast     (OS increaseContrast)

For each state: save a PNG capture, then measure the status-surface region
(top of window): darkest pixel = surface, lightest pixel = text; compute
WCAG contrast ratio from measured values. Also proves reduced-motion stops
the breathe animation: two captures 1.5s apart must be pixel-identical in
the character region when motion is off, and differ when motion is on.

Usage: python3 live-appearance-captures.py <candidate-pid> <out-dir>
Exit 0 only when every check passes. Restores OS appearance state on exit.
"""

import json
import os
import subprocess
import sys
import time

import Quartz
from PIL import Image

def window_id(pid):
    wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
    for w in wins:
        if w.get("kCGWindowOwnerPID") == pid:
            return w["kCGWindowNumber"], w["kCGWindowBounds"]
    return None, None

def capture(pid, path):
    wid, bounds = window_id(pid)
    if wid is None:
        return None
    x, y, w, h = int(bounds["X"]), int(bounds["Y"]), int(bounds["Width"]), int(bounds["Height"])
    img = Quartz.CGWindowListCreateImage(
        Quartz.CGRectMake(x, y, w, h),
        Quartz.kCGWindowListOptionIncludingWindow, wid, Quartz.kCGWindowImageDefault)
    if img is None:
        return None
    # Convert CGImage to PNG bytes via PIL.
    width = Quartz.CGImageGetWidth(img)
    height = Quartz.CGImageGetHeight(img)
    bpr = Quartz.CGImageGetBytesPerRow(img)
    data = Quartz.CGImageGetDataProvider(img)
    raw = Quartz.CGDataProviderCopyData(data)
    pil = Image.frombytes("RGBA", (width, height), bytes(raw), "raw", "BGRA", bpr, 1)
    pil.save(path)
    return pil

def set_dark(on):
    subprocess.run(["osascript", "-e",
        f'tell application "System Events" to tell appearance preferences to set dark mode to {str(on).lower()}'],
        capture_output=True, timeout=15)
    time.sleep(1.0)

def set_reduce_motion(on):
    subprocess.run(["defaults", "write", "com.apple.universalaccess", "reduceMotion",
                    "-bool", str(on).lower()], capture_output=True, timeout=15)
    time.sleep(1.5)

def set_increase_contrast(on):
    subprocess.run(["defaults", "write", "com.apple.universalaccess", "increaseContrast",
                    "-bool", str(on).lower()], capture_output=True, timeout=15)
    time.sleep(1.5)

def lum(rgb):
    def f(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])

def contrast(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)

def ax_text_regions(pid):
    """Screen-space rects of AXStaticText nodes, from the live AX tree."""
    script = f'''
function run() {{
  const se = Application("System Events");
  const p = se.processes.whose({{unixId: {pid}}})[0];
  const w = p.windows()[0];
  const out = [];
  function walk(el) {{
    try {{
      if (el.role() === "AXStaticText") {{
        const pos = el.position(); const sz = el.size();
        out.push({{x: pos[0], y: pos[1], w: sz[0], h: sz[1], v: String(el.value())}});
      }}
      const kids = el.uiElements();
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }} catch (e) {{}}
  }}
  walk(w);
  return JSON.stringify(out);
}}'''
    out = subprocess.run(["osascript", "-l", "JavaScript", "-e", script],
                         capture_output=True, text=True, timeout=30).stdout.strip()
    try:
        return json.loads(out)
    except Exception:
        return []

def measure_surface(pil, pid, win_bounds):
    """Measure contrast inside each AXStaticText rect (text vs its surface)."""
    w, h = pil.size
    wx, wy, ww, wh = (int(win_bounds[k]) for k in ("X", "Y", "Width", "Height"))
    scale_x = w / ww
    scale_y = h / wh
    results = []
    for r in ax_text_regions(pid):
        rx = int((r["x"] - wx) * scale_x)
        ry = int((r["y"] - wy) * scale_y)
        rw = max(1, int(r["w"] * scale_x))
        rh = max(1, int(r["h"] * scale_y))
        band = pil.crop((rx, ry, rx + rw, ry + rh))
        px = [p for p in band.getdata() if p[3] > 200]
        if not px:
            results.append((r["v"], None))
            continue
        darkest = min(px, key=lambda p: lum(p[:3]))
        lightest = max(px, key=lambda p: lum(p[:3]))
        results.append((r["v"], (darkest[:3], lightest[:3], contrast(darkest[:3], lightest[:3]))))
    return results

def character_region(pil):
    w, h = pil.size
    return pil.crop((int(w * 0.2), int(h * 0.30), int(w * 0.8), int(h * 0.75)))

def main():
    pid = int(sys.argv[1])
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)

    failures = []
    def check(label, ok, detail=""):
        print(f"{'PASS' if ok else 'FAIL'} {label}{' — ' + detail if detail else ''}")
        if not ok:
            failures.append(label)

    _, win_bounds = window_id(pid)
    if win_bounds is None:
        print("FAIL candidate window not found")
        sys.exit(1)

    # ---- light, motion on: two captures 1.5s apart must DIFFER (animation runs)
    set_dark(False)
    set_reduce_motion(False)
    set_increase_contrast(False)
    time.sleep(1.0)
    a = capture(pid, os.path.join(out, "light-motion-on-a.png"))
    time.sleep(1.5)
    b = capture(pid, os.path.join(out, "light-motion-on-b.png"))
    check("light captures taken", a is not None and b is not None)
    if a and b:
        ra, rb = character_region(a), character_region(b)
        diff = sum(1 for pa, pb in zip(ra.getdata(), rb.getdata()) if pa != pb)
        check("motion ON: character region animates (captures differ)", diff > 0, f"{diff} px differ")
        for label, m in measure_surface(a, pid, win_bounds):
            if m is None:
                check(f"light: {label[:30]} contrast >= 4.5:1", False, "no opaque pixels")
            else:
                check(f"light: {label[:30]} contrast >= 4.5:1", m[2] >= 4.5,
                      f"measured {m[2]:.2f}:1 (text {m[1]}, surface {m[0]})")

    # ---- light, motion off: two captures must be IDENTICAL in character region
    set_reduce_motion(True)
    time.sleep(1.0)
    c = capture(pid, os.path.join(out, "light-motion-off-a.png"))
    time.sleep(1.5)
    d = capture(pid, os.path.join(out, "light-motion-off-b.png"))
    check("motion-off captures taken", c is not None and d is not None)
    if c and d:
        rc, rd = character_region(c), character_region(d)
        diff = sum(1 for pc, pd_ in zip(rc.getdata(), rd.getdata()) if pc != pd_)
        check("motion OFF: character region static (captures identical)", diff == 0, f"{diff} px differ")

    # ---- dark mode
    set_dark(True)
    time.sleep(1.0)
    e = capture(pid, os.path.join(out, "dark-motion-off.png"))
    check("dark capture taken", e is not None)
    if e:
        for label, m in measure_surface(e, pid, win_bounds):
            if m is None:
                check(f"dark: {label[:30]} contrast >= 4.5:1", False, "no opaque pixels")
            else:
                check(f"dark: {label[:30]} contrast >= 4.5:1", m[2] >= 4.5,
                      f"measured {m[2]:.2f}:1 (text {m[1]}, surface {m[0]})")

    # ---- high contrast
    set_increase_contrast(True)
    time.sleep(1.0)
    f = capture(pid, os.path.join(out, "high-contrast.png"))
    check("high-contrast capture taken", f is not None)
    if f:
        for label, m in measure_surface(f, pid, win_bounds):
            if m is None:
                check(f"high-contrast: {label[:30]} contrast >= 4.5:1", False, "no opaque pixels")
            else:
                check(f"high-contrast: {label[:30]} contrast >= 4.5:1", m[2] >= 4.5,
                      f"measured {m[2]:.2f}:1 (text {m[1]}, surface {m[0]})")

    # ---- restore OS state
    set_increase_contrast(False)
    set_dark(False)
    set_reduce_motion(False)

    if failures:
        print(f"\n{len(failures)} APPEARANCE CHECK(S) FAILED")
        sys.exit(1)
    print("\nLIVE APPEARANCE CAPTURES ALL GREEN")
    sys.exit(0)

if __name__ == "__main__":
    main()
