#!/usr/bin/env bash
# compact-guard.sh — THE AUTO-COMPACTION FLOOR WRITER (RC-20; wave-7 work item WI-53).
#
# Usage:
#   compact-guard.sh <config-root> <target>   e.g. compact-guard.sh ~/.claude 500000
#   compact-guard.sh --selftest
#   compact-guard.sh --help
#
# WHAT IT IS FOR. Step 2.6 used to read "the window is 500000" — an EQUALITY —
# in "each config root's settings.json" — BOTH roots. In the second canary an
# operator's hand-tuned 800000 in ~/.claude/settings.json and 600000 in
# ~/.claude-nine/settings.json were both written DOWN to 500000. The launcher
# that OBEYED that sentence did the harm; the launcher that deviated from it
# protected the operator. That is a defect in the rule, not in the execution,
# so the rule stops being a sentence a model interprets and becomes a floor a
# script enforces:
#
#   live <  target   RAISE to target, backup taken first              (rc 0)
#   live == target   nothing is written                               (rc 4)
#   live >  target   nothing is written; the operator's value STANDS  (rc 3)
#   anything else    nothing is written; UNDETERMINED, never a guess  (rc 2)
#
# IT NEVER LOWERS A VALUE. There is no flag, no environment variable and no
# argument that makes it lower one. The floor is checked twice on independent
# code paths — once here from the reader's value, and again inside the writer
# itself, which refuses its own job if the value it re-reads is not strictly
# below the target. A lowering write has to defeat both.
#
# IT ONLY EVER CHANGES DIGITS THAT ARE ALREADY THERE. An autoCompactWindow
# that is ABSENT is UNDETERMINED (rc 2), not an invitation to add the key:
# absence has an effective value — whatever the harness defaults to — and this
# script does not measure that default and will not guess at it, so it cannot
# prove that writing the key would RAISE the window rather than lower it.
# Sources checked for a documented default, by name: this skill's own
# references (`grep -rn autoCompact --include=*.md`) and
# `~/.claude/skills/update-config`. Neither documents one. Not checked: the
# harness's own release notes, and the web. So the honest answer for an absent
# key is UNDETERMINED, and the step reports that instead of a number
# (references/platform.md section 5.4: a file this skill did not generate is
# not this skill's to reshape). A missing settings.json is UNDETERMINED for
# the same reason, and is never created.
#
# IT WRITES ONE ROOT — THE ONE IT WAS GIVEN. It appends /settings.json to the
# root argument itself and never globs, never resolves a sibling root, and
# never reads or writes ~/.claude when handed ~/.claude-nine or the reverse.
# The caller resolves that root from CLAUDE_CONFIG_DIR and never hardcodes it
# (references/platform.md section 2's config-root rows). Writing the sibling
# root would buy the run nothing and cost the operator a setting: a per-root
# key is INVISIBLE to the other launcher (references/platform.md section 7.2).
#
# IT WRITES ONE KEY — autoCompactWindow. autoCompactEnabled is a boolean, not
# a floor, and is not this script's business; every other key in the file is
# the operator's and is carried across untouched.
#
# THE READER IS compact-check.sh, NOT A SECOND PARSER. The live value comes
# from `compact-check.sh <config-root>`, whose rc 0 line is the only source of
# the number and whose rc 2 is UNDETERMINED. That script stays read-only and
# unchanged; this one is the only writer. Nothing here greps a JSON file for a
# value.
#
# THE WRITE. Backup FIRST, to <path>.bak-spec-protocol-<ISO8601Z> — the BASIC
# ISO 8601 form, 20260909T041500Z, because a colon in a filename is hostile on
# more than one filesystem — and the backup is proven byte-identical to the
# original by sha256 before anything else happens. A backup that cannot be
# made, or cannot be proven, means no write at all. Then the new text is built
# and PROVEN before it is committed, so the live file is never in a
# half-written state:
#
#   python3 present  a SPLICE. Only the digits of the autoCompactWindow value
#                    change; every other byte of the file is the byte it was.
#                    The text is parsed before and after, and the splice is
#                    refused unless the pattern matched exactly once.
#   jq only          a parser rewrite. Key ORDER and every other key's VALUE
#                    are preserved; the parser normalizes whitespace, which is
#                    why the splice is preferred where python3 exists.
#
# Either way the candidate is written to a .tmp beside the file and checked
# before it is committed — the new document minus autoCompactWindow must hash
# identically to the old document minus autoCompactWindow, and the new
# autoCompactWindow must equal the target — and only then renamed over the
# live file. After the rename the value is re-read through compact-check.sh;
# if that read does not say the target, the backup is restored and this exits
# 2.
#
# COMPACT_GUARD_WRITER=jq|python3 forces one writer so the other is proven
# rather than assumed; a writer that is forced but absent is UNDETERMINED,
# never a silent fallback to the other one. The selftest runs one full pass
# per writer present on the box and labels every line with the one it used.
#
# WHAT IT NEVER PRINTS. Not the file, not any key but autoCompactWindow, not a
# value it could not read. settings.json holds hook commands, environment
# values and apiKeyHelper invocations; a tool that dumped the file to change
# one number would leak all of it into a transcript. Fixture 1 puts a decoy
# key beside the window and fails if that name or its value reaches the
# output.
#
# OUTPUT — on stdout, the ledger line, exactly as tools/ledger.sh must record
# it (SKILL.md step 2.6):
#
#   AUTOCOMPACT: root=<path> live=<n|UNSET|UNDETERMINED> target=<n> action=<action>
#
# and, on a raise only, a second line naming the backup:
#
#   COMPACT-GUARD backup=<absolute path>
#
# The action vocabulary is three words — raised, no-write-above-target,
# no-write-undetermined — and the exit codes are four, because "at the target"
# and "above the target" are the same DECISION, write nothing, and differ only
# in what the caller may want to see.
#
# EXIT CODES
#   0  raised                  the live value was BELOW target and is now the
#                              target. The backup path is on stdout.
#   3  no-write-above-target   the live value is ABOVE target. Untouched. It is
#                              the operator's own value; it stands.
#   4  no-write-equal          the live value EQUALS target. Untouched. Its
#                              LEDGER action is no-write-above-target, because
#                              the vocabulary step 2.6 defines has three words
#                              and "equal" is the same DECISION as "above":
#                              write nothing.
#   2  no-write-undetermined   nothing was written and no number is claimed:
#                              the root or settings.json is missing, the file
#                              is not valid JSON or not an object, the key is
#                              ABSENT or holds a container or a non-integer,
#                              there is no JSON parser or no sha256 hasher, the
#                              target argument is not a positive integer, the
#                              backup could not be proven, or a candidate write
#                              failed its proof.
#
# --selftest proves the instrument before any verdict is believed. Four
# fixtures, each a settings.json inside its own `mktemp -d`, each reporting a
# DIFFERENT observation, run once per writer present. It opens no settings.json
# anywhere else on the box for writing:
#
#   1  raise-control    live 300000, target 500000 -> rc 0. THE KNOWN-GOOD
#                       CONTROL: if this fails the instrument is broken and the
#                       other three lines mean nothing. It also proves the five
#                       unrelated keys beside the window (a nested object and
#                       an array among them) survive the write, and that the
#                       backup holds the ORIGINAL 300000.
#   2  equal            live 500000, target 500000 -> rc 4, sha256 unchanged.
#   3  above-target     live 800000, target 500000 -> rc 3, sha256 unchanged.
#                       THE DISCRIMINATING FIXTURE. An implementation that read
#                       the target as an equality passes 1 and 2 and fails this
#                       one, which is exactly the canary defect.
#   4  undetermined     two sub-cases, both rc 2 with sha256 unchanged and no
#                       backup made: (a) an INVALID-JSON settings.json, whose
#                       text is never echoed, and (b) a clean settings.json
#                       with NO autoCompactWindow at all, which is not
#                       silently added.

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
READER="${SCRIPT_DIR}/compact-check.sh"

