#!/usr/bin/env bash
# openclaw_browser_adapter.sh — Lane 2 adapter: maps Skill 06 builder calls onto
# the OpenClaw MANAGED browser CLI (`openclaw browser …`). Plan ref P1-12 /
# 9.7-6 / Appendix A.
#
# 999 HARNESS FORM (claude-nine): Lane 2 does not exist in the Claude Code
# harness — there is no OpenClaw managed browser here, and the capability
# probe (tools/capability_probe.py) reports the lane structurally absent.
# Every verb in this adapter therefore refuses with exit 75 and the harness
# reason, BEFORE any CLI or capability check. The verb vocabulary and the
# `openclaw browser` translation below are retained verbatim as the
# documented mapping: if a future plan amendment lands a managed-browser
# lane in this harness, the harness gate at main() is the only block that
# changes. Skill 6's working lane in this harness is Lane 1, agent-browser
# via browser_manager.sh, exactly as the pack ADAPTER.md seam 1 binds.
#
# LANE POLICY (load-bearing — read before wiring): Lane 2 is an EXPERIMENTAL
# UPGRADE ONLY. It is NEVER selected by default. The capability probe
# (tools/capability_probe.py) is the sole decider: this adapter runs only when
# the probe has selected the `openclaw_managed_browser` lane, and even then it
# REFUSES (exit 75) unless `lanes.openclaw_managed_browser.cliWorks` is `true`
# in the capability JSON. The PRIMARY lane stays agent-browser via
# browser_manager.sh (pin 0.27.0); do not remove that pin until Lane 2 is
# proven equivalent on real GHL builds (plan Part 7).
#
# WHY AN ADAPTER: Skill 6's builder speaks a small verb vocabulary (status /
# start / open / snapshot / click / type / frame-snapshot / stop). This file is
# the ONE place those verbs are translated to `openclaw browser` subcommands,
# so a Lane-2 client never hand-rolls CLI plumbing and the mapping is testable
# offline. Snapshot defaults per plan P1-12: ALWAYS `--interactive`
# (snapshotDefaults), the `--efficient` preset ON by default
# (snapshotDefaults.mode: efficient — matches capability JSON
# optimizations.snapshotMode = "efficient"), and `--frame SELECTOR` is passed
# through VERBATIM whenever given (frame-scoped snapshots are the whole point
# of Lane 2 on iframe-heavy GHL builder pages — Appendix A / 9.6 lane table).
#
# SAFETY: headless-safe and browser-safe. This adapter NEVER launches a
# browser in --selftest: every selftest invocation runs either against a
# PATH stripped of the openclaw CLI or against a tiny argv-echoing STUB, so
# no real browser process can ever start from a selftest. No secrets are
# read or printed. Nothing is written outside /tmp (mktemp in selftest only).
#
# PORTABILITY: bash-3.2-safe for the Mac fleet half — no `mapfile`, no
# `declare -A`, no `${var,,}`; POSIX grep. `set -u` is fine; `set -e` is
# deliberately NOT used (explicit return-code checks only, matching
# browser_manager.sh which must survive being sourced).
#
# EXIT CODES (pick + document, per the browser_manager convention):
#   0   success (verb ran; openclaw's own exit code passes through)
#   64  usage error (unknown verb / missing argument) OR openclaw CLI absent
#   75  capability gate refusal — capability JSON missing/unreadable, python3
#       missing, or lanes.openclaw_managed_browser.cliWorks is not true
#   (a real `timeout` kill surfaces as the timeout binary's own code)
#
# USAGE:
#   bash openclaw_browser_adapter.sh <verb> [args...]
#   bash openclaw_browser_adapter.sh --selftest
#   bash openclaw_browser_adapter.sh --help
#
# VERBS (mapping per plan Appendix A + live `openclaw browser --help`):
#   status                     -> openclaw browser --browser-profile openclaw status
#   start                      -> openclaw browser start            (no-op if running)
#   open URL [opts...]         -> openclaw browser open URL
#   snapshot [opts...]         -> openclaw browser snapshot --interactive [opts...]
#                                 (+ `--efficient` preset by default; a caller's
#                                 `--frame SELECTOR` passes through verbatim)
#   frame-snapshot SEL [opts]  -> openclaw browser snapshot --interactive --frame SEL
#   click REF                  -> openclaw browser click REF
#   type REF TEXT              -> openclaw browser type REF TEXT
#   stop                       -> openclaw browser close
#                                 (closes the current managed tab, per the P1-12
#                                 contract; the CLI's process-level `stop` is
#                                 intentionally NOT mapped — closing the tab is
#                                 the Skill 6 teardown unit)
#
# ENV (all optional):
#   GHL_SKILL6_CAPABILITY_JSON  capability JSON path
#                               (default <skill>/working/skill6-capability.json)
#   OCB_PROFILE                 browser profile for `status` (default: openclaw)
#   OCB_CALL_TIMEOUT            per-call timeout seconds (default: 120)
#   GHL_SKILL6_SNAPSHOT_MODE    "efficient" (default) adds `--efficient`;
#                               any other value omits the preset

