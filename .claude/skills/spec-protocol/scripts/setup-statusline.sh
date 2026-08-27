#!/usr/bin/env bash
# setup-statusline.sh — detect-first installer for the Spec Protocol status
# line. Idempotent: safe to run repeatedly; never creates duplicate
# configuration, never destroys an existing status line.
#
# Contract: references/progress-visibility.md. The CLIENT-FACING display
# (operator order 2026-08-16) is: model, session cost (derived), git
# branch/status, Project progress, Wave progress — what truly matters.
# Context usage and 5h/7d rates are INTERNAL doctrine (agent behavior
# thresholds), never client display. Session cost is REQUIRED on the bar.
# Primary source: stdin `cost.total_cost_usd` — Claude Code's own tracked
# total for this session (proven present in the installed CLI's payload-
# construction code; no state file, no delta math, no cross-harness double-
# counting). Fallback (older CC builds without that field): cumulative
# session token counts from `context_window.total_input_tokens` /
# `.total_output_tokens` times published per-model pricing. Either way the
# figure is displayed with a ~ marker, and a model that doesn't match a known
# Anthropic family (including anything shaped like a 9Router chain id) never
# gets an Anthropic-priced number — the cost segment is omitted, never
# guessed and never mis-attributed to routed traffic.
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

if ! command -v jq >/dev/null 2>&1; then
  bad "jq is required and not on PATH"
  exit 2
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
# SPEC-PROTOCOL-STATUSLINE — Spec Protocol status line.
# CLIENT-FACING display (operator order 2026-08-16): model, derived session
# cost, git branch/status, Project progress, Wave progress. Context usage
# and 5h/7d rates are INTERNAL doctrine, never client display. Never invents
# a number; never prints secrets. bash 3.2 compatible — no associative
# arrays (stock macOS ships bash 3.2; `declare -A` there blanks the whole
# bar under `set -u`).
set -uo pipefail

json="$(cat)"
if [ -z "$json" ]; then exit 0; fi

jqget() { printf '%s' "$json" | jq -r "$1" 2>/dev/null || true; }

model="$(jqget '.model.display_name // empty')"
total_in="$(jqget '.context_window.total_input_tokens // empty')"
total_out="$(jqget '.context_window.total_output_tokens // empty')"
cwd_path="$(jqget '.cwd // empty')"

# --- session cost: ~-labeled, never guessed ---------------------------------
# Primary source: stdin `cost.total_cost_usd` — Claude Code's own running
# total for THIS session (confirmed present in the installed CLI's payload-
# construction code). It is already cumulative, so no state file, no
# per-refresh delta math, and no double-counting when both `claude` and
# `claude-nine` happen to share a state directory (that whole class of bug
# is eliminated by not keeping cost state at all).
#
# Fallback (older Claude Code builds that don't yet emit `cost`): derive from
# `context_window.total_input_tokens` / `.total_output_tokens` — these are
# already whole-session cumulative totals per Claude Code's own stdin
# contract, so the fallback needs no delta math either.
#
# Routed sessions (claude-nine / 9Router): `model.display_name` is the raw
# chain id the router was asked for (e.g. "opus-chain", "fusion-coding"),
# not an Anthropic model — chains blend cheap providers and are edited live,
# so no static price is ever honest for one, and "opus-chain" would silently
# match a naive *opus* glob. price_for() therefore refuses anything shaped
# like a chain id BEFORE testing the Anthropic family globs, in both the
# primary and fallback paths, so a routed session never shows an
# Anthropic-priced number — cost is omitted for it instead.
#
# Published pricing, USD per 1M tokens (input / output). Plain `case` —
# no associative arrays. Order fable before opus/sonnet/haiku on general
# principle (no actual substring overlap among these four, but a later
# family glob must never be able to shadow an earlier one).
price_for() {
  local display="$1" lower
  lower="$(printf '%s' "$display" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *-chain|fusion-*) printf '' ;;                    # routed chain id — never Anthropic-priced
    *fable*)          printf '%s %s' "10.00" "50.00" ;;
    *opus*)           printf '%s %s' "5.00" "25.00" ;;
    *sonnet*)         printf '%s %s' "3.00" "15.00" ;;
    *haiku*)          printf '%s %s' "1.00" "5.00" ;;
    *)                printf '' ;;
  esac
}

