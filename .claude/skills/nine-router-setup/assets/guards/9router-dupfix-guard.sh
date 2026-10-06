#!/bin/bash
# 9router-dupfix-guard.sh — keeps the 9Router stream-translator fix applied.
#
# THE BUG (found and measured 2026-07-28): 9Router's OPENAI→CLAUDE stream
# translator emits buffered tool-call arguments when it sees `finish_reason`,
# with no idempotency guard and without clearing its buffers. Providers that
# send `finish_reason` TWICE — once on the real chunk, once on the trailing
# usage chunk — make the whole tail re-emit, so the harness receives doubled
# argument JSON: {"skill":"judge-unit"}{"skill":"judge-unit"}. That is not
# parseable, so the tool call is rejected. Measured 20/20 corrupt before the
# fix, 0/30 after. It killed roughly half of every tool call.
#
# THE FIX: gate each CLAUDE-target finish block on `!b.finishReason`, the state
# flag that block itself sets at the end. A duplicate finish_reason chunk then
# becomes a no-op.
#
# ---------------------------------------------------------------------------
# REWRITTEN 2026-08-03. The previous version hardcoded chunk `6805.js`. The
# 0.5.40 -> 0.5.45 update RENUMBERED the chunks, so that path stopped existing
# and the script took its `target not found` branch and **exited 0** — it
# reported success while the bug ran unpatched. Two changes:
#
#   1. LOCATE THE CHUNK BY CONTENT, never by number. Survives renumbering.
#   2. PATCH ONLY CLAUDE-TARGET SITES. The old blanket regex hit every
#      `if(X.finish_reason)` in the file, including one in the
#      OPENAI_RESPONSES->OPENAI translator that is NOT this bug. A site only
#      qualifies if its own block assigns `b.finishReason=` (that assignment
#      is what makes the guard idempotent). In 0.5.45 that is 2 of 3 sites.
# ---------------------------------------------------------------------------
#
# Exit codes: 0 = patch present (already, or re-applied). 1 = could not apply.
# --check: read-only. Prints already-applied / WOULD PATCH / AMBIGUOUS and
# writes nothing. Exit 0 = already-applied or would-patch (target found, no
# problem). Exit 2 = 9router install/chunks dir not found at all. Exit 3 =
# the anchor itself is missing/ambiguous within an existing target (build
# shape changed) — consistent with 9router-glm53-thinking-guard.sh /
# 9router-agnes30-caps-guard.sh's convention.
set -uo pipefail

CHECK=0; QUIET=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --quiet) QUIET="--quiet" ;;
  esac
done
say() { [ "$QUIET" = "--quiet" ] || echo "$@" >&2; }

# Find the 9router install regardless of npm prefix (npm-global, homebrew,
# system /usr, or whatever `npm root -g` resolves to on this box).
#
# npm is resolved by ABSOLUTE PATH first: a non-login SSH shell has
# PATH=/usr/bin:/bin:/usr/sbin:/sbin, where a bare `npm` is NOT found. The
# `npm root -g` call is guarded so a missing npm cannot abort this script
# under `set -uo pipefail`.
NPM_BIN=""
for p in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
  if [ -x "$p" ]; then NPM_BIN="$p"; break; fi
done
if [ -z "$NPM_BIN" ]; then
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
fi
NPM_ROOT=""
if [ -n "$NPM_BIN" ]; then
  NPM_ROOT="$("$NPM_BIN" root -g 2>/dev/null || true)"
fi

SEARCH_DIRS="$HOME/.npm-global/lib/node_modules/9router /opt/homebrew/lib/node_modules/9router /usr/local/lib/node_modules/9router /usr/lib/node_modules/9router $HOME/.local/share/999/npm/lib/node_modules/9router"
[ -n "$NPM_ROOT" ] && SEARCH_DIRS="$SEARCH_DIRS $NPM_ROOT/9router"

CHUNKS=""
for d in $SEARCH_DIRS; do
  if [ -d "$d/app/.next-cli-build/server/chunks" ]; then
    CHUNKS="$d/app/.next-cli-build/server/chunks"
    break
  fi
done

if [ -z "$CHUNKS" ]; then
  say "9router-dupfix: no 9router chunks dir found. Searched: $SEARCH_DIRS — NOT guarded."
  say "   The 50% tool-call corruption is LIVE (unguarded) if 9router is installed elsewhere."
  if [ "$CHECK" = "1" ]; then exit 2; fi
  exit 1
fi

/usr/bin/python3 - "$CHUNKS" "$QUIET" "$CHECK" <<'PY'
import glob, os, re, shutil, subprocess, sys, time

chunks_dir, quiet, check = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
def say(*a):
    if quiet != "--quiet":
        print(*a, file=sys.stderr)

