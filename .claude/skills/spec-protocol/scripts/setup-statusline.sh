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

# --- main ----------------------------------------------------------------

# --check: detection-only dry run. Reports what WOULD happen, writes nothing.
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
  if [ -f "$STATUSLINE_SCRIPT" ]; then
    grep -q "SPEC-PROTOCOL-STATUSLINE" "$STATUSLINE_SCRIPT" 2>/dev/null \
      && say "Shared script already installed (ours) — would keep." \
      || say "Shared script present but NOT ours — would leave untouched."
  else
    say "Would install shared script: $STATUSLINE_SCRIPT"
  fi
  [ -f "$STAMP_FILE" ] && say "Stamp present — a real run would report already-installed."
  exit 0
fi

# 1. Detect-first. An existing statusLine in EITHER store is reported, never
#    replaced. Equal-or-better is the healthy outcome; enhanceable lines are
#    preserved and only extended by hand — this script never rewrites them.
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
  exit 0
fi

# 2. Idempotency stamp. Same launch paths + same script + already stamped ->
#    nothing to do. Stamp and key presence can drift (documented disable
#    removes only the key), so a stamp is honored only while a store still
#    carries the line; otherwise the stamp is cleared and install proceeds.
if [ -f "$STAMP_FILE" ]; then
  STAMP_VALID=0
  for f in "$CLAUDE_SETTINGS" "$CC9_SETTINGS"; do
    if has_statusline "$f"; then STAMP_VALID=1; break; fi
  done
  if [ "$STAMP_VALID" = 1 ]; then
    say "Spec Protocol status line: already installed (stamp present)."
    say "No replacement required."
    exit 0
  fi
  warn "Stamp present but no statusLine key in either store — removing stamp."
  rm -f "$STAMP_FILE"
fi

# 3. Install the shared statusline command script (idempotent overwrite of
#    our own file only — the file is OURS, not the user's).
if [ -f "$STATUSLINE_SCRIPT" ] && ! grep -q "SPEC-PROTOCOL-STATUSLINE" "$STATUSLINE_SCRIPT" 2>/dev/null; then
  warn "Existing $STATUSLINE_SCRIPT is not ours — left untouched."
  say "Status line left UNCONFIGURED. Point a statusLine key at it by hand."
  exit 0
fi
cat > "$STATUSLINE_SCRIPT" <<'STATUSLINE_EOF'
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
# The newest IN_PROGRESS unit's PLAIN NAME — "the booking page", never
# "U042" (references/audience.md, the naming convention). Read from
# CONTROL/project_state.json: any object carrying an IN_PROGRESS status and a
# name, newest by its own timestamp field, falling back to document order.
# The reader is deliberately shape-tolerant — it is a reader, and a state
# file that has not yet grown a unit list drops the segment rather than
# inventing one.
nowseg=""
if [ -n "$state_file" ]; then
  now_unit="$(jq -r '
    [ ..
      | objects
      | select( ((.status? // .state? // "")
                 | if type == "string" then (ascii_upcase | gsub("[-_ ]+"; "_")) else "" end
                ) == "IN_PROGRESS" )
      | select( (.plain_name? // .plain? // .name? // .title? // .unit?) != null )
    ]
    | sort_by(.updated? // .updated_at? // .started_at? // .started? // .ts? // "")
    | last
    | if . == null then empty
      else (.plain_name // .plain // .name // .title // .unit) end
  ' "$state_file" 2>/dev/null || true)"
  now_unit="$(oneline "$now_unit")"
  if [ -n "$now_unit" ] && [ "$now_unit" != "null" ]; then
    nowseg="Now: $now_unit"
  fi
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

# 5. Stamp, so a re-run reports already-installed instead of reconfiguring.
mkdir -p "$STAMP_DIR"
printf '%s\n' "$(date +%Y-%m-%d)" > "$STAMP_FILE"

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
say "  Now: <piece>: Supported — the newest IN_PROGRESS unit's plain name in CONTROL/project_state.json; omitted when nothing is in progress"
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
