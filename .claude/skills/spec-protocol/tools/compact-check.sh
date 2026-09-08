#!/usr/bin/env bash
# compact-check.sh — THE LIVE AUTO-COMPACTION READER (RC-7; wave-6 work item WI-39).
#
# Usage:
#   compact-check.sh <config-root>          e.g. ~/.claude, ~/.claude-nine
#   compact-check.sh --selftest
#   compact-check.sh --help
#
# WHAT IT IS FOR. Step 2.6 sets auto-compaction and then TELLS THE CLIENT what
# it set. In the canary the skill told the client a number it had read out of a
# SIBLING BACKUP: both live settings files already carried
# autoCompactWindow=500000 (mtime 2026-09-07T22:43:13/14Z, before the run
# started), while the 800000/600000 the skill reported existed only in
# settings.json.bak-* files beside them. ~/.claude alone holds fifty-odd such
# siblings. A reported value that came from a backup is a fabricated fact about
# a live machine, and it is exactly as wrong as a made-up number.
#
# So this script reads ONE path and names it: <config-root>/settings.json. It
# never globs, never falls back to a sibling, never guesses. What it prints is
# the value, the absolute path it came from, and that file's mtime — the three
# things together, so the claim can be re-checked by hand in one command.
#
# IT IS READ-ONLY. It opens the file for reading through a JSON parser and
# writes nothing, anywhere. The selftest proves this by comparing the fixture's
# mtime before and after the read.
#
# IT PRINTS TWO KEYS AND NO OTHERS. autoCompactEnabled and autoCompactWindow.
# settings.json holds hook commands, environment values and apiKeyHelper
# invocations; a tool that dumped the file to find two numbers would leak all
# of it into a transcript. The parser selects the two keys by name and nothing
# else reaches stdout — fixture 0 proves it with a decoy key.
#
# OUTPUT — one line, on stdout, on a clean read:
#
#   COMPACT-CHECK | root=<as given> | path=<absolute live path> | mtime=<ISO8601 UTC> (epoch <n>)
#     | autoCompactEnabled=<true|false|UNSET|NON-SCALAR> | autoCompactWindow=<n|UNSET|NON-SCALAR>
#
# (one physical line; wrapped here only for this comment). UNSET means the key
# is absent from a file that parsed cleanly — an honest absence with the path
# named, never a number. NON-SCALAR means the key holds an object or an array,
# which is reported as a shape, never printed.
#
# EXIT CODES
#   0  CLEAN READ — the live file parsed as a JSON object. The two keys are
#                   reported as they stand, UNSET included.
#   2  UNDETERMINED — the live file is missing, unreadable, not valid JSON, or
#                   valid JSON that is not an object; or there is no JSON
#                   parser on this box; or the argument is not a directory.
#                   The path is named in every case. This exit NEVER carries a
#                   value: a number that could not be read from the live file
#                   is not reported at all, and the caller must say
#                   UNDETERMINED to the client rather than pick a figure.
#
# DIAGNOSTIC KNOB
#   COMPACT_CHECK_NO_JQ=1   force the python3 fallback on a box that has jq, so
#                           the fallback is proven rather than assumed. The
#                           selftest sets it for one pass over the fixtures
#                           whenever both parsers are present.
#
# --selftest proves the instrument before any verdict is believed. Fixture 0 is
# the parser control; fixtures 1-3 are the three the work item names:
#
#   1  live-vs-backup   a temp root holding settings.json (window 500000) AND
#                       settings.json.bak-canary (window 800000, enabled false).
#                       The tool must report the LIVE 500000/true and name the
#                       LIVE path. THIS IS THE DISCRIMINATING FIXTURE — reading
#                       the backup is the exact defect — and it also proves the
#                       read left the file's mtime untouched.
#   2  unreadable       two sub-cases, both rc 2: no settings.json in the root
#                       at all, and a settings.json that is not valid JSON.
#                       Neither may print a value.
#   3  valid-file       a different valid file (window 372000, enabled false)
#                       reads rc 0 and reports 372000. It exists so fixtures 1
#                       and 3 cannot both pass on a tool that prints a constant.
#
# Every fixture reports a DIFFERENT observation. A selftest whose lines all say
# the same thing is not testing anything.

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"

SETTINGS_BASENAME="settings.json"