SETTINGS_BASENAME="settings.json"
KEY="autoCompactWindow"

usage() {
  cat <<'USAGE'
compact-guard.sh — RAISE autoCompactWindow to a floor; NEVER lower it.

  compact-guard.sh <config-root> <target>   one root, one key, floor semantics
  compact-guard.sh --selftest               prove the instrument (fixtures 1-4)
  compact-guard.sh --help                   this text

Exit 0 = raised (backup path on stdout). 3 = live value above target, untouched.
4 = live value equals target, untouched. 2 = UNDETERMINED, nothing written and
no number claimed.
USAGE
}

# ledger_line <root> <live> <target> <action> — the one stdout line the caller
# hands to tools/ledger.sh verbatim.
ledger_line() {
  printf 'AUTOCOMPACT: root=%s live=%s target=%s action=%s\n' "$1" "$2" "$3" "$4"
}

# und <root> <live> <target> <message> — the only UNDETERMINED exit. Names what
# was checked; never the file, and never a number it could not read.
und() {
  ledger_line "$1" "$2" "$3" "no-write-undetermined"
  printf 'COMPACT-GUARD UNDETERMINED | %s\n' "$4" >&2
  exit 2
}

#------------------------------------------------------------------------------
# Instruments
#------------------------------------------------------------------------------
JQ=""
PY=""
WRITER=""
HASHER=""

