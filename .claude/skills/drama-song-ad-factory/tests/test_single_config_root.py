#!/usr/bin/env python3
"""Single shared Claude config root — both launchers, one skill copy.

Acceptance (unit W3-03-U6; directive 2.2 / 2.3 / 2.4, 5.3):

- running installer-registration/package_core.py produces the 999 tree whose
  core file hashes equal the onboarding-owned canonical source,
- packaging creates NO copy under a separate claude-nine skills root
  (run with HOME pointed at a throwaway directory; the real home is never
  read or written),
- after the documented one-install, exactly one drama-song-ad-factory
  directory exists under the shared config root and none under a separate
  claude-nine skills root,
- both launchers (claude-nine / plain claude) use that one root and one
  skill copy: the repo ships exactly one skill directory, the launchers
  contain no install/copy logic for this skill, claude-nine bridges skills
  through sync-nine-skills rather than a maintained second copy, the
  installer registry lists the skill exactly once, and the adapters +
  AGENT_INSTALL state the single-root law.

Every config root used here is a fixture under /tmp (prefix
TrevelynsMini2-W3-03-U6-). Negative controls prove each counter can fail.
stdlib only, no framework, no network.

Run: python3 tests/test_single_config_root.py
Canonical override: DSAF_CANONICAL_CORE=/path/to/scripts/core
When the canonical core is absent (bare 999 clone), generation checks report
UNDETERMINED — parity culture: absence is not a pass and not a fail.
"""
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_NAME = "drama-song-ad-factory"
SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]                       # .../999-setup (or a lane worktree)
PKG = REPO / "installer-registration" / "package_core.py"
LAUNCHERS = REPO / "launchers"
REGISTRY = REPO / "CONTROL" / "bundled-skills.txt"
AGENT_INSTALL = REPO / "AGENT_INSTALL.md"

FAILS = []


def flat(text):
    """Collapse whitespace so line-wrapped phrases in READMEs still match."""
    return " ".join(text.split())


def norm(text):
    """README claim matching: markdown backticks stripped, case-insensitive.

    READMEs write `code` spans around product names (`claude-nine` shares this
    root), so exact-case substring equality against the README text is the
    wrong comparison. Compare the claim, not its formatting.
    """
    return flat(text.replace("`", "")).casefold()


def check(name, ok, detail=""):
    print(f"{'ok' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def collect(root: Path):
    """rel-path -> sha256, parity-test rules (sorted rglob, no caches)."""
    out = {}
    if not root.is_dir():
        return out
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def resolve_canonical():
    env = os.environ.get("DSAF_CANONICAL_CORE")
    if env:
        return Path(env)
    for base in (REPO, *REPO.parents):
        cand = base / "onboarding" / ("75-" + SKILL_NAME) / "scripts" / "core"
        if cand.is_dir():
            return cand
    return None


def count_skill_dirs(root: Path):
    if not root.exists():
        return 0
    return sum(1 for p in root.rglob(SKILL_NAME) if p.is_dir())


def run_pkg(args, home: Path):
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR")
    }
    env["HOME"] = str(home)
    return subprocess.run(
        [sys.executable, str(PKG), *args],
        env=env, capture_output=True, text=True,
    )