usage() {
  cat <<'USAGE'
compact-check.sh — report the LIVE autoCompactEnabled / autoCompactWindow.

  compact-check.sh <config-root>     read <config-root>/settings.json only
  compact-check.sh --selftest        prove the instrument (fixtures 0-3)
  compact-check.sh --help            this text

Exit 0 = clean read. Exit 2 = UNDETERMINED (missing, unreadable, invalid JSON,
not an object, or no JSON parser) — never a value it could not read.
USAGE
}

# und <message> — the only failure exit. Names what was checked, never a value.
und() {
  printf 'COMPACT-CHECK UNDETERMINED | %s\n' "$1" >&2
  exit 2
}

#------------------------------------------------------------------------------
# The parser. jq first, then python3. Neither present is UNDETERMINED with BOTH
# names said out loud — never a guess at the file's contents by grep.
#------------------------------------------------------------------------------
PARSER=""
JQ=""

resolve_parser() {
  if [ "${COMPACT_CHECK_NO_JQ:-0}" = "1" ]; then JQ=""            # diagnostic knob
  elif [ -x /usr/bin/jq ]; then JQ="/usr/bin/jq"
  else JQ="$(command -v jq 2>/dev/null || true)"; fi
  if [ -n "${JQ}" ]; then PARSER="jq"; return 0; fi
  if command -v python3 >/dev/null 2>&1; then PARSER="python3"; return 0; fi
  return 1
}

# The two keys, by name, and nothing else. A non-object file is NOTOBJECT; a
# key that is absent or null is UNSET; a key holding a container is reported as
# its shape, never as its contents.
JQ_KEYS='
def show(v): if v == null then "UNSET"
             elif (v|type) == "object" or (v|type) == "array" then "NON-SCALAR"
             else (v|tostring) end;
if type != "object" then "NOTOBJECT"
else "OK \(show(.autoCompactEnabled)) \(show(.autoCompactWindow))"
end
'

# read_keys <file> -> one token line on stdout, rc always 0:
#   "OK <enabled> <window>" | "NOTOBJECT" | "BADJSON"
read_keys() {
  case "${PARSER}" in
    jq)
      "${JQ}" -r "${JQ_KEYS}" "$1" 2>/dev/null || printf 'BADJSON\n'
      ;;
    python3)
      python3 - "$1" 2>/dev/null <<'PY' || printf 'BADJSON\n'
import json, sys
def show(v):
    if v is None:
        return "UNSET"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return "NON-SCALAR"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)
try:
    with open(sys.argv[1], "rb") as fh:
        d = json.load(fh)
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    print("NOTOBJECT")
else:
    print("OK %s %s" % (show(d.get("autoCompactEnabled")),
                        show(d.get("autoCompactWindow"))))
PY
      ;;
    *) printf 'BADJSON\n' ;;
  esac
}

# mtime_epoch <file> -> epoch seconds, or empty. BSD stat first, then GNU.
mtime_epoch() {
  local m
  m="$(stat -f %m "$1" 2>/dev/null)"
  if [ -z "${m}" ]; then m="$(stat -c %Y "$1" 2>/dev/null)"; fi
  printf '%s' "${m}"
}

# epoch_iso <epoch> -> ISO8601 UTC, or UNDETERMINED. BSD date first, then GNU.
epoch_iso() {
  local s
  s="$(date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  if [ -z "${s}" ]; then s="$(date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; fi
  if [ -z "${s}" ]; then s="UNDETERMINED"; fi
  printf '%s' "${s}"
}

#------------------------------------------------------------------------------
# The run
#------------------------------------------------------------------------------
run_check() {
  local root="$1" absroot path token enabled window epoch iso

  [ -e "${root}" ] \
    || und "config root does not exist: ${root} — nothing was read, and no value is reported"
  [ -d "${root}" ] \
    || und "config root is not a directory: ${root} — this tool takes the ROOT (~/.claude), and appends /${SETTINGS_BASENAME} itself, so it can never be pointed at a backup"

  absroot="$(cd "${root}" 2>/dev/null && pwd)"
  [ -n "${absroot}" ] \
    || und "cannot enter config root: ${root}"
  path="${absroot}/${SETTINGS_BASENAME}"

  resolve_parser \
    || und "no JSON parser on this box. Checked, by name: jq (at /usr/bin/jq, then on PATH) and python3 (on PATH). Not checked: nothing else — this script reads JSON with a parser or not at all, and it never guesses at a file's contents with grep. Path not read: ${path}"

  [ -e "${path}" ] \
    || und "no live settings file at ${path}. Sibling backups in ${absroot} are NEVER read as a substitute (RC-7): the live file is the only source, so this is UNDETERMINED, not a value"
  [ -f "${path}" ] \
    || und "${path} exists but is not a regular file"
  [ -r "${path}" ] \
    || und "${path} is not readable by this user"

  epoch="$(mtime_epoch "${path}")"
  if [ -z "${epoch}" ]; then epoch="UNDETERMINED"; iso="UNDETERMINED"
  else iso="$(epoch_iso "${epoch}")"; fi

  token="$(read_keys "${path}")"
  case "${token}" in
    "OK "*)
      enabled="$(printf '%s' "${token}" | cut -d' ' -f2)"
      window="$(printf '%s' "${token}" | cut -d' ' -f3)"
      ;;
    NOTOBJECT)
      und "${path} is valid JSON but not an object, so it is not a settings file — no value reported (parser: ${PARSER})" ;;
    *)
      und "${path} is not readable as JSON (parser: ${PARSER}) — its contents are NOT printed, and no value is reported" ;;
  esac

  printf 'COMPACT-CHECK | root=%s | path=%s | mtime=%s (epoch %s) | autoCompactEnabled=%s | autoCompactWindow=%s | parser=%s\n' \
    "${root}" "${path}" "${iso}" "${epoch}" "${enabled}" "${window}" "${PARSER}"
  exit 0
}

