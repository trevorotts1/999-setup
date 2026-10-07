#!/usr/bin/env bash
# smoke_test.sh — installer smoke test for the 999 drama-song-ad-factory
# distribution (W3-03-U7; directive 5.3, 26).
#
# Proves, on a machine where the 999 installer has run:
#   * the skill is listed in the registry the installer actually reads
#     (CONTROL/bundled-skills.txt) and packaged in the repo tree
#   * BOTH runtimes discover it: plain claude (~/.claude) and claude-nine
#     (~/.claude-nine), with the claude-nine launcher installed
#   * required runtime helpers RUN (python3, git — executed, not just
#     resolved) and every declared helper skill (Skills 66/67/68/74 and
#     46) is installed; a missing helper fails with an actionable message
#   * no line this script prints ever carries key material: every line
#     passes a leak filter first, a match is suppressed and fails the run
#
# Exit codes:
#   0  good install
#   1  usage error, or --self-test case regression
#   2  skill not discovered by plain claude
#   3  claude-nine not proven (launcher missing, or skill undiscovered)
#   4  missing helper (runtime tool or helper skill / manifest broken)
#   5  key material blocked in this script's output
#   6  registry or packaged source missing
#
# Modes:
#   (no args)     run the smoke checks against this machine
#   --self-test   build a fixture install under /tmp and prove the contract:
#                 good -> 0, missing helper -> 4, missing plain-root skill
#                 -> 2, injected key material -> 5 (and never printed)
#   --help        usage
#
# Env overrides (used by --self-test):
#   SMOKE_REPO_ROOT SMOKE_PLAIN_ROOT SMOKE_NINE_ROOT
#   SMOKE_NINE_LAUNCHER SMOKE_HELPER_MANIFEST SMOKE_SELFTEST_LEAK=1 SMOKE_TMP
#
# This script never reads, sources or prints credential files or values.

set -u

SKILL_NAME="drama-song-ad-factory"
LEAK_COUNT=0
FIRST_FAIL=0

# Key-material filter: every printed line goes through emit() first.
# A match suppresses the line (the material is never shown) and fails
# the run with exit 5.
LEAK_RE='sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}|(api[_-]?key|secret|token|password|passwd)[=:][^[:space:]]{8,}'

emit() {
  if printf '%s' "$1" | LC_ALL=C grep -Eqi "$LEAK_RE"; then
    LEAK_COUNT=$((LEAK_COUNT + 1))
    printf '%s\n' "[smoke_test] BLOCKED: output line matched key-material pattern (suppressed)"
    return 0
  fi
  printf '%s\n' "$1"
}

note_fail() {
  if [ "$FIRST_FAIL" -eq 0 ]; then
    FIRST_FAIL="$1"
  fi
}

usage() {
  printf '%s\n' \
    "usage: smoke_test.sh [--self-test | --help]" \
    "  (no args)   smoke-check this machine's install; 0 = good install" \
    "  --self-test prove good->0 / missing-helper->4 / missing-skill->2 / leak->5" \
    "  exit codes: 0 ok 1 usage 2 plain discovery 3 claude-nine" \
    "              4 missing helper 5 key material 6 registry/source"
}

