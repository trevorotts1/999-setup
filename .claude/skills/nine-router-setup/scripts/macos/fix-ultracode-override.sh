#!/usr/bin/env bash
# fix-ultracode-override.sh — find and clear every source that exports
# CLAUDE_CODE_EFFORT_LEVEL on this Mac, so the in-session /effort picker
# (including `ultracode`) stops snapping back. CONFIGURATION ONLY.
#
# THE BUG. Claude Code treats CLAUDE_CODE_EFFORT_LEVEL in the environment as an
# OVERRIDE of the in-session picker. With it set to anything other than xhigh,
# selecting ultracode returns
#   "CLAUDE_CODE_EFFORT_LEVEL=<value> overrides effort this session — clear it
#    and ultracode takes over"
# and the selection is not applied. The shipped binary's save path also accepts
# only low|medium|high|xhigh, so "max" is not persistable at all.
#
# The launchers were fixed in v1.2.0 (they export it only under
# CLAUDE_NINE_FORCE_EFFORT). That fix cannot reach a box where the variable is
# exported from somewhere ELSE — a shell startup file, the launchd user domain,
# a settings.json env map, or a parent process. This script is that reach.
#
# Phases:
#   P0  prove the scanner on a planted known-good control BEFORE accepting any
#       "clean" result. A detector that cannot find a positive has not proved a
#       negative — it has only failed silently.
#   P1  DETECT every source and name each one: the current process environment,
#       the launchd user domain, six shell startup files, the settings.json env
#       maps, candidate service env files, and the system-wide startup files.
#   P2  read-only inspection of running Claude work. Observation only.
#   P3  timestamped backup of every file about to be edited; an existing backup
#       is NEVER overwritten, and the path is printed.
#   P4  shell startup files: COMMENT OUT the offending line behind a dated
#       marker. Never delete it — a commented line is reversible and visible, a
#       deleted one is neither. A rerun never double-comments.
#   P5  launchd user domain: `launchctl unsetenv`, then re-read to prove it.
#   P6  settings.json env maps: MERGE-remove ONLY this key, validate the result
#       including every pre-existing leaf value, and RESTORE THE BACKUP on any
#       failure — a broken settings.json is never left behind.
#   P7  VERIFY from disk and from launchd, never from this shell's stale
#       environment. Optional --shell-probe starts one fresh login shell.
#   P8  report every source: state before, action taken, state after.
#
# SOURCES THIS SCRIPT WILL NOT EDIT AUTOMATICALLY (reported with the exact
# manual command instead of guessed at):
#   - the CURRENT process environment. A child process cannot alter its
#     parent's environment; `unset` in this shell is the operator's to run.
#   - service env files (OpenClaw and friends). Those are credential files, and
#     clearing one only takes effect when that service restarts — and this
#     script restarts nothing, ever.
#   - system-wide startup files under /etc. Root-owned, shared by every user.
#   - any line mentioning the variable in a form this script does not
#     positively recognise. Never guess at a client's shell configuration.
#
# THE SAFETY ENVELOPE (binding on every line of this script):
#   NEVER kill, restart, signal, interrupt, detach, reload, or "clean up" any
#   running Claude Code session, workflow, subagent, terminal, tmux
#   session/server, background task, build, or test — even if it looks stale.
#   Never restart the current session. This change is for NEW shells and NEW
#   sessions. Anything running right now keeps the effort level it started with
#   and keeps running exactly as it is.
#
#   This script therefore contains NO process-termination command of any kind,
#   no signal delivery, no service restart, no `exec`, and no shell-profile
#   reload. The only commands that mutate anything are: writing a shell startup
#   file, writing a settings file, copying backups, and `launchctl unsetenv`.
#
# Never prints a secret. Settings files are read for THIS ONE KEY's name and
# value only — never dumped, and no other value is ever printed. Shell files are
# reported by line NUMBER and classification, never by line content.
#
# Idempotent and re-run safe: a second run finds nothing live, writes nothing,
# creates no backup, and says so.
#
# Usage:
#   fix-ultracode-override.sh [--dry-run] [--shell-probe] [--settings PATH]
#   fix-ultracode-override.sh --selftest
#
# Exit codes:
#   0  complete — no source remains that would override a NEW session
#   1  manual action required — a source this script will not touch
#      automatically is still active; the exact command is in the report
#   2  tooling failure — backups were restored where applicable
set -euo pipefail

VAR="CLAUDE_CODE_EFFORT_LEVEL"

# The launchd user-domain tool. Overridable so --selftest can point it at a
# stub and never touch the real user domain.
LAUNCHCTL="${FIX_ULTRACODE_LAUNCHCTL:-/bin/launchctl}"

# Marker date + backup stamp. Seams so --selftest is deterministic; production
# runs use the wall clock.
MARKER_DATE="${FIX_ULTRACODE_DATE:-$(date +%Y-%m-%d)}"

# Shell startup files this script will EDIT (comment out, never delete).
SHELL_FILES="$HOME/.zshrc
$HOME/.zprofile
$HOME/.zshenv
$HOME/.bash_profile
$HOME/.bashrc
$HOME/.profile"

# Startup files that are DETECTED ONLY. ~/.zlogin and ~/.bash_login are user
# files but outside the six the remediation owns; /etc/* are root-owned and
# shared by every account on the machine. Both classes are reported with the
# exact manual command rather than edited here.
DETECT_ONLY_FILES="$HOME/.zlogin
$HOME/.bash_login
/etc/zshenv
/etc/zprofile
/etc/zshrc
/etc/bashrc
/etc/profile"

# Settings files whose "env" map this script will MERGE-remove the key from.
# claude-nine reuses the ordinary Claude config root (repo rule 10), so both
# roots are checked; --settings replaces the primary path.
SETTINGS_FILES="$HOME/.claude/settings.json
$HOME/.claude/settings.local.json
$HOME/.claude-nine/settings.json
$HOME/.claude-nine/settings.local.json"

# Candidate service env files: DETECTED ONLY, never edited. Extend with
# FIX_ULTRACODE_EXTRA_ENV_FILES (colon-separated).
ENV_FILES="$HOME/.openclaw/.env
$HOME/.openclaw/env
$HOME/.config/openclaw/.env
$HOME/.clawdbot/.env"

DRY_RUN=0
SHELL_PROBE=0
SETTINGS_OVERRIDE=""

log() { printf '[fix-ultracode-override] %s\n' "$*" >&2; }