SITE = re.compile(r'if\((?P<var>[A-Za-z_$][\w$]*)\.finish_reason\)')
WINDOW = 2500  # a CLAUDE-target block assigns b.finishReason well within this

def claude_target_sites(s):
    """Sites whose own block assigns b.finishReason — i.e. the CLAUDE-target
    translators. Excludes the OPENAI_RESPONSES->OPENAI site, which never does."""
    return [m for m in SITE.finditer(s)
            if re.search(r'b\.finishReason\s*=', s[m.end():m.end() + WINDOW])]

# Collect EVERY matching file, not just the first. If the CLAUDE-target sites
# ever split across two chunk files, a scan that stops at the first match
# leaves the second file unpatched with no warning.
targets = []  # list of (path, text, sites)
for path in sorted(glob.glob(os.path.join(chunks_dir, "*.js"))):
    try:
        s = open(path, encoding="utf-8", errors="surrogateescape").read()
    except OSError:
        continue
    found = claude_target_sites(s)
    if found:
        targets.append((path, s, found))

if not targets:
    # Either already patched everywhere, or the build shape changed.
    for path in sorted(glob.glob(os.path.join(chunks_dir, "*.js"))):
        s = open(path, encoding="utf-8", errors="surrogateescape").read()
        # `!b.__cxTerm)` is this same protection under a namespaced flag, applied
        # by 9router-codex-terminal-guard.sh. It had to rename the flag because
        # `finishReason` is ALSO set by the upstream hop of a chained conversion
        # (openai-responses -> openai -> claude), which made this guard suppress
        # the Anthropic terminal events and broke every cx/* model. The dedup
        # protection is identical — the block still no-ops on a duplicate
        # finish_reason chunk — so treat it as present, not missing.
        if "!b.finishReason)" in s or "!b.__cxTerm)" in s:
            if check:
                print(f"already-applied: {os.path.basename(path)}")
                sys.exit(0)
            say(f"9router-dupfix: patch present in {os.path.basename(path)}.")
            sys.exit(0)
    if check:
        print("AMBIGUOUS: no CLAUDE-target finish_reason site found and no patch "
              "marker present anywhere under " + chunks_dir + " — build shape changed")
        sys.exit(3)
    say("9router-dupfix: no CLAUDE-target finish_reason site found and no patch "
        "marker present — the build shape changed. NOT edited; inspect by hand.")
    sys.exit(1)

if check:
    # Target(s) found and unpatched — report and stop. Nothing opened for
    # writing, no backup taken, no node --check subprocess spawned: this
    # branch returns before any of that code runs.
    names = ", ".join(f"{os.path.basename(t)} ({len(sites)} site(s))" for t, _, sites in targets)
    print(f"WOULD PATCH: {names}")
    sys.exit(0)

# Resolve node by absolute path, ONCE. A non-login SSH shell has PATH=/usr/bin:
# /usr/sbin:/sbin, where `env node` is NOT found — relying on PATH made this
# check fail on a perfectly good patch and roll it back.
node_bin = next(
    (p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node",
                 os.path.expanduser("~/.local/opt/node/bin/node"),
                 shutil.which("node")) if p and os.path.exists(p)),
    None,
)
if node_bin is None:
    say("9router-dupfix: cannot locate a node binary to syntax-check with. "
        "NOT edited; would leave an unverified edit in place.")
    sys.exit(1)

total_sites, patched_files = 0, []
for target, text, sites in targets:
    say(f"⚠️  9router-dupfix: PATCH MISSING in {os.path.basename(target)} "
        f"({len(sites)} CLAUDE-target site(s)). Re-applying.")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = f"{target}.pre-dupfix-{stamp}"
    shutil.copy2(target, backup)

    # Rewrite right-to-left so earlier offsets stay valid.
    out = text
    for m in reversed(sites):
        out = out[:m.start()] + f"if({m.group('var')}.finish_reason&&!b.finishReason)" + out[m.end():]

    open(target, "w", encoding="utf-8", errors="surrogateescape").write(out)

    if subprocess.run([node_bin, "--check", target], capture_output=True).returncode != 0:
        shutil.copy2(backup, target)
        say(f"9router-dupfix: re-applied {os.path.basename(target)} does not parse. Restored the backup.")
        say("   The 50% tool-call corruption is LIVE until this is fixed by hand.")
        sys.exit(1)

    say(f"✅ 9router-dupfix: patched {len(sites)} site(s) in {os.path.basename(target)} "
        f"and syntax-checked.")
    say(f"   Backup: {backup}")
    total_sites += len(sites)
    patched_files.append(os.path.basename(target))

say(f"✅ 9router-dupfix: done — {total_sites} site(s) across {len(patched_files)} file(s) "
    f"({', '.join(patched_files)}). Restart 9router to load it.")
sys.exit(0)
PY
exit $?
