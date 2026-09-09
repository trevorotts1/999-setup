#!/usr/bin/env bash
# hook-check.sh — IS THE ENFORCER CURRENT? (RC-27; wave-7 WI-65)
#
# Usage:
#   hook-check.sh [--root <path>]... [--refresh] [--home <dir>]
#   hook-check.sh --selftest
#   hook-check.sh --help
#
# WHAT IT IS FOR. Both config roots execute the SAME hook file
# (~/.claude/hooks/dispatch-gate.py), and for the whole 2026-09-08 canary that
# file carried SHAPE 1-5 while the skill's copy carried SHAPE 1-7: the pause
# wall and the write-ahead rule were absent from the running enforcer and
# nothing noticed. This is the instrument that notices. It reads, from each
# config root's settings.json hooks block BY KEY, the path registered for the
# PreToolUse Workflow matcher; sha256s that file; compares it to the skill's
# own tools/hooks/dispatch-gate.py; and reports match, stale (naming BOTH
# hashes and the SHAPE list each carries), or absent.
#
# IT NEVER PRINTS A SETTINGS FILE. That file holds hook commands, environment
# values and an apiKeyHelper invocation. The parser selects registered hook
# COMMANDS by key name and nothing else reaches stdout — the selftest proves
# it with a decoy key. A settings.json is the operator's file (RC-20).
#
# THE ROOT RULE (the load-bearing decision). The hook FILE is this skill's own
# artifact and may be refreshed; the settings.json that points at it is not.
# With --refresh, and ONLY with it, a stale hook whose registered path lies
# INSIDE the ACTIVE config root (CLAUDE_CONFIG_DIR when set, $HOME/.claude
# otherwise) is refreshed silently: backed up FIRST to
# <path>.bak-spec-protocol-<ISO8601Z>, replaced, the backup path recorded
# through tools/ledger.sh. A stale hook whose registered path lies inside
# ANOTHER root — the live claude-nine case, where the routed launcher reaches
# into the claude root for its enforcement — is NEVER written: the run reports
# write=refused and stops. Writing the sibling root would silently change the
# other launcher's enforcement, which is the exact cross-root write RC-20
# forbids. Report-only is the default, so a bare run never changes anything.
#
# THE LEDGER. Every run writes one line per checked root through
# tools/ledger.sh (which stamps and signs it):
#   HOOK-CHECK: root=<path> registered=<path> verdict=match|stale|absent shapes=<list>
# with ` write=refused` appended when a write was refused. A refresh also
# files HOOK-CHECK-BACKUP naming the backup path.
#
# EXIT CODES
#   0  match — every checked root's registered hook is byte-identical to the skill's
#   3  stale — at least one registered hook differs (missing SHAPEs named)
#   4  absent — at least one registered hook file is missing (and nothing stale)
#   2  UNDETERMINED — a settings file could not be read, no parser exists, or
#      the skill's own copy is missing. Never a verdict about the hook.
# With several roots the worst verdict wins, absent over stale over
# UNDETERMINED over match: GATE 0b stops on any of them.
#
# DIAGNOSTIC KNOBS (the selftest's, never a run's)
#   HOOK_CHECK_SKILL_ROOT  compare against this tree's tools/hooks/dispatch-gate.py
#                          instead of the skill that ships this script
#   HOOK_CHECK_HOME        project home for the ledger when --home is not given
#
# --selftest proves the instrument on four fixtures, all inside one mktemp -d:
#   1  a registered hook byte-identical to the skill copy returns 0
#   2  a fixture hook carrying SHAPES 1-5 against a skill copy carrying 1-7
#      returns 3 naming BOTH hashes and the missing shapes 6 and 7 (2b then
#      proves --refresh repairs that same-root copy: backup beside the file,
#      bytes identical after, backup path in the ledger)
#   3  an absent registered file returns 4
#   4  THE DISCRIMINATING CASE: a settings file registering a path under a
#      DIFFERENT root returns 3 with write=refused and leaves that file's
#      sha256 UNCHANGED — an implementation that repairs whatever it finds
#      passes the first three and fails this one

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
SKILL_ROOT="${HOOK_CHECK_SKILL_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SKILL_HOOK="$SKILL_ROOT/tools/hooks/dispatch-gate.py"
LEDGER_SH="$SCRIPT_DIR/ledger.sh"

