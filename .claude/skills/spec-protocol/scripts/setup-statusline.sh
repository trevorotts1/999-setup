#!/usr/bin/env bash
# setup-statusline.sh — detect-first installer for the Spec Protocol status
# line. Idempotent: safe to run repeatedly; never creates duplicate
# configuration, never destroys an existing status line.
#
# Contract: references/progress-visibility.md.
#
# THE CLIENT BAR (1.18.0). Four segments, in this order:
#
#   Working ✓ 2m ago | Now: the booking page | 14 of 40 pieces (35%) | Needs you: nothing
#
# Each one answers a question the owner of the project actually asks: is it
# still going, what is it on right now, how far along is it, is it waiting on
# me. Before the plan exists the third segment reads `Getting ready: step 4
# of 9`. A wave-shaped run adds a Wave segment on the end.
#
# What was REMOVED from the bar in 1.18.0, and why: the model name, the
# session cost, and the git branch. None of the three answers a question the
# owner asked, and the cost figure priced the session's tokens at Anthropic
# list rates for a subscriber who pays $0 marginal — a charge that was never
# incurred. No money figure is computed anywhere in this file any more.
#
# THE INSTALLER OWNS THE BODY. The deployed script at
# ~/.claude/statusline-command.sh is this file's heredoc output and nothing
# else. Never edit a deployed copy: fix the heredoc here and re-run the
# installer, then diff the two. (That is exactly how an earlier defect
# survived — the installer carried the fix, the running script did not.)
#
# HOW IT NOTICES. The stamp file is TWO lines — the sha256 of the body this
# installer generates, and the date. Every path that could stop early now
# compares the deployed file's sha256 against the installer's own first, so a
# statusLine key that is already present can no longer freeze a stale body in
# place. `--check` is the drift report (both hashes, writes nothing); `--force`
# is the repair. A statusline that is not ours is never written to, in any mode.
#
# Never prints API keys or any secret value. Name-only output.
set -uo pipefail

STATUSLINE_SCRIPT="$HOME/.claude/statusline-command.sh"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CC9_SETTINGS="$HOME/.claude-nine/settings.json"
STAMP_DIR="$HOME/.claude"
STAMP_FILE="$STAMP_DIR/.spec-protocol-statusline-stamp"

say()  { printf '%s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
bad()  { printf '✗ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }

# --- prerequisite --------------------------------------------------------
# jq reads and writes the settings JSON here, and reads the project state in
# the deployed script. It ships with macOS 26 and is absent on older Macs and
# on stock Linux and Windows. Checked FIRST, before --check, so a dry run on a
# machine without it reports the truth instead of a hypothetical plan. One
# plain sentence, no jargon, exit 2.
if ! command -v jq >/dev/null 2>&1; then
  say "One small helper program is missing (jq). Install it, then run this again."
  exit 2
fi

# --- content hashing ------------------------------------------------------
# The installer owns the body, so the installer has to be able to tell when the
# deployed copy is no longer the body it would write. sha256 of the generated
# text is that test. `shasum` ships with macOS, `sha256sum` with most Linux.
# Each candidate is RUN on a known input before it is trusted — a resolvable
# name is not a working program — and with neither of them working the answer
# is UNDETERMINED: this script never regenerates on an unproven comparison,
# because a wrong "drift" verdict would overwrite a healthy file.

SHA_TOOL=""
sha256_resolve() {
  [ -n "$SHA_TOOL" ] && return 0
  if printf '' | shasum -a 256 >/dev/null 2>&1; then SHA_TOOL="shasum"; return 0; fi
  if printf '' | sha256sum      >/dev/null 2>&1; then SHA_TOOL="sha256sum"; return 0; fi
  return 1
}

sha256_stdin() {
  sha256_resolve || return 1
  case "$SHA_TOOL" in
    shasum)    shasum -a 256 2>/dev/null | awk '{print $1}' ;;
    sha256sum) sha256sum     2>/dev/null | awk '{print $1}' ;;
    *)         return 1 ;;
  esac
}

sha256_file() {
  [ -f "$1" ] || return 1
  sha256_stdin < "$1"
}

# --- store helpers ------------------------------------------------------

has_statusline() {
  local f="$1"
  [ -f "$f" ] || return 1
  jq -e 'has("statusLine")' "$f" >/dev/null 2>&1
}

settings_symlink_target() {
  local f="$1"
  [ -L "$f" ] && readlink "$f"
}

backup_settings() {
  local f="$1"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "$f" "$f.bak-statusline-$ts"
  say "Backup: $f.bak-statusline-$ts"
}

