#!/bin/bash
# 9router-nextserver-guard.sh — keeps the 9Router unscoped-kill fix applied.
#
# THE BUG (measured on this box 2026-08-03): 9Router runs, on EVERY startup,
#
#     killAllAppProcesses(port).then(() => killProcessOnPort(port)).then(...)
#
# and killAllAppProcesses() picks its kill victims out of `ps aux` with:
#
#     const isAppProcess =
#       (cmd.includes("node") && cmd.includes("9router") && (...))   // scoped, fine
#       || cmd.includes("next-server");                              // UNSCOPED
#
# then `kill -9`s every match. The first clause is properly scoped to 9router.
# The second is not, and the `port` argument is IGNORED by it — so ANY Next.js
# app on the machine is SIGKILLed every time 9Router starts, kickstarts, or the
# machine reboots. The LaunchAgent sets KeepAlive=true + RunAtLoad=true, so it
# re-fires forever. On this box it had already killed the Command Center and two
# demo apps 51 separate times between 2026-07-15 and 2026-08-03.
#
# WHY THE OBVIOUS FIX DOES NOT WORK: `&& cmd.includes("9router")` looks right and
# is WRONG. Next.js REWRITES its own process title, so both processes appear in
# `ps aux` as a bare string with no path, no port and no owner:
#
#     next-server (v16.2.1)      <- 9Router's own
#     next-server (v14.2.21)     <- Command Center
#
# Scoping on text would silently break 9Router's ability to reap its OWN stale
# server. The version string is brittle (any 9router release bumps it) and the
# port is wrong too (a stale server that already lost its port would become
# unkillable).
#
# THE FIX: discriminate on process ANCESTRY. 9Router's own next-server is always
# a descendant of a 9router cli.js; a PM2/launchd app never is. A second `ps`
# snapshot (`ps -Ao pid,ppid,command` — `ps aux` has no PPID column) builds the
# set of next-server PIDs that are ours, and the clause is narrowed to that set.
# The clause is NARROWED, never deleted: 9Router legitimately needs to reap its
# own stale server.
#
# FAILS CLOSED by design. Any error yields an empty set, so nothing extra dies.
# A stale next-server of ours whose cli.js parent is already gone is still
# reclaimed one step later by killProcessOnPort(), which kills by port.
#
# ---------------------------------------------------------------------------
# Modelled on 9router-dupfix-guard.sh, and inheriting its hard-won rules:
#
#   1. LOCATE THE TARGET BY CONTENT, never by filename or line number. The
#      0.5.40 -> 0.5.45 update renumbered chunks and a pinned path made the
#      dupfix guard exit 0 while the bug ran unpatched for weeks.
#   2. ABSENCE IS A LOUD FAILURE (exit 1), never a silent exit 0.
#   3. Back up before editing; `node --check` via an ABSOLUTE node path; roll
#      back automatically on any verification failure.
#
# There are TWO occurrences of the unscoped clause — a macOS/Linux branch and a
# win32 twin. Only the macOS one is patched (this is a POSIX fix; the win32
# branch reads real command lines out of WMI, where the text scope does work).
# They are told apart by the preceding line: win32 also tests `\9router`.
#
# NINEROUTER_CLI_JS=<path to a cli.js>  (or R9_DIR=<dir holding cli.js>)
# overrides install discovery. Used to exercise the failure paths against a
# pristine COPY — the fallback search paths below are ABSOLUTE, so a `HOME=`
# override alone does NOT sandbox this script and a "target absent" test would
# fall through and patch the real router. That mistake has already patched a
# live box during what its operator believed was a sandbox run.
# ---------------------------------------------------------------------------
#
# Exit codes: 0 = patch present (already, or re-applied). 1 = could not apply.
# --check: read-only. Prints already-applied / WOULD PATCH / AMBIGUOUS and
# writes nothing. Exit 0 = already-applied or would-patch (target found, no
# problem). Exit 2 = no 9router cli.js found at all. Exit 3 = the anchor(s)
# are missing/ambiguous within an existing target (build shape changed) —
# consistent with 9router-glm53-thinking-guard.sh / 9router-agnes30-caps-guard.sh's
# convention.
set -uo pipefail

CHECK=0; QUIET=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --quiet) QUIET="--quiet" ;;
  esac
done
say() { [ "$QUIET" = "--quiet" ] || echo "$@" >&2; }