# resolve_tools -> 0 a writer is available; 1 none; 3 one was FORCED and is absent
resolve_tools() {
  if [ -x /usr/bin/jq ]; then JQ="/usr/bin/jq"
  else JQ="$(command -v jq 2>/dev/null || true)"; fi
  if command -v python3 >/dev/null 2>&1; then PY="python3"; fi

  case "${COMPACT_GUARD_WRITER:-}" in
    jq)      [ -n "${JQ}" ] || return 3; PY="" ;;
    python3) [ -n "${PY}" ] || return 3; JQ="" ;;
    '')      : ;;
    *)       return 3 ;;
  esac

  if [ -n "${PY}" ]; then WRITER="python3"
  elif [ -n "${JQ}" ]; then WRITER="jq"
  else return 1; fi
  return 0
}

# resolve_hasher -> 0 a real sha256 is available, 1 none. A proof that cannot
# be computed is never reported as a proof that passed.
resolve_hasher() {
  if command -v shasum >/dev/null 2>&1; then HASHER="shasum"; return 0; fi
  if command -v sha256sum >/dev/null 2>&1; then HASHER="sha256sum"; return 0; fi
  return 1
}

# sha_stdin — sha256 of stdin, hex only. Empty when there is no hasher.
sha_stdin() {
  case "${HASHER}" in
    shasum)    shasum -a 256 | awk '{print $1}' ;;
    sha256sum) sha256sum | awk '{print $1}' ;;
  esac
}

# sha_file <file> — sha256 of a file, or empty if it cannot be read or hashed.
sha_file() {
  [ -r "$1" ] || return 1
  sha_stdin < "$1"
}

# is_sha <string> — a real 64-hex digest, not an excuse for one
is_sha() {
  case "$1" in
    ????????????????????????????????????????????????????????????????)
      case "$1" in *[!0-9a-f]*) return 1 ;; esac; return 0 ;;
  esac
  return 1
}

# others_digest <file> — sha256 of the document with autoCompactWindow deleted
# and the keys sorted: the proof that nothing else moved. Empty on any failure.
others_digest() {
  if [ -n "${JQ}" ]; then
    "${JQ}" -S "del(.${KEY})" "$1" 2>/dev/null | sha_stdin
  elif [ -n "${PY}" ]; then
    "${PY}" - "$1" "${KEY}" 2>/dev/null <<'PY' | sha_stdin
import json, sys
with open(sys.argv[1], "rb") as fh:
    d = json.load(fh)
d.pop(sys.argv[2], None)
sys.stdout.write(json.dumps(d, sort_keys=True))
PY
  fi
}

# live_window <config-root> — the LIVE value, through the reader and nothing
# else. Prints the value token on stdout; rc 0 read cleanly, rc 2 the reader
# said UNDETERMINED (its own message is relayed on stderr, and that message
# never carries the file's contents — compact-check.sh fixture 2 proves it).
live_window() {
  local out rc
  out="$(bash "${READER}" "$1" 2>&1)"; rc=$?
  if [ "${rc}" != "0" ]; then
    printf '%s\n' "${out}" >&2
    return 2
  fi
  printf '%s' "${out}" | tr '|' '\n' | sed -n "s/^ *${KEY}=\\(.*[^ ]\\) *\$/\\1/p" | head -n 1
}