set_statusline_key() {
  local f="$1"
  jq --arg cmd "$STATUSLINE_SCRIPT" \
    '.statusLine = {"type": "command", "command": $cmd}' \
    "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

# --- the generated body ---------------------------------------------------
# The deployed script, as a quoted heredoc, emitted by a function so the
# installer can HASH the body it would write without writing it anywhere.
# This is the only copy of the body; ~/.claude/statusline-command.sh is its
# output and nothing else.
emit_statusline_body() {
  cat <<'STATUSLINE_EOF'
#!/usr/bin/env bash
# SPEC-PROTOCOL-STATUSLINE — Spec Protocol status line (the CLIENT BAR).
#
#   Working ✓ 2m ago | Now: the booking page | 14 of 40 pieces (35%) | Needs you: nothing
#
# Four plain-words segments. Before the plan exists the third reads
# `Getting ready: step 4 of 9`. A wave-shaped run adds `Wave 2 ██████░░░░ 60%`.
#
# NOT on this bar (removed 1.18.0): the model name, the session cost, the git
# branch. No money figure is computed here at all.
#
# GENERATED FILE. Its source is the heredoc in the skill's
# scripts/setup-statusline.sh. Editing this copy is lost on the next install
# and puts the running bar out of step with the installer.
#
# Never invents a number. A source that is missing, unreadable, or malformed
# drops its OWN segment and leaves the rest of the bar standing. Never prints
# secrets. bash 3.2 compatible — no associative arrays (stock macOS ships
# bash 3.2; `declare -A` there blanks the whole bar under `set -u`).
set -uo pipefail

json="$(cat)"
if [ -z "$json" ]; then exit 0; fi
# No jq -> no bar. A blank bar is honest; a bar built from unparsed JSON is not.
command -v jq >/dev/null 2>&1 || exit 0

jqget() { printf '%s' "$json" | jq -r "$1" 2>/dev/null || true; }
cwd_path="$(jqget '.cwd // empty')"

now_epoch() { date -u +%s; }

# ISO8601Z -> epoch, portable across BSD (macOS) and GNU date. Prints nothing
# and returns 1 when the stamp cannot be parsed — UNDETERMINED, never a guess.
iso_to_epoch() {
  local ts="$1" out
  out="$(TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null)" && { printf '%s' "$out"; return 0; }
  out="$(date -u -d "$ts" +%s 2>/dev/null)" && { printf '%s' "$out"; return 0; }
  return 1
}

# File modification time -> epoch (BSD stat, then GNU stat).
mtime_epoch() {
  local f="$1" out
  out="$(stat -f %m "$f" 2>/dev/null)" && { printf '%s' "$out"; return 0; }
  out="$(stat -c %Y "$f" 2>/dev/null)" && { printf '%s' "$out"; return 0; }
  return 1
}

# One line, no pipes (the bar's own separator), bounded length.
oneline() { printf '%s' "$1" | tr -d '\n\r' | tr '|' '/' | cut -c1-60; }

# The ten-block progress bar, as ELEVEN PREBUILT LITERALS printed whole.
# Never built by translating spaces into block characters with `tr`: that
# pipeline maps a byte at a time and corrupts a multi-byte block character
# under a C locale, which is a locale a status line often runs in. A literal
# string printed with %s is locale-proof.
bar10() {
  case "$1" in
    0)  printf '%s' '░░░░░░░░░░' ;;
    1)  printf '%s' '█░░░░░░░░░' ;;
    2)  printf '%s' '██░░░░░░░░' ;;
    3)  printf '%s' '███░░░░░░░' ;;
    4)  printf '%s' '████░░░░░░' ;;
    5)  printf '%s' '█████░░░░░' ;;
    6)  printf '%s' '██████░░░░' ;;
    7)  printf '%s' '███████░░░' ;;
    8)  printf '%s' '████████░░' ;;
    9)  printf '%s' '█████████░' ;;
    10) printf '%s' '██████████' ;;
    *)  printf '%s' '░░░░░░░░░░' ;;
  esac
}

# --- the project home ------------------------------------------------------
# BOUNDED UPWARD WALK — spec-protocol projects are not git repos, so this
# cannot use `git rev-parse --show-toplevel`. From $cwd, look for a CONTROL
# directory, walking up one level at a time, stopping the moment $HOME (or,
# as a hard safety bound for a $cwd outside $HOME entirely, the filesystem
# root) has been checked. Without the walk every segment renders from the
# project root and then silently vanishes the moment you `cd` one level down.
# The walk keys on CONTROL/ rather than on the state file, because the
# `Getting ready` segment has to render BEFORE the state file exists.
proj_home=""
if [ -n "$cwd_path" ]; then
  walk_dir="$cwd_path"
  while [ -n "$walk_dir" ]; do
    if [ -d "$walk_dir/CONTROL" ]; then
      proj_home="$walk_dir"
      break
    fi
    [ "$walk_dir" = "${HOME:-}" ] && break
    [ "$walk_dir" = "/" ] && break
    walk_dir="$(dirname "$walk_dir")"
  done
fi

state_file=""
if [ -n "$proj_home" ] && [ -f "$proj_home/CONTROL/project_state.json" ]; then
  state_file="$proj_home/CONTROL/project_state.json"
fi

# --- 1. Working ✓ Nm ago ---------------------------------------------------
# The age of the NEWEST line in CONTROL/HEARTBEAT.md — one line per live
# agent, each stamped `<ISO8601Z> | agent label | work item | stage` and
# rewritten on every real progress step (references/documents.md, document
# 13). Newest = the highest stamp, which for a fixed-width ISO stamp is the
# lexicographic maximum. A heartbeat file with no parseable stamp falls back
# to the file's own modification time — still disk truth, never a guess. No
# heartbeat file at all -> the segment is omitted; nothing has reported work.
workseg=""
if [ -n "$proj_home" ] && [ -f "$proj_home/CONTROL/HEARTBEAT.md" ]; then
  hb_file="$proj_home/CONTROL/HEARTBEAT.md"
  hb_ts="$(sed -e 's/^[[:space:]]*-[[:space:]]*//' "$hb_file" 2>/dev/null \
           | grep -o '^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z' \
           | sort -r | head -n 1)"
  hb_epoch=""
  if [ -n "$hb_ts" ]; then hb_epoch="$(iso_to_epoch "$hb_ts" || true)"; fi
  if [ -z "$hb_epoch" ]; then hb_epoch="$(mtime_epoch "$hb_file" || true)"; fi
  case "$hb_epoch" in
    ''|*[!0-9]*) hb_epoch="" ;;
  esac
  if [ -n "$hb_epoch" ]; then
    age_min=$(( ( $(now_epoch) - hb_epoch ) / 60 ))
    [ "$age_min" -lt 0 ] && age_min=0
    workseg="Working ✓ ${age_min}m ago"
  fi
