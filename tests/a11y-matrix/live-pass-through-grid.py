#!/usr/bin/env python3
"""
FIX-008 QC — live transparent-point pass-through grid (macOS).

Proves the packaged candidate window passes pointer input through to the
window beneath it. Procedure:

  1. Activate the candidate app (frontmost).
  2. Click a 5x5 grid of points inside the candidate's native bounds.
  3. After each click, read the frontmost app.
  4. PASS when the first click activates the app beneath (Terminal) and
     every subsequent click keeps it frontmost — i.e. no grid point was
     eaten by the transparent rectangle.
  5. Control: one click outside the candidate bounds must also activate
     the app beneath, proving the click mechanism itself works.

Usage: python3 live-pass-through-grid.py <candidate-pid> <beneath-app-name>
Exit 0 only when every grid point passes through.
"""

import json
import subprocess
import sys
import time

import Quartz

def frontmost():
    out = subprocess.run(
        ["osascript", "-e",
         'tell application "System Events" to get name of first application process whose frontmost is true'],
        capture_output=True, text=True, timeout=15,
    ).stdout.strip()
    return out

def click(x, y):
    down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (x, y), Quartz.kCGMouseButtonLeft)
    up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
    time.sleep(0.05)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
    time.sleep(0.15)

def activate(pid):
    subprocess.run(
        ["osascript", "-l", "JavaScript", "-e",
         f'function run() {{ Application("System Events").processes.whose({{unixId: {pid}}})[0].frontmost = true; }}'],
        capture_output=True, text=True, timeout=15,
    )

def window_bounds(pid):
    wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
    for w in wins:
        if w.get("kCGWindowOwnerPID") == pid:
            b = w["kCGWindowBounds"]
            return (int(b["X"]), int(b["Y"]), int(b["Width"]), int(b["Height"]))
    return None

def main():
    pid = int(sys.argv[1])
    beneath = sys.argv[2] if len(sys.argv) > 2 else "Terminal"

    bounds = window_bounds(pid)
    if bounds is None:
        print("FAIL candidate window not found on screen")
        sys.exit(1)
    x0, y0, w, h = bounds
    print(f"candidate window: x={x0} y={y0} w={w} h={h}")

    # Control: click outside candidate bounds (left of it) — must activate beneath.
    activate(pid)
    time.sleep(0.3)
    fm = frontmost()
    print(f"after activate: frontmost={fm}")
    if fm.lower() != "candice-companion":
        print("FAIL could not activate candidate app (control precondition)")
        sys.exit(1)

    cx, cy = x0 - 30, y0 + h // 2
    click(cx, cy)
    fm = frontmost()
    print(f"control click ({cx},{cy}): frontmost={fm}")
    if fm != beneath:
        print(f"FAIL control click did not activate {beneath} — click mechanism broken")
        sys.exit(1)

    # Grid: 5x5 points inside candidate bounds.
    failures = []
    for i in range(1, 6):
        for j in range(1, 6):
            gx = x0 + (w * i) // 6
            gy = y0 + (h * j) // 6
            click(gx, gy)
            fm = frontmost()
            ok = fm == beneath
            print(f"grid ({gx},{gy}): frontmost={fm} {'PASS' if ok else 'FAIL'}")
            if not ok:
                failures.append((gx, gy, fm))

    # Candidate must still be alive after the grid.
    alive = window_bounds(pid) is not None
    print(f"candidate window still present: {alive}")
    if not alive:
        failures.append(("window", "gone", "candidate crashed during grid"))

    if failures:
        print(f"\n{len(failures)} GRID POINT(S) FAILED")
        sys.exit(1)
    print("\nLIVE PASS-THROUGH GRID ALL GREEN")
    sys.exit(0)

if __name__ == "__main__":
    main()