usage() {
  sed -n '2,80p' "$0" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# Report accumulators. Newline-delimited strings, never arrays: macOS ships
# bash 3.2, where expanding a completely empty array under `set -u` is an
# unbound-variable error.
# ---------------------------------------------------------------------------
R_SCANNER="NOT PROVEN"
R_PROCESS_ENV="NOT CHECKED"
R_LAUNCHCTL="NOT CHECKED"
R_SHELL=""
R_SETTINGS=""
R_ENVFILES=""
R_DETECTONLY=""
R_ACTIVE="UNKNOWN"
R_PROBE="NOT RUN (opt in with --shell-probe)"
R_BACKUPS=""
MANUAL=""
FOUND_ANY=0        # any source found anywhere
FIXED_ANY=0        # any source this run actually remediated
MANUAL_REQUIRED=0  # a source remains that this script will not touch
TOOLING_FAILED=0

add_manual() { MANUAL="$MANUAL
$1"; }
add_backup() { R_BACKUPS="$R_BACKUPS
  $1"; }

# make_backup <file> -> prints the backup path. NEVER overwrites an existing
# backup: a name collision takes the next free -N suffix. Returns non-zero
# (printing nothing) when the source is missing or the copy fails — a caller
# must never proceed to edit a file believing it has a backup it does not have.
make_backup() {
  local src="$1" stamp b n
  [ -f "$src" ] || return 1
  stamp="${FIX_ULTRACODE_BACKUP_STAMP:-$(date +%Y%m%d-%H%M%S)}"
  b="$src.backup.$stamp"
  n=1
  while [ -e "$b" ]; do
    b="$src.backup.$stamp-$n"
    n=$((n + 1))
  done
  cp -p "$src" "$b" || return 1
  [ -f "$b" ] || return 1
  printf '%s' "$b"
}

# restore_backup <backup> <target> — a restore that can itself fail is reported,
# never assumed. Used on every failure path.
restore_backup() {
  if cp -p "$1" "$2" 2>/dev/null; then
    log "RESTORED the backup: $1 -> $2"
    return 0
  fi
  log "WARNING: could not restore $1 -> $2. The backup file is still there; copy it back yourself."
  return 1
}

resolve_node() {
  local n="${NODE_BIN:-}"
  if [ -n "$n" ] && [ -x "$n" ]; then printf '%s' "$n"; return 0; fi
  n="$(command -v node 2>/dev/null || true)"
  if [ -n "$n" ]; then printf '%s' "$n"; return 0; fi
  return 1
}

# Print a path with $HOME collapsed to ~ so the report stays readable and does
# not leak a username more than the filesystem already does.
tilde() { case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac; }

# ---------------------------------------------------------------------------
# The shell-file scanner/rewriter. Node, not grep: this script must not depend
# on how `grep` resolves in the caller's environment, and grep's rc>=2 (error)
# is trivially misread as rc=1 (no match). The program is fed on stdin from a
# quoted heredoc so its regexes carry their quoting verbatim.
#
# env in : TARGET, MODE=scan|fix, MARKER_DATE, VAR
# stdout : ABSENT | UNREADABLE <code> | LIVE <lineno> <class> | DISABLED <n>
#          | RESULT CLEAN|FOUND|WRITTEN|UNCHANGED
# exit   : 0 normal, 3 read/write failure
#
# Line content is NEVER printed — classification and line number only.
# ---------------------------------------------------------------------------
shell_file_op() {
  TARGET="$1" MODE="$2" MARKER_DATE="$MARKER_DATE" VAR="$VAR" "$NODE" - <<'JS'
const fs = require("fs");
const p = process.env.TARGET;
const mode = process.env.MODE;
const V = process.env.VAR;

let text = "";
try {
  text = fs.readFileSync(p, "utf8");
} catch (e) {
  if (e.code === "ENOENT") { console.log("ABSENT"); console.log("RESULT CLEAN"); process.exit(0); }
  // An unreadable file is NEVER reported as clean.
  console.log("UNREADABLE " + e.code);
  process.exit(3);
}

const esc = V.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An assignment, with or without an exporting keyword, tolerant of whitespace
// and of any quoting style on the value.
const ASSIGN = new RegExp("^[ \\t]*(?:export[ \\t]+|declare[ \\t]+-[A-Za-z]*x[A-Za-z]*[ \\t]+|typeset[ \\t]+-[A-Za-z]*x[A-Za-z]*[ \\t]+|setenv[ \\t]+)?" + esc + "[ \\t]*=");
// `export VAR` with no `=` still publishes an inherited value to children.
const EXPORT_ONLY = new RegExp("^[ \\t]*(?:export|declare[ \\t]+-[A-Za-z]*x[A-Za-z]*|typeset[ \\t]+-[A-Za-z]*x[A-Za-z]*)[ \\t]+" + esc + "[ \\t]*(?:$|[;#])");
// A startup file that seeds the launchd user domain is the same fault.
const LAUNCHCTL_SET = new RegExp("launchctl[ \\t]+setenv[ \\t]+" + esc + "\\b");
// `unset VAR` is a FIX, not a fault. Commenting it out would re-break the box.
const UNSET = new RegExp("^[ \\t]*unset[ \\t]+(?:-v[ \\t]+)?" + esc + "\\b");
const MENTION = new RegExp("\\b" + esc + "\\b");
const IS_COMMENT = /^[ \t]*#/;
const MARKER = "999-setup: disabled " + V;

const lines = text.split("\n");
const targets = [];   // line indexes to comment out
let disabled = 0;
let other = 0;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (IS_COMMENT.test(l)) {
    if (MENTION.test(l) && (ASSIGN.test(l.replace(/^[ \t]*#+[ \t]?/, "")) ||
                            EXPORT_ONLY.test(l.replace(/^[ \t]*#+[ \t]?/, "")) ||
                            LAUNCHCTL_SET.test(l))) disabled++;
    continue;   // a comment sets nothing, and is never re-commented
  }
  if (!MENTION.test(l)) continue;
  if (UNSET.test(l)) { console.log("LIVE " + (i + 1) + " UNSET"); continue; }
  if (ASSIGN.test(l)) { console.log("LIVE " + (i + 1) + " ASSIGN"); targets.push(i); continue; }
  if (EXPORT_ONLY.test(l)) { console.log("LIVE " + (i + 1) + " EXPORT"); targets.push(i); continue; }
  if (LAUNCHCTL_SET.test(l)) { console.log("LIVE " + (i + 1) + " LAUNCHCTL"); targets.push(i); continue; }
  // Recognised as a mention, not as a form this script knows how to disable.
  // Reported, never guessed at.
  console.log("LIVE " + (i + 1) + " OTHER");
  other++;
}

if (disabled) console.log("DISABLED " + disabled);
if (!targets.length) { console.log("RESULT " + (other ? "FOUND" : "CLEAN")); process.exit(0); }
if (mode !== "fix") { console.log("RESULT FOUND"); process.exit(0); }

const marker = "# " + MARKER + " on " + process.env.MARKER_DATE +
  " — this variable overrides the in-session /effort picker, so ultracode reverts." +
  " Remove the leading # on the next line to restore it.";
const out = [];
const targetSet = new Set(targets);
for (let i = 0; i < lines.length; i++) {
  if (targetSet.has(i)) { out.push(marker); out.push("#" + lines[i]); }
  else out.push(lines[i]);
}
let tmp = p + ".999tmp." + process.pid;
try {
  fs.writeFileSync(tmp, out.join("\n"), { mode: 0o600 });
  try { fs.chmodSync(tmp, fs.statSync(p).mode & 0o7777); } catch (e) {}
  fs.renameSync(tmp, p);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (e2) {}
  console.log("UNREADABLE " + (e.code || "EWRITE"));
  process.exit(3);
}
console.log("RESULT WRITTEN");
JS
}

# ---------------------------------------------------------------------------
# settings.json helpers. Node is already a hard dependency of this repo's setup
# flow and is the only JSON parser guaranteed present (python3 is optional on
# macOS — see setup-macos.sh probe_python3). Writes are atomic: temp file in the
# same directory, original mode preserved, then rename.
#
# ONLY this key's name and value are ever read out. No other key name and no
# other value is printed, and the file is never dumped.
# ---------------------------------------------------------------------------

# settings_scan <file> -> ABSENT | UNPARSEABLE | NOENV | KEYABSENT | KEYPRESENT <value>
settings_scan() {
  SETTINGS_PATH="$1" VAR="$VAR" "$NODE" -e '
    const fs = require("fs");
    const p = process.env.SETTINGS_PATH;
    let raw;
    try { raw = fs.readFileSync(p, "utf8"); }
    catch (e) { if (e.code === "ENOENT") { console.log("ABSENT"); process.exit(0); }
                console.log("UNPARSEABLE " + e.code); process.exit(0); }
    const text = raw.replace(/^\uFEFF/, "");
    if (text.trim() === "") { console.log("NOENV"); process.exit(0); }
    let obj;
    try { obj = JSON.parse(text); } catch (e) { console.log("UNPARSEABLE"); process.exit(0); }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) { console.log("UNPARSEABLE"); process.exit(0); }
    const env = obj.env;
    if (env === null || typeof env !== "object" || Array.isArray(env)) { console.log("NOENV"); process.exit(0); }
    if (!Object.prototype.hasOwnProperty.call(env, process.env.VAR)) { console.log("KEYABSENT"); process.exit(0); }
    console.log("KEYPRESENT " + String(env[process.env.VAR]));
  '
}

# settings_remove <file> — MERGE-remove ONLY this key from the env map.
# exit 3: unparseable/unexpected structure — nothing is written.
settings_remove() {
  SETTINGS_PATH="$1" VAR="$VAR" "$NODE" -e '
    const fs = require("fs");
    const p = process.env.SETTINGS_PATH;
    let raw;
    try { raw = fs.readFileSync(p, "utf8"); }
    catch (e) { console.error("READ_FAILED: " + e.message); process.exit(3); }
    const text = raw.replace(/^\uFEFF/, "");
    let obj;
    try { obj = JSON.parse(text); } catch (e) { console.error("PARSE_FAILED: " + e.message); process.exit(3); }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) { console.error("NOT_A_JSON_OBJECT"); process.exit(3); }
    const env = obj.env;
    if (env === null || typeof env !== "object" || Array.isArray(env)) { console.error("ENV_NOT_A_JSON_OBJECT"); process.exit(3); }
    if (!Object.prototype.hasOwnProperty.call(env, process.env.VAR)) { console.log("UNCHANGED"); process.exit(0); }
    // REMOVE exactly one key. An env map left empty stays as {} — the smallest
    // possible change to a file the operator owns.
    delete env[process.env.VAR];
    const out = JSON.stringify(obj, null, 2) + "\n";
    const tmp = p + ".999tmp." + process.pid;
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    try { fs.chmodSync(tmp, fs.statSync(p).mode & 0o7777); } catch (e) {}
    fs.renameSync(tmp, p);
    console.log("WRITTEN");
  '
}

# settings_validate <file> <backup> — valid JSON, the key is GONE from env, and
# every leaf value that existed in the backup is still present and unchanged
# except the single removed key. exit 4 with a named reason on stderr.
settings_validate() {
  SETTINGS_PATH="$1" BACKUP_PATH="${2:-}" VAR="$VAR" "$NODE" -e '
    const fs = require("fs");
    const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
    const V = process.env.VAR;
    let cur;
    try { cur = readJson(process.env.SETTINGS_PATH); }
    catch (e) { console.error("INVALID_JSON: " + e.message); process.exit(4); }
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) { console.error("NOT_A_JSON_OBJECT"); process.exit(4); }
    if (cur.env && typeof cur.env === "object" && !Array.isArray(cur.env) &&
        Object.prototype.hasOwnProperty.call(cur.env, V)) {
      console.error("KEY_STILL_PRESENT"); process.exit(4);
    }
    const bak = process.env.BACKUP_PATH;
    if (bak) {
      let old;
      try { old = readJson(bak); } catch (e) { console.error("BACKUP_UNREADABLE: " + e.message); process.exit(4); }
      const leaves = (o, prefix, out) => {
        if (o !== null && typeof o === "object") {
          if (Array.isArray(o)) {
            out.push([prefix + "#len", String(o.length)]);
            o.forEach((v, i) => leaves(v, prefix + "[" + i + "]", out));
          } else {
            const ks = Object.keys(o);
            if (!ks.length) out.push([prefix, "{}"]);
            ks.forEach((k) => leaves(o[k], prefix ? prefix + "." + k : k, out));
          }
        } else {
          out.push([prefix, JSON.stringify(o)]);
        }
      };
      const oldLeaves = []; leaves(old, "", oldLeaves);
      const newLeaves = []; leaves(cur, "", newLeaves);
      const newMap = new Map(newLeaves);
      // The removed key is the ONLY permitted difference. An env map that held
      // nothing else legitimately collapses to "env" -> "{}".
      const allowed = new Set(["env." + V, "env"]);
      const lost = [];
      for (const [path, val] of oldLeaves) {
        if (allowed.has(path)) continue;
        if (!newMap.has(path) || newMap.get(path) !== val) lost.push(path);
      }
      if (lost.length) { console.error("PRE_EXISTING_SETTINGS_LOST: " + lost.slice(0, 10).join(", ")); process.exit(4); }
    }
  '
}

# ---------------------------------------------------------------------------
# P0. PROVE THE SCANNER before trusting a single "clean".
# A planted known-good control, run through the SAME instrument, in the SAME
# mode, on the SAME host. If the control comes back clean, the scanner is
# broken and every negative below is UNDETERMINED — never "clean".
# ---------------------------------------------------------------------------
prove_scanner() {
  local ctl out neg
  ctl="$(mktemp "${TMPDIR:-/tmp}/fix-ultracode-control.XXXXXX")"
  {
    printf '# a control file\n'
    printf 'export %s=control\n' "$VAR"
  } > "$ctl"
  out="$(shell_file_op "$ctl" scan 2>&1)" || { rm -f "$ctl"; R_SCANNER="FAILED (the control scan errored: $out)"; return 1; }
  # And the other direction: a file that must come back CLEAN, so a scanner
  # that reports FOUND for everything is caught too.
  printf '# nothing here\nexport SOMETHING_ELSE=1\n' > "$ctl.neg"
  neg="$(shell_file_op "$ctl.neg" scan 2>&1)" || { rm -f "$ctl" "$ctl.neg"; R_SCANNER="FAILED (the negative control errored: $neg)"; return 1; }
  rm -f "$ctl" "$ctl.neg"
  case "$out" in
    *"RESULT FOUND"*) ;;
    *) R_SCANNER="FAILED (a planted \`export $VAR=control\` line was NOT detected — every CLEAN below is UNDETERMINED, not clean)"; return 1 ;;
  esac
  case "$neg" in
    *"RESULT CLEAN"*) ;;
    *) R_SCANNER="FAILED (a file with no assignment was reported as FOUND — the scanner does not discriminate)"; return 1 ;;
  esac
  R_SCANNER="PASS (planted positive detected, planted negative reported clean)"
  return 0
}