# Find the 9router install regardless of npm prefix (npm-global vs homebrew).
TARGET=""
# Defined unconditionally (not just inside the discovery branch below) so the
# not-found message below can always name what it searched, even when the
# R9_DIR branch is the one taken. Bash 3.2 under `set -u` aborts on an unset
# variable reference, so this must never be left undefined in any branch.
SEARCH_DIRS=""
if [ -n "${NINEROUTER_CLI_JS:-}" ]; then
  # Explicit target path. Never falls back to discovery: a sandbox test that
  # names a missing file must test the MISSING path, not the real install.
  if [ -f "$NINEROUTER_CLI_JS" ]; then
    TARGET="$NINEROUTER_CLI_JS"
  else
    say "9router-nextserver: NINEROUTER_CLI_JS=$NINEROUTER_CLI_JS does not exist. NOT falling back to install discovery."
    if [ "$CHECK" = "1" ]; then exit 2; fi
    exit 1
  fi
elif [ -n "${R9_DIR:-}" ]; then
  SEARCH_DIRS="$R9_DIR/cli.js (from R9_DIR)"
  [ -f "$R9_DIR/cli.js" ] && TARGET="$R9_DIR/cli.js"
else
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

  for d in $SEARCH_DIRS; do
    if [ -f "$d/cli.js" ]; then
      TARGET="$d/cli.js"
      break
    fi
  done
fi

if [ -z "$TARGET" ]; then
  say "9router-nextserver: no 9router cli.js found. Searched: $SEARCH_DIRS — NOT guarded."
  say "   The unscoped next-server kill is LIVE (unguarded) if 9router is installed elsewhere."
  if [ "$CHECK" = "1" ]; then exit 2; fi
  exit 1
fi

/usr/bin/python3 - "$TARGET" "$QUIET" "$CHECK" <<'PY'
import os, shutil, subprocess, sys, time

target, quiet, check = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
def say(*a):
    if quiet != "--quiet":
        print(*a, file=sys.stderr)

MARKER = "__r9OwnNextServerPids"

# --- anchors, all verified unique in 0.5.45 --------------------------------
# The macOS/Linux clause. The win32 twin differs by also testing `\\9router`,
# so this exact two-line string matches the POSIX branch and nothing else.
ANCHOR_CLAUSE = (
    '              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("/9router")))\n'
    '              || cmd.includes("next-server");'
)
PATCHED_CLAUSE = (
    '              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("/9router")))\n'
    r'              || (cmd.includes("next-server") && __r9OwnNext.has(line.trim().split(/\s+/)[1]));'
)

# Where the per-call ancestry snapshot is taken. Inside the POSIX branch only,
# so the set is rebuilt on every call and can never go stale.
ANCHOR_SPLIT = "          const lines = output.split('\\n');"
PATCHED_SPLIT = (
    "          const lines = output.split('\\n');\n"
    "          const __r9OwnNext = __r9OwnNextServerPids();"
)

ANCHOR_FUNC = "function killAllAppProcesses(appPort) {"
HELPER = r'''// [9router-nextserver-guard] --------------------------------------------------
// Returns the set of next-server PIDs that belong to THIS package.
//
// killAllAppProcesses() whitelists any `ps aux` line containing "next-server".
// Next.js rewrites its process title to "next-server (vX.Y.Z)" — no path, no
// port, no owner — so every unrelated Next.js app on the machine matched and was
// SIGKILLed on every start, kickstart and reboot. Text cannot discriminate;
// ancestry can: our own next-server is always a descendant of a 9router cli.js.
//
// FAILS CLOSED: on any error the set is empty and nothing extra is killed. A
// stale server of ours with no live cli.js parent is still reclaimed one step
// later by killProcessOnPort(), which kills by port.
function __r9OwnNextServerPids() {
  const own = new Set();
  try {
    // `ps aux` has no PPID column, so take a second snapshot that does.
    const snap = execSync("ps -Ao pid=,ppid=,command= 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000
    });
    const parent = new Map();
    const cmdOf = new Map();
    snap.split("\n").forEach((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) return;
      parent.set(m[1], m[2]);
      cmdOf.set(m[1], m[3].toLowerCase());
    });
    const isRouter = (c) =>
      c.includes("9router") && (c.includes("cli.js") || c.includes("/9router"));
    for (const [pid, cmd] of cmdOf) {
      if (!cmd.includes("next-server")) continue;
      let cur = parent.get(pid);
      let hops = 0;
      while (cur && cur !== "0" && cur !== "1" && hops++ < 12) {
        if (isRouter(cmdOf.get(cur) || "")) { own.add(pid); break; }
        cur = parent.get(cur);
      }
    }
  } catch {}
  return own;
}

'''