cost=""
cost_usd="$(jqget '.cost.total_cost_usd // empty')"
if [ -n "$cost_usd" ] && [ "$cost_usd" != "null" ]; then
  prices="$(price_for "$model")"
  if [ -n "$prices" ]; then
    cost="$(awk -v c="$cost_usd" 'BEGIN { printf "~$%.2f", c }')"
  fi
elif [ -n "$total_in" ] && [ -n "$total_out" ] \
   && [ "$total_in" != "null" ] && [ "$total_out" != "null" ]; then
  prices="$(price_for "$model")"
  if [ -n "$prices" ]; then
    pin="${prices%% *}"; pout="${prices##* }"
    cost="$(awk -v ti="$total_in" -v to="$total_out" -v pi="$pin" -v po="$pout" \
      'BEGIN { printf "~$%.2f", (ti*pi + to*po)/1000000 }')"
  fi
fi

# --- project completion bar (THE MAIN METRIC) ------------------------------
# Disk truth only: reads CONTROL/project_state.json. Percent = completed /
# (pending + in_progress + completed). No state file -> segment omitted (the
# plan does not exist yet; showing 0% before the plan exists is fake progress).
# BOUNDED UPWARD WALK — spec-protocol projects are not git repos, so this
# cannot use `git rev-parse --show-toplevel`. From $cwd, check each directory
# for CONTROL/project_state.json, walking up one level at a time, stopping the
# moment $HOME (or, as a hard safety bound for a $cwd outside $HOME entirely,
# the filesystem root) has been checked. Without this walk, the Project
# segment renders from the project root and then silently vanishes the moment
# you `cd` into a subdirectory — the confirmed defect this fixes.
projseg=""
state_file=""
if [ -n "$cwd_path" ]; then
  walk_dir="$cwd_path"
  while [ -n "$walk_dir" ]; do
    if [ -f "$walk_dir/CONTROL/project_state.json" ]; then
      state_file="$walk_dir/CONTROL/project_state.json"
      break
    fi
    [ "$walk_dir" = "$HOME" ] && break
    [ "$walk_dir" = "/" ] && break
    walk_dir="$(dirname "$walk_dir")"
  done
fi
if [ -n "$state_file" ] && [ -f "$state_file" ]; then
  pcounts="$(jq -r '.tasks.counts // empty | "\(.pending // 0) \(.in_progress // 0) \(.completed // 0)"' "$state_file" 2>/dev/null || true)"
  pstatus="$(jq -r '.run_status // empty' "$state_file" 2>/dev/null || true)"
  if [ -n "$pcounts" ]; then
    set -- $pcounts
    ptotal=$(( $1 + $2 + $3 ))
    if [ "$ptotal" -gt 0 ]; then
      ppct=$(( $3 * 100 / ptotal ))
      pfill=$(( ppct / 10 ))
      pbar="$(printf '%*s' "$pfill" '' | tr ' ' '█')$(printf '%*s' $((10 - pfill)) '' | tr ' ' '░')"
      projseg="Project $pbar ${ppct}%"
      if [ -n "$pstatus" ] && [ "$pstatus" != "RUNNING" ]; then
        projseg="$projseg [$pstatus]"
      fi
    fi
  fi
fi

# --- wave bar (wave-shaped runs) -------------------------------------------
# SCOPE — the project you are ACTUALLY IN. Reads FIX-LEDGER.md at $cwd, else at
# the git repo root of $cwd. NEVER a hardcoded absolute path to a named
# project: a ledger outside the current project is ANOTHER project's status and
# must never render here. (2026-08-26 defect: a hardcoded
# $HOME/work-999-setup/FIX-LEDGER.md fallback pinned a long-closed "Wave 6"
# into every session, in every directory, in both config stores, forever.)
# CURRENT WAVE — the highest "WAVE <n>" that has NO "WAVE <n> CLOSED" line. A
# closed wave is history, not status; all waves closed -> segment omitted, so
# the bar clears itself the moment the last wave closes.
# TOTAL = that wave's workflow-completion lines ("- `WF-<n>x" class); DONE =
# those carrying a PASS or DONE marker. Denominator and numerator share the
# same class: the locked-wave table row and log lines (DISPATCH /
# VIOLATION-STOP / CLOSED / REVIEW-FINDING) that merely mention a wave id are
# never counted. No workflow lines for the current wave -> segment omitted.
wavseg=""
ledger_file=""
if [ -n "$cwd_path" ] && [ -f "$cwd_path/FIX-LEDGER.md" ]; then
  ledger_file="$cwd_path/FIX-LEDGER.md"
elif [ -n "$cwd_path" ] && [ -d "$cwd_path" ]; then
  repo_root="$(git -C "$cwd_path" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$repo_root" ] && [ -f "$repo_root/FIX-LEDGER.md" ]; then
    ledger_file="$repo_root/FIX-LEDGER.md"
  fi