# ---------------------------------------------------------------------------
# launchd user domain. `launchctl getenv` prints the value and exits 0 whether
# or not the name is set, so an empty answer alone proves nothing about the
# instrument. Prove it with a known-non-empty name first.
# ---------------------------------------------------------------------------
launchctl_probe() {
  local ctl_out ctl_rc val val_rc

  if [ ! -x "$LAUNCHCTL" ]; then
    R_LAUNCHCTL="UNDETERMINED (no executable launchctl at $LAUNCHCTL — the launchd user domain was NOT checked)"
    return 0
  fi
  set +e
  ctl_out="$("$LAUNCHCTL" getenv PATH 2>&1)"; ctl_rc=$?
  set -e
  if [ "$ctl_rc" -ne 0 ] || [ -z "$ctl_out" ]; then
    R_LAUNCHCTL="UNDETERMINED (the control \`launchctl getenv PATH\` returned rc=$ctl_rc and $( [ -z "$ctl_out" ] && echo 'no value' || echo 'a value' ) — the instrument is not proven, so a clean answer here would mean nothing)"
    return 0
  fi
  set +e
  val="$("$LAUNCHCTL" getenv "$VAR" 2>&1)"; val_rc=$?
  set -e
  if [ "$val_rc" -ne 0 ]; then
    R_LAUNCHCTL="UNDETERMINED (\`launchctl getenv $VAR\` exited $val_rc — an error, not an empty result)"
    return 0
  fi
  if [ -z "$val" ]; then
    R_LAUNCHCTL="CLEAN (checked with \`launchctl getenv $VAR\`; control \`getenv PATH\` returned a value, so the empty answer is real)"
    return 0
  fi
  FOUND_ANY=1
  if [ "$DRY_RUN" -eq 1 ]; then
    R_LAUNCHCTL="FOUND (=$val) -> NOT CHANGED (--dry-run). Clear it with: launchctl unsetenv $VAR"
    MANUAL_REQUIRED=1
    add_manual "launchctl unsetenv $VAR"
    return 0
  fi
  set +e
  "$LAUNCHCTL" unsetenv "$VAR" >/dev/null 2>&1; val_rc=$?
  set -e
  local after after_rc
  set +e
  after="$("$LAUNCHCTL" getenv "$VAR" 2>&1)"; after_rc=$?
  set -e
  if [ "$after_rc" -eq 0 ] && [ -z "$after" ]; then
    FIXED_ANY=1
    R_LAUNCHCTL="FOUND (=$val) -> UNSET, re-read from launchd and now empty"
  else
    MANUAL_REQUIRED=1
    R_LAUNCHCTL="FOUND (=$val) -> \`launchctl unsetenv\` exited $val_rc and the re-read still returns a value. Run it yourself: launchctl unsetenv $VAR"
    add_manual "launchctl unsetenv $VAR"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  NODE="$(resolve_node || true)"
  if [ -z "${NODE:-}" ]; then
    log "BLOCKER: node was not found (set NODE_BIN or put node on PATH)."
    log "Nothing was inspected, backed up, or modified."
    exit 2
  fi

  # ---- P0. PROVE THE INSTRUMENT -------------------------------------------
  # A detector that cannot find a planted positive has not proved a negative.
  # When the control fails, this run DEGRADES TO DETECT-ONLY: it still reports
  # everything it can see, but it will not edit a single file on the strength of
  # an instrument it just failed to trust. Remediating here would be acting on
  # readings known to be wrong.
  local scanner_ok=1
  prove_scanner || scanner_ok=0
  log "scanner control: $R_SCANNER"
  if [ "$scanner_ok" -eq 0 ]; then
    DRY_RUN=1
    TOOLING_FAILED=1
    log "scanner control FAILED — degrading to detect-only. Nothing will be backed up or edited."
  fi

  # ---- P2. INSPECT RUNNING WORK (READ-ONLY) --------------------------------
  # awk, not grep, so the result never depends on how `grep` resolves in the
  # caller's environment. OBSERVATION ONLY: nothing found here is ever attached
  # to, signalled, or touched in any way. `ps aux` prints command lines only —
  # never `ps eww`, which would dump other processes' environments.
  local procs
  procs="$(ps aux 2>/dev/null | awk '/[c]laude/' | awk 'END { print NR + 0 }')"
  case "$procs" in
    ''|0) R_ACTIVE="NONE OBSERVED (none touched either way)" ;;
    *) R_ACTIVE="YES ($procs Claude-related processes observed; none touched, none signalled, none restarted)" ;;
  esac
  log "read-only inspection: $R_ACTIVE"

  # ---- P1a. CURRENT PROCESS ENVIRONMENT ------------------------------------
  # A child process cannot alter its parent's environment. This one is always
  # reported and never "fixed" — saying otherwise would be a lie.
  local cur_env_set=0
  if [ -n "${CLAUDE_CODE_EFFORT_LEVEL:-}" ]; then
    cur_env_set=1
    FOUND_ANY=1
    R_PROCESS_ENV="SET (=$CLAUDE_CODE_EFFORT_LEVEL) in THIS shell -> NOT CHANGED. A child process cannot alter its parent's environment. Run: unset $VAR"
  else
    R_PROCESS_ENV="NOT SET in this process's environment"
  fi

  # ---- P1b. LAUNCHD USER DOMAIN (+ P5 remediation) -------------------------
  launchctl_probe

  # ---- P1c / P3 / P4. SHELL STARTUP FILES ---------------------------------
  local f out rc label backup
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    label="$(tilde "$f")"
    set +e
    out="$(shell_file_op "$f" scan 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")UNREADABLE — NOT clean, NOT changed ($out)"
      add_manual "inspect $f by hand: it could not be read"
      continue
    fi
    case "$out" in
      *ABSENT*)
        R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")ABSENT (checked; no such file)"
        continue ;;
    esac

    local live_assign live_unset live_other disabled_n
    live_assign="$(printf '%s\n' "$out" | awk '$1=="LIVE" && ($3=="ASSIGN"||$3=="EXPORT"||$3=="LAUNCHCTL") { n++ } END { print n+0 }')"
    live_unset="$(printf '%s\n' "$out" | awk '$1=="LIVE" && $3=="UNSET" { n++ } END { print n+0 }')"
    live_other="$(printf '%s\n' "$out" | awk '$1=="LIVE" && $3=="OTHER" { n++ } END { print n+0 }')"
    disabled_n="$(printf '%s\n' "$out" | awk '$1=="DISABLED" { print $2; f=1 } END { if (!f) print 0 }')"

    # NOTE: written as `if`, never `test && assign`. Under `set -e` a standalone
    # AND-list whose first command is false exits the script.
    local extra=""
    if [ "$live_unset" -gt 0 ]; then
      extra="$extra; $live_unset \`unset\` line(s) left exactly as they are — those are a fix, not a fault"
    fi
    if [ "$disabled_n" -gt 0 ]; then
      extra="$extra; $disabled_n line(s) already disabled by an earlier run"
    fi

    if [ "$live_other" -gt 0 ]; then
      FOUND_ANY=1
      MANUAL_REQUIRED=1
      local lines
      lines="$(printf '%s\n' "$out" | awk '$1=="LIVE" && $3=="OTHER" { printf "%s%s", (n++ ? "," : ""), $2 } END { print "" }')"
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")MENTIONS $VAR on line(s) $lines in a form this script does not recognise -> NOT CHANGED (never guess at your shell config). Inspect them yourself$extra"
      add_manual "open $f and review line(s) $lines by hand"
    fi

    if [ "$live_assign" -eq 0 ]; then
      if [ "$live_other" -eq 0 ]; then
        if [ "$scanner_ok" -eq 1 ]; then
          R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")CLEAN (checked for assignment, export, and launchctl-setenv forms)$extra"
        else
          R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")UNDETERMINED (no assignment matched, but the scanner control FAILED — this is not a clean result)$extra"
        fi
      fi
      continue
    fi

    FOUND_ANY=1
    local lines
    lines="$(printf '%s\n' "$out" | awk '$1=="LIVE" && ($3=="ASSIGN"||$3=="EXPORT"||$3=="LAUNCHCTL") { printf "%s%s", (n++ ? "," : ""), $2 } END { print "" }')"

    if [ "$DRY_RUN" -eq 1 ]; then
      MANUAL_REQUIRED=1
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")FOUND $live_assign line(s) ($lines) -> NOT CHANGED (--dry-run)$extra"
      continue
    fi

    # P3. Back up BEFORE editing, and print the path. A backup that could not be
    # written means the file is NOT edited — never edit without a way back.
    if ! backup="$(make_backup "$f")"; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")FOUND $live_assign line(s) ($lines) -> NOT CHANGED: the backup could not be written, so nothing was edited"
      add_manual "edit $f by hand: comment out the $VAR line(s) on $lines"
      continue
    fi
    add_backup "$(tilde "$f") -> $(tilde "$backup")"
    log "backup: $backup"

    set +e
    out="$(shell_file_op "$f" fix 2>&1)"; rc=$?
    set -e
    # `case`, never `grep`: grep's rc>=2 is an ERROR and is trivially misread as
    # rc=1 "no match", which here would mean silently believing a failed write.
    local wrote=0
    case "$out" in *"RESULT WRITTEN"*) wrote=1 ;; esac
    if [ "$rc" -ne 0 ] || [ "$wrote" -eq 0 ]; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      restore_backup "$backup" "$f" || true
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")FOUND $live_assign line(s) ($lines) -> WRITE FAILED, backup restored ($out)"
      add_manual "edit $f by hand: comment out the $VAR line(s) on $lines"
      continue
    fi

    # P7. Verify from DISK — not from this shell's environment.
    local after
    set +e
    after="$(shell_file_op "$f" scan 2>&1)"; rc=$?
    set -e
    local now_clean=0
    case "$after" in *"RESULT CLEAN"*) now_clean=1 ;; esac
    if [ "$rc" -eq 0 ] && [ "$now_clean" -eq 1 ]; then
      FIXED_ANY=1
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")FOUND $live_assign line(s) ($lines) -> COMMENTED OUT behind a dated marker; re-read from disk and now clean$extra
  $(printf '%-24s' '')backup: $(tilde "$backup")"
    else
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      restore_backup "$backup" "$f" || true
      R_SHELL="$R_SHELL
  $(printf '%-24s' "$label")FOUND $live_assign line(s) ($lines) -> post-write re-read did NOT come back clean; backup restored ($after)"
      add_manual "edit $f by hand: comment out the $VAR line(s) on $lines"
    fi
  done <<EOF