#------------------------------------------------------------------------------
# The writers. Each is handed <path> <target> <tmp>, must refuse outright if
# the value it re-reads is not strictly below the target, must prove its
# candidate before returning, and must leave the live file alone — the rename
# is the caller's.
#------------------------------------------------------------------------------
write_python() { # -> 0 wrote tmp; 20 own floor refusal; other = failed
  "${PY}" - "$1" "$2" "$3" "${KEY}" <<'PY'
import json, re, sys
path, target, tmp, key = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
try:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    before = json.loads(text)
except Exception:
    sys.exit(11)
if not isinstance(before, dict):
    sys.exit(12)
live = before.get(key, None)
if live is None or isinstance(live, bool) or isinstance(live, (dict, list)):
    sys.exit(15)                                  # absent or a container: not ours to write
if not isinstance(live, (int, float)) or (isinstance(live, float) and not live.is_integer()):
    sys.exit(14)
if int(live) >= target:                           # the writer's own floor check
    sys.exit(20)
pat = re.compile(r'("' + re.escape(key) + r'"[ \t\r\n]*:[ \t\r\n]*)'
                 r'(-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)')
if len(pat.findall(text)) != 1:
    sys.exit(13)
new_text = pat.sub(lambda m: m.group(1) + str(target), text, count=1)
try:
    after = json.loads(new_text)
except Exception:
    sys.exit(16)
if after.get(key) != target:
    sys.exit(16)
b = dict(before); a = dict(after)
b.pop(key, None); a.pop(key, None)
if json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
    sys.exit(16)
try:
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(new_text)
except Exception:
    sys.exit(17)
print("SPLICED")
PY
}

write_jq() { # -> 0 wrote tmp; 20 own floor refusal; other = failed
  local path="$1" target="$2" tmp="$3" live d0 d1 got
  "${JQ}" -e 'type == "object"' "${path}" >/dev/null 2>&1 || return 12
  live="$("${JQ}" -r "if has(\"${KEY}\") then (.${KEY}|tostring) else \"UNSET\" end" \
          "${path}" 2>/dev/null)" || return 11
  [ "${live}" != "UNSET" ] || return 15            # absent: not ours to write
  case "${live}" in
    ''|*[!0-9]*) return 14 ;;
  esac
  [ "${live}" -lt "${target}" ] || return 20       # the writer's own floor check
  "${JQ}" --argjson w "${target}" ".${KEY} = \$w" "${path}" > "${tmp}" 2>/dev/null || return 17
  d0="$(others_digest "${path}")"
  d1="$(others_digest "${tmp}")"
  is_sha "${d0}" && [ "${d0}" = "${d1}" ] || return 16
  got="$("${JQ}" -r ".${KEY}|tostring" "${tmp}" 2>/dev/null)"
  [ "${got}" = "${target}" ] || return 16
  printf 'REWRITTEN\n'
}

