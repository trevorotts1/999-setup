#!/usr/bin/env python3
"""Gate test harness for check_stages in tools/boss-cron (Issue 8 FIX step 2)."""
import importlib.machinery
import importlib.util
import os
import sys

BC = "/Users/blackceomacmini/work-999-setup-fix/WF-3C/tools/boss-cron"
loader = importlib.machinery.SourceFileLoader("bosscron", BC)
spec = importlib.util.spec_from_loader("bosscron", loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)
check_stages = mod.check_stages

SITE = "/Users/blackceomacmini/work-999-setup-fix/WF-3C/verification-test/site/assets"
TRANS = f"{SITE}/logo-transparent.png"   # real transparent output
RAW = f"{SITE}/logo-source-raw.png"      # real opaque raw source
MISSING = f"{SITE}/no-such-file.png"

def run(name, lines, expect_clean):
    v = check_stages(lines)
    ok = (len(v) == 0) == expect_clean
    print(f"{'PASS' if ok else 'FAIL'} {name}: violations={len(v)}")
    for x in v:
        print(f"    {x}")
    return ok

results = []

# 1. Clean full sequence, logo in play, transparent output
results.append(run("clean full sequence + logo", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    f"- `STAGE-LOGO: {RAW}={TRANS}` 2026-08-16T17:14Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], True))

# 2. Clean full sequence, honest 'none' logo line
results.append(run("clean full sequence, logo none", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    "- `STAGE-LOGO: none (no client logo supplied)` 2026-08-16T17:14Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], True))

# 3. No logo in play anywhere, no STAGE-LOGO line — STAGE-BUILD must pass
results.append(run("no logo in play, no STAGE-LOGO", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], True))

# 4. Logo in play (DESIGN-BRIEF mentions logo), STAGE-LOGO missing — violation
results.append(run("logo in play, STAGE-LOGO missing", [
    "- `DESIGN-BRIEF: client logo supplied (ACME mark)` 2026-08-16T17:09Z",
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], False))

# 5. STAGE-BUILD missing STAGE-IMAGES — violation
results.append(run("STAGE-BUILD missing STAGE-IMAGES", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-LOGO: none (no client logo supplied)` 2026-08-16T17:14Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], False))

# 6. STAGE-HERO before STAGE-SCAFFOLDING — predecessor gate violation
results.append(run("STAGE-HERO before STAGE-SCAFFOLDING", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
], False))

# 7. STAGE-LOGO output is the raw opaque file — violation
results.append(run("STAGE-LOGO opaque output", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    f"- `STAGE-LOGO: {RAW}={RAW}` 2026-08-16T17:14Z",
], False))

# 8. STAGE-LOGO output file missing — violation
results.append(run("STAGE-LOGO output missing", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    f"- `STAGE-LOGO: {RAW}={MISSING}` 2026-08-16T17:14Z",
], False))

# 9. STAGE-LOGO transparent output, no STAGE-BUILD yet — clean
results.append(run("STAGE-LOGO transparent, no build yet", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    f"- `STAGE-LOGO: {RAW}={TRANS}` 2026-08-16T17:14Z",
], True))

# 10. Per-page wireframe lines count as STAGE-WIREFRAMES
results.append(run("per-page wireframes count as stage", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-WIREFRAMES-pricing: Header, Offer, Form, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
], True))

# 11. STAGE-SCAFFOLDING with no wireframe lines — violation
results.append(run("STAGE-SCAFFOLDING without wireframes", [
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
], False))

# 12. BUG 2 regression: source path opaque, output transparent — must pass
# (the check runs on the OUTPUT side of '=' only)
results.append(run("source opaque, output transparent (BUG 2 regression)", [
    "- `STAGE-WIREFRAMES-home: Header, Hero, Features, Proof, Footer` 2026-08-16T17:10Z",
    "- `STAGE-SCAFFOLDING: tokens, type-scale, colors` 2026-08-16T17:11Z",
    "- `STAGE-HERO: hero-home` 2026-08-16T17:12Z",
    "- `STAGE-IMAGES: gallery-1, gallery-2` 2026-08-16T17:13Z",
    f"- `STAGE-LOGO: {RAW}={TRANS}` 2026-08-16T17:14Z",
    "- `STAGE-BUILD: all pages built` 2026-08-16T17:15Z",
], True))

print(f"ALL: {all(results)}")
sys.exit(0 if all(results) else 1)