set -u

OCB_ADAPTER_VERSION="v0.1.0"

# Resolve the skill dir (this file lives in <skill>/tools/).
_OCB_SELF_PATH="$0"
case "$_OCB_SELF_PATH" in
  */*) ;;
  *) _OCB_SELF_PATH="./$_OCB_SELF_PATH" ;;
esac
OCB_SKILL_DIR="$(cd "$(dirname "$_OCB_SELF_PATH")/.." && pwd)"

CAPABILITY_JSON="${GHL_SKILL6_CAPABILITY_JSON:-$OCB_SKILL_DIR/working/skill6-capability.json}"
OCB_BIN_NAME="openclaw"
OCB_PROFILE="${OCB_PROFILE:-openclaw}"
OCB_CALL_TIMEOUT="${OCB_CALL_TIMEOUT:-120}"
OCB_SNAPSHOT_MODE="${GHL_SKILL6_SNAPSHOT_MODE:-efficient}"

usage() {
  cat <<'USAGE'
openclaw_browser_adapter.sh — Lane 2 adapter: Skill 6 builder verbs -> OpenClaw managed browser (`openclaw browser`).

Lane 2 is an EXPERIMENTAL UPGRADE ONLY — never selected by default. The capability
probe (tools/capability_probe.py) decides; this adapter refuses unless
lanes.openclaw_managed_browser.cliWorks is true in the capability JSON.

VERBS:
  status                     openclaw browser --browser-profile openclaw status
  start                      openclaw browser start            (no-op if already running)
  open URL [opts...]         openclaw browser open URL
  snapshot [opts...]         openclaw browser snapshot --interactive [opts...]
                             (+ --efficient preset by default; --frame SELECTOR passes through verbatim)
  frame-snapshot SEL [opts]  openclaw browser snapshot --interactive --frame SEL
  click REF                  openclaw browser click REF
  type REF TEXT              openclaw browser type REF TEXT
  stop                       openclaw browser close            (closes the managed tab)

FLAGS:
  --selftest                 offline self-test (no openclaw CLI, no browser, no network needed)
  --help                     this text

ENV:
  GHL_SKILL6_CAPABILITY_JSON  capability JSON path (default <skill>/working/skill6-capability.json)
  OCB_PROFILE                 browser profile for `status` (default openclaw)
  OCB_CALL_TIMEOUT            per-call timeout seconds (default 120)
  GHL_SKILL6_SNAPSHOT_MODE    "efficient" (default) adds --efficient; anything else omits it

EXIT CODES:
  0 success; 64 usage error / openclaw CLI absent; 75 capability gate refusal.
USAGE
}

_ocb_usage_refuse() {
  echo "REFUSE: $1" >&2
  echo "Run with --help for the verb table." >&2
  exit 64
}

# ── GATE 0: harness gate (999) — Lane 2 is not part of this harness ──────────
# Runs FIRST on every verb (after --help/--version/--selftest). Exit 75, the
# capability-refusal code: the lane is not refused for a missing file or a
# false flag, it is refused because the lane does not exist here.
require_harness_lane() {
  echo "REFUSE: Lane 2 (openclaw_managed_browser) is not part of the Claude Code" >&2
  echo "harness (claude-nine): there is no OpenClaw managed browser here, and the" >&2
  echo "capability probe reports the lane structurally absent. Skill 6's lane in" >&2
  echo "this harness is agent-browser via browser_manager.sh. Aborting." >&2
  exit 75
}

# ── GATE 1: openclaw CLI present (checked FIRST on every verb; exit 64) ───────
require_ocb_cli() {
  if ! command -v "$OCB_BIN_NAME" >/dev/null 2>&1; then
    echo "REFUSE: openclaw CLI not found on PATH (command -v $OCB_BIN_NAME failed)." >&2
    echo "Lane 2 (openclaw_managed_browser) needs the openclaw CLI; Skill 6 PRIMARY" >&2
    echo "(agent-browser via browser_manager.sh) does not. Aborting." >&2
    exit 64
  fi
}

# ── GATE 2: capability gate (exit 75) ─────────────────────────────────────────
# Parse lanes.openclaw_managed_browser.cliWorks out of the capability JSON with
# python3 -c (stdlib json only — BSD-safe, no jq dependency). Fail CLOSED: any
# parse error, missing file, or non-true value refuses with exit 75.
_ocb_cliworks_py='import json, sys
try:
    with open(sys.argv[1], "r") as f:
        d = json.load(f)
    lane = d.get("lanes", {}).get("openclaw_managed_browser", {})
    print("True" if lane.get("cliWorks") is True else "False")
except Exception:
    print("Error")'

require_capability() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "REFUSE: capability gate — python3 not found, cannot parse capability" >&2
    echo "JSON at $CAPABILITY_JSON. Fail-closed: Lane 2 stays disabled. Aborting." >&2
    exit 75
  fi
  _ocb_cliworks="$(python3 -c "$_ocb_cliworks_py" "$CAPABILITY_JSON" 2>/dev/null)" || _ocb_cliworks=""
  case "$_ocb_cliworks" in
    True)
      : ;;
    False)
      echo "REFUSE: capability gate — lanes.openclaw_managed_browser.cliWorks is" >&2
      echo "NOT true in $CAPABILITY_JSON. Re-run tools/capability_probe.py first." >&2
      echo "Lane 2 is an experimental upgrade, never a default; refusing. Aborting." >&2
      exit 75
      ;;
    *)
      echo "REFUSE: capability gate — capability JSON missing or unreadable at" >&2
      echo "$CAPABILITY_JSON (run tools/capability_probe.py to write it)." >&2
      echo "Fail-closed: Lane 2 stays disabled. Aborting." >&2
      exit 75
      ;;
  esac
}

# ── Runner: direct binary name (never `command` under `timeout` — see the
#    browser_manager.sh AB() note about macOS /usr/bin/command vs Linux 127) ──
ocb() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$OCB_CALL_TIMEOUT" "$OCB_BIN_NAME" "$@"
  else
    "$OCB_BIN_NAME" "$@"
  fi
}

# Snapshot defaults per plan P1-12 (snapshotDefaults): ALWAYS --interactive;
# `--efficient` preset on by default (GHL_SKILL6_SNAPSHOT_MODE=efficient,
# mirroring the capability JSON optimizations.snapshotMode); caller args —
# including --frame SELECTOR — pass through verbatim after the defaults.
run_snapshot() {
  if [ "$OCB_SNAPSHOT_MODE" = "efficient" ]; then
    set -- --efficient "$@"
  fi
  set -- --interactive "$@"
  ocb browser snapshot "$@"
}

# ── Verb dispatch ─────────────────────────────────────────────────────────────
main() {
  if [ $# -lt 1 ]; then
    usage
    exit 64
  fi
  _ocb_verb="$1"
  shift
  case "$_ocb_verb" in
    --help|-h|help)
      usage
      exit 0
      ;;
    --version)
      echo "openclaw_browser_adapter $OCB_ADAPTER_VERSION"
      exit 0
      ;;
    --selftest)
      selftest
      exit $?
      ;;
  esac
  # 999 harness gate: every verb refuses here (see GATE 0 above).
  require_harness_lane
  # Strip an optional `--` separator before the verb's own args.
  if [ "${1:-}" = "--" ]; then
    shift
  fi
  case "$_ocb_verb" in
    status)
      require_ocb_cli
      require_capability
      ocb browser --browser-profile "$OCB_PROFILE" status "$@"
      ;;
    start)
      require_ocb_cli
      require_capability
      ocb browser start "$@"
      ;;
    open)
      require_ocb_cli
      if [ $# -lt 1 ]; then
        _ocb_usage_refuse "open requires a URL argument."
      fi
      require_capability
      ocb browser open "$@"
      ;;
    snapshot)
      require_ocb_cli
      require_capability
      run_snapshot "$@"
      ;;
    frame-snapshot)
      require_ocb_cli
      if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
        _ocb_usage_refuse "frame-snapshot requires an iframe selector argument."
      fi
      _ocb_sel="$1"
      shift
      require_capability
      run_snapshot --frame "$_ocb_sel" "$@"
      ;;
    click)
      require_ocb_cli
      if [ $# -lt 1 ]; then
        _ocb_usage_refuse "click requires a REF argument (from a snapshot)."
      fi
      require_capability
      ocb browser click "$@"
      ;;
    type)
      require_ocb_cli
      if [ $# -lt 2 ]; then
        _ocb_usage_refuse "type requires REF and TEXT arguments."
      fi
      require_capability
      ocb browser type "$@"
      ;;
    stop)
      require_ocb_cli
      require_capability
      ocb browser close "$@"
      ;;
    *)
      echo "REFUSE: unknown verb '$_ocb_verb'." >&2
      usage
      exit 64
      ;;
  esac
}

# ── OFFLINE SELFTEST ──────────────────────────────────────────────────────────
# Proves the 999 harness gate WITHOUT ever launching a browser: every verb
# must refuse with exit 75 + the harness reason, both on a PATH stripped to
# /usr/bin:/bin and against a throwaway argv-echoing stub named `openclaw`
# with a cliWorks:true capability JSON. All temp files live under mktemp
# (TMPDIR). No network, no secrets.
selftest() {
  _st_fails=0
  _st_pass() { echo "  ok:   $1"; }
  _st_fail() { echo "  FAIL: $1" >&2; _st_fails=$((_st_fails + 1)); }

  _st_self="$(cd "$(dirname "$_OCB_SELF_PATH")" && pwd)/$(basename "$_OCB_SELF_PATH")"
  _st_clean_path="/usr/bin:/bin"

  echo "openclaw_browser_adapter selftest (offline; no browser will launch):"

  # 1. bash -n self-parse
  if bash -n "$_st_self" 2>/dev/null; then
    _st_pass "bash -n parses this script"
  else
    _st_fail "bash -n failed on $_st_self"
  fi

  # 2. python3 present (capability parser dependency)
  if command -v python3 >/dev/null 2>&1; then
    _st_pass "python3 present (capability JSON parser)"
  else
    _st_fail "python3 absent — capability JSON cannot be parsed"
  fi

  # 3. verb table present (every contracted verb has a dispatch arm)
  for _st_v in status start open snapshot click type frame-snapshot stop; do
    if grep -q "$_st_v)" "$_st_self" 2>/dev/null; then
      _st_pass "verb table has arm: $_st_v"
    else
      _st_fail "verb table missing arm: $_st_v"
    fi
  done

  # 4. 999 harness gate: every verb refuses with exit 75 + the harness
  #    reason, on a PATH without any openclaw CLI.
  for _st_v in status start open snapshot click type frame-snapshot stop; do
    _st_out="$(PATH="$_st_clean_path" "$_st_self" "$_st_v" arg1 arg2 2>&1)"
    _st_rc=$?
    if [ "$_st_rc" = "75" ]; then
      case "$_st_out" in
        *claude-nine*) _st_pass "harness gate: verb $_st_v -> exit 75 + names claude-nine" ;;
        *) _st_fail "harness gate: verb $_st_v exit 75 but message does not name the harness" ;;
      esac
    else
      _st_fail "harness gate: verb $_st_v expected exit 75, got $_st_rc"
    fi
  done

  # 5. The gate precedes EVERYTHING: even with a stub openclaw CLI on PATH
  #    and a capability JSON claiming cliWorks:true, the verb still
  #    refuses with exit 75 (the lane does not exist in this harness, so no
  #    capability state can enable it here).
  _st_dir="$(mktemp -d "${TMPDIR:-/tmp}/ocb-adapter-selftest.XXXXXX")" || _st_dir=""
  if [ -z "$_st_dir" ]; then
    _st_fail "mktemp failed — skipping stub checks"
  else
    printf '#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done\nexit 0\n' \
      > "$_st_dir/openclaw" 2>/dev/null && chmod 755 "$_st_dir/openclaw" 2>/dev/null
    if [ -x "$_st_dir/openclaw" ]; then
      _st_stub_path="$_st_dir:/usr/bin:/bin"
      printf '{"lanes":{"openclaw_managed_browser":{"cliWorks":true}}}' \
        > "$_st_dir/cap-true.json"
      _st_out="$(PATH="$_st_stub_path" GHL_SKILL6_CAPABILITY_JSON="$_st_dir/cap-true.json" \
        "$_st_self" status 2>&1)"
      _st_rc=$?
      if [ "$_st_rc" = "75" ]; then
        case "$_st_out" in
          *claude-nine*) _st_pass "harness gate precedes CLI + capability: status -> exit 75 even with cliWorks=true" ;;
          *) _st_fail "harness gate precedence: exit 75 but message does not name the harness" ;;
        esac
      else
        _st_fail "harness gate precedence: status expected exit 75, got $_st_rc"
      fi
    else
      _st_fail "could not create stub openclaw — skipping stub checks"
    fi
    rm -rf "$_st_dir" 2>/dev/null || true
  fi

  # NOTE (999): the verb -> `openclaw browser` mapping checks that used to
  # run here are not exercisable in this harness — the gate refuses before
  # any mapping can run. The mapping remains in the dispatch below as the
  # documented translation for the amendment path.

  if [ "$_st_fails" -eq 0 ]; then
    echo "SELFTEST PASS"
    return 0
  fi
  echo "SELFTEST FAILED: $_st_fails check(s)" >&2
  return 1
}

main "$@"