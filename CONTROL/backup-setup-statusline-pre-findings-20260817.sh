#!/usr/bin/env bash
# setup-statusline.sh — detect-first installer for the Spec Protocol status
# line. Idempotent: safe to run repeatedly; never creates duplicate
# configuration, never destroys an existing status line.
#
# Contract: references/progress-visibility.md. The CLIENT-FACING display
# (operator order 2026-08-16) is: model, session cost (derived), git
# branch/status, Project progress, Wave progress — what truly matters.
# Context usage and 5h/7d rates are INTERNAL doctrine (agent behavior
# thresholds), never client display. Session cost is REQUIRED on the bar and
# is DERIVED: real token counts from the stdin JSON multiplied by published
# per-model pricing, displayed with a ~ marker. A model absent from the
# pricing table -> the cost segment is omitted, never guessed.
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
#    nothing to do.
if [ -f "$STAMP_FILE" ]; then
  say "Spec Protocol status line: already installed (stamp present)."
  say "No replacement required."
  exit 0
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
# and 5h/7d rates are INTERNAL doctrine, never client display — the token
# counts are still read here to derive the cost. Never invents a number;
# never prints secrets.
set -uo pipefail

json="$(cat)"
if [ -z "$json" ]; then exit 0; fi

jqget() { printf '%s' "$json" | jq -r "$1" 2>/dev/null || true; }

model="$(jqget '.model.display_name // empty')"
total_in="$(jqget '.context_window.total_input_tokens // empty')"
total_out="$(jqget '.context_window.total_output_tokens // empty')"
cwd_path="$(jqget '.cwd // empty')"

# --- session cost: derived, ~-labeled. REAL token counts from stdin
#     multiplied by published per-model pricing (USD per million tokens).
#     A model absent from the table -> cost segment omitted, never guessed.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/spec-protocol-statusline"
STATE_FILE="$STATE_DIR/$(printf '%s' "$(jqget '.session_id // "unknown"')" | tr -cd 'A-Za-z0-9_-')"
mkdir -p "$STATE_DIR"

declare -A PRICE_IN
declare -A PRICE_OUT
# Published pricing, USD per 1M tokens (input / output). Update on price
# changes; a new model without an entry is omitted, not estimated.
PRICE_IN[opus]=15.00;      PRICE_OUT[opus]=75.00
PRICE_IN[sonnet]=3.00;     PRICE_OUT[sonnet]=15.00
PRICE_IN[haiku]=0.80;      PRICE_OUT[haiku]=4.00

price_for() {
  local display="$1" lower
  lower="$(printf '%s' "$display" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *opus*)   printf '15.00 75.00' ;;
    *sonnet*) printf '3.00 15.00' ;;
    *haiku*)  printf '0.80 4.00' ;;
    *)        printf '' ;;
  esac
}

cost=""
if [ -n "$total_in" ] && [ -n "$total_out" ] \
   && [ "$total_in" != "null" ] && [ "$total_out" != "null" ]; then
  if [ -f "$STATE_FILE" ]; then
    prev="$(cat "$STATE_FILE")"
    prev_in="${prev%% *}"; prev_out="${prev##* }"
    delta_in=$(( total_in - prev_in )); delta_out=$(( total_out - prev_out ))
  else
    delta_in=$total_in; delta_out=$total_out
  fi
  prices="$(price_for "$model")"
  if [ -n "$prices" ]; then
    pin="${prices%% *}"; pout="${prices##* }"
    cost="$(awk -v di="$delta_in" -v dout="$delta_out" -v pi="$pin" -v po="$pout" \
      'BEGIN { printf "~$%.2f", (di*pi + dout*po)/1000000 }')"
  fi
  printf '%s %s\n' "$total_in" "$total_out" > "$STATE_FILE"
fi

# --- project completion bar (THE MAIN METRIC) ------------------------------
# Disk truth only: reads $cwd/CONTROL/project_state.json. Percent = completed /
# (pending + in_progress + completed). No state file -> segment omitted (the
# plan does not exist yet; showing 0% before the plan exists is fake progress).
projseg=""
state_file="$cwd_path/CONTROL/project_state.json"
if [ -n "$cwd_path" ] && [ -f "$state_file" ]; then
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
# Looks for FIX-LEDGER.md at $cwd first, then $HOME/work-999-setup/FIX-LEDGER.md.
# Current wave = highest "WAVE <n>" line; total = its WF-<n> lines; done = those
# with a PASS or DONE marker. No wave/workflow lines -> segment omitted.
wavseg=""
ledger_file=""
if [ -n "$cwd_path" ] && [ -f "$cwd_path/FIX-LEDGER.md" ]; then
  ledger_file="$cwd_path/FIX-LEDGER.md"
elif [ -f "$HOME/work-999-setup/FIX-LEDGER.md" ]; then
  ledger_file="$HOME/work-999-setup/FIX-LEDGER.md"
fi
if [ -n "$ledger_file" ]; then
  cur_wave="$(grep -o 'WAVE [0-9][0-9]*' "$ledger_file" 2>/dev/null | grep -o '[0-9][0-9]*' | sort -n | tail -1)"
  if [ -n "$cur_wave" ]; then
    wftotal="$(grep -c "WF-${cur_wave}" "$ledger_file" 2>/dev/null || true)"
    wfdone="$(grep "WF-${cur_wave}" "$ledger_file" 2>/dev/null | grep -c 'PASS\|DONE' || true)"
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
  # Symlink rule: update the target file, not the link.
  if [ -L "$f" ]; then
    f="$(readlink "$f")"
    case "$f" in /*) ;; *) f="$HOME/$(basename "$f")" ;; esac
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
say "  Session cost: Derived (real token counts × published pricing, ~-labeled)"
say "  Session duration: Not exposed by this Claude Code version"
say "  Git branch/status: Supported inside Git repositories"
say "  Project bar: Supported inside Spec Protocol projects (reads CONTROL/project_state.json; omitted until the plan exists)"
say "  Wave bar: Supported for wave-shaped runs (reads FIX-LEDGER.md; omitted when no wave lines exist)"
say "  Context usage: INTERNAL doctrine — tracked and acted on by the agent (thresholds 70/85/95), never shown to the client (operator order 2026-08-16)"
say "  5-hour / 7-day usage: INTERNAL doctrine — never shown to the client (operator order 2026-08-16)"
say ""
say "Verification still REQUIRED: launch BOTH plain claude and claude-nine and"
say "confirm the status line appears in each — a configured key is not a proven"
say "line. Never report the capability complete until it has been tested."
exit 0