$SHELL_FILES
EOF

  # ---- P1d. DETECT-ONLY STARTUP FILES --------------------------------------
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    label="$(tilde "$f")"
    if [ ! -e "$f" ]; then
      R_DETECTONLY="$R_DETECTONLY
  $(printf '%-24s' "$label")ABSENT (checked; no such file)"
      continue
    fi
    if [ ! -r "$f" ]; then
      R_DETECTONLY="$R_DETECTONLY
  $(printf '%-24s' "$label")NOT READABLE by this user — UNDETERMINED, not clean"
      continue
    fi
    set +e
    out="$(shell_file_op "$f" scan 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      R_DETECTONLY="$R_DETECTONLY
  $(printf '%-24s' "$label")UNREADABLE — NOT clean ($out)"
      continue
    fi
    local n
    n="$(printf '%s\n' "$out" | awk '$1=="LIVE" && ($3=="ASSIGN"||$3=="EXPORT"||$3=="LAUNCHCTL"||$3=="OTHER") { c++ } END { print c+0 }')"
    if [ "$n" -gt 0 ]; then
      FOUND_ANY=1
      MANUAL_REQUIRED=1
      R_DETECTONLY="$R_DETECTONLY
  $(printf '%-24s' "$label")FOUND $n line(s) -> NOT CHANGED (this file is outside what this script edits). Edit it yourself and comment the line out."
      add_manual "edit $f yourself (root-owned or outside the managed set) and comment out the $VAR line"
    else
      R_DETECTONLY="$R_DETECTONLY
  $(printf '%-24s' "$label")CLEAN (checked, read-only)"
    fi
  done <<EOF