GREP="/usr/bin/grep"
if [ ! -x "${GREP}" ]; then
  if [ -x /bin/grep ]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

# --- sha256, named instruments ---------------------------------------------
hook_sha() {
  local f="$1"
  [ -f "$f" ] || return 1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" 2>/dev/null | awk '{print $1}'
  else
    return 2
  fi
}

# --- SHAPE census ------------------------------------------------------------
shape_list() {
  "${GREP}" -oE 'SHAPE [0-9]+' "$1" 2>/dev/null \
    | "${GREP}" -oE '[0-9]+' | sort -nu | paste -sd, - 2>/dev/null
}

# --- JSON parser, jq first then python3; neither is UNDETERMINED -------------
PARSER=""
JQ_BIN=""
resolve_parser() {
  if [ -x /usr/bin/jq ]; then JQ_BIN="/usr/bin/jq"
  else JQ_BIN="$(command -v jq 2>/dev/null || true)"; fi
  if [ -n "${JQ_BIN}" ]; then PARSER="jq"; return 0; fi
  if command -v python3 >/dev/null 2>&1; then PARSER="python3"; return 0; fi
  return 1
}

# registered_commands <settings-file> — the dispatch-gate.py hook commands
# registered under a Workflow-matching PreToolUse entry, one per line. Key
# names and one command string only; the file is never printed.
JQ_WF_CMDS='.hooks | .. | objects | select((.matcher? // "" | tostring | contains("Workflow")) and (.hooks? | type == "array")) | .hooks[]? | objects | select((.command? // "" | tostring | contains("dispatch-gate.py"))) | .command | tostring'
PY_WF_CMDS='import json,sys
try:
    d = json.load(open(sys.argv[1], "rb"))
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
out = []
def walk(node, matcher):
    if isinstance(node, dict):
        m = node.get("matcher", matcher)
        for hook in node.get("hooks", []) if isinstance(node.get("hooks"), list) else []:
            if isinstance(hook, dict):
                cmd = hook.get("command", "")
                if isinstance(cmd, str) and "dispatch-gate.py" in cmd and isinstance(m, str) and "Workflow" in m:
                    out.append(cmd)
        for value in node.values():
            walk(value, m)
    elif isinstance(node, list):
        for item in node:
            walk(item, matcher)
walk(d.get("hooks"), None)
for cmd in dict.fromkeys(out):
    print(cmd)'
registered_commands() {
  case "${PARSER}" in
    jq)      "${JQ_BIN}" -r "${JQ_WF_CMDS}" "$1" 2>/dev/null ;;
    python3) python3 - "$1" 2>/dev/null <<'PYEOF'
import json,sys
try:
    d = json.load(open(sys.argv[1], "rb"))
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
out = []
def walk(node, matcher):
    if isinstance(node, dict):
        m = node.get("matcher", matcher)
        hooks = node.get("hooks")
        if isinstance(hooks, list):
            for hook in hooks:
                if isinstance(hook, dict):
                    cmd = hook.get("command", "")
                    if isinstance(cmd, str) and "dispatch-gate.py" in cmd and isinstance(m, str) and "Workflow" in m:
                        out.append(cmd)
        for value in node.values():
            walk(value, m)
    elif isinstance(node, list):
        for item in node:
            walk(item, matcher)
walk(d.get("hooks"), None)
for cmd in dict.fromkeys(out):
    print(cmd)
PYEOF
      ;;
  esac
}

# command_to_path <command> — the token naming the hook file
command_to_path() {
  local token=""
  for token in $1; do
    token="${token%\"}"; token="${token#\"}"
    token="${token%\'}"; token="${token#\'}"
    case "${token}" in *dispatch-gate.py) printf '%s' "${token}" ;; esac
  done | tail -n 1
}

canon() { ( cd "$1" 2>/dev/null && pwd ) || printf '%s' "$1"; }

iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown-time'; }