#------------------------------------------------------------------------------
# The run
#------------------------------------------------------------------------------
run_guard() {
  local root="$1" target="$2"
  local absroot path live stamp backup tmp mode wrc after rt s0 s1

  case "${target}" in
    ''|*[!0-9]*) und "${root}" "UNDETERMINED" "${target}" "target must be a positive integer of digits only, and was given as: ${target}" ;;
  esac
  [ "${target}" -gt 0 ] \
    || und "${root}" "UNDETERMINED" "${target}" "target must be greater than zero"

  [ -d "${root}" ] \
    || und "${root}" "UNDETERMINED" "${target}" "config root is not a directory: ${root} — this tool takes the ROOT (~/.claude) and appends /${SETTINGS_BASENAME} itself, so it can never be pointed at a backup, and it never touches the sibling root"
  absroot="$(cd "${root}" 2>/dev/null && pwd)"
  [ -n "${absroot}" ] \
    || und "${root}" "UNDETERMINED" "${target}" "cannot enter config root: ${root}"
  path="${absroot}/${SETTINGS_BASENAME}"

  [ -r "${READER}" ] \
    || und "${absroot}" "UNDETERMINED" "${target}" "the reader ${READER} is missing or unreadable, and this script never parses a settings file itself. Path not written: ${path}"

  resolve_tools; rt=$?
  if [ "${rt}" = "3" ]; then
    und "${absroot}" "UNDETERMINED" "${target}" "COMPACT_GUARD_WRITER was forced to '${COMPACT_GUARD_WRITER:-}' and that writer is not available on this box (checked, by name: jq at /usr/bin/jq then on PATH, and python3 on PATH). A forced writer is never silently swapped for the other one. Path not written: ${path}"
  fi
  [ "${rt}" = "0" ] \
    || und "${absroot}" "UNDETERMINED" "${target}" "no JSON parser on this box. Checked, by name: jq (at /usr/bin/jq, then on PATH) and python3 (on PATH). Not checked: nothing else — this script edits JSON with a parser or not at all. Path not written: ${path}"
  resolve_hasher \
    || und "${absroot}" "UNDETERMINED" "${target}" "no sha256 hasher on this box. Checked, by name: shasum and sha256sum (both on PATH). The backup is proven by hash before any write, and an unprovable backup means no write. Path not written: ${path}"

  live="$(live_window "${absroot}")" \
    || und "${absroot}" "UNDETERMINED" "${target}" "the reader (compact-check.sh) returned UNDETERMINED for ${path}; its own message is above. Nothing was written and no number is claimed"

  case "${live}" in
    ''|UNSET)
      und "${absroot}" "UNSET" "${target}" "${KEY} is ABSENT from ${path}, which parsed cleanly. An absent key still has an effective value — the harness default — and this script does not measure that default and will not guess at it, so it cannot prove that adding the key would RAISE the window rather than lower it. Nothing was written and the key was NOT added" ;;
    NON-SCALAR)
      und "${absroot}" "NON-SCALAR" "${target}" "${KEY} in ${path} holds an object or an array, which is the operator's structure and is never overwritten by a number" ;;
    *[!0-9]*)
      und "${absroot}" "NON-INTEGER" "${target}" "${KEY} in ${path} is not an integer, so it cannot be compared with the target; its value is not printed and nothing was written" ;;
  esac

  if [ "${live}" -gt "${target}" ]; then
    ledger_line "${absroot}" "${live}" "${target}" "no-write-above-target"
    printf 'COMPACT-GUARD | the live %s in %s is ABOVE the target. It is the operator'"'"'s value and it STANDS — recorded, not corrected. Nothing was written and no backup was made.\n' \
      "${KEY}" "${path}" >&2
    exit 3
  fi
  if [ "${live}" -eq "${target}" ]; then
    ledger_line "${absroot}" "${live}" "${target}" "no-write-above-target"
    printf 'COMPACT-GUARD | the live %s in %s already equals the target. Nothing was written and no backup was made.\n' \
      "${KEY}" "${path}" >&2
    exit 4
  fi

  # --- BELOW the target: the one case that writes ----------------------------
  stamp="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null)"
  [ -n "${stamp}" ] \
    || und "${absroot}" "${live}" "${target}" "cannot stamp a backup name with a UTC time, so no backup can be named and nothing is written"
  backup="${path}.bak-spec-protocol-${stamp}"
  [ -e "${backup}" ] \
    && und "${absroot}" "${live}" "${target}" "a backup already exists at ${backup} and is never overwritten; nothing was written"

  cp -p "${path}" "${backup}" 2>/dev/null \
    || und "${absroot}" "${live}" "${target}" "could not write the backup ${backup}; a write without a proven backup does not happen"
  s0="$(sha_file "${path}")"
  s1="$(sha_file "${backup}")"
  if ! is_sha "${s0}" || [ "${s0}" != "${s1}" ]; then
    rm -f "${backup}"
    und "${absroot}" "${live}" "${target}" "the backup could not be PROVEN byte-identical to ${path} by sha256; it was removed and nothing was written"
  fi

  tmp="${path}.tmp-spec-protocol-$$"
  rm -f "${tmp}"
  if [ "${WRITER}" = "python3" ]; then mode="$(write_python "${path}" "${target}" "${tmp}")"; wrc=$?
  else mode="$(write_jq "${path}" "${target}" "${tmp}")"; wrc=$?; fi
  if [ "${wrc}" != "0" ]; then
    rm -f "${tmp}"
    case "${wrc}" in
      20) und "${absroot}" "${live}" "${target}" "the ${WRITER} writer refused its own job: the value it re-read is NOT strictly below the target, so this would have been a lowering or a no-op write. The backup ${backup} is left in place and ${path} is untouched" ;;
      15) und "${absroot}" "${live}" "${target}" "the ${WRITER} writer found no scalar ${KEY} to raise, and it never adds the key. The backup ${backup} is left in place and ${path} is untouched" ;;
      16) und "${absroot}" "${live}" "${target}" "the candidate write failed its own proof (every other key must hash identically and ${KEY} must equal the target), so it was discarded. ${path} is untouched and the backup is ${backup}" ;;
      *)  und "${absroot}" "${live}" "${target}" "the ${WRITER} writer failed (code ${wrc}) and its candidate was discarded; ${path} is untouched and the backup is ${backup}" ;;
    esac
  fi

  mv -f "${tmp}" "${path}" 2>/dev/null || {
    rm -f "${tmp}"
    und "${absroot}" "${live}" "${target}" "could not rename the proven candidate over ${path}; the file is untouched and the backup is ${backup}"
  }

  after="$(live_window "${absroot}")" || after="UNDETERMINED"
  if [ "${after}" != "${target}" ]; then
    cp -p "${backup}" "${path}" 2>/dev/null
    und "${absroot}" "${live}" "${target}" "after the write the reader did not report the target from ${path}, so the backup was restored from ${backup}"
  fi

  ledger_line "${absroot}" "${live}" "${target}" "raised"
  printf 'COMPACT-GUARD backup=%s\n' "${backup}"
  printf 'COMPACT-GUARD | %s raised to the target by the %s writer (%s); every other key was proven unmoved before the rename.\n' \
    "${KEY}" "${WRITER}" "${mode}" >&2
  exit 0
}