# resolve_helper <name> [declared_path] — print first existing directory, rc 0.
# A path declared in helper-dependencies.json is AUTHORITATIVE: present there
# -> pass, absent there -> fail (no fallback, stray copies elsewhere do not
# hide an uninstalled helper). With no declared path, search the known roots.
resolve_helper() {
  local hname="$1" declared="${2:-}" root d
  if [ -n "$declared" ]; then
    case "$declared" in
      /*) if [ -d "$declared" ]; then printf '%s\n' "$declared"; return 0; fi ;;
      *)  if [ -d "$REPO_ROOT/$declared" ]; then printf '%s\n' "$REPO_ROOT/$declared"; return 0; fi ;;
    esac
    return 1
  fi
  for root in "$REPO_ROOT" "$PLAIN_ROOT/skills" "$NINE_ROOT/skills" \
              "$HOME/.openclaw/skills" "$HOME/.openclaw/onboarding" \
              "$HOME/openclaw-onboarding/skills"; do
    for d in "$root/$hname" "$root/$hname"-*; do
      if [ -d "$d" ]; then
        printf '%s\n' "$d"
        return 0
      fi
    done
  done
  return 1
}

check_discovery() {
  # <root> <label> <exit-code>
  local root="$1" label="$2" code="$3" f grc
  f="$1/skills/$SKILL_NAME/SKILL.md"
  if [ ! -f "$f" ]; then
    emit "FAIL discover-${label}: ${SKILL_NAME} not found at ${root}/skills/${SKILL_NAME} — rerun the installer's skill step (AGENT_INSTALL section 5)"
    note_fail "$code"
    return 0
  fi
  grep -q "name:[[:space:]]*$SKILL_NAME" "$f" 2>/dev/null
  grc=$?
  if [ "$grc" -eq 0 ]; then
    emit "PASS discover-${label}: ${f}"
  elif [ "$grc" -eq 1 ]; then
    emit "FAIL discover-${label}: ${f} exists but its frontmatter name is not ${SKILL_NAME}"
    note_fail "$code"
  else
    emit "FAIL discover-${label}: ${f} unreadable (grep rc=${grc})"
    note_fail "$code"
  fi
}

main_checks() {
  REPO_ROOT="${SMOKE_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
  PLAIN_ROOT="${SMOKE_PLAIN_ROOT:-$HOME/.claude}"
  NINE_ROOT="${SMOKE_NINE_ROOT:-$HOME/.claude-nine}"
  LAUNCHER="${SMOKE_NINE_LAUNCHER:-$HOME/.local/bin/claude-nine}"
  MANIFEST="${SMOKE_HELPER_MANIFEST:-$REPO_ROOT/installer-registration/helper-dependencies.json}"

  emit "smoke_test: installer smoke for ${SKILL_NAME}"
  emit "smoke_test: repo=${REPO_ROOT} plain=${PLAIN_ROOT} nine=${NINE_ROOT}"

  # 1. registry the installer reads (AGENT_INSTALL section 5)
  local reg n grc
  reg="$REPO_ROOT/CONTROL/bundled-skills.txt"
  if [ ! -f "$reg" ]; then
    emit "FAIL registry: ${reg} not found — installer has no bundled-skills registry to read"
    note_fail 6
  else
    n="$(sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$reg" 2>/dev/null | grep -cx "$SKILL_NAME" 2>/dev/null)"
    grc=$?
    if [ "$grc" -ge 2 ]; then
      emit "FAIL registry: ${reg} unreadable (grep rc=${grc}) — fix permissions, then rerun"
      note_fail 6
    elif [ "${n:-0}" -ge 1 ]; then
      emit "PASS registry: ${SKILL_NAME} listed in CONTROL/bundled-skills.txt"
    else
      emit "FAIL registry: ${SKILL_NAME} not listed in ${reg} — the installer will not install it; add the line"
      note_fail 6
    fi
  fi

  # 2. packaged source in the repo tree
  if [ -f "$REPO_ROOT/.claude/skills/$SKILL_NAME/SKILL.md" ]; then
    emit "PASS source: repo tree carries .claude/skills/${SKILL_NAME}/SKILL.md"
  else
    emit "FAIL source: ${REPO_ROOT}/.claude/skills/${SKILL_NAME}/SKILL.md missing — distribution not packaged; run package_core.py first"
    note_fail 6
  fi

  # 3. discovery by both runtimes
  check_discovery "$PLAIN_ROOT" "plain-claude" 2
  check_discovery "$NINE_ROOT" "claude-nine" 3

  # 4. claude-nine launcher installed
  if [ -x "$LAUNCHER" ]; then
    emit "PASS launcher-nine: ${LAUNCHER}"
  else
    emit "FAIL launcher-nine: ${LAUNCHER} missing or not executable — claude-nine cannot start; rerun the 999 orchestrator (AGENT_INSTALL section 8)"
    note_fail 3
  fi

  # 5. runtime helpers must RUN, not merely resolve
  local t p trc
  for t in python3 git; do
    p="$(command -v "$t" 2>/dev/null || true)"
    if [ -z "$p" ]; then
      emit "FAIL runtime-helper: ${t} not on PATH — install ${t} before running the installer"
      note_fail 4
      continue
    fi
    if [ "$t" = "python3" ]; then
      python3 -c 'import sys' >/dev/null 2>&1
      trc=$?
    else
      git --version >/dev/null 2>&1
      trc=$?
    fi
    if [ "$trc" -eq 0 ]; then
      emit "PASS runtime-helper: ${t} runs (${p})"
    else
      emit "FAIL runtime-helper: ${t} resolves to ${p} but does not run (rc=${trc}) — repair the install of ${t}"
      note_fail 4
    fi
  done

  # 6. helper skills (Skills 66/67/68/74 and 46)
  local helper_lines helper_src manifest_ok=0 hline hname hpath found
  helper_lines=""
  helper_src="builtin default"
  if [ -f "$MANIFEST" ]; then
    helper_src="$MANIFEST"
    helper_lines="$(python3 - "$MANIFEST" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as fh:
        data = json.load(fh)
except Exception:
    sys.exit(3)
if isinstance(data, dict):
    items = data.get("helpers") or data.get("dependencies") or data.get("skills") or []
else:
    items = data
if not isinstance(items, list):
    sys.exit(4)
for item in items:
    if isinstance(item, str):
        print(item)
    elif isinstance(item, dict):
        name = item.get("name") or item.get("skill") or item.get("id") or item.get("helper") or ""
        path = item.get("path") or item.get("install_path") or item.get("dir") or item.get("target") or ""
        if name:
            print("%s\t%s" % (name, path))
PY
)"
    mrc=$?
    if [ "$mrc" -eq 0 ]; then
      manifest_ok=1
      if [ -z "$helper_lines" ]; then
        emit "FAIL helper-manifest: ${MANIFEST} declares no helpers — clean installs would miss Skills 66/67/68/74/46"
        note_fail 4
      fi
    else
      emit "FAIL helper-manifest: ${MANIFEST} unreadable or malformed (python rc=${mrc}) — fix the JSON; falling back to builtin default list"
      note_fail 4
      helper_lines=""
    fi
  fi
  if [ "$manifest_ok" -eq 0 ] && [ -z "$helper_lines" ]; then
    if [ ! -f "$MANIFEST" ]; then
      emit "helper source: builtin default (${MANIFEST} not present yet)"
    fi
    helper_lines="$(printf '%s\n' 66-kie-image 67-kie-video 68-kie-audio 74-kie-live-adapter 46-kie-callback-relay)"
  fi

  while IFS=$'\t' read -r hname hpath; do
    [ -n "$hname" ] || continue
    if found="$(resolve_helper "$hname" "${hpath:-}")"; then
      emit "PASS helper: ${hname} -> ${found}"
    elif [ -n "${hpath:-}" ]; then
      emit "FAIL helper: ${hname} missing at declared path ${hpath} — restore it or correct installer-registration/helper-dependencies.json"
      note_fail 4
    else
      emit "FAIL helper: ${hname} missing — not under the repo tree, ${PLAIN_ROOT}/skills, ${NINE_ROOT}/skills, ~/.openclaw/skills, ~/.openclaw/onboarding or openclaw-onboarding/skills; install it (see installer-registration/helper-dependencies.json)"
      note_fail 4
    fi
  done <<< "$helper_lines"

  # 7. leak probe (self-test only): must be blocked, never printed
  if [ "${SMOKE_SELFTEST_LEAK:-0}" = "1" ]; then
    emit "leak-probe: sk-TESTFAKEKEY0123456789ABCDEF"
  fi

  # verdict — key material outranks everything, then first failure
  if [ "$LEAK_COUNT" -gt 0 ]; then
    printf '%s\n' "smoke_test: RESULT FAIL (code 5) — key-material line(s) blocked in output"
    return 5
  fi
  if [ "$FIRST_FAIL" -ne 0 ]; then
    emit "smoke_test: RESULT FAIL (code ${FIRST_FAIL})"
    return "$FIRST_FAIL"
  fi
  emit "smoke_test: RESULT PASS — good install (exit 0)"
  return 0
}

self_test() {
  local fx self rc1 rc2 rc3 rc4 out fail=0
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  fx="${SMOKE_TMP:-/tmp/TrevelynsMini2-W3-03-U7-fx}-$$"

  rm -rf "$fx"
  mkdir -p "$fx/plain/skills/$SKILL_NAME" "$fx/nine/skills/$SKILL_NAME" \
           "$fx/repo/CONTROL" "$fx/repo/.claude/skills/$SKILL_NAME" \
           "$fx/repo/installer-registration" "$fx/launchers" "$fx/helpers" || {
    emit "self-test: cannot create fixture ${fx}"
    return 1
  }

  printf '%s\n' '---' "name: $SKILL_NAME" 'description: fixture skill for smoke self-test' 'version: 0.0.0' '---' \
    > "$fx/plain/skills/$SKILL_NAME/SKILL.md"
  cp "$fx/plain/skills/$SKILL_NAME/SKILL.md" "$fx/nine/skills/$SKILL_NAME/SKILL.md"
  cp "$fx/plain/skills/$SKILL_NAME/SKILL.md" "$fx/repo/.claude/skills/$SKILL_NAME/SKILL.md"
  printf '%s\n' "# fixture registry read by the installer" "$SKILL_NAME" \
    > "$fx/repo/CONTROL/bundled-skills.txt"
  : > "$fx/launchers/claude-nine"
  chmod +x "$fx/launchers/claude-nine"

  local h
  for h in 66-kie-image 67-kie-video 68-kie-audio 74-kie-live-adapter 46-kie-callback-relay; do
    mkdir -p "$fx/helpers/$h"
    printf '%s\n' '---' "name: $h" 'description: fixture helper' '---' > "$fx/helpers/$h/SKILL.md"
  done
  python3 - "$fx" > "$fx/repo/installer-registration/helper-dependencies.json" <<'PY'
import json, os, sys
fx = sys.argv[1]
names = ["66-kie-image", "67-kie-video", "68-kie-audio", "74-kie-live-adapter", "46-kie-callback-relay"]
print(json.dumps({
    "schema": "helper-dependencies@1",
    "helpers": [{"name": n, "path": os.path.join(fx, "helpers", n)} for n in names],
}, indent=1))
PY

  # case 1: good fixture install -> 0
  env SMOKE_REPO_ROOT="$fx/repo" SMOKE_PLAIN_ROOT="$fx/plain" SMOKE_NINE_ROOT="$fx/nine" \
      SMOKE_NINE_LAUNCHER="$fx/launchers/claude-nine" \
      bash "$self" > "$fx/out-good.txt" 2>&1
  rc1=$?
  if [ "$rc1" -eq 0 ]; then
    emit "SELFTEST PASS: good install -> rc 0"
  else
    emit "SELFTEST FAIL: good install -> rc ${rc1} (expected 0)"
    fail=1
  fi

  # case 2: one helper removed -> 4
  rm -rf "$fx/helpers/67-kie-video"
  env SMOKE_REPO_ROOT="$fx/repo" SMOKE_PLAIN_ROOT="$fx/plain" SMOKE_NINE_ROOT="$fx/nine" \
      SMOKE_NINE_LAUNCHER="$fx/launchers/claude-nine" \
      bash "$self" > "$fx/out-missing-helper.txt" 2>&1
  rc2=$?
  if [ "$rc2" -eq 4 ]; then
    emit "SELFTEST PASS: missing helper -> rc 4"
  else
    emit "SELFTEST FAIL: missing helper -> rc ${rc2} (expected 4)"
    fail=1
  fi
  if grep -q "FAIL helper: 67-kie-video missing" "$fx/out-missing-helper.txt" 2>/dev/null; then
    emit "SELFTEST PASS: missing helper named in output (actionable)"
  else
    emit "SELFTEST FAIL: missing helper not named in output"
    fail=1
  fi
  mkdir -p "$fx/helpers/67-kie-video"
  printf '%s\n' '---' 'name: 67-kie-video' 'description: fixture helper' '---' > "$fx/helpers/67-kie-video/SKILL.md"

  # case 3: skill absent from plain root -> 2
  rm -rf "$fx/plain/skills/$SKILL_NAME"
  env SMOKE_REPO_ROOT="$fx/repo" SMOKE_PLAIN_ROOT="$fx/plain" SMOKE_NINE_ROOT="$fx/nine" \
      SMOKE_NINE_LAUNCHER="$fx/launchers/claude-nine" \
      bash "$self" > "$fx/out-missing-skill.txt" 2>&1
  rc3=$?
  if [ "$rc3" -eq 2 ]; then
    emit "SELFTEST PASS: skill missing from plain root -> rc 2"
  else
    emit "SELFTEST FAIL: skill missing from plain root -> rc ${rc3} (expected 2)"
    fail=1
  fi
  mkdir -p "$fx/plain/skills/$SKILL_NAME"
  cp "$fx/nine/skills/$SKILL_NAME/SKILL.md" "$fx/plain/skills/$SKILL_NAME/SKILL.md"

  # case 4: injected key material -> 5, and the material is never printed
  out="$fx/out-leak.txt"
  env SMOKE_REPO_ROOT="$fx/repo" SMOKE_PLAIN_ROOT="$fx/plain" SMOKE_NINE_ROOT="$fx/nine" \
      SMOKE_NINE_LAUNCHER="$fx/launchers/claude-nine" SMOKE_SELFTEST_LEAK=1 \
      bash "$self" > "$out" 2>&1
  rc4=$?
  if [ "$rc4" -eq 5 ]; then
    emit "SELFTEST PASS: injected key material -> rc 5"
  else
    emit "SELFTEST FAIL: injected key material -> rc ${rc4} (expected 5)"
    fail=1
  fi
  if grep -q "TESTFAKEKEY" "$out" 2>/dev/null; then
    emit "SELFTEST FAIL: injected key material appeared in output"
    fail=1
  else
    emit "SELFTEST PASS: injected key material never printed (suppressed)"
  fi
  if grep -q "BLOCKED" "$out" 2>/dev/null; then
    emit "SELFTEST PASS: leak line reported as BLOCKED"
  else
    emit "SELFTEST FAIL: BLOCKED marker missing from leak run output"
    fail=1
  fi

  rm -rf "$fx"
  if [ "$fail" -eq 0 ]; then
    emit "self-test: PASS — all 4 cases behaved as specified"
    return 0
  fi
  emit "self-test: FAIL — see SELFTEST FAIL lines above"
  return 1
}

case "${1:-}" in
  "") main_checks; exit $? ;;
  --self-test) self_test; exit $? ;;
  --help|-h) usage; exit 0 ;;
  *) usage; exit 1 ;;
esac