# --- ledger ------------------------------------------------------------------
LED_HOME=""
ledger_line() {
  [ -n "${LED_HOME}" ] || { printf 'HOOK-CHECK | ledger=SKIPPED | no project home (--home, $HOOK_CHECK_HOME, $SPEC_PROJECT, or CONTROL/ above $PWD) — the verdict above stands, but it is NOT recorded\n' >&2; return 0; }
  [ -x "${LEDGER_SH}" ] || { printf 'HOOK-CHECK | ledger=SKIPPED | %s missing or not executable\n' "${LEDGER_SH}" >&2; return 0; }
  "${LEDGER_SH}" "${LED_HOME}" "CONTROL/LEDGER.md" "$1" >/dev/null 2>&1 \
    || printf 'HOOK-CHECK | ledger=SKIPPED | ledger.sh refused the line\n' >&2
  return 0
}

resolve_home() {
  local d
  if [ -n "${1:-}" ]; then LED_HOME="$1"; return 0; fi
  if [ -n "${HOOK_CHECK_HOME:-}" ]; then LED_HOME="${HOOK_CHECK_HOME}"; return 0; fi
  if [ -n "${SPEC_PROJECT:-}" ] && [ -d "${SPEC_PROJECT%/}/CONTROL" ]; then LED_HOME="${SPEC_PROJECT%/}"; return 0; fi
  d="$PWD"; local i=0
  while [ "${i}" -lt 6 ]; do
    if [ -d "${d}/CONTROL" ]; then LED_HOME="${d}"; return 0; fi
    [ "${d}" = "/" ] && break
    d="$(dirname "${d}")"; i=$((i + 1))
  done
  LED_HOME=""
}

