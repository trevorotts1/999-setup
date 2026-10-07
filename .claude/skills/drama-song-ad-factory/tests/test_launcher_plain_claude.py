#!/usr/bin/env python3
"""Plain Claude Code launcher contract — adapters/claude-code/README.md.

Acceptance (unit W3-03-U3, directive §26 "Under plain Claude Code", §2.2,
§5.3):

- the README states plain `claude` is non-routed and that there is no
  separate skill root (one shared root with `claude-nine`),
- the README lists discovery check commands,
- environment shows no 9Router base URL / routing set by the skill:
  no skill file writes routing env (static scan) and the shared control
  entrypoint runs to its documented envelope in a scrubbed environment
  (no router base URL, no separate config root handed to it),
- core path identical to the claude-nine launcher: exactly one
  factory.py under the skill, at the canonical relative path, resolved
  identically from both adapter folders, README names that exact path.

stdlib only, no framework, no network.
Run: python3 tests/test_launcher_plain_claude.py
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
ADAPTERS = SKILL / "adapters"
README = ADAPTERS / "claude-code" / "README.md"
NINE_README = ADAPTERS / "claude-nine" / "README.md"
FACTORY = SKILL / "scripts" / "core" / "intake_preflight" / "factory.py"
BRIEF = SKILL / "assets" / "example-brief.json"
CORE_REL = "scripts/core/intake_preflight/factory.py"

# Assignments that would route plain claude or fork the config root.
# (Built with \\s* so this file's own pattern source never self-matches.)
FORBIDDEN = [
    (re.compile(r"\bCLAUDE_CONFIG_DIR\s*="), "writes a separate config root"),
    (re.compile(r"\bANTHROPIC_BASE_URL\s*="), "writes a router/model base URL"),
    (re.compile("localhost:" + "20128"), "hardcodes the local router port"),
]
SCAN_SUFFIXES = {".md", ".py", ".sh", ".js", ".mjs", ".ps1", ".json", ".txt"}

# Env keys that mean "routing / separate config root"; stripped for the
# dynamic run so the skill proves it neither needs nor reintroduces them.
ROUTING_KEYS = ("ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR")

FAILS = []
SKIPPED = []


def check(name, ok, detail=""):
    print(f"{'ok' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def flat(text):
    return re.sub(r"\s+", " ", text)


def main():
    # --- README: plain claude is non-routed, no separate skill root ------
    check("README present", README.is_file(), str(README))
    if not README.is_file():
        print(f"\n1 FAILED: README missing")
        return 1
    text = README.read_text(encoding="utf-8")
    norm = flat(text)

    check("README states plain claude is non-routed",
          "Plain `claude` must remain non-routed" in norm)
    check("README forbids a separate config root",
          "Never set a separate `CLAUDE_CONFIG_DIR`" in norm)
    check("README forbids a second skills root",
          "never create a second skills root" in norm)
    check("README says claude-nine shares the one root",
          "claude-nine shares this root" in norm
          or "`claude-nine` shares this root" in norm)
    check("README says the skill itself writes no routing env",
          "no file in this skill writes router/routing environment variables" in norm)

    # --- README: discovery check commands listed -------------------------
    fences = re.findall(r"```(?:bash|sh)?\n(.*?)```", text, re.S)
    disc = "\n".join(f for f in fences if "test -f" in f and "SKILL.md" in f)
    check("README lists a discovery check fence", bool(disc))
    check("discovery command: skill file testable",
          "test -f ~/.claude/skills/drama-song-ad-factory/SKILL.md" in flat(disc))
    check("discovery command: frontmatter grep",
          "grep -m1 '^name: drama-song-ad-factory'" in flat(disc))
    check("discovery command: loadable subfolders",
          "for d in references scripts assets tests adapters" in flat(disc))
    check("discovery command: no router env written by skill",
          "ANTHROPIC_BASE_URL[[:space:]]*=" in flat(disc))
    check("README points at this launcher test",
          "tests/test_launcher_plain_claude.py" in text)

    # --- environment: skill sets no 9Router base URL / routing -----------
    scanned = 0
    for p in sorted(SKILL.rglob("*")):
        if not p.is_file() or p.suffix not in SCAN_SUFFIXES:
            continue
        scanned += 1
        body = p.read_text(encoding="utf-8", errors="replace")
        for rx, why in FORBIDDEN:
            if rx.search(body):
                check(f"no forbidden write in {p.relative_to(SKILL)}: {why}", False)
    check(f"static scan covered skill text files ({scanned})", scanned > 0)

    # Dynamic: run the shared entrypoint in a scrubbed environment —
    # no router base URL, no config root — and require the documented
    # intake envelope. The skill must neither need nor add routing.
    scrub = {k: v for k, v in os.environ.items() if k not in ROUTING_KEYS}
    check("scrubbed env has no router base URL",
          "ANTHROPIC_BASE_URL" not in scrub)
    check("scrubbed env has no separate config root",
          "CLAUDE_CONFIG_DIR" not in scrub)
    check("entrypoint present", FACTORY.is_file(), str(FACTORY))
    check("example brief present", BRIEF.is_file(), str(BRIEF))
    if FACTORY.is_file() and BRIEF.is_file():
        proc = subprocess.run(
            [sys.executable, str(FACTORY), "intake", "--brief-file", str(BRIEF)],
            capture_output=True, text=True, timeout=120, env=scrub,
        )
        try:
            env = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            check("scrubbed run stdout is one JSON envelope", False, str(exc))
            env = {}
        else:
            check("scrubbed run stdout is one JSON envelope", True)
        check("scrubbed intake exit 2 (waiting)", proc.returncode == 2, str(proc.returncode))
        check("scrubbed intake outcome waiting", env.get("outcome") == "waiting",
              str(env.get("outcome")))
        check("scrubbed intake reason missing-essentials",
              env.get("reason_code") == "missing-essentials", str(env.get("reason_code")))
        out = proc.stdout + proc.stderr
        check("run output carries no router base URL", "ANTHROPIC_BASE_URL" not in out)
        check("run output carries no router port", "20128" not in out)
        check("run output carries no router address", "127.0.0.1" not in out)

    # --- core path identical to the claude-nine launcher -----------------
    found = sorted(
        p for p in SKILL.rglob("factory.py") if "__pycache__" not in p.parts
    )
    check("exactly one factory.py under the skill", len(found) == 1,
          str([str(p.relative_to(SKILL)) for p in found]))
    if found:
        check("the one factory.py is at the canonical core path",
              found[0].relative_to(SKILL).as_posix() == CORE_REL,
              found[0].relative_to(SKILL).as_posix())
    check("README names the canonical core path", CORE_REL in text)
    for adapter in ("claude-code", "claude-nine"):
        resolved = (ADAPTERS / adapter / ".." / ".." / CORE_REL).resolve()
        check(f"{adapter} adapter resolves the same shared core",
              resolved == (SKILL / CORE_REL).resolve(),
              f"{resolved} != {(SKILL / CORE_REL).resolve()}")
    check("no adapter-local core copy",
          not any(ADAPTERS.rglob("factory.py")))
    check("claude-nine README present (shared sibling)", NINE_README.is_file())
    if NINE_README.is_file():
        nine = NINE_README.read_text(encoding="utf-8")
        nine_paths = set(re.findall(r"scripts/core/[\w./-]+\.py", nine))
        check("claude-nine README names no conflicting core path",
              not (nine_paths - {CORE_REL}), str(sorted(nine_paths)))
        check("claude-nine README documents the same control entrypoint",
              "control entrypoint" in flat(nine))

    # Installed claude-nine root, when present, must carry the same core.
    nine_root = Path.home() / ".claude-nine" / "skills" / "drama-song-ad-factory"
    nine_factory = nine_root / CORE_REL
    if nine_factory.is_file() and FACTORY.is_file():
        h1 = hashlib.sha256(FACTORY.read_bytes()).hexdigest()
        h2 = hashlib.sha256(nine_factory.read_bytes()).hexdigest()
        check("installed claude-nine root core is byte-identical", h1 == h2,
              f"repo={h1[:12]} nine={h2[:12]}")
    else:
        SKIPPED.append("installed ~/.claude-nine skill copy absent")
        print(f"UNDETERMINED: installed claude-nine skill root not on this machine: "
              f"{nine_root} (not a pass — record as undetermined)")

    if SKIPPED:
        print(f"SKIPPED: {len(SKIPPED)} check(s): " + "; ".join(SKIPPED))
    if FAILS:
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    print("\nALL PASS" + (" (installed claude-nine root undetermined)" if SKIPPED else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