fi

# --- 2. Now: <plain name> --------------------------------------------------
# What the run is on RIGHT NOW, in plain words. Read from documents a
# spec-protocol project actually writes — no other shape is looked for:
#
#   CONTROL/project_state.json -> `.phase`, "<current task id>" in the
#     project-state@1 schema (references/documents.md); the conductor writes
#     it at station 15 of every revolution, and references/worked-example.md
#     carries real values ("phase": "T-07", "phase": "T-03").
#   CONTROL/CHECKLIST.md (document 2, the planner) then CONTROL/TODO.md
#     (document 3, the orchestrator) -> the line where that same id sits next
#     to the sentence a person would say out loud.
#
# The id is looked up and the SENTENCE is what gets shown — "the booking
# page", never "T-07" (references/audience.md, the naming convention).
# `phase` is a free-text string, so a phase that is already plain words is
# shown as it stands. Nothing resolvable -> the segment is OMITTED: a bare
# identifier never reaches the bar, and a name is never manufactured from a
# file path or a heading.
nowseg=""
now_phase=""
if [ -n "$state_file" ]; then
  now_phase="$(jq -r '.phase // empty' "$state_file" 2>/dev/null || true)"
  case "$now_phase" in null) now_phase="" ;; esac
  now_phase="$(oneline "$now_phase")"
fi

# name_for_id <file> <id> — the plain words on the line that carries the id.
# An OPEN box wins over any other line; a closed one still names the work.
# -F matches the id LITERALLY, so an id carrying a regex metacharacter can
# never turn into a pattern.
name_for_id() {
  local f="$1" id="$2" line text
  [ -f "$f" ] || return 0
  line="$(grep -F -- "$id" "$f" 2>/dev/null \
          | grep -m1 -E '^[[:space:]]*[-*][[:space:]]*\[[[:space:]]*\]' || true)"
  [ -n "$line" ] || line="$(grep -m1 -F -- "$id" "$f" 2>/dev/null || true)"
  [ -n "$line" ] || return 0
  # Drop the list marker and the box, then the id itself (removed literally by
  # the shell — no regex escaping), then the punctuation that joined the two.
  # Byte-wise classes only: that separator is usually an em dash and this bar
  # often runs under a C locale.
  text="$(printf '%s' "$line" \
          | sed -e 's/^[[:space:]]*[-*][[:space:]]*//' \
                -e 's/^\[[[:space:]xX]\][[:space:]]*//')"
  text="${text/"$id"/}"
  text="$(printf '%s' "$text" | sed -e 's/^[^[:alnum:]]*//' -e 's/[[:space:]]*$//')"
  printf '%s' "$text"
}

now_unit=""
if [ -n "$now_phase" ]; then
  if [ -n "$proj_home" ]; then
    now_unit="$(name_for_id "$proj_home/CONTROL/CHECKLIST.md" "$now_phase")"
    [ -n "$now_unit" ] || now_unit="$(name_for_id "$proj_home/CONTROL/TODO.md" "$now_phase")"
  fi
  # No line names it: show the phase only when it is already a phrase a
  # person would say. A bare id stays off the bar.
  if [ -z "$now_unit" ]; then
    case "$now_phase" in *\ *) now_unit="$now_phase" ;; esac
  fi
fi
now_unit="$(oneline "$now_unit")"
if [ -n "$now_unit" ]; then
  nowseg="Now: $now_unit"
fi

# --- 3. n of N pieces (p%)  /  Getting ready: step n of 9 ------------------
# Disk truth only. Pieces = tasks.counts, the SAME counts the reconciler
# audits: completed of (pending + in_progress + completed). Blocked work
# counts in the total — hiding it inflates the percent. The counts advance
# only when a task completes under the completion law, so the number moves on
# VALIDATION, never on code generation, and a repair loop that reopens work
# moves it DOWN. That is correct.
#
# Before the plan exists there is nothing to count, and 0% would be a lie
# about a project that has not been planned yet. The conductor writes
# CONTROL/setup_progress.json at each step of the nine-step setup flow —
# one line, {"step":4,"of":9} — and this segment reads it instead.
pieceseg=""
if [ -n "$state_file" ]; then
  pcounts="$(jq -r '.tasks.counts // empty | "\(.pending // 0) \(.in_progress // 0) \(.completed // 0)"' "$state_file" 2>/dev/null || true)"
  pstatus="$(jq -r '.run_status // empty' "$state_file" 2>/dev/null || true)"
  if [ -n "$pcounts" ]; then
    set -- $pcounts
    ptotal=$(( $1 + $2 + $3 ))
    pdone="$3"
    if [ "$ptotal" -gt 0 ]; then
      ppct=$(( pdone * 100 / ptotal ))
      pieceseg="${pdone} of ${ptotal} pieces (${ppct}%)"
      if [ -n "$pstatus" ] && [ "$pstatus" != "RUNNING" ]; then
        pieceseg="$pieceseg [$pstatus]"
      fi
    fi
  fi
elif [ -n "$proj_home" ] && [ -f "$proj_home/CONTROL/setup_progress.json" ]; then
  sfile="$proj_home/CONTROL/setup_progress.json"
  sstep="$(jq -r '.step // empty' "$sfile" 2>/dev/null || true)"
  sof="$(jq -r '.of // empty' "$sfile" 2>/dev/null || true)"
  case "$sstep" in ''|*[!0-9]*) sstep="" ;; esac
  case "$sof"   in ''|*[!0-9]*) sof="9"  ;; esac
  if [ -n "$sstep" ]; then
    pieceseg="Getting ready: step ${sstep} of ${sof}"
  fi