# --- one root ----------------------------------------------------------------
# check_root <root> <allow-refresh 0|1> <active-root>
# Prints the verdict line; echoes the exit code on a final `=rc <n>` line.
check_root() {
  local root="$1" allow_refresh="$2" active="$3"
  local settings reg_cmds reg_path="" verdict="undetermined" reason=""
  local sha_skill="" sha_reg="none" shapes_skill="" shapes_reg="none" missing="none" write_note=""

  settings="${root%/}/settings.json"
  if [ ! -e "${settings}" ]; then
    reason="no settings file at ${settings}"
  elif [ ! -f "${settings}" ] || [ ! -r "${settings}" ]; then
    reason="${settings} is not a readable regular file"
  elif ! resolve_parser; then
    reason="no JSON parser on this box (checked by name: jq at /usr/bin/jq then on PATH, then python3 on PATH) — ${settings} was NOT read"
  else
    reg_cmds="$(registered_commands "${settings}")"
    if [ -z "${reg_cmds}" ]; then
      verdict="absent"; reason="no dispatch-gate.py command under a Workflow PreToolUse entry in ${settings}"
    else
      reg_path="$(command_to_path "$(printf '%s' "${reg_cmds}" | head -n 1)")"
      if [ -z "${reg_path}" ]; then
        verdict="absent"; reason="a Workflow hook mentions dispatch-gate.py but names no file path"
      elif [ ! -f "${reg_path}" ]; then
        verdict="absent"
      fi
    fi
  fi

  if [ "${verdict}" = "undetermined" ] && [ -n "${reg_path}" ] && [ -f "${reg_path}" ]; then
    sha_skill="$(hook_sha "${SKILL_HOOK}" 2>/dev/null || true)"
    if [ -z "${sha_skill}" ]; then
      reason="the skill's own ${SKILL_HOOK} is missing or has no sha256 instrument"
    else
      sha_reg="$(hook_sha "${reg_path}" 2>/dev/null || true)"
      [ -n "${sha_reg}" ] || { reason="sha256 of ${reg_path} could not be computed"; sha_reg="none"; }
    fi
    if [ -z "${reason}" ]; then
      shapes_skill="$(shape_list "${SKILL_HOOK}")"
      shapes_reg="$(shape_list "${reg_path}")"
      [ -n "${shapes_skill}" ] || shapes_skill="none"
      [ -n "${shapes_reg}" ] || shapes_reg="none"
      if [ "${sha_reg}" = "${sha_skill}" ]; then
        verdict="match"
      else
        verdict="stale"
        missing="$(printf '%s\n' "${shapes_skill}" | tr ',' '\n' | while IFS= read -r s; do
          case ",${shapes_reg}," in *",${s},"*) ;; *) printf '%s\n' "${s}" ;; esac; done | paste -sd, -)"
        [ -n "${missing}" ] || missing="none"
      fi
    fi
  fi

  # The root rule. Refresh only with --refresh, only for the ACTIVE root, only
  # when the registered path sits inside that same root.
  if [ "${verdict}" = "stale" ]; then
    local root_c reg_c reg_dir inside=0 same_active=0
    root_c="$(canon "${root}")"
    reg_dir="$(dirname "${reg_path}")"
    if [ "$(canon "${reg_dir}")/" != "/" ]; then
      case "$(canon "${reg_dir}")/" in "${root_c}/"*) inside=1 ;; esac
    fi
    [ "$(canon "${active}")" = "${root_c}" ] && same_active=1
    if [ "${allow_refresh}" = "1" ] && [ "${inside}" = "1" ] && [ "${same_active}" = "1" ]; then
      local bak ts
      ts="$(iso_now)"
      bak="${reg_path}.bak-spec-protocol-${ts}"
      if cp -p "${reg_path}" "${bak}" 2>/dev/null \
         && cp "${SKILL_HOOK}" "${reg_path}.tmp.$$" 2>/dev/null \
         && mv "${reg_path}.tmp.$$" "${reg_path}" 2>/dev/null; then
        sha_reg="$(hook_sha "${reg_path}")"
        shapes_reg="$(shape_list "${reg_path}")"
        verdict="match"
        write_note="write=refreshed backup=${bak}"
        ledger_line "HOOK-CHECK-BACKUP: root=${root} registered=${reg_path} backup=${bak} previous_sha=${sha_skill:+replaced}"
      else
        rm -f "${reg_path}.tmp.$$" 2>/dev/null
        write_note="write=refused reason=refresh-failed"
      fi
    else
      if [ "${inside}" = "1" ] && [ "${same_active}" = "1" ]; then
        write_note="write=deferred run-with---refresh"
      else
        write_note="write=refused"
      fi
    fi
  fi

  [ "${verdict}" = "absent" ] && [ -z "${reg_path}" ] && reg_path="none"
  [ "${verdict}" = "absent" ] && [ -f "${reg_path:-}" ] || true

  printf 'HOOK-CHECK | root=%s | registered=%s | verdict=%s | skill_sha=%s | registered_sha=%s | skill_shapes=%s | shapes=%s | missing=%s%s%s\n' \
    "${root}" "${reg_path:-none}" "${verdict}" \
    "${sha_skill:-none}" "${sha_reg}" "${shapes_skill:-none}" "${shapes_reg}" "${missing}" \
    "${write_note:+ | ${write_note}}" "${reason:+ | note=${reason}}"

  if [ -n "${LED_HOME}" ] || [ -z "${HOOK_CHECK_HOME:-}${SPEC_PROJECT:-}" ]; then :; fi
  case "${verdict}" in
    match) ledger_line "HOOK-CHECK: root=${root} registered=${reg_path:-none} verdict=match shapes=${shapes_reg}" ;;
    stale) ledger_line "HOOK-CHECK: root=${root} registered=${reg_path:-none} verdict=stale shapes=${shapes_reg}${write_note:+ ${write_note%% backup=*}}" ;;
    absent) ledger_line "HOOK-CHECK: root=${root} registered=${reg_path:-none} verdict=absent shapes=none" ;;
    *) ledger_line "HOOK-CHECK: root=${root} registered=${reg_path:-none} verdict=undetermined shapes=none" ;;
  esac

  case "${verdict}" in
    match) printf '=rc 0\n' ;;
    stale) printf '=rc 3\n' ;;
    absent) printf '=rc 4\n' ;;
    *) printf '=rc 2\n' ;;
  esac
}

usage() { sed -n '2,40p' "${SELF}"; }

