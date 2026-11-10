#!/usr/bin/env python3
"""Twin-sync fingerprint rows: generator AND test (one file).

`references/twin-sync-fingerprints.json` keeps one row per path in the union of
the canonical (onboarding) and packaged (999) `scripts/core/` trees. This file
is the only tool that writes those rows and the only check that verifies them.

Write mode (rewrites only files, summary, canonical.{base_sha,branch,tree_sha256},
packaged.{base_sha,branch,tree_sha256}, unit, generated_by; every other key is
left byte for byte):
  python3 tests/test_twin_sync_fingerprints.py --write --canonical <onboarding scripts/core dir> \
      --canonical-sha <sha> --packaged-sha <sha>

Test mode (pytest function, or `python3 tests/test_twin_sync_fingerprints.py`):
  ALWAYS: real packaged files + sha256 == packaged side of the rows; every match
          flag == (canonical == packaged); summary == counts recomputed from rows.
  LIVE:   when DSAF_CANONICAL_CORE is set, or the build-tree default exists, the
          canonical side is checked the same way. Set but missing = FAIL.
          Absent = printed UNDETERMINED, never a pass.

Any change to scripts/core on either side requires re-running write mode.
Scope and exclusions come from twin_sync_prove.tree() (no __pycache__, no *.pyc).
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent))
from twin_sync_prove import SKILL, DEFAULT_CANONICAL, tree as _tree  # noqa: E402


def tree(root):
    """twin_sync_prove.tree() minus ignored .pytest_cache dirs (untracked, never in a checkout)."""
    return {k: v for k, v in _tree(root).items() if ".pytest_cache/" not in k}

FINGERPRINTS = SKILL / "references" / "twin-sync-fingerprints.json"
PACKAGED = SKILL / "scripts" / "core"
ENV = "DSAF_CANONICAL_CORE"
GENERATED_BY = ("python3 .claude/skills/drama-song-ad-factory/tests/test_twin_sync_fingerprints.py "
                "--write --canonical <onboarding 75-drama-song-ad-factory/scripts/core> "
                "--canonical-sha <onboarding sha> --packaged-sha <999 sha>")


def tree_digest(t):
    return hashlib.sha256("".join(f"{k}  {t[k]}\n" for k in sorted(t)).encode()).hexdigest()


def build_rows(c, p):
    rows = {}
    for r in sorted(set(c) | set(p)):
        rows[r] = {"canonical_sha256": c.get(r), "match": r in c and r in p and c[r] == p[r],
                   "packaged_sha256": p.get(r)}
    return rows


def summarize(rows):
    both = [v for v in rows.values() if v["canonical_sha256"] and v["packaged_sha256"]]
    return {"differ": sum(not v["match"] for v in both), "in_scope_files": len(rows),
            "match": sum(v["match"] for v in rows.values()),
            "only_canonical": sum(not v["packaged_sha256"] for v in rows.values()),
            "only_packaged": sum(not v["canonical_sha256"] for v in rows.values())}


def write(canonical, csha, psha):
    c, p = tree(canonical), tree(PACKAGED)
    d = json.loads(FINGERPRINTS.read_text(encoding="utf-8"))
    d["files"] = build_rows(c, p)
    d["summary"] = summarize(d["files"])
    d["canonical"].update(base_sha=csha, branch="main", tree_sha256=tree_digest(c))
    d["packaged"].update(base_sha=psha, branch="main", tree_sha256=tree_digest(p))
    d["unit"] = "KIE26-FP"
    d["generated_by"] = GENERATED_BY
    FINGERPRINTS.write_text(json.dumps(d, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print("WROTE", d["summary"])


def evaluate():
    d = json.loads(FINGERPRINTS.read_text(encoding="utf-8"))
    rows, errs = d["files"], []
    p = tree(PACKAGED)
    rp = {r: v["packaged_sha256"] for r, v in rows.items() if v["packaged_sha256"]}
    if rp != p:
        errs.append(f"packaged tree != rows: only-rows={sorted(set(rp)-set(p))[:5]} "
                    f"only-disk={sorted(set(p)-set(rp))[:5]} "
                    f"changed={sorted(r for r in set(rp)&set(p) if rp[r]!=p[r])[:5]}")
    for r, v in rows.items():
        if v["match"] != (v["canonical_sha256"] == v["packaged_sha256"] and v["packaged_sha256"] is not None):
            errs.append(f"match flag wrong: {r}")
    if d["summary"] != summarize(rows):
        errs.append(f"summary {d['summary']} != recomputed {summarize(rows)}")
    live = Path(os.environ[ENV]) if ENV in os.environ else DEFAULT_CANONICAL
    if live.is_dir():
        rc = {r: v["canonical_sha256"] for r, v in rows.items() if v["canonical_sha256"]}
        if rc != tree(live):
            errs.append(f"canonical tree {live} != rows")
        print(f"LIVE canonical checked: {live}")
    elif ENV in os.environ:
        errs.append(f"{ENV} set but missing: {live}")
    else:
        print(f"UNDETERMINED: canonical side not checked (no tree at {live}); this is not a pass")
    return errs


def test_twin_sync_fingerprints():
    errs = evaluate()
    assert not errs, "\n".join(errs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--canonical")
    ap.add_argument("--canonical-sha")
    ap.add_argument("--packaged-sha")
    a = ap.parse_args()
    if a.write:
        if not (a.canonical and a.canonical_sha and a.packaged_sha):
            ap.error("--write needs --canonical --canonical-sha --packaged-sha")
        write(Path(a.canonical), a.canonical_sha, a.packaged_sha)
        return 0
    errs = evaluate()
    for e in errs:
        print("FAIL:", e)
    print("FAIL" if errs else "PASS")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