fi

# --- 4. Needs you: <k or nothing> -----------------------------------------
# Open items in CONTROL/TODO.md that are waiting on a person: the
# reconciler's OPERATOR-ESCALATION rows and the questions the orchestrator
# parked for a human (document 3 — "the questions waiting on a human with
# your recommendation"). An unchecked box that names OPERATOR-ESCALATION or
# QUESTION, or asks something with a question mark, counts. A checked box
# never counts. No TODO.md -> the segment is omitted, never a cheerful zero.
needseg=""
if [ -n "$proj_home" ] && [ -f "$proj_home/CONTROL/TODO.md" ]; then
  needk="$(grep -c -E '^[[:space:]]*[-*][[:space:]]*\[[[:space:]]*\].*(OPERATOR-ESCALATION|QUESTION|\?)' \
           "$proj_home/CONTROL/TODO.md" 2>/dev/null || true)"
  case "$needk" in ''|*[!0-9]*) needk="" ;; esac
  if [ -n "$needk" ]; then
    if [ "$needk" -gt 0 ]; then needseg="Needs you: $needk"; else needseg="Needs you: nothing"; fi
  fi
fi

# --- 5. Wave (wave-shaped runs only) ---------------------------------------
# SCOPE — the project you are ACTUALLY IN. Reads CONTROL/LEDGER.md at $cwd,
# else at the git repo root of $cwd. That is the file spec-protocol projects
# write (references/documents.md, document 6); the pre-1.18.0 script read a
# fix-execution ledger that no spec-protocol project ever writes, so this bar
# could never render for a client. NEVER a hardcoded absolute path: a ledger
# outside the current project is ANOTHER project's status.
# CURRENT WAVE — the highest "WAVE <n>" with NO "WAVE <n> CLOSED" line. A
# closed wave is history; all waves closed -> segment omitted, so the bar
# clears itself the moment the last wave closes.
# TOTAL = that wave's workflow-completion lines ("- `WF-<n>x" class); DONE =
# those carrying a PASS or DONE marker. Numerator and denominator share the
# same anchored class, so log lines that merely MENTION a wave id are never
# counted as workflows.
wavseg=""
ledger_file=""
if [ -n "$cwd_path" ] && [ -f "$cwd_path/CONTROL/LEDGER.md" ]; then
  ledger_file="$cwd_path/CONTROL/LEDGER.md"
elif [ -n "$cwd_path" ] && [ -d "$cwd_path" ]; then
  repo_root="$(git -C "$cwd_path" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$repo_root" ] && [ -f "$repo_root/CONTROL/LEDGER.md" ]; then
    ledger_file="$repo_root/CONTROL/LEDGER.md"
  fi