#------------------------------------------------------------------------------
# The selftest — the instrument proven before any verdict is believed
#------------------------------------------------------------------------------
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [ "$3" = "1" ]; then printf 'PASS %-2s %-18s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-18s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

# field <line> <key> — pull one "key=value" field out of a COMPACT-CHECK line
field() {
  printf '%s' "$1" | tr '|' '\n' | sed -n "s/^ *$2=\\(.*[^ ]\\) *$/\\1/p" | head -n 1
}

run_pass() { # run_pass <jq|python3> — fixtures 0-3 against the named parser
  local label="$1" T P out rc rc_a line ok mt0 mt1 tmpbase

  if [ "${label}" = "python3" ]; then export COMPACT_CHECK_NO_JQ=1
  else export COMPACT_CHECK_NO_JQ=0; fi

  local tmpbase="${TMPDIR:-/tmp}"
  tmpbase="${tmpbase%/}"
  T="$(mktemp -d "${tmpbase}/compact-check-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  T="$(cd "${T}" && pwd)"

  # --- 0: the parser control -----------------------------------------------
  # A known-good file must yield exactly the values it holds, and the decoy key
  # beside them must not appear anywhere in the output.
  P="${T}/ctl"; mkdir -p "${P}"
  printf '%s\n' '{"apiKeyHelper":"DECOY-NOT-A-SECRET-BUT-MUST-NOT-BE-PRINTED","autoCompactEnabled":true,"autoCompactWindow":123456,"env":{"X":"y"}}' > "${P}/settings.json"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  ok=0
  if [ "${rc}" = "0" ] \
     && [ "$(field "${out}" autoCompactWindow)" = "123456" ] \
     && [ "$(field "${out}" autoCompactEnabled)" = "true" ]; then ok=1; fi
  case "${out}" in *DECOY*) ok=0 ;; esac
  case "${out}" in *apiKeyHelper*) ok=0 ;; esac
  report 0 "parser-controls" "${ok}" "[${label}] rc=${rc} (want 0); reported 123456/true from a file that also holds apiKeyHelper and env — neither name nor value appears in the output"
  if [ "${ok}" = "0" ]; then
    printf '\ncompact-check.sh selftest: the instrument fails its own control under %s — every line below would be meaningless\n' "${label}" >&2
    rm -rf "${T}"
    exit 2
  fi

  # --- 1: live file AND a .bak with different values → the LIVE ones -------
  P="${T}/live-vs-bak"; mkdir -p "${P}"
  printf '%s\n' '{"autoCompactEnabled":true,"autoCompactWindow":500000}'   > "${P}/settings.json"
  printf '%s\n' '{"autoCompactEnabled":false,"autoCompactWindow":800000}'  > "${P}/settings.json.bak-canary"
  printf '%s\n' '{"autoCompactEnabled":false,"autoCompactWindow":600000}'  > "${P}/settings.json.bak-concurrency-20260907"
  mt0="$(mtime_epoch "${P}/settings.json")"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  mt1="$(mtime_epoch "${P}/settings.json")"
  line="${out}"
  ok=0
  if [ "${rc}" = "0" ] \
     && [ "$(field "${line}" autoCompactWindow)" = "500000" ] \
     && [ "$(field "${line}" autoCompactEnabled)" = "true" ] \
     && [ "$(field "${line}" path)" = "${P}/settings.json" ] \
     && [ -n "${mt0}" ] && [ "${mt0}" = "${mt1}" ]; then ok=1; fi
  case "${line}" in *800000*) ok=0 ;; esac
  case "${line}" in *600000*) ok=0 ;; esac
  case "${line}" in *.bak*) ok=0 ;; esac
  report 1 "live-vs-backup" "${ok}" "[${label}] rc=${rc} (want 0) — reported window=$(field "${line}" autoCompactWindow) enabled=$(field "${line}" autoCompactEnabled) from path=$(field "${line}" path) while two siblings held 800000 and 600000; neither backup figure nor the string .bak reached the output, and the live file's mtime is unchanged (${mt0} → ${mt1}). THE DISCRIMINATING FIXTURE."

  # --- 2a: no settings.json in the root at all → rc 2, no value ------------
  P="${T}/absent"; mkdir -p "${P}"
  printf '%s\n' '{"autoCompactEnabled":true,"autoCompactWindow":900000}' > "${P}/settings.json.bak-only-a-backup"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  ok=0; [ "${rc}" = "2" ] && ok=1
  case "${out}" in *900000*) ok=0 ;; esac
  case "${out}" in 'COMPACT-CHECK | '*) ok=0 ;; esac
  rc_a="${rc}"
  # --- 2b: a settings.json that is not valid JSON → rc 2, no contents ------
  P="${T}/invalid"; mkdir -p "${P}"
  printf '%s\n' '{"autoCompactEnabled":true,"autoCompactWindow":' > "${P}/settings.json"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  [ "${rc}" = "2" ] || ok=0
  case "${out}" in *'"autoCompactWindow":'*) ok=0 ;; esac
  case "${out}" in 'COMPACT-CHECK | '*) ok=0 ;; esac
  report 2 "unreadable" "${ok}" "[${label}] rc=${rc_a} then rc=${rc} (want 2 and 2) — a root holding ONLY settings.json.bak-only-a-backup (its 900000 never reported, no COMPACT-CHECK value line printed), then a root whose settings.json is truncated JSON (its text never echoed)"

  # --- 3: a different valid file → rc 0 and ITS values, not fixture 1's ----
  P="${T}/valid372"; mkdir -p "${P}"
  printf '%s\n' '{"autoCompactEnabled":false,"autoCompactWindow":372000,"model":"opus"}' > "${P}/settings.json"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  ok=0
  if [ "${rc}" = "0" ] \
     && [ "$(field "${out}" autoCompactWindow)" = "372000" ] \
     && [ "$(field "${out}" autoCompactEnabled)" = "false" ] \
     && [ "$(field "${out}" path)" = "${P}/settings.json" ]; then ok=1; fi
  case "${out}" in *opus*) ok=0 ;; esac
  report 3 "valid-file" "${ok}" "[${label}] rc=${rc} (want 0) — reported window=$(field "${out}" autoCompactWindow) enabled=$(field "${out}" autoCompactEnabled), which differs from fixture 1's 500000/true, so neither line is a constant; the file's third key (model) is not printed"

  rm -rf "${T}"
}