#------------------------------------------------------------------------------
# The selftest — four fixtures, four different observations, one temp dir each,
# one full pass per writer present on the box
#------------------------------------------------------------------------------
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [ "$3" = "1" ]; then printf 'PASS %-2s %-14s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-14s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

# same <sha-before> <sha-after> — the sha256 verdict, MEASURED. A selftest that
# printed "UNCHANGED" as static text would lie in exactly the run that matters,
# so every sub-claim in every report line below is computed, never asserted.
same() {
  if ! is_sha "$1" || ! is_sha "$2"; then printf 'UNREADABLE'
  elif [ "$1" = "$2" ]; then printf 'UNCHANGED'
  else printf 'CHANGED — %s became %s' "$1" "$2"; fi
}

# baks <config-root> — what backup files the fixture actually has now.
baks() {
  local n
  n="$(ls "$1"/settings.json.bak-* 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${n}" = "0" ]; then printf 'no backup was made'
  else printf '%s backup file(s) EXIST' "${n}"; fi
}

# leaks <output> <needle>... — whether any needle reached the output.
leaks() {
  local out="$1"; shift
  local n
  for n in "$@"; do
    case "${out}" in *"${n}"*) printf 'LEAKED %s' "${n}"; return 0 ;; esac
  done
  printf 'nothing leaked'
}

# action_of <output> — the action token out of the AUTOCOMPACT line
action_of() {
  printf '%s' "$1" | sed -n 's/^AUTOCOMPACT: .*action=\([a-z-]*\).*$/\1/p' | head -n 1
}

# window_of <config-root> — the live window, read through the reader
window_of() {
  bash "${READER}" "$1" 2>/dev/null \
    | tr '|' '\n' | sed -n "s/^ *${KEY}=\\(.*[^ ]\\) *\$/\\1/p" | head -n 1
}

new_root() { # new_root -> an empty temp config root, absolute
  local tmpbase T
  tmpbase="${TMPDIR:-/tmp}"; tmpbase="${tmpbase%/}"
  T="$(mktemp -d "${tmpbase}/compact-guard-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  (cd "${T}" && pwd)
}

DECOY='DECOY-NOT-A-SECRET-BUT-MUST-NOT-BE-PRINTED'