try:
    text = open(target, encoding="utf-8", errors="surrogateescape").read()
except OSError as e:
    say(f"9router-nextserver: cannot read {target}: {e}")
    sys.exit(1)

base = os.path.basename(target)

# --- idempotent no-op ------------------------------------------------------
if MARKER in text:
    n = text.count("__r9OwnNext.has(")
    if n == 1 and text.count(ANCHOR_CLAUSE) == 0:
        if check:
            print(f"already-applied: {base}")
            sys.exit(0)
        say(f"9router-nextserver: patch present in {base}.")
        sys.exit(0)
    if check:
        print(f"AMBIGUOUS: {base} — marker present but unexpected shape "
              f"({n} narrowed clause(s), {text.count(ANCHOR_CLAUSE)} unscoped clause(s) still present)")
        sys.exit(3)
    say(f"9router-nextserver: {base} contains the marker but is in an UNEXPECTED "
        f"shape ({n} narrowed clause(s), {text.count(ANCHOR_CLAUSE)} unscoped "
        f"clause(s) still present). NOT edited; inspect by hand.")
    sys.exit(1)

# --- absence must be LOUD --------------------------------------------------
missing = [name for name, a in (("clause", ANCHOR_CLAUSE),
                                ("snapshot point", ANCHOR_SPLIT),
                                ("function", ANCHOR_FUNC)) if text.count(a) != 1]
if missing:
    if check:
        print(f"AMBIGUOUS: {base} — expected anchor(s) not found exactly once: {', '.join(missing)}")
        sys.exit(3)
    say(f"9router-nextserver: expected anchor(s) not found exactly once in {base}: "
        f"{', '.join(missing)}. The build shape changed. NOT edited; inspect by hand.")
    say("   The unscoped next-server kill is LIVE until this is fixed.")
    sys.exit(1)

if check:
    # Target found, anchors intact, patch not yet applied — report and stop.
    # Nothing opened for writing, no backup taken, no node --check subprocess
    # spawned: this branch returns before any of that code runs.
    print(f"WOULD PATCH: {base}")
    sys.exit(0)

say(f"⚠️  9router-nextserver: PATCH MISSING in {base}. Applying.")

stamp = time.strftime("%Y%m%d-%H%M%S")
backup = f"{target}.pre-nextserver-{stamp}"
shutil.copy2(target, backup)

out = text.replace(ANCHOR_FUNC, HELPER + ANCHOR_FUNC, 1)
out = out.replace(ANCHOR_SPLIT, PATCHED_SPLIT, 1)
out = out.replace(ANCHOR_CLAUSE, PATCHED_CLAUSE, 1)

open(target, "w", encoding="utf-8", errors="surrogateescape").write(out)

def rollback(msg):
    shutil.copy2(backup, target)
    say(f"9router-nextserver: {msg} Restored the backup.")
    say("   The unscoped next-server kill is LIVE until this is fixed by hand.")
    sys.exit(1)

# Post-conditions, checked by content.
if out.count(MARKER) != 2 or out.count("__r9OwnNext.has(") != 1 or out.count(ANCHOR_CLAUSE) != 0:
    rollback("post-patch content check failed.")

# Resolve node by absolute path. A non-login shell has PATH=/usr/bin:/bin:
# /usr/sbin:/sbin, where `env node` is NOT found — relying on PATH made this
# check fail on a perfectly good patch and roll it back.
node_bin = next(
    (p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node",
                 os.path.expanduser("~/.local/opt/node/bin/node"),
                 shutil.which("node")) if p and os.path.exists(p)),
    None,
)
if node_bin is None:
    rollback("cannot locate a node binary to syntax-check with.")

if subprocess.run([node_bin, "--check", target], capture_output=True).returncode != 0:
    rollback("patched file does not parse.")

say(f"✅ 9router-nextserver: narrowed the unscoped next-server clause in {base} "
    f"and syntax-checked. Restart 9router to load it.")
say(f"   Backup: {backup}")
sys.exit(0)
PY
exit $?