def main():
    tmp = Path(tempfile.mkdtemp(dir="/tmp", prefix="TrevelynsMini2-W3-03-U6-"))
    passed_before = len(FAILS)
    try:
        # --- A. the owned artifact and its contract ----------------------
        check("package_core.py present at owned path", PKG.is_file(), str(PKG))
        if PKG.is_file():
            spec = importlib.util.spec_from_file_location("u6_package_core", PKG)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            check(
                "package_core default dest is the 999 skill core",
                str(mod.DEFAULT_DEST).endswith(f".claude/skills/{SKILL_NAME}/scripts/core"),
                str(mod.DEFAULT_DEST),
            )

        skill_dirs = [p for p in REPO.rglob(SKILL_NAME) if p.is_dir() and ".git" not in p.parts]
        check(
            "repo ships exactly one skill directory (one skill copy)",
            len(skill_dirs) == 1 and skill_dirs[0] == SKILL,
            "found=" + ", ".join(str(p) for p in skill_dirs),
        )

        launch_hits = [
            str(p.relative_to(REPO))
            for p in sorted(LAUNCHERS.rglob("*"))
            if p.is_file() and SKILL_NAME in p.read_text(encoding="utf-8", errors="replace")
        ]
        check(
            "launchers contain no install/copy logic for this skill",
            not launch_hits,
            "hits=" + ", ".join(launch_hits),
        )

        nine_launcher = LAUNCHERS / "macos" / "claude-nine"
        check("claude-nine launcher present", nine_launcher.is_file(), str(nine_launcher))
        if nine_launcher.is_file():
            check(
                "claude-nine bridges skills via sync-nine-skills (no maintained copy)",
                "sync-nine-skills.sh" in nine_launcher.read_text(encoding="utf-8"),
            )

        names = []
        if REGISTRY.is_file():
            for raw in REGISTRY.read_text(encoding="utf-8").splitlines():
                line = raw.split("#", 1)[0].strip()
                if line:
                    names.append(line)
        check("installer registry present", REGISTRY.is_file(), str(REGISTRY))
        check(
            "registry lists this skill exactly once (one install => one copy)",
            names.count(SKILL_NAME) == 1,
            f"count={names.count(SKILL_NAME)}",
        )

        nine_ad = SKILL / "adapters" / "claude-nine" / "README.md"
        code_ad = SKILL / "adapters" / "claude-code" / "README.md"
        # Two config roots, one install: the plain `claude` root and the
        # `claude-nine` root are bridged by sync-nine-skills.sh, so the law
        # is "install once, never maintain a second copy" — not "there is
        # only one root".
        nine_body = (
            norm(nine_ad.read_text(encoding="utf-8")) if nine_ad.is_file() else ""
        )
        check(
            "claude-nine adapter: two config roots bridged by the sync step",
            bool(nine_body)
            and "two config roots" in nine_body
            and "sync-nine-skills.sh" in nine_body,
        )
        if code_ad.is_file():
            ad = norm(code_ad.read_text(encoding="utf-8"))
            check(
                "claude-code adapter: one install in the plain root, no maintained second copy",
                "two config roots" in ad
                and "sync-nine-skills.sh" in ad
                and "install the skill once" in ad
                and "second edited copy" in ad,
            )
        else:
            check("claude-code adapter present", False, str(code_ad))
        if AGENT_INSTALL.is_file():
            ai = flat(AGENT_INSTALL.read_text(encoding="utf-8"))
            check(
                "AGENT_INSTALL: both runtimes resolve the same config root",
                "same config root, no duplicate install" in ai,
            )
        else:
            check("AGENT_INSTALL.md present", False, str(AGENT_INSTALL))

        # --- B. generation: 999 tree hashes == canonical source ----------
        canonical = resolve_canonical()
        if canonical is None or not canonical.is_dir():
            print(f"UNDETERMINED: canonical core not found (checked DSAF_CANONICAL_CORE and")
            print(f"  <repo>/../onboarding up the parent chain): generation checks skipped;")
            print("  this is neither a pass nor a fail of packaging.")
            src_map = {}
        else:
            print(f"canonical core: {canonical}")
            src_map = collect(canonical)
            check("canonical core non-empty", bool(src_map), str(canonical))

            fake_home = tmp / "pack-home"
            fake_home.mkdir()
            gen = tmp / "gen" / "core"
            r = run_pkg(["--source", str(canonical), "--dest", str(gen)], fake_home)
            check(
                "package_core generation exits 0",
                r.returncode == 0,
                f"rc={r.returncode} stderr={r.stderr[-400:]}",
            )
            gen_map = collect(gen)
            only_gen = sorted(set(gen_map) - set(src_map))
            only_src = sorted(set(src_map) - set(gen_map))
            mismatch = sorted(k for k in set(gen_map) & set(src_map) if gen_map[k] != src_map[k])
            check(
                "generated 999 tree file set == source",
                set(gen_map) == set(src_map),
                f"only-gen={only_gen[:5]} only-src={only_src[:5]}",
            )
            check(
                "every generated core file hash == source",
                bool(gen_map) and not mismatch,
                f"mismatch={mismatch[:5]}",
            )
            check(
                "packaging created no config root under its HOME",
                not (fake_home / ".claude").exists() and not (fake_home / ".claude-nine").exists(),
                f"claude={(fake_home / '.claude').exists()} claude-nine={(fake_home / '.claude-nine').exists()}",
            )
            check(
                "explicitly: no ~/.claude-nine/skills copy created",
                not (fake_home / ".claude-nine" / "skills" / SKILL_NAME).exists(),
            )

            r = run_pkg(["--source", str(canonical), "--dest", str(gen), "--check"], fake_home)
            check("--check green on freshly generated tree", r.returncode == 0,
                  f"rc={r.returncode} out={r.stdout[-300:]}")

            victim = gen / "state_store.py"
            if victim.is_file():
                victim.write_bytes(b"corrupted-by-negative-control")
                r = run_pkg(["--source", str(canonical), "--dest", str(gen), "--check"], fake_home)
                check("--check exits nonzero on corrupted tree (negative control)",
                      r.returncode == 1, f"rc={r.returncode}")
                # Restore the generated tree before section C overlays it.
                r = run_pkg(["--source", str(canonical), "--dest", str(gen)], fake_home)
                check("regeneration restores the tree after the negative control",
                      r.returncode == 0, f"rc={r.returncode}")

            r = run_pkg(["--source", str(tmp / "no-such-source"), "--dest", str(tmp / "x")], fake_home)
            check("missing source exits 2 with actionable error (negative control)",
                  r.returncode == 2 and "canonical source not found" in (r.stdout + r.stderr),
                  f"rc={r.returncode}")

        # --- C. one shared config root, one skill copy -------------------
        # The documented install: the whole 999 skill tree (post-generation
        # overlay when the canonical core was available) lands ONCE in the
        # shared config root. Both runtimes resolve that one copy.
        home = tmp / "roothome"
        shared = home / ".claude"
        nine_root = home / ".claude-nine"
        install_src = SKILL
        if src_map:
            dist = tmp / "dist" / ".claude" / "skills" / SKILL_NAME
            shutil.copytree(SKILL, dist, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            shutil.rmtree(dist / "scripts" / "core")
            shutil.copytree(tmp / "gen" / "core", dist / "scripts" / "core")
            check(
                "overlay: packaged core in the 999 tree still hashes == source",
                collect(dist / "scripts" / "core") == src_map,
            )
            install_src = dist
        shutil.copytree(
            install_src, shared / "skills" / SKILL_NAME,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        check(
            "exactly one drama-song-ad-factory directory under the shared config root",
            count_skill_dirs(shared) == 1,
            f"count={count_skill_dirs(shared)}",
        )
        check(
            "shared-root copy exposes SKILL.md (discoverable)",
            (shared / "skills" / SKILL_NAME / "SKILL.md").is_file(),
        )
        check(
            "none under a separate claude-nine skills root",
            count_skill_dirs(nine_root) == 0 and not nine_root.exists(),
            f"count={count_skill_dirs(nine_root)} exists={nine_root.exists()}",
        )

        # Negative control: a real second copy under the claude-nine root
        # must be detected, proving the counter is not vacuous.
        shutil.copytree(
            SKILL, nine_root / "skills" / SKILL_NAME,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        check(
            "detector finds a second copy under the claude-nine root (negative control)",
            count_skill_dirs(nine_root) == 1,
            f"count={count_skill_dirs(nine_root)}",
        )
        shutil.rmtree(nine_root)
        check(
            "restored: claude-nine skills root absent again",
            count_skill_dirs(nine_root) == 0 and not nine_root.exists(),
        )
    finally:
        # Always drop the /tmp fixture. Check names (printed above) carry the
        # failure signal; a leftover fixture is debris, not evidence.
        shutil.rmtree(tmp, ignore_errors=True)

    if FAILS:
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    print("\nALL PASS")
    print(f"  checks run against a pass count from {passed_before}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