run_pass() { # run_pass <jq|python3> — fixtures 1-4 against the named writer
  local label="$1"
  local T out rc rc_a ok sha0 sha1 d0 d1 bak bakroot win

  # --- 1: BELOW target -> raised. THE KNOWN-GOOD CONTROL -------------------
  T="$(new_root)"
  printf '%s\n' '{
  "'"${KEY}"'": 300000,
  "apiKeyHelper": "'"${DECOY}"'",
  "env": { "X": "y", "Z": "w" },
  "permissions": { "allow": ["Bash(ls:*)", "Read"], "deny": [] },
  "statusLine": { "type": "command", "command": "statusline-command.sh" },
  "enabledMcpjsonServers": ["github", "supabase"]
}' > "${T}/settings.json"
  d0="$(others_digest "${T}/settings.json")"
  out="$(COMPACT_GUARD_WRITER="${label}" bash "${SELF}" "${T}" 500000 2>&1)"; rc=$?
  d1="$(others_digest "${T}/settings.json")"
  win="$(window_of "${T}")"
  bak="$(ls "${T}"/settings.json.bak-spec-protocol-* 2>/dev/null | head -n 1)"
  bakroot="$(new_root)"
  [ -n "${bak}" ] && cp "${bak}" "${bakroot}/settings.json"
  ok=0
  if [ "${rc}" = "0" ] \
     && [ "${win}" = "500000" ] \
     && [ -n "${bak}" ] \
     && [ "$(window_of "${bakroot}")" = "300000" ] \
     && is_sha "${d0}" && [ "${d0}" = "${d1}" ] \
     && [ "$(action_of "${out}")" = "raised" ]; then ok=1; fi
  case "${out}" in *DECOY*) ok=0 ;; esac
  case "${out}" in *apiKeyHelper*) ok=0 ;; esac
  report 1 "raise-control" "${ok}" "[${label}] rc=${rc} (want 0) — 300000 now reads ${win} (want 500000); the five unrelated keys beside it (apiKeyHelper, the nested objects env / permissions / statusLine, and the array enabledMcpjsonServers) digest $(same "${d0}" "${d1}"); the backup holds $(window_of "${bakroot}") (want the ORIGINAL 300000); output leak check: $(leaks "${out}" "${DECOY}" 'apiKeyHelper'). THE KNOWN-GOOD CONTROL — if this line says FAIL the other three mean nothing."
  if [ "${ok}" = "0" ]; then
    printf '\ncompact-guard.sh selftest: the instrument fails its own control under %s — every line below would be meaningless\n' "${label}" >&2
    rm -rf "${T}" "${bakroot}"
    exit 2
  fi
  rm -rf "${T}" "${bakroot}"

  # --- 2: EQUAL to target -> no write --------------------------------------
  T="$(new_root)"
  printf '%s\n' '{"'"${KEY}"'":500000,"autoCompactEnabled":true,"model":"sonnet"}' > "${T}/settings.json"
  sha0="$(sha_file "${T}/settings.json")"
  out="$(COMPACT_GUARD_WRITER="${label}" bash "${SELF}" "${T}" 500000 2>&1)"; rc=$?
  sha1="$(sha_file "${T}/settings.json")"
  ok=0
  if [ "${rc}" = "4" ] \
     && is_sha "${sha0}" && [ "${sha0}" = "${sha1}" ] \
     && [ "$(action_of "${out}")" = "no-write-above-target" ] \
     && [ -z "$(ls "${T}"/settings.json.bak-* 2>/dev/null)" ]; then ok=1; fi
  report 2 "equal" "${ok}" "[${label}] rc=${rc} (want 4) — live 500000 equals target 500000; file sha256 $(same "${sha0}" "${sha1}"); $(baks "${T}"); action=$(action_of "${out}")"
  rm -rf "${T}"

  # --- 3: ABOVE target -> no write. THE DISCRIMINATING FIXTURE -------------
  T="$(new_root)"
  printf '%s\n' '{"'"${KEY}"'":800000,"autoCompactEnabled":true,"model":"opus"}' > "${T}/settings.json"
  sha0="$(sha_file "${T}/settings.json")"
  out="$(COMPACT_GUARD_WRITER="${label}" bash "${SELF}" "${T}" 500000 2>&1)"; rc=$?
  sha1="$(sha_file "${T}/settings.json")"
  win="$(window_of "${T}")"
  ok=0
  if [ "${rc}" = "3" ] \
     && is_sha "${sha0}" && [ "${sha0}" = "${sha1}" ] \
     && [ "${win}" = "800000" ] \
     && [ "$(action_of "${out}")" = "no-write-above-target" ] \
     && [ -z "$(ls "${T}"/settings.json.bak-* 2>/dev/null)" ]; then ok=1; fi
  report 3 "above-target" "${ok}" "[${label}] rc=${rc} (want 3) — the operator's 800000 exceeds target 500000 and now READS ${win} (want 800000, untouched); file sha256 $(same "${sha0}" "${sha1}"); $(baks "${T}"); action=$(action_of "${out}"). THE DISCRIMINATING FIXTURE: an implementation that read the target as an equality passes 1 and 2 and fails here, which is exactly the canary defect."
  rm -rf "${T}"

  # --- 4a: invalid JSON -> UNDETERMINED, no write, no echo -----------------
  T="$(new_root)"
  printf '%s\n' '{"'"${KEY}"'":300000,"apiKeyHelper":"'"${DECOY}"'",' > "${T}/settings.json"
  sha0="$(sha_file "${T}/settings.json")"
  out="$(COMPACT_GUARD_WRITER="${label}" bash "${SELF}" "${T}" 500000 2>&1)"; rc=$?
  sha1="$(sha_file "${T}/settings.json")"
  ok=0
  if [ "${rc}" = "2" ] \
     && is_sha "${sha0}" && [ "${sha0}" = "${sha1}" ] \
     && [ "$(action_of "${out}")" = "no-write-undetermined" ] \
     && [ -z "$(ls "${T}"/settings.json.bak-* 2>/dev/null)" ]; then ok=1; fi
  case "${out}" in *DECOY*) ok=0 ;; esac
  case "${out}" in *300000*) ok=0 ;; esac
  rc_a="${rc}"
  d0="$(same "${sha0}" "${sha1}")"
  d1="$(baks "${T}")"
  win="$(leaks "${out}" "${DECOY}" '300000')"
  rm -rf "${T}"
  # --- 4b: the key is ABSENT -> UNDETERMINED, and it is NOT added ----------
  T="$(new_root)"
  printf '%s\n' '{"autoCompactEnabled":true,"model":"opus"}' > "${T}/settings.json"
  sha0="$(sha_file "${T}/settings.json")"
  out="$(COMPACT_GUARD_WRITER="${label}" bash "${SELF}" "${T}" 500000 2>&1)"; rc=$?
  sha1="$(sha_file "${T}/settings.json")"
  [ "${rc}" = "2" ] || ok=0
  is_sha "${sha0}" && [ "${sha0}" = "${sha1}" ] || ok=0
  [ "$(window_of "${T}")" = "UNSET" ] || ok=0
  [ "$(action_of "${out}")" = "no-write-undetermined" ] || ok=0
  [ -z "$(ls "${T}"/settings.json.bak-* 2>/dev/null)" ] || ok=0
  report 4 "undetermined" "${ok}" "[${label}] rc=${rc_a} then rc=${rc} (want 2 and 2) — (a) a truncated settings.json: sha256 ${d0}, ${d1}, leak check for the decoy and for the 300000 inside the broken text: ${win}; (b) a clean settings.json with NO ${KEY}: sha256 $(same "${sha0}" "${sha1}"), the key still reads $(window_of "${T}") so it was NOT silently added, $(baks "${T}"), action=$(action_of "${out}")"
  rm -rf "${T}"
}