$DETECT_ONLY_FILES
EOF

  # ---- P1e / P3 / P6. SETTINGS FILES ---------------------------------------
  local settings_list="$SETTINGS_FILES"
  if [ -n "$SETTINGS_OVERRIDE" ]; then
    settings_list="$SETTINGS_OVERRIDE"
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    label="$(tilde "$f")"
    set +e
    out="$(settings_scan "$f" 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      TOOLING_FAILED=1
      R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")UNDETERMINED (the scan errored) — NOT changed"
      continue
    fi
    case "$out" in
      ABSENT*)
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")ABSENT (checked; no such file)"
        continue ;;
      UNPARSEABLE*)
        MANUAL_REQUIRED=1
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")UNPARSEABLE JSON -> NOT CHANGED. An unreadable settings file is never treated as empty and never overwritten."
        add_manual "fix the JSON in $f, then rerun this script"
        continue ;;
      NOENV*|KEYABSENT*)
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")CLEAN (no \"$VAR\" in its env map)"
        continue ;;
      KEYPRESENT*) ;;
      *)
        # An answer the scanner is not supposed to be able to give. Never
        # guessed at, never treated as either state.
        TOOLING_FAILED=1
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")UNDETERMINED (the scan returned an unrecognised answer) -> NOT CHANGED"
        continue ;;
    esac

    # KEYPRESENT <value> — this one key's value is the only one ever read out.
    local val
    val="${out#KEYPRESENT }"
    FOUND_ANY=1
    if [ "$DRY_RUN" -eq 1 ]; then
      MANUAL_REQUIRED=1
      R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> NOT CHANGED (--dry-run)"
      continue
    fi

    if ! backup="$(make_backup "$f")"; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> NOT CHANGED: the backup could not be written, so nothing was edited"
      add_manual "remove \"$VAR\" from the env map in $f by hand"
      continue
    fi
    add_backup "$(tilde "$f") -> $(tilde "$backup")"
    log "backup: $backup"

    local rm_out rm_rc
    set +e
    rm_out="$(settings_remove "$f" 2>&1)"; rm_rc=$?
    set -e
    if [ "$rm_rc" -ne 0 ]; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      restore_backup "$backup" "$f" || true
      R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> REMOVAL FAILED ($rm_out); backup restored, nothing landed"
      add_manual "remove \"$VAR\" from the env map in $f by hand"
      continue
    fi

    local v_out v_rc
    set +e
    v_out="$(settings_validate "$f" "$backup" 2>&1)"; v_rc=$?
    set -e
    # Test-only seam: --selftest uses it to prove the restore path really restores.
    if [ -n "${FIX_ULTRACODE_FORCE_VALIDATION_FAILURE:-}" ]; then
      v_rc=4
      v_out="FORCED_VALIDATION_FAILURE (selftest seam)"
    fi
    if [ "$v_rc" -ne 0 ]; then
      TOOLING_FAILED=1
      MANUAL_REQUIRED=1
      log "settings validation FAILED: $v_out"
      restore_backup "$backup" "$f" || true
      R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> VALIDATION FAILED ($v_out); backup restored byte for byte, nothing landed"
      add_manual "remove \"$VAR\" from the env map in $f by hand"
      continue
    fi

    # P7. Verify from disk.
    local after
    set +e
    after="$(settings_scan "$f" 2>&1)"
    set -e
    case "$after" in
      KEYABSENT*|NOENV*)
        FIXED_ANY=1
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> REMOVED from the env map, JSON re-read from disk and valid, every other setting proven unchanged
  $(printf '%-36s' '')backup: $(tilde "$backup")" ;;
      *)
        TOOLING_FAILED=1
        MANUAL_REQUIRED=1
        restore_backup "$backup" "$f" || true
        R_SETTINGS="$R_SETTINGS
  $(printf '%-36s' "$label")KEY PRESENT (=$val) -> post-write re-read still finds it; backup restored"
        add_manual "remove \"$VAR\" from the env map in $f by hand" ;;
    esac
  done <<EOF
$settings_list
EOF

  # ---- P1f. SERVICE ENV FILES — DETECTED ONLY ------------------------------
  # Never edited: these are credential files, and clearing one only takes effect
  # when that service restarts. This script restarts nothing, ever.
  local env_list="$ENV_FILES"
  if [ -n "${FIX_ULTRACODE_EXTRA_ENV_FILES:-}" ]; then
    env_list="$env_list
$(printf '%s' "$FIX_ULTRACODE_EXTRA_ENV_FILES" | tr ':' '\n')"
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    label="$(tilde "$f")"
    if [ ! -e "$f" ]; then
      R_ENVFILES="$R_ENVFILES
  $(printf '%-36s' "$label")ABSENT (checked; no such file)"
      continue
    fi
    if [ ! -r "$f" ]; then
      R_ENVFILES="$R_ENVFILES
  $(printf '%-36s' "$label")NOT READABLE by this user — UNDETERMINED, not clean"
      continue
    fi
    set +e
    out="$(shell_file_op "$f" scan 2>&1)"; rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      R_ENVFILES="$R_ENVFILES
  $(printf '%-36s' "$label")UNREADABLE — NOT clean ($out)"
      continue
    fi
    local n
    n="$(printf '%s\n' "$out" | awk '$1=="LIVE" && $3!="UNSET" { c++ } END { print c+0 }')"
    if [ "$n" -gt 0 ]; then
      FOUND_ANY=1
      MANUAL_REQUIRED=1
      R_ENVFILES="$R_ENVFILES
  $(printf '%-36s' "$label")FOUND $n line(s) -> NOT CHANGED. Comment the line out yourself, then restart that service when YOU choose. This script never restarts anything."
      add_manual "comment out the $VAR line in $f, then restart that service yourself"
    else
      R_ENVFILES="$R_ENVFILES
  $(printf '%-36s' "$label")CLEAN (checked for this one key only; no other key was read or printed)"
    fi
  done <<EOF