run_selftest() {
  local have_jq=0 have_py=0

  if [ -x /usr/bin/jq ] || command -v jq >/dev/null 2>&1; then have_jq=1; fi
  if command -v python3 >/dev/null 2>&1; then have_py=1; fi
  if [ "${have_jq}" = "0" ] && [ "${have_py}" = "0" ]; then
    printf 'compact-check.sh selftest: BROKEN INSTRUMENT — no JSON parser. Checked, by name: jq (at /usr/bin/jq, then on PATH) and python3 (on PATH).\n' >&2
    exit 2
  fi

  if [ "${have_jq}" = "1" ]; then
    printf '# parser pass: jq\n'
    run_pass jq
  fi
  if [ "${have_py}" = "1" ]; then
    printf '# parser pass: python3 (the fallback, forced with COMPACT_CHECK_NO_JQ=1 — an untested fallback is a lie)\n'
    run_pass python3
  fi
  unset COMPACT_CHECK_NO_JQ

  printf '\n'
  if [ "${FAILS}" = "0" ]; then
    printf 'compact-check.sh selftest: ALL PASS (fixtures 0-3, every parser present on this box)\n'
    exit 0
  fi
  printf 'compact-check.sh selftest: %s FAILED — this reader is a BROKEN INSTRUMENT; report the compaction setting as UNDETERMINED and name the path by hand, never a remembered number\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_check "$1" ;;
esac