fi
if [ -n "$ledger_file" ]; then
  cur_wave=""
  for w in $(grep -o 'WAVE [0-9][0-9]*' "$ledger_file" 2>/dev/null \
             | grep -o '[0-9][0-9]*' | sort -rnu); do
    grep -q "WAVE ${w} CLOSED" "$ledger_file" 2>/dev/null || { cur_wave="$w"; break; }
  done
  if [ -n "$cur_wave" ]; then
    wftotal="$(grep -c "^- \`WF-${cur_wave}[A-Z]" "$ledger_file" 2>/dev/null || true)"
    wfdone="$(grep "^- \`WF-${cur_wave}[A-Z]" "$ledger_file" 2>/dev/null | grep -c 'PASS\|DONE' || true)"
    # grep rc>=2 (unreadable file) yields empty, not 0 -> never let that reach
    # an arithmetic test as a bare word.
    wftotal="${wftotal:-0}"; wfdone="${wfdone:-0}"
    if [ "$wftotal" -gt 0 ]; then
      wpct=$(( wfdone * 100 / wftotal ))
      wfill=$(( wpct / 10 ))
      wavseg="Wave $cur_wave $(bar10 "$wfill") ${wpct}%"
    fi
  fi
fi

# --- assemble --------------------------------------------------------------
out=""
add() {
  [ -n "$1" ] || return 0
  if [ -n "$out" ]; then out="$out | $1"; else out="$1"; fi
}
add "$workseg"
add "$nowseg"
add "$pieceseg"
add "$needseg"
add "$wavseg"

[ -n "$out" ] && printf '%s\n' "$out"
exit 0
STATUSLINE_EOF
}

# --- is the deployed body still the installer's body? ---------------------
# `is_ours` is the ONE ownership test in this file: the generated body carries
# the SPEC-PROTOCOL-STATUSLINE marker on its second line, and a statusline
# without it belongs to somebody else and is never written to, in any mode.

STATUSLINE_MARKER="SPEC-PROTOCOL-STATUSLINE"

is_ours() {
  [ -f "$1" ] || return 1
  grep -q "$STATUSLINE_MARKER" "$1" 2>/dev/null
}

installer_body_hash() { emit_statusline_body | sha256_stdin; }
deployed_body_hash()  { sha256_file "$STATUSLINE_SCRIPT"; }

# The stamp is TWO lines: the sha256 of the body the last install wrote, then
# the date. A pre-1.19.0 stamp holds only a date, which is not 64 hex
# characters, so it reads as "no recorded hash" and can never read as a match.
stamp_hash() {
  local h
  [ -f "$STAMP_FILE" ] || return 1
  h="$(sed -n '1p' "$STAMP_FILE" 2>/dev/null)"
  printf '%s' "$h" | grep -qE '^[0-9a-f]{64}$' || return 1
  printf '%s' "$h"
}

write_stamp() {
  local h
  h="$(installer_body_hash || true)"
  mkdir -p "$STAMP_DIR"
  printf '%s\n%s\n' "${h:-no-content-hash}" "$(date +%Y-%m-%d)" > "$STAMP_FILE"
}

# body_state — sets BODY_STATE (and the hashes behind the verdict) to one of:
#   absent        no deployed script at all
#   foreign       a statusline that is not ours; never touched
#   undetermined  no working sha256 tool, so the comparison cannot be made
#   match         the deployed body IS the body this installer generates
#   drift         the deployed body is NOT the body this installer generates
# It sets globals rather than printing, because a `$(...)` call would run it in
# a subshell and the hashes would never reach the caller.
BODY_STATE=""
BODY_DEPLOYED_HASH=""
BODY_INSTALLER_HASH=""
BODY_STAMP_HASH=""
BODY_STAMP_CURRENT=0
body_state() {
  BODY_STATE=""
  BODY_DEPLOYED_HASH=""
  BODY_INSTALLER_HASH="$(installer_body_hash || true)"
  BODY_STAMP_HASH="$(stamp_hash || true)"
  BODY_STAMP_CURRENT=0
  if [ -n "$BODY_INSTALLER_HASH" ] && [ "$BODY_STAMP_HASH" = "$BODY_INSTALLER_HASH" ]; then
    BODY_STAMP_CURRENT=1
  fi
  if [ ! -f "$STATUSLINE_SCRIPT" ]; then BODY_STATE="absent"; return 0; fi
  if ! is_ours "$STATUSLINE_SCRIPT"; then BODY_STATE="foreign"; return 0; fi
  BODY_DEPLOYED_HASH="$(deployed_body_hash || true)"
  if [ -z "$BODY_INSTALLER_HASH" ] || [ -z "$BODY_DEPLOYED_HASH" ]; then
    BODY_STATE="undetermined"; return 0
  fi
  if [ "$BODY_DEPLOYED_HASH" = "$BODY_INSTALLER_HASH" ]; then
    BODY_STATE="match"
  else
    BODY_STATE="drift"
  fi
}

report_hashes() {
  say "  deployed  sha256: ${BODY_DEPLOYED_HASH:-unknown}"
  say "  installer sha256: ${BODY_INSTALLER_HASH:-unknown}"
}

# Regenerate ONLY the file the installer owns, and re-stamp it. A statusline
# that is not ours is refused here exactly as it is at the install step: rc 1,
# nothing written, no settings store touched.
regenerate_body() {
  if [ -f "$STATUSLINE_SCRIPT" ] && ! is_ours "$STATUSLINE_SCRIPT"; then
    warn "Existing $STATUSLINE_SCRIPT is not ours — would leave untouched."
    say "Status line body left UNCHANGED. Nothing was written."
    return 1
  fi
  mkdir -p "$(dirname "$STATUSLINE_SCRIPT")"
  emit_statusline_body > "$STATUSLINE_SCRIPT"
  chmod +x "$STATUSLINE_SCRIPT"
  write_stamp
  ok "Regenerated from the installer: $STATUSLINE_SCRIPT"
  return 0
}

# --- main ----------------------------------------------------------------

# --check: detection-only dry run. Reports what WOULD happen, writes nothing —
# including the drift report, which is a comparison and never a repair.
# Testing MUST use this mode — a bare invocation mutates the settings stores.
if [ "${1:-}" = "--check" ]; then
  say "DRY RUN (--check) — nothing will be written."
  for f in "$CLAUDE_SETTINGS" "$CC9_SETTINGS"; do
    if has_statusline "$f"; then
      say "Already configured in $f — healthy, no action."
    elif [ -f "$f" ]; then
      say "Would configure statusLine in $f."
    else
      say "Store absent: $f — skipped."
    fi
  done
  body_state
  case "$BODY_STATE" in
    absent)
      say "Would install shared script: $STATUSLINE_SCRIPT" ;;
    foreign)
      say "Shared script present but NOT ours — would leave untouched." ;;
    undetermined)
      warn "UNDETERMINED: no working sha256 tool (shasum, sha256sum) on PATH."
      say "Shared script already installed (ours) — its body cannot be compared." ;;
    match)
      say "HEALTHY: deployed body matches installer"
      report_hashes ;;
    drift)
      say "DRIFT: deployed body differs from installer"
      report_hashes
      say "  Repair: run this installer with --force." ;;
  esac
  if [ -f "$STAMP_FILE" ]; then
    if [ "$BODY_STAMP_CURRENT" = 1 ]; then
      say "Stamp present and carries the installer's own content hash."
    elif [ -n "$BODY_STAMP_HASH" ]; then
      say "Stamp present, records $BODY_STAMP_HASH — not the installer's body."
    else
      say "Stamp present but carries NO content hash (pre-1.19.0 date-only stamp)."
    fi
  else
    say "No stamp — a real run would install and stamp."
  fi
  exit 0
fi

# --force: the repair. Regenerates the file the installer owns WITHOUT the
# content comparison, then re-stamps it. It still refuses a statusline that is
# not ours, and it still never writes a settings store — a missing statusLine
# key is the bare run's job, not this one's.
if [ "${1:-}" = "--force" ]; then
  say "FORCE — regenerating the installer-owned status line script."
  regenerate_body || say "Nothing regenerated."
  exit 0
fi

# --selftest: three fixtures under a TEMPORARY HOME, each one this same file
# re-invoked with $HOME pointed into the temp tree. Every path this script
# touches is derived from $HOME, so nothing outside the temp tree can be
# written; the real ~/.claude files are stat'd before and after as the proof.
#
#   A  stale body + a stamp that matches the STALE body -> DRIFT
#   B  the current body + a current stamp              -> HEALTHY
#   C  a statusline that is not ours                   -> not ours, untouched
#
# Fixture A is the discriminating one: its stamp is internally consistent, so
# only a comparison against the INSTALLER catches it. Three fixtures must
# return three different verdicts; a run where they agree is a broken test.
if [ "${1:-}" = "--selftest" ]; then
  SELF="$0"
  case "$SELF" in /*) ;; *) SELF="$PWD/$SELF" ;; esac
  T="$(mktemp -d "${TMPDIR:-/tmp}/spec-statusline-selftest.XXXXXX")" || {
    bad "selftest: cannot create a temporary directory."; exit 2; }
  trap 'rm -rf "$T"' EXIT
  SELFTEST_FAILED=0

  st_mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || printf 'absent'; }
  st_fingerprint() {
    printf '%s|%s|%s|%s' \
      "$(st_mtime "$HOME/.claude/statusline-command.sh")" \
      "$(st_mtime "$STAMP_FILE")" \
      "$(st_mtime "$HOME/.claude/settings.json")" \
      "$(st_mtime "$HOME/.claude-nine/settings.json")"
  }
  REAL_BEFORE="$(st_fingerprint)"

  st_fail() { bad "selftest: $*"; SELFTEST_FAILED=$((SELFTEST_FAILED+1)); }
  st_report() {   # st_report <failure count before the fixture> <line>
    if [ "$SELFTEST_FAILED" = "$1" ]; then say "  PASS  $2"; else say "  FAIL  $2"; fi
  }
  st_expect() {   # st_expect <label> <text> <pattern>
    printf '%s' "$2" | grep -qi -- "$3" && return 0
    st_fail "$1: expected /$3/ in the output"
    return 1
  }

  st_home() {     # st_home <name> -> a fixture HOME with the statusLine key set
    local h="$T/$1"
    mkdir -p "$h/.claude"
    printf '%s\n' '{"statusLine":{"type":"command","command":"statusline-command.sh"}}' \
      > "$h/.claude/settings.json"
    printf '%s' "$h"
  }
  st_run() {      # st_run <fixture HOME> [flag]
    if [ -n "${2:-}" ]; then HOME="$1" bash "$SELF" "$2" 2>&1
    else                    HOME="$1" bash "$SELF"      2>&1; fi
  }

  INSTALLER_HASH="$(installer_body_hash || true)"
  [ -n "$INSTALLER_HASH" ] || { bad "selftest: no working sha256 tool — UNDETERMINED, not a pass."; exit 2; }

  # --- fixture A: stale body, stamp valid for that stale body ---------------
  A0="$SELFTEST_FAILED"
  HA="$(st_home A)"
  emit_statusline_body > "$HA/.claude/statusline-command.sh"
  printf '%s\n' '# a line an earlier version carried' >> "$HA/.claude/statusline-command.sh"
  printf '%s\n%s\n' "$(sha256_file "$HA/.claude/statusline-command.sh")" '2026-01-01' \
    > "$HA/.claude/.spec-protocol-statusline-stamp"
  A_SETTINGS_BEFORE="$(sha256_file "$HA/.claude/settings.json")"
  A_CHECK="$(st_run "$HA" --check)"
  st_expect "A --check" "$A_CHECK" 'DRIFT: deployed body differs from installer'
  st_expect "A --check" "$A_CHECK" "$INSTALLER_HASH"
  A_INSTALL="$(st_run "$HA")"
  st_expect "A install" "$A_INSTALL" 'DRIFT'
  st_expect "A install" "$A_INSTALL" 'Regenerated from the installer'
  [ "$(sha256_file "$HA/.claude/statusline-command.sh")" = "$INSTALLER_HASH" ] \
    || st_fail "A install: the body was not regenerated to the installer's"
  [ "$(sed -n '1p' "$HA/.claude/.spec-protocol-statusline-stamp")" = "$INSTALLER_HASH" ] \
    || st_fail "A install: the stamp does not carry the installer's hash"
  [ "$(sha256_file "$HA/.claude/settings.json")" = "$A_SETTINGS_BEFORE" ] \
    || st_fail "A install: the settings store was rewritten — it must never be"
  st_report "$A0" "A  stale body + valid stamp      -> DRIFT, regenerated, settings untouched"

  # --- fixture B: the current body, current stamp --------------------------
  B0="$SELFTEST_FAILED"
  HB="$(st_home B)"
  emit_statusline_body > "$HB/.claude/statusline-command.sh"
  printf '%s\n%s\n' "$INSTALLER_HASH" "$(date +%Y-%m-%d)" \
    > "$HB/.claude/.spec-protocol-statusline-stamp"
  B_BODY_BEFORE="$(st_mtime "$HB/.claude/statusline-command.sh")"
  B_CHECK="$(st_run "$HB" --check)"
  st_expect "B --check" "$B_CHECK" 'HEALTHY: deployed body matches installer'
  B_INSTALL="$(st_run "$HB")"
  st_expect "B install" "$B_INSTALL" 'matches the installer'
  [ "$(sha256_file "$HB/.claude/statusline-command.sh")" = "$INSTALLER_HASH" ] \
    || st_fail "B install: a matching body was altered"
  [ "$(st_mtime "$HB/.claude/statusline-command.sh")" = "$B_BODY_BEFORE" ] \
    || st_fail "B install: a matching body was rewritten"
  st_report "$B0" "B  current body + current stamp  -> HEALTHY, nothing rewritten"

  # --- fixture C: a statusline that is not ours ----------------------------
  C0="$SELFTEST_FAILED"
  HC="$(st_home C)"
  printf '%s\n%s\n' '#!/usr/bin/env bash' 'echo "somebody else s bar"' \
    > "$HC/.claude/statusline-command.sh"
  C_BODY_BEFORE="$(sha256_file "$HC/.claude/statusline-command.sh")"
  C_CHECK="$(st_run "$HC" --check)"
  st_expect "C --check" "$C_CHECK" 'NOT ours — would leave untouched'
  C_INSTALL="$(st_run "$HC")"
  st_expect "C install" "$C_INSTALL" 'not ours — would leave untouched'
  C_FORCE="$(st_run "$HC" --force)"
  st_expect "C --force" "$C_FORCE" 'not ours — would leave untouched'
  [ "$(sha256_file "$HC/.claude/statusline-command.sh")" = "$C_BODY_BEFORE" ] \
    || st_fail "C: a foreign statusline was modified"
  [ -f "$HC/.claude/.spec-protocol-statusline-stamp" ] \
    && st_fail "C: a foreign statusline was stamped"
  st_report "$C0" "C  a statusline that is not ours -> not ours — would leave untouched (--check, install, --force)"

  # --- the three verdicts must differ --------------------------------------
  if printf '%s' "$A_CHECK" | grep -q 'HEALTHY' \
     || printf '%s' "$B_CHECK" | grep -q 'DRIFT' \
     || printf '%s' "$C_CHECK" | grep -q 'DRIFT\|HEALTHY'; then
    st_fail "the three fixtures did not return three different verdicts — the test is broken"
  fi

  # --- proof that this box was not written to ------------------------------
  REAL_AFTER="$(st_fingerprint)"
  if [ "$REAL_BEFORE" = "$REAL_AFTER" ]; then
    say "Real \$HOME statusline files unchanged (mtimes identical before and after)."
  else
    st_fail "a file under the real \$HOME changed during the selftest"
  fi

  if [ "$SELFTEST_FAILED" = 0 ]; then
    ok "selftest: 3 fixtures, 3 different verdicts — DRIFT, HEALTHY, not ours."
    exit 0
  fi
  bad "selftest FAILED — $SELFTEST_FAILED check(s) did not hold."
  exit 1
fi

# 1. Detect-first. An existing statusLine key in EITHER store is reported and
#    NEVER replaced — the settings stores are still never rewritten when a key
#    exists. The BODY is a separate question, and it used to ride on the same
#    answer: a present key ended the run, so a deployed script written by an
#    older installer stayed on the box for ever. It no longer does. The
#    deployed file is this installer's own output, so its sha256 is compared
#    with the body this installer would write, and only OUR file is
#    regenerated on a mismatch.
EXISTING=0
for f in "$CLAUDE_SETTINGS" "$CC9_SETTINGS"; do
  if has_statusline "$f"; then
    say "Claude Code Status Line (name-only check):"
    say "Already configured in $(basename "$f")."
    say "No replacement required."
    EXISTING=1
  fi
done
if [ "$EXISTING" = 1 ]; then
  body_state
  case "$BODY_STATE" in
    match)
      if [ "$BODY_STAMP_CURRENT" = 1 ]; then
        say "Deployed body matches the installer — nothing to regenerate."
      else
        say "Deployed body matches the installer — refreshing the content stamp."
        write_stamp
      fi
      ;;
    drift)
      say "DRIFT: deployed body differs from installer"
      report_hashes
      regenerate_body || true
      ;;
    absent)
      say "No deployed status line script — installing ours."
      regenerate_body || true
      ;;
    foreign)
      warn "Existing $STATUSLINE_SCRIPT is not ours — would leave untouched."
      say "Status line body left UNCHANGED. Nothing was written."
      ;;
    *)
      warn "UNDETERMINED: no working sha256 tool (shasum, sha256sum) on PATH."
      say "The deployed body cannot be compared, so it is left exactly as it stands."
      ;;
  esac
  exit 0
fi

# 2. Idempotency stamp. Same launch paths + same script + already stamped ->
#    nothing to do. Stamp and key presence can drift (documented disable
#    removes only the key), so a stamp is honored only while a store still
#    carries the line; otherwise the stamp is cleared and install proceeds.
#    The stamp is never on its own a reason to stop either: step 1 normally
#    answers the key-present case, and this branch repeats the SAME content
#    comparison so no path in this file can report already-installed over a
#    body the installer no longer generates.
if [ -f "$STAMP_FILE" ]; then
  STAMP_VALID=0
  for f in "$CLAUDE_SETTINGS" "$CC9_SETTINGS"; do
    if has_statusline "$f"; then STAMP_VALID=1; break; fi
  done
  if [ "$STAMP_VALID" = 1 ]; then
    body_state
    case "$BODY_STATE" in
      match)
        say "Spec Protocol status line: already installed (content stamp matches)."
        say "No replacement required."
        [ "$BODY_STAMP_CURRENT" = 1 ] || write_stamp
        ;;
      drift)
        say "DRIFT: deployed body differs from installer"
        report_hashes
        regenerate_body || true
        ;;
      absent)
        say "Stamp present but no deployed script — installing ours."
        regenerate_body || true
        ;;
      foreign)
        warn "Existing $STATUSLINE_SCRIPT is not ours — would leave untouched."
        say "Status line body left UNCHANGED. Nothing was written."
        ;;
      *)
        warn "UNDETERMINED: no working sha256 tool (shasum, sha256sum) on PATH."
        say "The deployed body cannot be compared, so it is left exactly as it stands."
        ;;
    esac
    exit 0
  fi
  warn "Stamp present but no statusLine key in either store — removing stamp."
  rm -f "$STAMP_FILE"
fi

# 3. Install the shared statusline command script (idempotent overwrite of
#    our own file only — the file is OURS, not the user's).
if [ -f "$STATUSLINE_SCRIPT" ] && ! is_ours "$STATUSLINE_SCRIPT"; then
  warn "Existing $STATUSLINE_SCRIPT is not ours — left untouched."
  say "Status line left UNCONFIGURED. Point a statusLine key at it by hand."
  exit 0
fi
emit_statusline_body > "$STATUSLINE_SCRIPT"
chmod +x "$STATUSLINE_SCRIPT"
ok "Shared statusline command: $STATUSLINE_SCRIPT"

# 4. Register the key in BOTH settings stores (both-stores rule — the stores
#    are separate; the skills symlink farm does not cover settings.json).
WROTE=0
for f in "$CLAUDE_SETTINGS" "$CC9_SETTINGS"; do
  if [ ! -f "$f" ]; then
    say "Settings store absent (name-only): $(basename "$f") — skipped."
    continue
  fi
  # Symlink rule: update the target file, not the link. A relative link
  # target resolves against the link's own directory, never $HOME.
  if [ -L "$f" ]; then
    orig="$f"
    f="$(readlink "$f")"
    case "$f" in /*) ;; *) f="$(dirname "$orig")/$f" ;; esac
    [ -f "$f" ] || { bad "Symlink target missing: $f — skipped."; continue; }
  fi
  backup_settings "$f"
  set_statusline_key "$f"
  ok "statusLine registered in $(basename "$f")"
  WROTE=$((WROTE+1))
done
if [ "$WROTE" = 0 ]; then
  warn "No settings store written. Status line NOT configured."
  exit 0
fi

# 5. Stamp: the sha256 of the body this installer generates, then the date. A
#    date on its own could never answer the one question a re-run has to ask —
#    is the deployed body still the body this installer writes?
write_stamp

say ""
say "Progress Visibility"
say ""
say "At the bottom of the window you'll see a bar with how close your project is to done. Press Ctrl and T together to see the list of pieces and which are finished."
say ""
say "The bar reads like this:"
say ""
say "  Working ✓ 2m ago | Now: the booking page | 14 of 40 pieces (35%) | Needs you: nothing"
say ""
say "Before the plan exists it reads \"Getting ready: step 4 of 9\" instead of the pieces."
say ""
say "Metric report (supported metrics were configured; unsupported ones omitted — never faked):"
say "  Working ✓ Nm ago: Supported — the age of the newest line in CONTROL/HEARTBEAT.md (file modification time when no line carries a stamp); omitted when nothing has reported work"
say "  Now: <piece>: Supported — CONTROL/project_state.json .phase, named through CONTROL/CHECKLIST.md then CONTROL/TODO.md (a phase already in plain words is shown as it stands); omitted when nothing names it"
say "  n of N pieces (p%): Supported — CONTROL/project_state.json tasks.counts (completed of pending + in_progress + completed); omitted until the plan exists"
say "  Getting ready: step n of 9: Supported — CONTROL/setup_progress.json, shown only before the plan exists"
say "  Needs you: Supported — open OPERATOR-ESCALATION and question items in CONTROL/TODO.md; reads \"nothing\" at zero; omitted when there is no TODO.md"
say "  Wave bar: Supported for wave-shaped runs (reads CONTROL/LEDGER.md at \$cwd or the git root; omitted when no wave lines exist)"
say "  Model name / session cost / git branch: NOT displayed — removed from the client bar in 1.18.0 (no money figure is computed at all)"
say "  Context usage: INTERNAL doctrine — tracked and acted on by the agent (thresholds 70/85/95), never shown to the client"
say "  5-hour / 7-day usage: INTERNAL doctrine — never shown to the client"
say ""
say "Verification still REQUIRED: launch BOTH plain claude and claude-nine and"
say "confirm the status line appears in each — a configured key is not a proven"
say "line. Never report the capability complete until it has been tested."
exit 0