# --- the run -----------------------------------------------------------------
run_check() {
  local allow_refresh=0 home_arg="" active=""
  local -a roots=()
  while [ $# -gt 0 ]; do
    case "${1:-}" in
      --refresh) allow_refresh=1 ;;
      --root) roots+=("${2:?--root needs a path}"); shift ;;
      --home) home_arg="${2:?--home needs a dir}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) printf 'hook-check.sh: unknown argument %s\n' "${1:-}" >&2; exit 2 ;;
    esac
    shift
  done
  [ -n "${GREP}" ] && [ -x "${GREP}" ] || { printf 'HOOK-CHECK UNDETERMINED | no usable grep (checked /usr/bin/grep, /bin/grep, PATH)\n' >&2; exit 2; }
  active="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ "${#roots[@]}" -eq 0 ]; then
    roots+=("${active}")
    # The session's roots, never hardcoded beyond the platform defaults: the
    # active root (CLAUDE_CONFIG_DIR when set, $HOME/.claude otherwise), plus
    # each platform root that EXISTS — the same existence evidence SKILL.md
    # section 2's harness detection already uses.
    for d in "$HOME/.claude" "$HOME/.claude-nine"; do
      [ -d "${d}" ] || continue
      roots+=("${d}")
    done
  fi
  # Dedupe canonically.
  local -a uniq=() seen=""
  local r c
  for r in "${roots[@]}"; do
    c="$(canon "${r}")"
    case "${seen}" in *"|${c}|"*) ;; *) uniq+=("${r}"); seen="${seen}|${c}|" ;; esac
  done
  resolve_home "${home_arg}"
  local worst=0 rc out
  for r in "${uniq[@]}"; do
    out="$(check_root "${r}" "${allow_refresh}" "${active}")"
    printf '%s\n' "${out}" | "${GREP}" -v '^=rc '
    rc="$(printf '%s\n' "${out}" | "${GREP}" '^=rc ' | tail -n 1 | awk '{print $2}')"
    case "${rc}" in 4) worst=4 ;; 3) [ "${worst}" != "4" ] && worst=3 ;; 2) [ "${worst}" = "0" ] && worst=2 ;; esac
  done
  exit "${worst}"
}