fi
if [ -n "$ledger_file" ]; then
  # Highest wave id first; take the first one with no CLOSED line.
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
      wbar="$(printf '%*s' "$wfill" '' | tr ' ' '█')$(printf '%*s' $((10 - wfill)) '' | tr ' ' '░')"
      wavseg="Wave $cur_wave $wbar ${wpct}%"
    fi
  fi
fi

# --- git ------------------------------------------------------------------
gitseg=""
if [ -n "$cwd_path" ] && [ -d "$cwd_path" ]; then
  branch="$(git -C "$cwd_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -n "$branch" ]; then
    dirty="$(git -C "$cwd_path" status --porcelain 2>/dev/null | head -c 1)"
    mark="✓"
    [ -n "$dirty" ] && mark="✗"
    gitseg="$branch $mark"
  fi
fi

# --- assemble --------------------------------------------------------------
# CLIENT-FACING DISPLAY (operator order 2026-08-16): model, cost, git,
# Project progress, Wave progress — what truly matters. Context usage and
# usage rates are INTERNAL doctrine (agent behavior thresholds), never
# client display. The script still reads token counts for the cost
# derivation — it just does not render them.
out=""
[ -n "$model" ] && out="$out$model"
[ -n "$cost" ] && out="$out | $cost"
[ -n "$gitseg" ] && out="$out | $gitseg"
[ -n "$projseg" ] && out="$out | $projseg"
[ -n "$wavseg" ] && out="$out | $wavseg"

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
say "Spec Protocol configured Claude Code to show a persistent session-health display at the bottom of your terminal."
say ""
say "It shows your active model, session cost (derived estimate, ~-marked), Git branch, and — the main thing — how close your project is to being DONE."
say ""
say "For wave-shaped runs it ALSO shows a Wave bar — how close the current wave is to being done."
say ""
say "During larger builds, Spec Protocol will also maintain a live task list so you can see which stages are complete, currently running, pending, or blocked."
say ""
say "Press Ctrl+T inside Claude Code to view or hide task progress."
say ""
say "Metric report (supported metrics were configured; unsupported ones omitted — never faked):"
say "  Model: Supported"
say "  Session cost: ~-labeled — Claude Code's own tracked session total when available, else derived from cumulative token counts × published pricing; omitted for routed (9Router) models"
say "  Session duration: Not exposed by this Claude Code version"
say "  Git branch/status: Supported inside Git repositories"
say "  Project bar: Supported inside Spec Protocol projects (walks up from cwd to \$HOME looking for CONTROL/project_state.json; omitted until the plan exists)"
say "  Wave bar: Supported for wave-shaped runs (reads FIX-LEDGER.md; omitted when no wave lines exist)"
say "  Context usage: INTERNAL doctrine — tracked and acted on by the agent (thresholds 70/85/95), never shown to the client (operator order 2026-08-16)"
say "  5-hour / 7-day usage: INTERNAL doctrine — never shown to the client (operator order 2026-08-16)"
say ""
say "Verification still REQUIRED: launch BOTH plain claude and claude-nine and"
say "confirm the status line appears in each — a configured key is not a proven"
say "line. Never report the capability complete until it has been tested."
exit 0