$env_list
EOF

  # ---- The inherited-from-a-parent case ------------------------------------
  # Set in this process but explained by nothing we found and nothing we fixed:
  # it came from a parent this script cannot reach.
  if [ "$cur_env_set" -eq 1 ] && [ "$FIXED_ANY" -eq 0 ] && [ "$MANUAL_REQUIRED" -eq 0 ]; then
    local parent
    parent="$(ps -o comm= -p "${PPID:-0}" 2>/dev/null | head -1 || true)"
    [ -n "$parent" ] || parent="unknown"
    MANUAL_REQUIRED=1
    R_PROCESS_ENV="$R_PROCESS_ENV
    No user-domain source explains it, so this process INHERITED it from its parent (\`$parent\`).
    That parent's own environment is the source and no child process can reach it. Clear it where
    that parent is started, then start a NEW one when you choose — this script never restarts anything."
    add_manual "clear $VAR wherever the parent process \`$parent\` is started, then start a new one yourself"
  fi

  # ---- P7b. OPTIONAL FRESH-SHELL PROBE -------------------------------------
  # Off by default on purpose: sourcing a client's rc files in a subshell runs
  # whatever those files run. The disk and launchd re-reads above are already
  # independent of this shell's stale environment; this only adds a live shell.
  if [ "$SHELL_PROBE" -eq 1 ]; then
    local sh probe
    sh="${SHELL:-/bin/zsh}"
    if [ -x "$sh" ]; then
      set +e
      probe="$(env -u "$VAR" "$sh" -l -c "printf '%s' \"\${$VAR-<unset>}\"" 2>&1)"
      rc=$?
      set -e
      if [ "$rc" -ne 0 ]; then
        R_PROBE="UNDETERMINED (a fresh \`$sh -l\` exited $rc; that is a shell error, not a clean result)"
      elif [ "$probe" = "<unset>" ]; then
        R_PROBE="CLEAN — a fresh login shell started WITHOUT the inherited value does not set $VAR"
      else
        MANUAL_REQUIRED=1
        R_PROBE="STILL SET (=$probe) in a fresh login shell — a source outside the files above is still exporting it"
        add_manual "a fresh \`$sh -l\` still sets $VAR; check any startup file this script listed as NOT CHECKED"
      fi
    else
      R_PROBE="UNDETERMINED (\$SHELL=$sh is not executable)"
    fi
  fi

  # ---- P8. REPORT -----------------------------------------------------------
  local status
  if [ "$scanner_ok" -eq 0 ]; then
    status="UNDETERMINED - the scanner failed its own planted control, so no 'clean' below is trustworthy and NOTHING was edited. Fix the tooling (node) and rerun."
  elif [ "$TOOLING_FAILED" -eq 1 ]; then
    status="PARTIAL - one or more sources could not be changed; every backup was restored. See the per-source lines below."
  elif [ "$MANUAL_REQUIRED" -eq 1 ] && [ "$FIXED_ANY" -eq 1 ]; then
    status="PARTIALLY FIXED - some sources were cleared; others need one manual command (listed below). Applies to NEW shells and NEW sessions."
  elif [ "$MANUAL_REQUIRED" -eq 1 ]; then
    status="MANUAL ACTION REQUIRED - a source this script will not touch automatically is still active. The exact command is below."
  elif [ "$FIXED_ANY" -eq 1 ]; then
    status="FIXED - every source found was cleared. Applies to NEW shells and NEW sessions; anything running right now is unchanged."
  elif [ "$FOUND_ANY" -eq 1 ]; then
    status="ALREADY CLEAR - nothing needed changing this run."
  else
    status="CLEAN - no source of $VAR was found. Nothing was backed up and nothing was changed."
  fi

  print_report "$status"

  if [ -n "$MANUAL" ]; then
    printf '\nMANUAL STEPS (reported, never performed — running work comes first):%s\n' "$(printf '%s' "$MANUAL" | sed 's/^/- /' | sed 's/^- $//')"
  fi

  if [ "$TOOLING_FAILED" -eq 1 ]; then exit 2; fi
  if [ "$MANUAL_REQUIRED" -eq 1 ]; then exit 1; fi
  exit 0
}

print_report() {
  local status="$1"
  cat <<REPORT

ULTRACODE OVERRIDE:
$status

VARIABLE:
$VAR (Claude Code treats it as an override of the in-session /effort picker;
only low|medium|high|xhigh are persistable, so "max" cannot be saved at all)

SCANNER CONTROL:
$R_SCANNER

CURRENT PROCESS ENVIRONMENT:
$R_PROCESS_ENV

LAUNCHD USER DOMAIN:
$R_LAUNCHCTL

SHELL STARTUP FILES (checked, and edited by commenting out — never deleting):${R_SHELL:-
  (none checked)}

STARTUP FILES CHECKED READ-ONLY (never edited here):${R_DETECTONLY:-
  (none checked)}

SETTINGS FILES — env map, this one key only:${R_SETTINGS:-
  (none checked)}

SERVICE ENV FILES — detected only, never edited:${R_ENVFILES:-
  (none checked)}

BACKUPS WRITTEN:${R_BACKUPS:-
  (none — nothing was edited)}

FRESH LOGIN SHELL PROBE:
$R_PROBE

NOT CHECKED (named, so this report is not read as coverage it does not have):
  per-project .claude/settings.json files anywhere on disk
  other users' home directories on this machine
  the environment of any process other than this one (never \`ps eww\` — it
    would dump every process's secrets)
  LaunchAgents/LaunchDaemons plists that set the variable via EnvironmentVariables

ACTIVE CLAUDE WORK DETECTED:
$R_ACTIVE

ACTIVE CLAUDE WORK INTERRUPTED:
NO

ACTIVE WORKFLOWS INTERRUPTED:
NO

ACTIVE SUBAGENTS INTERRUPTED:
NO

ACTIVE TERMINALS CLOSED:
NO

ACTIVE TMUX SESSIONS TERMINATED:
NO

CURRENT CLAUDE SESSION RESTARTED:
NO

ANY PROCESS SIGNALLED, KILLED, OR RESTARTED:
NO

WHICH SESSIONS THIS AFFECTS:
NEW shells and NEW Claude Code sessions. A terminal that is already open keeps
the environment it was started with, and a Claude Code session that is running
right now keeps the effort level it is running at. Nothing was restarted to
make this take effect, and nothing needs to be: open a new terminal.
REPORT
}

# ---------------------------------------------------------------------------
# --selftest — proves detection AND remediation in both directions, in a
# sandbox HOME. Touches nothing outside its own temp directory, installs
# nothing, signals nothing, and never runs the real launchctl.
# ---------------------------------------------------------------------------

selftest() {
  local box rc fails=0
  box="$(mktemp -d "${TMPDIR:-/tmp}/fix-ultracode-selftest.XXXXXX")"

  local NODE_T
  NODE_T="$(resolve_node || true)"
  if [ -z "${NODE_T:-}" ]; then
    printf 'FAIL  selftest: node not found (set NODE_BIN or put node on PATH)\n'
    exit 1
  fi

  # A launchctl stub. The real user domain is NEVER touched by the selftest.
  # It keeps its state in a file so unsetenv is observable.
  mk_launchctl() { # mk_launchctl <path> <state-file> <control-answer>
    cat > "$1" <<STUB
#!/bin/sh
STATE="$2"
case "\$1" in
  getenv)
    if [ "\$2" = "PATH" ]; then printf '%s\n' "$3"; exit 0; fi
    if [ -f "\$STATE" ]; then cat "\$STATE"; fi
    exit 0 ;;
  unsetenv) rm -f "\$STATE"; exit 0 ;;
esac
exit 0
STUB
    chmod 755 "$1"
  }

  st_node() { "$NODE_T" -e "$1"; }

  # st_run <home> [args...] — every path this script touches derives from HOME.
  st_run() {
    local h="$1"; shift
    HOME="$h" NODE_BIN="$NODE_T" \
      FIX_ULTRACODE_LAUNCHCTL="$h/launchctl" \
      FIX_ULTRACODE_DATE="2026-01-01" \
      env -u CLAUDE_CODE_EFFORT_LEVEL \
      bash "$SELF" "$@" > "$h/report.txt" 2> "$h/log.txt"
  }

  # ---- 1. PLANTED POSITIVE IS CAUGHT AND COMMENTED OUT, in every form ------
  local h1="$box/case1"
  mkdir -p "$h1/.claude"
  mk_launchctl "$h1/launchctl" "$h1/lcstate" "/usr/bin:/bin"
  printf 'max\n' > "$h1/lcstate"
  printf '# my zshrc\nexport CLAUDE_CODE_EFFORT_LEVEL=max\nalias ll="ls -la"\n' > "$h1/.zshrc"
  printf '   export   CLAUDE_CODE_EFFORT_LEVEL="high"   # pinned\n' > "$h1/.zprofile"
  printf "CLAUDE_CODE_EFFORT_LEVEL='medium'\n" > "$h1/.zshenv"
  printf 'launchctl setenv CLAUDE_CODE_EFFORT_LEVEL max\n' > "$h1/.bash_profile"
  printf 'CLAUDE_CODE_EFFORT_LEVEL=low\nexport CLAUDE_CODE_EFFORT_LEVEL\n' > "$h1/.bashrc"
  printf '# clean file\nexport EDITOR=vim\n' > "$h1/.profile"
  cat > "$h1/.claude/settings.json" <<'JSON'
{
  "model": "opus[1m]",
  "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max", "EXISTING_VAR": "keep-me" },
  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] },
  "hooks": { "Stop": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "true" } ] } ] }
}
JSON
  rc=0; st_run "$h1" || rc=$?
  if [ "$rc" -eq 0 ] && \
     BOX="$h1" st_node '
      const fs = require("fs"), h = process.env.BOX;
      const rd = (f) => fs.readFileSync(h + "/" + f, "utf8");
      const live = (t) => t.split("\n").filter((l) => !/^[ \t]*#/.test(l) && /CLAUDE_CODE_EFFORT_LEVEL/.test(l));
      const files = [".zshrc", ".zprofile", ".zshenv", ".bash_profile", ".bashrc"];
      for (const f of files) { if (live(rd(f)).length !== 0) { console.error("still live in " + f); process.exit(1); } }
      const z = rd(".zshrc");
      if (!/^#export CLAUDE_CODE_EFFORT_LEVEL=max$/m.test(z)) { console.error("original line not preserved under a #"); process.exit(1); }
      if ((z.match(/999-setup: disabled/g) || []).length !== 1) { console.error("marker count"); process.exit(1); }
      if (!/alias ll="ls -la"/.test(z)) { console.error("user content lost"); process.exit(1); }
      if (!/export EDITOR=vim/.test(rd(".profile"))) { console.error(".profile touched"); process.exit(1); }
      if (fs.existsSync(h + "/.profile.backup.20260101-000000")) { console.error(".profile was backed up though it was clean"); process.exit(1); }
      const s = JSON.parse(rd(".claude/settings.json"));
      if ("CLAUDE_CODE_EFFORT_LEVEL" in s.env) { console.error("settings key survived"); process.exit(1); }
      if (s.env.EXISTING_VAR !== "keep-me" || s.model !== "opus[1m]" ||
          s.permissions.allow[0] !== "Bash(ls:*)" || s.hooks.Stop[0].hooks[0].command !== "true") {
        console.error("other settings lost"); process.exit(1);
      }
      if (fs.existsSync(h + "/lcstate")) { console.error("launchctl unsetenv not called"); process.exit(1); }
      process.exit(0);' 2>>"$h1/log.txt"; then
    printf 'PASS  1. planted positives in 5 shell files + settings.json + launchd are all caught and cleared\n'
  else
    printf 'FAIL  1. planted positive caught and cleared (exit %s) — see %s\n' "$rc" "$h1/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 2. MUTATION PROOF: the same box, --dry-run, MUST report FOUND -------
  # Proves case 1's "cleared" is a real observation and not a hardcoded PASS.
  local h2="$box/case2"
  mkdir -p "$h2/.claude"
  mk_launchctl "$h2/launchctl" "$h2/lcstate" "/usr/bin:/bin"
  printf 'export CLAUDE_CODE_EFFORT_LEVEL=max\n' > "$h2/.zshrc"
  cp "$h2/.zshrc" "$h2/zshrc.orig"
  rc=0; st_run "$h2" --dry-run || rc=$?
  if [ "$rc" -eq 1 ] && cmp -s "$h2/zshrc.orig" "$h2/.zshrc" && \
     grep -q 'NOT CHANGED (--dry-run)' "$h2/report.txt"; then
    printf 'PASS  2. MUTATION PROOF — --dry-run on a planted positive reports FOUND, exits 1, and writes nothing\n'
  else
    printf 'FAIL  2. mutation proof: dry-run detection (exit %s) — see %s\n' "$rc" "$h2/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 3. CLEAN NEGATIVE IS LEFT ALONE ------------------------------------
  local h3="$box/case3"
  mkdir -p "$h3/.claude"
  mk_launchctl "$h3/launchctl" "$h3/lcstate" "/usr/bin:/bin"   # no state file = unset
  printf '# nothing to see\nexport EDITOR=vim\n' > "$h3/.zshrc"
  printf '{ "env": { "OTHER": "1" }, "model": "sonnet" }\n' > "$h3/.claude/settings.json"
  cp "$h3/.zshrc" "$h3/zshrc.orig"
  cp "$h3/.claude/settings.json" "$h3/settings.orig"
  rc=0; st_run "$h3" || rc=$?
  if [ "$rc" -eq 0 ] && cmp -s "$h3/zshrc.orig" "$h3/.zshrc" && \
     cmp -s "$h3/settings.orig" "$h3/.claude/settings.json" && \
     [ -z "$(find "$h3" -name '*.backup.*' 2>/dev/null)" ] && \
     awk '/^ULTRACODE OVERRIDE:$/ { getline; if ($0 ~ /^CLEAN /) f = 1 } END { exit f ? 0 : 1 }' "$h3/report.txt"; then
    printf 'PASS  3. a clean box is reported CLEAN, byte-identical, with no backup written\n'
  else
    printf 'FAIL  3. clean negative untouched (exit %s) — see %s\n' "$rc" "$h3/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 4. IDEMPOTENT: a second run is a byte-identical no-op --------------
  local h4="$box/case4"
  mkdir -p "$h4/.claude"
  mk_launchctl "$h4/launchctl" "$h4/lcstate" "/usr/bin:/bin"
  printf 'export CLAUDE_CODE_EFFORT_LEVEL=max\nexport EDITOR=vim\n' > "$h4/.zshrc"
  printf '{ "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max", "K": "v" } }\n' > "$h4/.claude/settings.json"
  rc=0; st_run "$h4" || rc=$?
  cp "$h4/.zshrc" "$h4/after-first.zshrc"
  cp "$h4/.claude/settings.json" "$h4/after-first.json"
  local backups_after_first
  backups_after_first="$(find "$h4" -name '*.backup.*' | wc -l | tr -d ' ')"
  local rc2=0; st_run "$h4" || rc2=$?
  local backups_after_second
  backups_after_second="$(find "$h4" -name '*.backup.*' | wc -l | tr -d ' ')"
  if [ "$rc" -eq 0 ] && [ "$rc2" -eq 0 ] && \
     cmp -s "$h4/after-first.zshrc" "$h4/.zshrc" && \
     cmp -s "$h4/after-first.json" "$h4/.claude/settings.json" && \
     [ "$backups_after_first" = "$backups_after_second" ] && \
     awk '/^ULTRACODE OVERRIDE:$/ { getline; if ($0 ~ /^CLEAN /) f = 1 } END { exit f ? 0 : 1 }' "$h4/report.txt"; then
    printf 'PASS  4. rerun is a byte-identical no-op — nothing double-commented, no second backup\n'
  else
    printf 'FAIL  4. idempotent rerun (exit %s/%s, backups %s->%s) — see %s\n' "$rc" "$rc2" "$backups_after_first" "$backups_after_second" "$h4/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 5. `unset` LINES AND ALREADY-DISABLED LINES ARE NEVER TOUCHED ------
  local h5="$box/case5"
  mkdir -p "$h5/.claude"
  mk_launchctl "$h5/launchctl" "$h5/lcstate" "/usr/bin:/bin"
  printf 'unset CLAUDE_CODE_EFFORT_LEVEL\n# 999-setup: disabled CLAUDE_CODE_EFFORT_LEVEL on 2025-01-01\n#export CLAUDE_CODE_EFFORT_LEVEL=max\n' > "$h5/.zshrc"
  cp "$h5/.zshrc" "$h5/zshrc.orig"
  rc=0; st_run "$h5" || rc=$?
  if [ "$rc" -eq 0 ] && cmp -s "$h5/zshrc.orig" "$h5/.zshrc"; then
    printf 'PASS  5. an `unset` line and an already-disabled line are left exactly as they are\n'
  else
    printf 'FAIL  5. unset/already-disabled untouched (exit %s) — see %s\n' "$rc" "$h5/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 6. AN EXISTING BACKUP IS NEVER OVERWRITTEN -------------------------
  local h6="$box/case6" stamp="20260101-000000" decoy
  mkdir -p "$h6/.claude"
  mk_launchctl "$h6/launchctl" "$h6/lcstate" "/usr/bin:/bin"
  printf 'export CLAUDE_CODE_EFFORT_LEVEL=max\n' > "$h6/.zshrc"
  decoy="$h6/.zshrc.backup.$stamp"
  printf 'DECOY-DO-NOT-TOUCH\n' > "$decoy"
  rc=0
  HOME="$h6" NODE_BIN="$NODE_T" FIX_ULTRACODE_LAUNCHCTL="$h6/launchctl" \
    FIX_ULTRACODE_DATE="2026-01-01" FIX_ULTRACODE_BACKUP_STAMP="$stamp" \
    env -u CLAUDE_CODE_EFFORT_LEVEL \
    bash "$SELF" > "$h6/report.txt" 2> "$h6/log.txt" || rc=$?
  if [ "$rc" -eq 0 ] && [ "$(cat "$decoy")" = "DECOY-DO-NOT-TOUCH" ] && \
     [ -f "$decoy-1" ] && grep -q 'export CLAUDE_CODE_EFFORT_LEVEL=max' "$decoy-1"; then
    printf 'PASS  6. an existing backup is never overwritten (the next free name is used)\n'
  else
    printf 'FAIL  6. existing backup never overwritten (exit %s) — see %s\n' "$rc" "$h6/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 7. VALIDATION FAILURE -> THE SETTINGS BACKUP IS RESTORED ----------
  local h7="$box/case7"
  mkdir -p "$h7/.claude"
  mk_launchctl "$h7/launchctl" "$h7/lcstate" "/usr/bin:/bin"
  printf '{\n  "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max", "SENTINEL": "seven" },\n  "model": "sonnet"\n}\n' > "$h7/.claude/settings.json"
  cp "$h7/.claude/settings.json" "$h7/original.json"
  rc=0
  HOME="$h7" NODE_BIN="$NODE_T" FIX_ULTRACODE_LAUNCHCTL="$h7/launchctl" \
    FIX_ULTRACODE_DATE="2026-01-01" FIX_ULTRACODE_FORCE_VALIDATION_FAILURE=1 \
    env -u CLAUDE_CODE_EFFORT_LEVEL \
    bash "$SELF" > "$h7/report.txt" 2> "$h7/log.txt" || rc=$?
  if [ "$rc" -eq 2 ] && cmp -s "$h7/original.json" "$h7/.claude/settings.json" && \
     grep -q 'VALIDATION FAILED' "$h7/report.txt"; then
    printf 'PASS  7. a failed validation restores the settings backup byte for byte (exit 2)\n'
  else
    printf 'FAIL  7. validation failure -> restore (exit %s) — see %s\n' "$rc" "$h7/log.txt"
    fails=$((fails + 1))
  fi

  # ---- 8. MUTATION PROOF: A BROKEN launchctl IS UNDETERMINED, NOT CLEAN ---
  # The control (`launchctl getenv PATH`) comes back empty, so the instrument is
  # not proven and the script must refuse to call the domain clean.
  local h8="$box/case8"
  mkdir -p "$h8/.claude"
  mk_launchctl "$h8/launchctl" "$h8/lcstate" ""    # control answers EMPTY
  printf '# clean\n' > "$h8/.zshrc"
  rc=0; st_run "$h8" || rc=$?
  if awk '/^LAUNCHD USER DOMAIN:$/ { getline; if ($0 ~ /^UNDETERMINED/) f = 1 } END { exit f ? 0 : 1 }' "$h8/report.txt"; then
    printf 'PASS  8. MUTATION PROOF — a launchctl whose control answers empty is UNDETERMINED, never CLEAN\n'
  else
    printf 'FAIL  8. broken launchctl must be UNDETERMINED (exit %s) — see %s\n' "$rc" "$h8/report.txt"
    fails=$((fails + 1))
  fi

  # ---- 9. MUTATION PROOF: A BROKEN SCANNER POISONS EVERY "CLEAN" ---------
  # Point NODE_BIN at a stub that always prints RESULT CLEAN. The planted
  # control must fail, no file may be reported clean, the run must degrade to
  # detect-only (nothing edited, no backup written) and exit 2.
  local h9="$box/case9"
  mkdir -p "$h9/.claude"
  mk_launchctl "$h9/launchctl" "$h9/lcstate" "/usr/bin:/bin"
  printf 'export CLAUDE_CODE_EFFORT_LEVEL=max\n' > "$h9/.zshrc"
  cat > "$h9/fakenode" <<'STUB'
#!/bin/sh
echo "RESULT CLEAN"
exit 0
STUB
  chmod 755 "$h9/fakenode"
  cp "$h9/.zshrc" "$h9/zshrc.orig"
  rc=0
  HOME="$h9" NODE_BIN="$h9/fakenode" FIX_ULTRACODE_LAUNCHCTL="$h9/launchctl" \
    FIX_ULTRACODE_DATE="2026-01-01" \
    env -u CLAUDE_CODE_EFFORT_LEVEL \
    bash "$SELF" > "$h9/report.txt" 2> "$h9/log.txt" || rc=$?
  if [ "$rc" -eq 2 ] && \
     awk '/^SCANNER CONTROL:$/ { getline; if ($0 ~ /^FAILED/) f = 1 } END { exit f ? 0 : 1 }' "$h9/report.txt" && \
     awk '/^ULTRACODE OVERRIDE:$/ { getline; if ($0 ~ /^UNDETERMINED/) f = 1 } END { exit f ? 0 : 1 }' "$h9/report.txt" && \
     ! grep -qE '^  ~/\.zshrc +CLEAN' "$h9/report.txt" && \
     cmp -s "$h9/zshrc.orig" "$h9/.zshrc" && \
     [ -z "$(find "$h9" -name '*.backup.*' 2>/dev/null)" ]; then
    printf 'PASS  9. MUTATION PROOF — a scanner that always says CLEAN fails its control, poisons every negative, edits nothing, exits 2\n'
  else
    printf 'FAIL  9. broken scanner must poison every negative (exit %s) — see %s\n' "$rc" "$h9/report.txt"
    fails=$((fails + 1))
  fi

  # ---- 10. THE FRESH-SHELL PROBE ACTUALLY PROVES A NEW SHELL -------------
  local h10="$box/case10"
  mkdir -p "$h10/.claude"
  mk_launchctl "$h10/launchctl" "$h10/lcstate" "/usr/bin:/bin"
  printf 'export CLAUDE_CODE_EFFORT_LEVEL=max\n' > "$h10/.profile"
  rc=0
  HOME="$h10" NODE_BIN="$NODE_T" FIX_ULTRACODE_LAUNCHCTL="$h10/launchctl" \
    FIX_ULTRACODE_DATE="2026-01-01" SHELL="/bin/sh" \
    env -u CLAUDE_CODE_EFFORT_LEVEL \
    bash "$SELF" --shell-probe > "$h10/report.txt" 2> "$h10/log.txt" || rc=$?
  if [ "$rc" -eq 0 ] && \
     awk '/^FRESH LOGIN SHELL PROBE:$/ { getline; if ($0 ~ /^CLEAN/) f = 1 } END { exit f ? 0 : 1 }' "$h10/report.txt"; then
    printf 'PASS 10. after remediation a fresh login shell no longer sets the variable\n'
  else
    printf 'FAIL 10. fresh login shell probe (exit %s) — see %s\n' "$rc" "$h10/report.txt"
    fails=$((fails + 1))
  fi

  # ---- 11. SANDBOX CONTAINMENT: nothing was written outside the box ------
  # Proved by the box's own tree being the only thing that changed: the run
  # derives every path from HOME, and HOME is the box.
  local outside=0
  for probe in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zshenv" "$HOME/.bash_profile" \
               "$HOME/.bashrc" "$HOME/.profile" "$HOME/.claude/settings.json"; do
    if [ -e "$probe.backup.2026-01-01" ] || [ -e "$probe.999tmp.$$" ]; then outside=1; fi
  done
  if [ "$outside" -eq 0 ]; then
    printf 'PASS 11. no backup or temp file from this selftest exists beside any real home-directory file\n'
  else
    printf 'FAIL 11. selftest artifacts found outside the sandbox\n'
    fails=$((fails + 1))
  fi

  if [ "$fails" -eq 0 ]; then
    rm -rf "$box"
    printf '\nAll 11 checks passed (including 3 mutation proofs that the checks can fail).\n'
    exit 0
  fi
  printf '\nselftest artifacts kept for inspection: %s\n' "$box"
  exit 1
}

SELF="$0"
DO_SELFTEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --shell-probe) SHELL_PROBE=1; shift ;;
    --settings) [ $# -ge 2 ] || usage; SETTINGS_OVERRIDE="$2"; shift 2 ;;
    --selftest) DO_SELFTEST=1; shift ;;
    -h|--help) usage ;;
    *) printf 'fix-ultracode-override: unknown argument "%s"\n' "$1" >&2; usage ;;
  esac
done

if [ "$DO_SELFTEST" -eq 1 ]; then
  selftest
fi

main
