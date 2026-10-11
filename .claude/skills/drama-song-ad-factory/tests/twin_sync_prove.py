#!/usr/bin/env python3
"""Twin-sync prover for skill 75 (drama-song-ad-factory) - U18.

Proves the packaged ``scripts/core`` is byte-identical to the canonical core
over the SAME scope on both sides, and proves the check actually discriminates
by planting a one-byte change that it must catch.

The canonical core is the OpenClaw onboarding tree
(``<build>/onboarding/75-drama-song-ad-factory/scripts/core``), exactly as
``references/parity-contract.md`` states and ``tests/test_parity_layout.py``
enforces. The packaged copy is this skill's own ``scripts/core``.

Scope (identical on both sides): every file under ``scripts/core/``.
Exclusions (identical on both sides): ``__pycache__/`` and ``*.pyc``.
No other normalisation is applied - bytes are hashed exactly as read, so a
real content difference can never be hidden by whitespace or line-ending
handling.

Usage:
  python3 tests/twin_sync_prove.py [--canonical DIR] [--packaged DIR] [--selftest]
  DSAF_CANONICAL_CORE=/path/to/scripts/core overrides the canonical default.

Exit codes:
  0  parity PROVEN, or PARITY UNDETERMINED (canonical tree not on this machine
     - undetermined is recorded as such, it is not a pass), or selftest PASS
  1  parity BROKEN, or the selftest failed to discriminate
"""
import argparse
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
SKILL = HERE.parents[1]
BUILD = SKILL.parents[3]
DEFAULT_CANONICAL = Path(os.environ.get(
    "DSAF_CANONICAL_CORE",
    BUILD / "onboarding" / "75-drama-song-ad-factory" / "scripts" / "core"))


def tree(root):
    """sha256 per file, relative posix path. Caches are skipped on BOTH sides."""
    out = {}
    for p in sorted(Path(root).rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def compare(canonical, packaged):
    """Return (ok, canonical_map, packaged_map, report_lines)."""
    c = tree(canonical)
    p = tree(packaged)
    only_c = sorted(set(c) - set(p))
    only_p = sorted(set(p) - set(c))
    differ = sorted(r for r in set(c) & set(p) if c[r] != p[r])
    lines = []
    for r in sorted(set(c) | set(p)):
        hc, hp = c.get(r), p.get(r)
        if hc and hp and hc == hp:
            status = "same"
        elif hc and hp:
            status = "DIFFER"
        elif hc:
            status = "only-canonical"
        else:
            status = "only-packaged"
        if status != "same":
            lines.append(f"  {status:<15} {r}  canonical={hc} packaged={hp}")
    n_same = len(set(c) & set(p)) - len(differ)
    lines.append(f"  summary: same={n_same} differ={len(differ)} "
                 f"only-canonical={len(only_c)} only-packaged={len(only_p)}")
    ok = not only_c and not only_p and not differ
    return ok, c, p, lines


def run(canonical, packaged, label):
    print(f"[{label}] scope=scripts/core/ (excl __pycache__/*.pyc) on both sides")
    print(f"[{label}] canonical={canonical}")
    print(f"[{label}] packaged ={packaged}")
    ok, c, p, lines = compare(canonical, packaged)
    for ln in lines:
        print(ln)
    print(f"[{label}] PARITY: {'PROVEN (byte-identical over same scope)' if ok else 'BROKEN'}")
    return ok


def selftest():
    """The check must catch a planted one-byte change and pass on an exact copy."""
    tmp = Path(tempfile.mkdtemp(prefix="twin-sync-selftest-"))
    try:
        base = tmp / "base"
        (base / "pkg").mkdir(parents=True)
        (base / "pkg" / "__init__.py").write_bytes(b"")
        (base / "pkg" / "mod.py").write_bytes(b"VALUE = 1\n")
        good = tmp / "good"
        shutil.copytree(base, good)
        # control 1: exact copy must be PROVEN
        ok_good, *_ = compare(base, good)
        # control 2: one planted byte must be detected
        bad = tmp / "bad"
        shutil.copytree(base, bad)
        (bad / "pkg" / "mod.py").write_bytes(b"VALUE = 2\n")
        ok_bad, *_ = compare(base, bad)
        # control 3: a planted extra file must be detected
        extra = tmp / "extra"
        shutil.copytree(base, extra)
        (extra / "pkg" / "added.py").write_bytes(b"# new\n")
        ok_extra, *_ = compare(base, extra)
        good_ok = ok_good is True
        caught_diff = ok_bad is False
        caught_extra = ok_extra is False
        print(f"[selftest] identical copy proven?          {good_ok} (want True)")
        print(f"[selftest] one-byte change caught?         {caught_diff} (want True)")
        print(f"[selftest] extra-file change caught?       {caught_extra} (want True)")
        passed = good_ok and caught_diff and caught_extra
        print(f"[selftest] SELFTEST: {'PASS' if passed else 'FAIL'}")
        return passed
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Twin-sync prover (U18).")
    ap.add_argument("--canonical", default=str(DEFAULT_CANONICAL))
    ap.add_argument("--packaged", default=str(SKILL / "scripts" / "core"))
    ap.add_argument("--selftest", action="store_true",
                    help="plant a bad case and prove the check discriminates")
    a = ap.parse_args(argv)

    rc = 0
    if a.selftest and not selftest():
        rc = 1

    canonical = Path(a.canonical)
    if not canonical.is_dir():
        print(f"PARITY UNDETERMINED: canonical core not on this machine: {canonical}")
        print("  (clean install; this is NOT a parity pass)")
        return rc
    ok = run(canonical, Path(a.packaged), "parity")
    if not ok:
        rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
