#!/usr/bin/env python3
"""Unit tests for check_orphans in tools/boss-cron (WF-3E slice 3, Issue 10 FIX step 3)."""
import sys
from importlib.machinery import SourceFileLoader

mod = SourceFileLoader("boss", "/Users/blackceomacmini/work-999-setup-fix/WF-3E/tools/boss-cron").load_module()

passed = 0
failed = 0

def run(name, lines, predicate, expect_clean=False):
    global passed, failed
    v = mod.check_orphans(lines)
    if expect_clean:
        ok = v == []
    else:
        ok = predicate(v)
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}: {v}")

# Test 1: clean ledger — no media lines, no violations
run("T1 clean no-media", [
    "- `BOSSCYCLE-CLEAN 2026-08-16T10:00:00Z: checks=caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan`",
], None, expect_clean=True)

# Test 2: perfect 1:1:1 — 2 manifest rows, 2 generated, 2 uploaded, 2 referenced (N refs allowed)
run("T2 perfect 1:1:1 N-refs", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-17T10:00:00Z`",
    "- `MANIFEST-ROW about-1: page=about slot=hero url=https://tempfile.aiquickdraw.com/p/b.jpg expires=2026-08-17T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
    "- `IMAGE-GENERATED about-1: task=def456 url=https://tempfile.aiquickdraw.com/p/b.jpg`",
    "- `GHL-URL hero-1: url=https://media.ghl.com/hero-1.jpg`",
    "- `GHL-URL about-1: url=https://media.ghl.com/about-1.jpg`",
    "- `IMAGE-REF hero-1: page=home slot=hero`",
    "- `IMAGE-REF hero-1: page=home slot=og-image`",
    "- `IMAGE-REF about-1: page=about slot=hero`",
], None, expect_clean=True)

# Test 3: orphaned generation — generated but no manifest row
run("T3 orphan generation", [
    "- `IMAGE-GENERATED mystery-1: task=xyz url=https://tempfile.aiquickdraw.com/p/c.jpg`",
], lambda v: any("mystery-1" in x and "no corresponding MANIFEST-ROW" in x for x in v))

# Test 4: generated but not uploaded
run("T4 generated-not-uploaded", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-17T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
], lambda v: any("hero-1" in x and "no GHL-URL" in x for x in v))

# Test 5: uploaded but never referenced
run("T5 uploaded-never-referenced", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-17T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
    "- `GHL-URL hero-1: url=https://media.ghl.com/hero-1.jpg`",
], lambda v: any("hero-1" in x and "no IMAGE-REF" in x for x in v))

# Test 6: expired temp URL, no GHL upload
run("T6 expired-temp-url", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-15T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
], lambda v: any("expired" in x and "hero-1" in x for x in v))

# Test 7: expired temp URL BUT uploaded — should NOT flag expiry
run("T7 expired-but-uploaded-clean", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-15T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
    "- `GHL-URL hero-1: url=https://media.ghl.com/hero-1.jpg`",
    "- `IMAGE-REF hero-1: page=home slot=hero`",
], lambda v: not any("expired" in x for x in v))

# Test 8: marked gap row — no generation, no violation
run("T8 marked-gap-clean", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero status=gap`",
], None, expect_clean=True)

# Test 9: manifest row without generation (unmarked gap)
run("T9 manifest-no-generation", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-17T10:00:00Z`",
], lambda v: any("hero-1" in x and "no IMAGE-GENERATED" in x for x in v))

# Test 10: future expiry, in-flight row — no expiry violation (only missing-upload violation)
run("T10 in-flight-future-expiry", [
    "- `MANIFEST-ROW hero-1: page=home slot=hero url=https://tempfile.aiquickdraw.com/p/a.jpg expires=2026-08-17T10:00:00Z`",
    "- `IMAGE-GENERATED hero-1: task=abc123 url=https://tempfile.aiquickdraw.com/p/a.jpg`",
], lambda v: not any("expired" in x for x in v))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