# --- the selftest -------------------------------------------------------------
FAILS=0
report() {
  if [ "$3" = "1" ]; then printf 'PASS %-2s %-20s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-20s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

write_hook() { # write_hook <file> <shapes...> — a hook carrying exactly these SHAPE markers
  local f="$1"; shift
  { printf '#!/usr/bin/env python3\n# fixture hook\n'; for s in "$@"; do printf '# SHAPE %s wall\n' "${s}"; done; } > "${f}"
}

write_settings() { # write_settings <root> <hook-path> — settings registering the path, plus a decoy
  local root="$1" path="$2"
  mkdir -p "${root}"
  python3 - "$root" "$path" <<'PYEOF'
import json, sys
root, path = sys.argv[1], sys.argv[2]
data = {"model": "sonnet",
        "apiKeyHelper": "DECOY-MUST-NEVER-BE-PRINTED",
        "env": {"DECOY_ENV_KEY": "decoy-value"},
        "hooks": {"PreToolUse": [
            {"matcher": "Workflow",
             "hooks": [{"type": "command",
                        "command": "python3 %s" % path,
                        "timeout": 30}]}]}}
with open(root + "/settings.json", "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
PYEOF
}

run_selftest() {
  local T rc out ok sha_a sha_b sha_e0 sha_e1
  T="$(mktemp -d "${TMPDIR:-/tmp}/hook-check-selftest.XXXXXX")" || {
    printf 'BROKEN INSTRUMENT: mktemp failed\n' >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT
  mkdir -p "$T/skill/tools/hooks" "$T/proj/CONTROL"
  write_hook "$T/skill/tools/hooks/dispatch-gate.py" 1 2 3 4 5 6 7
  export HOOK_CHECK_SKILL_ROOT="$T/skill" HOOK_CHECK_HOME="$T/proj"
  export CLAUDE_CONFIG_DIR="$T/active-unset-marker"

  # --- 1: byte-identical registers as match ----------------------------------
  mkdir -p "$T/rootA/hooks"
  cp "$T/skill/tools/hooks/dispatch-gate.py" "$T/rootA/hooks/dispatch-gate.py"
  write_settings "$T/rootA" "$T/rootA/hooks/dispatch-gate.py"
  out="$(bash "${SELF}" --root "$T/rootA" 2>&1)"; rc=$?
  ok=0; [ "${rc}" = "0" ] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'verdict=match' || ok=0
  case "${out}" in *DECOY*) ok=0 ;; esac
  case "${out}" in *apiKeyHelper*) ok=0 ;; esac
  report 1 "match-exit-0" "${ok}" "rc=${rc} (want 0) on a byte-identical hook; neither the decoy key's name nor its value reached the output"

  # --- 2: SHAPES 1-5 against 1-7 is stale, both hashes named -----------------
  mkdir -p "$T/rootB/hooks"
  write_hook "$T/rootB/hooks/dispatch-gate.py" 1 2 3 4 5
  write_settings "$T/rootB" "$T/rootB/hooks/dispatch-gate.py"
  sha_a="$(hook_sha "$T/skill/tools/hooks/dispatch-gate.py")"
  sha_b="$(hook_sha "$T/rootB/hooks/dispatch-gate.py")"
  out="$(bash "${SELF}" --root "$T/rootB" 2>&1)"; rc=$?
  ok=0; [ "${rc}" = "3" ] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'verdict=stale' || ok=0
  printf '%s' "${out}" | "${GREP}" -qF "${sha_a}" || ok=0
  printf '%s' "${out}" | "${GREP}" -qF "${sha_b}" || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'missing=6,7' || ok=0
  report 2 "stale-exit-3" "${ok}" "rc=${rc} (want 3); names skill ${sha_a} and registered ${sha_b} with missing=6,7"
  # 2b: --refresh repairs the same-root copy, backup beside the file
  export CLAUDE_CONFIG_DIR="$T/rootB"
  out="$(bash "${SELF}" --root "$T/rootB" --refresh 2>&1)"; rc=$?
  ok=0; [ "${rc}" = "0" ] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'verdict=match' || ok=0
  [ "$(hook_sha "$T/rootB/hooks/dispatch-gate.py")" = "${sha_a}" ] || ok=0
  ls "$T/rootB/hooks/" | "${GREP}" -qE 'dispatch-gate\.py\.bak-spec-protocol-' || ok=0
  "${GREP}" -q 'HOOK-CHECK-BACKUP' "$T/proj/CONTROL/LEDGER.md" 2>/dev/null || ok=0
  report 2b "refresh-same-root" "${ok}" "rc=${rc} (want 0) with CLAUDE_CONFIG_DIR inside the root: bytes identical after, .bak-spec-protocol beside the file, HOOK-CHECK-BACKUP in the ledger"
  export CLAUDE_CONFIG_DIR="$T/active-unset-marker"

  # --- 3: a registered file that is not there is absent ----------------------
  write_settings "$T/rootC" "$T/rootC/hooks/dispatch-gate.py"
  out="$(bash "${SELF}" --root "$T/rootC" 2>&1)"; rc=$?
  ok=0; [ "${rc}" = "4" ] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'verdict=absent' || ok=0
  report 3 "absent-exit-4" "${ok}" "rc=${rc} (want 4) registering a path with no file behind it"

  # --- 4: THE DISCRIMINATING CASE — a path under a DIFFERENT root ------------
  mkdir -p "$T/rootE/hooks"
  write_hook "$T/rootE/hooks/dispatch-gate.py" 1 2 3 4 5
  sha_e0="$(hook_sha "$T/rootE/hooks/dispatch-gate.py")"
  write_settings "$T/rootD" "$T/rootE/hooks/dispatch-gate.py"
  export CLAUDE_CONFIG_DIR="$T/rootD"
  out="$(bash "${SELF}" --root "$T/rootD" --refresh 2>&1)"; rc=$?
  sha_e1="$(hook_sha "$T/rootE/hooks/dispatch-gate.py")"
  ok=0; [ "${rc}" = "3" ] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'write=refused' || ok=0
  [ "${sha_e0}" = "${sha_e1}" ] || ok=0
  report 4 "cross-root-refused" "${ok}" "rc=${rc} (want 3) with --refresh and the active root set: write=refused is reported and the other root's sha256 is unchanged (${sha_e0} still ${sha_e1})"
  export CLAUDE_CONFIG_DIR="$T/active-unset-marker"

  printf '\n'
  if [ "${FAILS}" = "0" ]; then
    printf 'hook-check.sh selftest: ALL PASS (4 fixtures, every check inside %s)\n' "${T}"
    exit 0
  fi
  printf 'hook-check.sh selftest: %s FAILED — this is a BROKEN INSTRUMENT\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  -h|--help)  usage; exit 0 ;;
  *)          run_check "$@" ;;
esac