run_selftest() {
  local have_jq=0 have_py=0

  resolve_hasher || {
    printf 'compact-guard.sh selftest: BROKEN INSTRUMENT — no sha256 hasher. Checked, by name: shasum and sha256sum (both on PATH).\n' >&2
    exit 2; }
  [ -r "${READER}" ] || {
    printf 'compact-guard.sh selftest: BROKEN INSTRUMENT — the reader %s is missing or unreadable.\n' "${READER}" >&2
    exit 2; }
  unset COMPACT_GUARD_WRITER
  resolve_tools || {
    printf 'compact-guard.sh selftest: BROKEN INSTRUMENT — no JSON parser. Checked, by name: jq (at /usr/bin/jq, then on PATH) and python3 (on PATH).\n' >&2
    exit 2; }
  [ -n "${JQ}" ] && have_jq=1
  [ -n "${PY}" ] && have_py=1

  printf '# every fixture below is a settings.json inside its own mktemp -d; no settings.json anywhere else on this box is opened for writing\n'
  printf '# the proof digests are computed here with jq -S del(.%s), independently of the writer under test\n' "${KEY}"

  if [ "${have_py}" = "1" ]; then
    printf '\n# writer pass: python3 (the splice — only the digits change)\n'
    run_pass python3
  fi
  if [ "${have_jq}" = "1" ]; then
    printf '\n# writer pass: jq (the fallback, forced with COMPACT_GUARD_WRITER=jq — an untested fallback is a lie)\n'
    run_pass jq
  fi

  printf '\n'
  if [ "${FAILS}" = "0" ]; then
    printf 'compact-guard.sh selftest: ALL PASS (fixtures 1-4, every writer present on this box)\n'
    exit 0
  fi
  printf 'compact-guard.sh selftest: %s FAILED — this writer is a BROKEN INSTRUMENT; do not let it near a settings.json, report the compaction setting as UNDETERMINED and leave the operator'"'"'s value alone\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          [ "${2:-}" = "" ] && { usage >&2; exit 2; }; run_guard "$1" "$2" ;;
esac
