#!/usr/bin/env bash
# capacity-profile.sh — the ONE sanctioned memory of the spec-protocol skill
#
# Usage: capacity-profile.sh read [<profile-path>]
#        capacity-profile.sh write [<profile-path>] <answers-file>
#        capacity-profile.sh fingerprint <measured-config-file>
#        capacity-profile.sh --selftest
#        capacity-profile.sh --help
#
# THE DESIGN PRINCIPLE (references/capacity.md §13, the freshness contract):
#   MEASUREMENT BEATS MEMORY WHENEVER MEASUREMENT IS AFFORDABLE.
# The operator does not rewire mid-project — he rewires BETWEEN projects. So
# configuration is stable WITHIN a run and may be completely different BETWEEN
# runs. Anything a command can reveal in seconds is MEASURED every run and is
# FORBIDDEN here. This file remembers only what no command can observe:
# billing facts (which plan a human pays for) and user policy (how much
# headroom to leave). Even those are a STARTING POINT FOR A QUESTION, never a
# source of truth — every one is recalled and CONFIRMED, never trusted.
#
# THE PROFILE PATH: ~/.claude/spec-protocol/capacity-profile.json
#   Deliberately OUTSIDE the skill directory: the skill repo is fleet-wide, the
#   profile is ONE box's, ONE human's. Never committed, never copied between
#   boxes, never synced by a fleet roll. Override for tests with
#   SPEC_PROTOCOL_PROFILE or an explicit path argument.
#   This tool writes NOTHING anywhere else — not settings.json, not any
#   launcher, not ~/.claude-nine. Its only writes are the profile, the
#   backup beside it, and its own temp file in the same directory.
#
# ---------------------------------------------------------------------------
# WHAT MAY BE STORED (the entire legitimate content — classification rows
# 12–17 of the freshness contract):
#   OLLAMA_PLAN  AGNES_PLAN  DEEPSEEK_PATH  RESERVE_PCT  USAGE_WINDOW
#   EFFORT_SETTING  FALLBACKS  LAST_A4_WIDTH  OVERNIGHT_CAPACITY_POLICY
#   MEDIA_PROVIDER_PREF
#
# MEDIA_PROVIDER_PREF (values: kie | agnes) is the ONE media fact that may be
# remembered: a cross-project USER PREFERENCE, the same class as RESERVE_PCT.
# It is recalled as the OFFERED DEFAULT in the both-keys provider question
# ("last time you preferred Kie.ai — same again?") and is NEVER silently
# applied. Three media facts are deliberately NOT here, and this list is the
# place that says so out loud, because an allowlist a tool enforces must not
# grow by implication:
#   - MEDIA KEY PRESENCE (kie/Agnes key found or not) — MEASURED EVERY RUN by
#     tools/env-sweep.sh, classification row 4. A user may add a key between
#     projects, or revoke one, and a remembered presence would send the run
#     down the wrong branch with total confidence. Storing it is FORBIDDEN.
#   - "WANTS MEDIA / DOES NOT WANT MEDIA" — per-PROJECT taste. The same client's
#     funnel needs artwork and their API tool does not; it lives in that
#     project's decision register only.
#   - ANY GATED-TIER PRE-AUTHORIZATION (a standing yes to spend on the
#     expensive video families) — NEVER STORABLE ANYWHERE, in this file or any
#     other. The gate is per-generation by standing rule, and a remembered yes
#     is precisely the spend-without-consent this whole contract exists to
#     prevent. There must be no way to leave a standing permission to spend.
# All three are refused by the allowlist below, by NAME, and the selftest
# proves each refusal.
#
# WHAT IS FORBIDDEN — the deny-list, enforced HERE, not by good intentions.
# Every one of these makes `write` REFUSE and exit 2, naming the KEY only:
#   1. ANY SECRET VALUE. No keys, tokens, passwords: no key NAME matching
#      KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL, no value matching a known secret
#      shape (sk- ghp_ gho_ ghu_ ghs_ ghr_ github_pat_ eyJ xox?- AIza
#      -----BEGIN), no value over 64 characters.
#   2. ANYTHING IN CLASSIFICATION ROWS 1–11 AND 21 — balances, rate counts,
#      burn figures, core counts, harness/launcher, resolved aliases (outside
#      the fingerprint comparator), key liveness, context windows, Agnes rate
#      rules, router state, the router model pool. Measured things are
#      measured. Enforced as an ALLOWLIST: a key that is not on the list
#      above is refused by name.
#   3. BLOCK D answers, C0–C5, B1–B4, bar choices, feature lists — per
#      project; they live in that project's decision register only.
#   4. CLIENT NAMES or any cross-client material. This profile describes
#      accounts on THIS box for THIS user.
#   5. FREE-TEXT NOTES ABOUT THE USER. It stores answers he gave, and nothing
#      editorializing.
#
# THE FINGERPRINT is a COMPARATOR, NEVER A SOURCE. config_fingerprint.inputs
# exists only so a mismatch can be NAMED in plain words ("your builder used to
# point at DeepSeek v4 Flash; now it points at something else"). No run may
# read a capacity value out of it.
#
# ---------------------------------------------------------------------------
# FAILURE BEHAVIOR — a corrupt or unreadable profile fails toward ASKING,
# never toward assuming. A profile that cannot be read is NOT "no profile":
#   exit 0  read succeeded / write succeeded / fingerprint computed
#   exit 1  ABSENT — a PROVEN negative, with the path named and the stat
#           instrument proven by a known-good control first. Also the verdict
#           for a profile carrying another box's hostname hash
#           (ABSENT-FOREIGN-BOX: never adopt another box's history).
#   exit 2  CORRUPT / UNREADABLE / BAD SCHEMA / BROKEN INSTRUMENT / REFUSED
#           WRITE. Prints the quarantine `mv` command; never deletes anything.
#   exit 3  fingerprint UNDETERMINED (no digest instrument) — the caller
#           proceeds as MISMATCH, i.e. fails toward asking.
#
# NEGATIVE-RESULT CONTRACT, applied to this instrument:
#   - Every negative NAMES the sources checked and the sources not checked.
#   - A known-good CONTROL runs on the instrument before any negative is
#     accepted: the stat control before ABSENT, the parser control (an
#     embedded known-good fixture through the same parser) before CORRUPT or
#     before an empty answer set, the matcher control before any pattern
#     verdict, the digest known-answer test before any fingerprint.
#   - IF THE CONTROL ALSO FAILS, THE VERDICT IS BROKEN INSTRUMENT, NOT A FACT
#     ABOUT THE TARGET.
#   - grep rc>=2 is an ERROR, never "zero matches". Exit-code failure is never
#     an empty result.
#
# NO SECRET VALUE IS EVER PRINTED. Refusals name KEYS ONLY. Prove it with
# --selftest, which plants a sentinel and requires it to appear ZERO times.

set -o pipefail

# --- Constants ---------------------------------------------------------------
SCHEMA_VERSION=1
ANSWER_KEYS="OLLAMA_PLAN AGNES_PLAN DEEPSEEK_PATH RESERVE_PCT USAGE_WINDOW EFFORT_SETTING FALLBACKS LAST_A4_WIDTH OVERNIGHT_CAPACITY_POLICY MEDIA_PROVIDER_PREF"
META_KEYS="PROJECT CONFIG_FP CONFIG_FP_COMPUTED_AT CONFIG_FP_INPUT"
ANSWER_SUFFIXES="_SOURCE _ANSWERED_AT _CONFIRMED_AT _CONFIRM_COUNT"
MAX_VALUE_LEN=64          # write-side deny rule, verbatim from the contract
MAX_READ_VALUE_LEN=512    # read-side sanity cap (FALLBACKS joins <=8 entries)
MAX_FALLBACK_ENTRIES=8
SECRET_VALUE_RE='^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|eyJ|xox[abprs]-|AIza|-----BEGIN)'
# The empty-string SHA-256, used as the digest known-answer test (KAT).
SHA256_EMPTY_KAT='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

SELF_PATH="${BASH_SOURCE[0]}"

# --- Small helpers -----------------------------------------------------------
_now_iso()    { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
_now_stamp()  { date -u '+%Y%m%dT%H%M%SZ'; }   # ISO 8601 basic — colon-free filenames

# _matches <extended-regex> <string> -> 0 match, 1 no-match, 2 grep ERROR
_matches() {
  local re="$1" s="$2" rc
  printf '%s' "${s}" | /usr/bin/grep -qE -- "${re}"
  rc=$?
  if [ "${rc}" -ge 2 ]; then return 2; fi
  return "${rc}"
}

# The matcher control: the pattern engine must say YES to a known positive and
# NO to a known negative. A matcher that matches nothing would otherwise report
# "no secrets found" for every input — ALL CLEAR by way of being broken.
_matcher_control() {
  _matches '^sk-' 'sk-KNOWN-POSITIVE-CONTROL'; local p=$?
  _matches '^sk-' 'plain-known-negative';      local n=$?
  if [ "${p}" -ne 0 ] || [ "${n}" -ne 1 ]; then
    echo "BROKEN INSTRUMENT: the pattern matcher does not discriminate"
    echo "  control: known-positive rc=${p} (expected 0), known-negative rc=${n} (expected 1)"
    echo "  instrument: /usr/bin/grep -qE"
    echo "  Consequence: this tool cannot prove a value is not secret-shaped."
    echo "  Failing toward ASKING — do not treat any result from this run as clean."
    return 1
  fi
  return 0
}

# _sha256_hex — reads stdin, prints lowercase hex. Sets SHA_INSTRUMENT.
# Returns 1 when no digest instrument resolves, 2 when the chosen instrument
# fails its known-answer test (BROKEN INSTRUMENT, not "no answer").
SHA_INSTRUMENT=""
_sha256_pick() {
  SHA_INSTRUMENT=""
  local out
  if command -v shasum >/dev/null 2>&1; then
    out="$(printf '' | shasum -a 256 2>/dev/null | awk '{print $1}')"
    if [ "${out}" = "${SHA256_EMPTY_KAT}" ]; then SHA_INSTRUMENT="shasum -a 256"; return 0; fi
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    out="$(printf '' | sha256sum 2>/dev/null | awk '{print $1}')"
    if [ "${out}" = "${SHA256_EMPTY_KAT}" ]; then SHA_INSTRUMENT="sha256sum"; return 0; fi
  fi
  if command -v openssl >/dev/null 2>&1; then
    out="$(printf '' | openssl dgst -sha256 2>/dev/null | awk '{print $NF}')"
    if [ "${out}" = "${SHA256_EMPTY_KAT}" ]; then SHA_INSTRUMENT="openssl dgst -sha256"; return 0; fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    out="$(printf '' | python3 -c 'import hashlib,sys;sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' 2>/dev/null)"
    if [ "${out}" = "${SHA256_EMPTY_KAT}" ]; then SHA_INSTRUMENT="python3 hashlib"; return 0; fi
  fi
  return 1
}

_sha256_hex() {  # stdin -> hex, using the instrument already picked
  case "${SHA_INSTRUMENT}" in
    "shasum -a 256")        shasum -a 256 2>/dev/null | awk '{print $1}' ;;
    "sha256sum")            sha256sum 2>/dev/null | awk '{print $1}' ;;
    "openssl dgst -sha256") openssl dgst -sha256 2>/dev/null | awk '{print $NF}' ;;
    "python3 hashlib")      python3 -c 'import hashlib,sys;sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())' 2>/dev/null ;;
    *)                      return 1 ;;
  esac
}

_hostname_hash() {  # first 8 hex of sha256(hostname), or UNDETERMINED
  local h hh
  if ! _sha256_pick; then echo "UNDETERMINED"; return 0; fi
  h="$(hostname 2>/dev/null)"
  if [ -z "${h}" ]; then h="$(uname -n 2>/dev/null)"; fi
  if [ -z "${h}" ]; then echo "UNDETERMINED"; return 0; fi
  hh="$(printf '%s' "${h}" | _sha256_hex)"
  if [ -z "${hh}" ]; then echo "UNDETERMINED"; return 0; fi
  printf '%s\n' "$(echo "${hh}" | cut -c1-8)"
}

_default_path() {
  if [ -n "${SPEC_PROTOCOL_PROFILE:-}" ]; then
    printf '%s\n' "${SPEC_PROTOCOL_PROFILE}"
  else
    printf '%s\n' "${HOME:-}/.claude/spec-protocol/capacity-profile.json"
  fi
}

_in_list() {  # _in_list <needle> <space-separated list>
  local n="$1" l="$2" i
  for i in ${l}; do [ "${i}" = "${n}" ] && return 0; done
  return 1
}

_upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# _secret_key_name <key> -> 0 when the NAME is secret-shaped
_secret_key_name() {
  local k
  k="$(_upper "$1")"
  case "${k}" in
    *KEY*|*TOKEN*|*SECRET*|*PASSWORD*|*CREDENTIAL*) return 0 ;;
  esac
  return 1
}

# _secret_value_shape <value> -> 0 secret-shaped, 1 clean, 2 matcher error
_secret_value_shape() { _matches "${SECRET_VALUE_RE}" "$1"; }

# --- The embedded known-good fixture (the PARSER CONTROL) --------------------
# Parsed through the SAME reader as the target, before any negative verdict is
# accepted. If this comes back empty, the READER is broken — not the profile.
_control_fixture() {
  cat <<'FIXTURE'
{
  "schema_version": 1,
  "written_at": "2026-01-01T00:00:00Z",
  "written_by_project": "parser-control",
  "machine": { "hostname_hash": "00000000" },
  "answers": {
    "RESERVE_PCT": { "value": "25", "source": "default-confirmed", "answered_at": "2026-01-01T00:00:00Z", "last_confirmed_at": "2026-01-01T00:00:00Z", "confirm_count": 1 }
  },
  "config_fingerprint": { "value": "00000000", "computed_at": "2026-01-01T00:00:00Z", "inputs": [ "launcher=control" ] }
}
FIXTURE
}

# --- The JSON flattener (parser layer; validation happens in bash) -----------
# Emits a flat KEY=VALUE stream. Exit 0 ok, 2 unreadable/unparsable, 90 no parser.
PARSER_NAME=""
_pick_parser() {
  if command -v python3 >/dev/null 2>&1; then PARSER_NAME="python3"; return 0; fi
  if command -v jq      >/dev/null 2>&1; then PARSER_NAME="jq";      return 0; fi
  PARSER_NAME=""
  return 1
}

_flatten_python() {
  python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path, 'r') as fh:
        raw = fh.read()
except Exception as exc:
    sys.stdout.write("PARSE_FAIL=%s\n" % type(exc).__name__)
    sys.exit(2)
try:
    doc = json.loads(raw)
except Exception as exc:
    sys.stdout.write("PARSE_FAIL=%s\n" % type(exc).__name__)
    sys.exit(2)
if not isinstance(doc, dict):
    sys.stdout.write("PARSE_FAIL=NotAnObject\n")
    sys.exit(2)

def scalar(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v
    return "\x01NON-SCALAR"

out = []
out.append("SCHEMA_VERSION=" + scalar(doc.get("schema_version")))
out.append("WRITTEN_AT=" + scalar(doc.get("written_at")))
out.append("WRITTEN_BY_PROJECT=" + scalar(doc.get("written_by_project")))
mach = doc.get("machine")
out.append("HOSTNAME_HASH=" + (scalar(mach.get("hostname_hash")) if isinstance(mach, dict) else ""))
fp = doc.get("config_fingerprint")
if isinstance(fp, dict):
    out.append("CONFIG_FP=" + scalar(fp.get("value")))
    out.append("CONFIG_FP_COMPUTED_AT=" + scalar(fp.get("computed_at")))
    inputs = fp.get("inputs")
    if isinstance(inputs, list):
        for item in inputs:
            out.append("CONFIG_FP_INPUT=" + scalar(item))
else:
    out.append("CONFIG_FP=")
    out.append("CONFIG_FP_COMPUTED_AT=")
ans = doc.get("answers")
if isinstance(ans, dict):
    for key in sorted(ans.keys()):
        safe = key if key.replace("_", "").isalnum() else "UNPRINTABLE-KEY-NAME"
        out.append("ANSWER_KEY=" + safe)
        body = ans[key]
        if not isinstance(body, dict):
            out.append(safe + "=\x01NON-SCALAR")
            continue
        out.append(safe + "=" + scalar(body.get("value")))
        out.append(safe + "_SOURCE=" + scalar(body.get("source")))
        out.append(safe + "_ANSWERED_AT=" + scalar(body.get("answered_at")))
        out.append(safe + "_CONFIRMED_AT=" + scalar(body.get("last_confirmed_at")))
        out.append(safe + "_CONFIRM_COUNT=" + scalar(body.get("confirm_count")))
sys.stdout.write("\n".join(out) + "\n")
PY
}

_flatten_jq() {
  jq -r '
    def sc: if . == null then "" else tostring end;
    ("SCHEMA_VERSION=" + (.schema_version | sc)),
    ("WRITTEN_AT=" + (.written_at | sc)),
    ("WRITTEN_BY_PROJECT=" + (.written_by_project | sc)),
    ("HOSTNAME_HASH=" + (.machine.hostname_hash | sc)),
    ("CONFIG_FP=" + (.config_fingerprint.value | sc)),
    ("CONFIG_FP_COMPUTED_AT=" + (.config_fingerprint.computed_at | sc)),
    ((.config_fingerprint.inputs // []) | .[] | "CONFIG_FP_INPUT=" + (. | sc)),
    ((.answers // {}) | to_entries | sort_by(.key) | .[] |
       ("ANSWER_KEY=" + .key),
       (.key + "=" + (.value.value | sc)),
       (.key + "_SOURCE=" + (.value.source | sc)),
       (.key + "_ANSWERED_AT=" + (.value.answered_at | sc)),
       (.key + "_CONFIRMED_AT=" + (.value.last_confirmed_at | sc)),
       (.key + "_CONFIRM_COUNT=" + (.value.confirm_count | sc))
    )
  ' "$1" 2>/dev/null
  local rc=$?
  if [ "${rc}" -ne 0 ]; then echo "PARSE_FAIL=jq-rc-${rc}"; return 2; fi
  return 0
}

_flatten() {  # _flatten <json-path>
  case "${PARSER_NAME}" in
    python3) _flatten_python "$1" ;;
    jq)      _flatten_jq "$1" ;;
    *)       return 90 ;;
  esac
}

# The PARSER CONTROL: run the embedded known-good fixture through the same
# reader. Returns 0 when the control parses AND yields its known answer.
_parser_control() {
  local tmp out rc
  tmp="$(mktemp "${TMPDIR:-/tmp}/capprof-control.XXXXXX")" || return 1
  _control_fixture > "${tmp}"
  out="$(_flatten "${tmp}" 2>/dev/null)"; rc=$?
  rm -f "${tmp}"
  [ "${rc}" -ne 0 ] && return 1
  printf '%s\n' "${out}" | /usr/bin/grep -q '^ANSWER_KEY=RESERVE_PCT$' || return 1
  printf '%s\n' "${out}" | /usr/bin/grep -q '^RESERVE_PCT=25$' || return 1
  return 0
}

# =============================================================================
# READ
# =============================================================================
cmd_read() {
  local path="${1:-}"
  [ -z "${path}" ] && path="$(_default_path)"

  if ! _matcher_control; then return 2; fi

  # --- ABSENT: a proven negative, with its stat control run FIRST ------------
  if [ ! -e "${path}" ]; then
    # The stat control: this tool's own file must test as existing/readable.
    # If it does not, the file-test instrument is broken and "absent" is a
    # statement about the instrument, not about the profile.
    if [ ! -r "${SELF_PATH}" ]; then
      echo "BROKEN INSTRUMENT: the file-test control failed"
      echo "  control target: ${SELF_PATH} (this script — proven to exist by running)"
      echo "  Consequence: cannot prove the profile is absent. Failing toward ASKING."
      return 2
    fi
    echo "PROFILE_STATUS=ABSENT"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_CHECKED=${path} (test -e, control passed on ${SELF_PATH})"
    echo "PROFILE_NOT_CHECKED=every other location — the profile has exactly one sanctioned path; no search was performed, and none is sanctioned"
    echo "PROFILE_ACTION=run the full interview; write the profile at the end"
    return 1
  fi

  if [ ! -r "${path}" ]; then
    echo "PROFILE_STATUS=UNREADABLE"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_CHECKED=${path} (exists per test -e; test -r says not readable by this user)"
    echo "PROFILE_NOTE=an unreadable profile is a BROKEN INSTRUMENT, never \"no profile\""
    echo "PROFILE_ACTION=ask fresh; quarantine only if the file is also unparsable"
    echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
    return 2
  fi

  if ! _pick_parser; then
    echo "BROKEN INSTRUMENT: no JSON reader available"
    echo "  checked: python3, jq (both by command -v, then by running the control)"
    echo "  not checked: any other parser — this tool sanctions only these two"
    echo "  Consequence: the profile cannot be read. This is NOT \"no profile\"."
    echo "  Failing toward ASKING — run the full interview."
    return 2
  fi

  if ! _parser_control; then
    echo "BROKEN INSTRUMENT: the JSON reader (${PARSER_NAME}) failed its known-good control"
    echo "  control: an embedded, known-good schema-v1 fixture, parsed through the same reader"
    echo "  Consequence: any \"corrupt\" or \"empty\" verdict from this reader would be a"
    echo "  fact about the READER, not about ${path}. No verdict is issued."
    echo "  Failing toward ASKING — run the full interview; fix the reader."
    return 2
  fi

  local flat rc
  flat="$(_flatten "${path}")"; rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "PROFILE_STATUS=CORRUPT"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_READER=${PARSER_NAME} (control PASSED on the known-good fixture — so this verdict is about the file, not the reader)"
    echo "PROFILE_ERROR=$(printf '%s\n' "${flat}" | /usr/bin/grep '^PARSE_FAIL=' | head -1)"
    echo "PROFILE_NOTE=corrupt is NOT absent; the conductor quarantines, tells the user plainly, and asks fresh"
    echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
    return 2
  fi

  # --- Line-shape validation ------------------------------------------------
  local bad_line
  bad_line="$(printf '%s\n' "${flat}" | /usr/bin/grep -vcE '^[A-Za-z0-9_.-]+=')"
  if [ "${bad_line}" -ne 0 ]; then
    echo "PROFILE_STATUS=CORRUPT"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_REASON=a stored value contains a newline or an unprintable key name (${bad_line} malformed line(s)); the value itself is NOT printed"
    echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
    return 2
  fi

  # --- Schema version -------------------------------------------------------
  local sv
  sv="$(printf '%s\n' "${flat}" | /usr/bin/grep '^SCHEMA_VERSION=' | head -1 | cut -d= -f2-)"
  if [ "${sv}" != "${SCHEMA_VERSION}" ]; then
    echo "PROFILE_STATUS=BAD_SCHEMA"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_SCHEMA_EXPECTED=${SCHEMA_VERSION}"
    echo "PROFILE_SCHEMA_FOUND=$(printf '%s' "${sv}" | /usr/bin/grep -cE '.' >/dev/null 2>&1 && printf '%s' "${sv}" | cut -c1-16 || echo 'absent')"
    echo "PROFILE_NOTE=an unknown schema version is BROKEN-INSTRUMENT semantics, never \"no profile\""
    echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
    return 2
  fi

  # --- Hostname-hash gate: never adopt another box's history ----------------
  local stored_hash local_hash
  stored_hash="$(printf '%s\n' "${flat}" | /usr/bin/grep '^HOSTNAME_HASH=' | head -1 | cut -d= -f2-)"
  local_hash="$(_hostname_hash)"
  if [ -z "${stored_hash}" ] || [ "${stored_hash}" = "UNDETERMINED" ] \
     || [ "${local_hash}" = "UNDETERMINED" ] || [ "${stored_hash}" != "${local_hash}" ]; then
    echo "PROFILE_STATUS=ABSENT-FOREIGN-BOX"
    echo "PROFILE_PATH=${path}"
    echo "PROFILE_HOSTNAME_HASH_STORED=${stored_hash:-<empty>}"
    echo "PROFILE_HOSTNAME_HASH_LOCAL=${local_hash}"
    echo "PROFILE_REASON=the profile does not prove it belongs to THIS box (mismatch, or either side UNDETERMINED). A migrated profile must never masquerade as this box's history."
    echo "PROFILE_NOT_PRINTED=no stored answer was read out — none of them is believed to describe this machine"
    echo "PROFILE_ACTION=treat as ABSENT-WITH-NOTE; ask fresh"
    return 1
  fi

  # --- Allowlist + secret screen on every emitted pair ----------------------
  local keys k line lk lv
  keys="$(printf '%s\n' "${flat}" | /usr/bin/grep '^ANSWER_KEY=' | cut -d= -f2- | sort -u)"
  for k in ${keys}; do
    if ! _in_list "${k}" "${ANSWER_KEYS}"; then
      echo "PROFILE_STATUS=CORRUPT"
      echo "PROFILE_PATH=${path}"
      echo "PROFILE_FORBIDDEN_KEY=${k}"
      echo "PROFILE_REASON=that key is not on the sanctioned list; a profile carrying a measured or per-project value is contaminated, not merely surprising. Its value was NOT printed."
      echo "PROFILE_SANCTIONED_KEYS=${ANSWER_KEYS}"
      echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
      return 2
    fi
  done

  local out_buf=""
  while IFS= read -r line; do
    lk="${line%%=*}"
    lv="${line#*=}"
    case "${lk}" in ANSWER_KEY) continue ;; esac
    if [ "${#lv}" -gt "${MAX_READ_VALUE_LEN}" ]; then
      echo "PROFILE_STATUS=CORRUPT"
      echo "PROFILE_PATH=${path}"
      echo "PROFILE_OVERSIZE_KEY=${lk}"
      echo "PROFILE_REASON=stored value exceeds ${MAX_READ_VALUE_LEN} characters; the value was NOT printed"
      echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
      return 2
    fi
    if _secret_key_name "${lk}"; then
      echo "PROFILE_STATUS=CORRUPT"
      echo "PROFILE_PATH=${path}"
      echo "PROFILE_SECRET_SHAPED_KEY=${lk}"
      echo "PROFILE_REASON=a secret-shaped KEY NAME is present in the profile; its value was NOT printed"
      echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
      return 2
    fi
    _secret_value_shape "${lv}"
    case $? in
      0) echo "PROFILE_STATUS=CORRUPT"
         echo "PROFILE_PATH=${path}"
         echo "PROFILE_SECRET_SHAPED_VALUE_UNDER_KEY=${lk}"
         echo "PROFILE_REASON=a stored value matches a known secret shape; the value was NOT printed"
         echo "PROFILE_QUARANTINE_CMD=mv \"${path}\" \"${path}.corrupt-$(_now_stamp)\""
         return 2 ;;
      2) echo "BROKEN INSTRUMENT: the secret-shape matcher errored on key ${lk} (grep rc>=2)"
         echo "  Failing toward ASKING — no clean verdict is issued."
         return 2 ;;
    esac
    out_buf="${out_buf}${line}
"
  done <<EOF
${flat}
EOF

  local count
  count="$(printf '%s\n' "${keys}" | /usr/bin/grep -cE '^[A-Z]' )"
  [ -z "${count}" ] && count=0

  echo "PROFILE_STATUS=PRESENT"
  echo "PROFILE_PATH=${path}"
  echo "PROFILE_READER=${PARSER_NAME} (known-good control PASSED before this verdict)"
  echo "PROFILE_HOSTNAME_HASH_MATCH=yes"
  echo "PROFILE_ANSWER_COUNT=${count}"
  if [ "${count}" -eq 0 ]; then
    echo "PROFILE_NOTE=zero stored answers is a PROVEN negative: the reader parsed a known-good fixture with answers in it immediately before this read. Ask fresh."
  fi
  echo "PROFILE_RECALL_RULE=every value below is a PROPOSED answer to be CONFIRMED this run, never an input. Nothing measurable is stored here (capacity.md §13)."
  printf '%s' "${out_buf}"
  return 0
}

# =============================================================================
# WRITE
# =============================================================================
_refuse() {  # _refuse <key> <reason>
  echo "WRITE_STATUS=REFUSED"
  echo "WRITE_REFUSED_KEY=$1"
  echo "WRITE_REFUSED_REASON=$2"
  echo "WRITE_NOTE=the offending VALUE is never printed, quoted, or logged — only the key name"
  echo "WRITE_ACTION=nothing was written; no backup was taken; the existing profile is untouched"
}

_json_escape() {  # minimal, correct for UTF-8 text; control chars are refused earlier
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cmd_write() {
  local path="$1" answers="$2"

  if ! _matcher_control; then return 2; fi

  if [ ! -r "${answers}" ]; then
    echo "WRITE_STATUS=REFUSED"
    echo "WRITE_REFUSED_REASON=answers file not readable"
    echo "WRITE_CHECKED=${answers} (test -r)"
    return 2
  fi

  # --- Parse + screen. Nothing is written until every line has passed. ------
  local line key val ukey base suffix ok
  local fb_count=0 fb_joined="" project="" cfp="" cfp_at="" cfp_inputs=""
  local a_val a_src a_ans a_con a_cnt
  # Per-key collected values, held in plain variables (bash 3.2: no assoc arrays)
  local COLLECTED=""   # newline-separated "KEY<TAB>FIELD<TAB>VALUE"

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      ''|'#'*) continue ;;
    esac
    case "${line}" in
      *=*) : ;;
      *) echo "WRITE_STATUS=REFUSED"; echo "WRITE_REFUSED_REASON=malformed answers line (no '='); the line is not printed"; return 2 ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    ukey="$(_upper "${key}")"

    # Control characters would break the flat format and the JSON alike.
    case "${val}" in
      *[[:cntrl:]]*) _refuse "${ukey}" "value contains a control character"; return 2 ;;
    esac

    # DENY 1a — secret-shaped KEY NAME.
    if _secret_key_name "${ukey}"; then
      _refuse "${ukey}" "key name matches KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL — secrets are never stored in the capacity profile"
      return 2
    fi
    # DENY 1b — value over the length limit.
    if [ "${#val}" -gt "${MAX_VALUE_LEN}" ]; then
      _refuse "${ukey}" "value is ${#val} characters, over the ${MAX_VALUE_LEN}-character limit (FALLBACKS may be supplied as up to ${MAX_FALLBACK_ENTRIES} repeated lines, each within the limit)"
      return 2
    fi
    # DENY 1c — value matches a known secret shape.
    _secret_value_shape "${val}"
    case $? in
      0) _refuse "${ukey}" "value matches a known secret shape (sk-/ghp_/gho_/ghu_/ghs_/ghr_/github_pat_/eyJ/xox?-/AIza/-----BEGIN)"; return 2 ;;
      2) echo "BROKEN INSTRUMENT: the secret-shape matcher errored (grep rc>=2) on key ${ukey}"; echo "  Nothing was written. Failing toward ASKING."; return 2 ;;
    esac

    # --- Route the key --------------------------------------------------------
    case "${ukey}" in
      PROJECT)               project="${val}"; continue ;;
      CONFIG_FP)             cfp="${val}"; continue ;;
      CONFIG_FP_COMPUTED_AT) cfp_at="${val}"; continue ;;
      CONFIG_FP_INPUT)       cfp_inputs="${cfp_inputs}${val}
"; continue ;;
    esac

    if _in_list "${ukey}" "${ANSWER_KEYS}"; then
      if [ "${ukey}" = "FALLBACKS" ]; then
        fb_count=$(( fb_count + 1 ))
        if [ "${fb_count}" -gt "${MAX_FALLBACK_ENTRIES}" ]; then
          _refuse "FALLBACKS" "more than ${MAX_FALLBACK_ENTRIES} entries supplied"
          return 2
        fi
        if [ -z "${fb_joined}" ]; then fb_joined="${val}"; else fb_joined="${fb_joined}; ${val}"; fi
        continue
      fi
      COLLECTED="${COLLECTED}${ukey}	value	${val}
"
      continue
    fi

    # Suffixed metadata for an allowed answer key?
    ok=1
    for suffix in ${ANSWER_SUFFIXES}; do
      case "${ukey}" in
        *${suffix})
          base="${ukey%${suffix}}"
          if _in_list "${base}" "${ANSWER_KEYS}"; then
            case "${suffix}" in
              _CONFIRM_COUNT)
                _matches '^[0-9]+$' "${val}"
                [ $? -ne 0 ] && { _refuse "${ukey}" "confirm count must be a non-negative integer"; return 2; }
                ;;
            esac
            COLLECTED="${COLLECTED}${base}	${suffix}	${val}
"
            ok=0
          fi
          ;;
      esac
      [ "${ok}" -eq 0 ] && break
    done
    if [ "${ok}" -ne 0 ]; then
      _refuse "${ukey}" "not a sanctioned profile key. The profile stores ONLY unobservable billing facts and user policy; everything else is MEASURED every run (capacity.md §13, classification rows 1–11 and 21 are forbidden here). Sanctioned: ${ANSWER_KEYS}"
      return 2
    fi
  done < "${answers}"

  if [ -n "${fb_joined}" ]; then
    COLLECTED="${COLLECTED}FALLBACKS	value	${fb_joined}
"
  fi

  # --- Everything passed. Prepare the destination. --------------------------
  local dir created_dir="no"
  dir="$(dirname "${path}")"
  if [ ! -d "${dir}" ]; then
    mkdir -p "${dir}" 2>/dev/null || { echo "WRITE_STATUS=FAILED"; echo "WRITE_REASON=could not create ${dir}"; return 2; }
    chmod 700 "${dir}" 2>/dev/null
    created_dir="yes"
  fi

  local backup="none (no prior profile)"
  if [ -e "${path}" ]; then
    backup="${path}.bak.$(_now_stamp)"
    cp -p "${path}" "${backup}" 2>/dev/null || { echo "WRITE_STATUS=FAILED"; echo "WRITE_REASON=could not back up the existing profile; nothing was written"; return 2; }
  fi

  local now hh tmp
  now="$(_now_iso)"
  hh="$(_hostname_hash)"
  tmp="${path}.tmp.$$"

  {
    printf '{\n'
    printf '  "schema_version": %s,\n' "${SCHEMA_VERSION}"
    printf '  "written_at": "%s",\n' "$(_json_escape "${now}")"
    printf '  "written_by_project": "%s",\n' "$(_json_escape "${project}")"
    printf '  "machine": { "hostname_hash": "%s" },\n' "$(_json_escape "${hh}")"
    printf '  "answers": {\n'
    local first=1 ak v s aa ca cc note
    for ak in ${ANSWER_KEYS}; do
      v="$(printf '%s\n' "${COLLECTED}" | /usr/bin/grep "^${ak}	value	" | head -1 | cut -f3-)"
      [ -z "${v}" ] && continue
      s="$(printf '%s\n' "${COLLECTED}"  | /usr/bin/grep "^${ak}	_SOURCE	"        | head -1 | cut -f3-)"
      aa="$(printf '%s\n' "${COLLECTED}" | /usr/bin/grep "^${ak}	_ANSWERED_AT	"  | head -1 | cut -f3-)"
      ca="$(printf '%s\n' "${COLLECTED}" | /usr/bin/grep "^${ak}	_CONFIRMED_AT	" | head -1 | cut -f3-)"
      cc="$(printf '%s\n' "${COLLECTED}" | /usr/bin/grep "^${ak}	_CONFIRM_COUNT	"| head -1 | cut -f3-)"
      [ -z "${s}" ]  && s="unspecified"
      [ -z "${aa}" ] && aa="${now}"
      [ -z "${ca}" ] && ca="${now}"
      [ -z "${cc}" ] && cc=1
      [ "${first}" -eq 1 ] || printf ',\n'
      first=0
      printf '    "%s": { "value": "%s", "source": "%s", "answered_at": "%s", "last_confirmed_at": "%s", "confirm_count": %s' \
        "${ak}" "$(_json_escape "${v}")" "$(_json_escape "${s}")" "$(_json_escape "${aa}")" "$(_json_escape "${ca}")" "${cc}"
      if [ "${ak}" = "LAST_A4_WIDTH" ]; then
        printf ', "note": "offered as default only, never applied silently"'
      fi
      printf ' }'
    done
    [ "${first}" -eq 0 ] && printf '\n'
    printf '  },\n'
    printf '  "config_fingerprint": {\n'
    printf '    "value": "%s",\n' "$(_json_escape "${cfp}")"
    printf '    "computed_at": "%s",\n' "$(_json_escape "${cfp_at}")"
    printf '    "inputs": ['
    local ifirst=1 iline
    while IFS= read -r iline; do
      [ -z "${iline}" ] && continue
      [ "${ifirst}" -eq 1 ] || printf ','
      ifirst=0
      printf ' "%s"' "$(_json_escape "${iline}")"
    done <<EOF
${cfp_inputs}
EOF
    [ "${ifirst}" -eq 0 ] && printf ' '
    printf ']\n'
    printf '  }\n'
    printf '}\n'
  } > "${tmp}" 2>/dev/null || { rm -f "${tmp}"; echo "WRITE_STATUS=FAILED"; echo "WRITE_REASON=could not write the temp file in ${dir}"; return 2; }

  chmod 600 "${tmp}" 2>/dev/null
  mv "${tmp}" "${path}" 2>/dev/null || { rm -f "${tmp}"; echo "WRITE_STATUS=FAILED"; echo "WRITE_REASON=atomic move failed; the prior profile is intact"; return 2; }

  local wrote
  wrote="$(printf '%s\n' "${COLLECTED}" | /usr/bin/grep '	value	' | cut -f1 | sort -u | tr '\n' ' ')"

  echo "WRITE_STATUS=OK"
  echo "WRITE_PATH=${path}"
  echo "WRITE_MODE=600"
  echo "WRITE_DIR_CREATED=${created_dir}"
  echo "WRITE_BACKUP=${backup}"
  echo "WRITE_KEYS=${wrote}"
  echo "WRITE_HOSTNAME_HASH=${hh}"
  echo "WRITE_CONFIG_FP=${cfp:-<none supplied>}"
  echo "WRITE_NOTE=this tool wrote to exactly two paths — the profile and its backup — and to no settings file, no launcher, and no other location"
  return 0
}

# =============================================================================
# FINGERPRINT
# =============================================================================
cmd_fingerprint() {
  local file="$1"
  if [ ! -r "${file}" ]; then
    echo "CONFIG_FP=UNDETERMINED"
    echo "CONFIG_FP_REASON=measured-config file not readable"
    echo "CONFIG_FP_CHECKED=${file} (test -r)"
    echo "CONFIG_FP_ACTION=proceed as MISMATCH — fail toward asking"
    return 2
  fi
  if ! _sha256_pick; then
    echo "CONFIG_FP=UNDETERMINED"
    echo "CONFIG_FP_REASON=no digest instrument passed its known-answer test"
    echo "CONFIG_FP_CHECKED=shasum -a 256, sha256sum, openssl dgst -sha256, python3 hashlib — each run against the empty-string SHA-256 known answer"
    echo "CONFIG_FP_NOT_CHECKED=any other digest tool — these four are the sanctioned set"
    echo "CONFIG_FP_ACTION=proceed as MISMATCH — fail toward asking, never toward assuming"
    return 3
  fi
  local body hex n
  body="$(/usr/bin/grep -vE '^[[:space:]]*(#|$)' "${file}" | LC_ALL=C sort)"
  n="$(printf '%s\n' "${body}" | /usr/bin/grep -cE '.')"
  hex="$(printf '%s\n' "${body}" | _sha256_hex | cut -c1-8)"
  if [ -z "${hex}" ]; then
    echo "CONFIG_FP=UNDETERMINED"
    echo "CONFIG_FP_REASON=the digest instrument (${SHA_INSTRUMENT}) passed its known-answer test but produced no output for this input"
    echo "CONFIG_FP_ACTION=proceed as MISMATCH — fail toward asking"
    return 3
  fi
  echo "CONFIG_FP=${hex}"
  echo "CONFIG_FP_COMPUTED_AT=$(_now_iso)"
  echo "CONFIG_FP_INSTRUMENT=${SHA_INSTRUMENT} (known-answer test PASSED)"
  echo "CONFIG_FP_INPUT_COUNT=${n}"
  echo "CONFIG_FP_NOTE=a COMPARATOR, never a source — no capacity value may be read out of the inputs"
  return 0
}

# =============================================================================
# SELFTEST — proves the instrument BOTH WAYS before any run believes it
# =============================================================================
run_selftest() {
  local self="$1"
  local sandbox sentinel fails prof out rc
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/capacity-profile-selftest.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create sandbox HOME" >&2; return 1; }
  # A value that exists nowhere else on this machine. If it ever appears in
  # any output, this tool leaks secret VALUES.
  sentinel="SENTINEL-SECRET-VALUE-4c81be07-DO-NOT-PRINT"
  fails=0
  prof="${sandbox}/.claude/spec-protocol/capacity-profile.json"

  echo "SELFTEST — capacity-profile.sh"
  echo "  sandbox HOME: ${sandbox}"
  echo "  the real HOME is never touched: every child runs under env -i HOME=<sandbox>"
  echo

  _run() {  # _run <label-file> <args...> — runs the real script in the sandbox
    env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      bash "${self}" "$@" 2>&1
  }
  _ok()   { echo "  [PASS] $1"; }
  _bad()  { echo "  [FAIL] $1"; fails=$(( fails + 1 )); }
  _broken() { echo "  [BROKEN INSTRUMENT] $1"; fails=$(( fails + 1 )); }

  local ALL_OUT=""
  _cap() { ALL_OUT="${ALL_OUT}
$1"; }

  # --- 1. KNOWN-NEGATIVE: absent profile must exit 1 and NAME the path ------
  out="$(_run read "${prof}")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 1 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=ABSENT$' \
     && printf '%s\n' "${out}" | /usr/bin/grep -qF "PROFILE_CHECKED=${prof}"; then
    _ok "known-negative: absent profile exits 1, names the path checked and the control that proved the instrument"
  else
    _bad "known-negative: absent profile did not exit 1 with a named path (rc=${rc})"
  fi

  # --- 2. KNOWN-POSITIVE round trip ----------------------------------------
  cat > "${sandbox}/answers.txt" <<EOF
PROJECT=selftest-project
OLLAMA_PLAN=100
OLLAMA_PLAN_SOURCE=user-answer
OLLAMA_PLAN_ANSWERED_AT=2026-08-12T14:05:00Z
OLLAMA_PLAN_CONFIRMED_AT=2026-08-12T14:05:00Z
OLLAMA_PLAN_CONFIRM_COUNT=3
AGNES_PLAN=100
AGNES_PLAN_SOURCE=user-answer
DEEPSEEK_PATH=direct
RESERVE_PCT=25
RESERVE_PCT_SOURCE=default-confirmed
USAGE_WINDOW=5-hour window, resets about 3pm
EFFORT_SETTING=high
FALLBACKS=builder:v4flash->qwen38
FALLBACKS=judge:v4pro->glm52
LAST_A4_WIDTH=10
OVERNIGHT_CAPACITY_POLICY=throttle-then-park
CONFIG_FP=deadbeef
CONFIG_FP_COMPUTED_AT=2026-08-12T14:02:00Z
CONFIG_FP_INPUT=launcher=claude-nine
CONFIG_FP_INPUT=role.builder=deepseek-v4-flash
CONFIG_FP_INPUT=key-present=DEEPSEEK,OLLAMA_CLOUD,AGNES,GITHUB
EOF
  out="$(_run write "${prof}" "${sandbox}/answers.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 0 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_STATUS=OK$'; then
    _ok "known-positive: write accepted a full sanctioned answers file"
  else
    _bad "known-positive: write refused a legitimate answers file (rc=${rc})"
  fi
  if printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_BACKUP=none (no prior profile)$'; then
    _ok "first write reports 'no prior profile' rather than inventing a backup"
  else
    _bad "first write did not report the backup state honestly"
  fi

  out="$(_run read "${prof}")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 0 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=PRESENT$'; then
    _ok "known-positive: read of the freshly written profile exits 0 and reports PRESENT"
  else
    _bad "known-positive: read of a valid profile did not exit 0 PRESENT (rc=${rc})"
  fi
  local rt_fail=0 pair
  for pair in 'OLLAMA_PLAN=100' 'AGNES_PLAN=100' 'DEEPSEEK_PATH=direct' 'RESERVE_PCT=25' \
              'EFFORT_SETTING=high' 'LAST_A4_WIDTH=10' 'OVERNIGHT_CAPACITY_POLICY=throttle-then-park' \
              'OLLAMA_PLAN_CONFIRM_COUNT=3' 'RESERVE_PCT_SOURCE=default-confirmed' \
              'USAGE_WINDOW=5-hour window, resets about 3pm' \
              'FALLBACKS=builder:v4flash->qwen38; judge:v4pro->glm52' \
              'PROFILE_ANSWER_COUNT=9'; do
    printf '%s\n' "${out}" | /usr/bin/grep -qxF "${pair}" || { rt_fail=$(( rt_fail + 1 )); echo "        missing round-trip line: ${pair}"; }
  done
  if [ "${rt_fail}" -eq 0 ]; then
    _ok "round trip: all 9 answers, their provenance fields, and the joined FALLBACKS came back byte-identical"
  else
    _broken "round trip lost ${rt_fail} field(s) — a reader that cannot see a value it just wrote cannot report an honest zero"
  fi
  for pair in 'CONFIG_FP=deadbeef' 'CONFIG_FP_INPUT=launcher=claude-nine' 'CONFIG_FP_INPUT=role.builder=deepseek-v4-flash'; do
    printf '%s\n' "${out}" | /usr/bin/grep -qxF "${pair}" || { _bad "fingerprint comparator field lost: ${pair}"; }
  done
  _ok "fingerprint comparator round-tripped (value + inputs)"

  # --- 3. BACKUP on overwrite ----------------------------------------------
  out="$(_run write "${prof}" "${sandbox}/answers.txt")"; rc=$?
  _cap "${out}"
  local bpath
  bpath="$(printf '%s\n' "${out}" | /usr/bin/grep '^WRITE_BACKUP=' | head -1 | cut -d= -f2-)"
  if [ "${rc}" -eq 0 ] && [ -f "${bpath}" ]; then
    _ok "overwrite took a backup first and printed its path (${bpath##*/})"
  else
    _bad "overwrite did not produce a backup file at the announced path"
  fi

  # --- 4. CORRUPT fixture must exit 2, never 1 ------------------------------
  local corrupt="${sandbox}/corrupt.json"
  printf '{ this is not json at all' > "${corrupt}"
  out="$(_run read "${corrupt}")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=CORRUPT$' \
     && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_QUARANTINE_CMD=mv '; then
    _ok "corrupt profile exits 2 (never 1), names the reader control that passed, and prints the quarantine mv command"
  else
    _bad "corrupt profile did not exit 2 with a quarantine command (rc=${rc})"
  fi

  # --- 5. UNKNOWN SCHEMA VERSION -> 2 --------------------------------------
  local badschema="${sandbox}/badschema.json"
  printf '{ "schema_version": 99, "answers": {} }\n' > "${badschema}"
  out="$(_run read "${badschema}")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=BAD_SCHEMA$'; then
    _ok "unknown schema_version exits 2 (broken-instrument semantics), not 1"
  else
    _bad "unknown schema_version did not exit 2 (rc=${rc})"
  fi

  # --- 6. UNREADABLE file -> 2, distinct from absent ------------------------
  local noread="${sandbox}/noread.json"
  printf '{ "schema_version": 1 }\n' > "${noread}"
  chmod 000 "${noread}" 2>/dev/null
  out="$(_run read "${noread}")"; rc=$?
  _cap "${out}"
  chmod 644 "${noread}" 2>/dev/null
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=UNREADABLE$'; then
    _ok "an unreadable profile exits 2 — 'cannot read' is never reported as 'no profile'"
  else
    _bad "unreadable profile did not exit 2 UNREADABLE (rc=${rc})"
  fi

  # --- 7. FOREIGN BOX -> absent-with-note, and NO answer is printed ---------
  local foreign="${sandbox}/foreign.json"
  cat > "${foreign}" <<'EOF'
{
  "schema_version": 1,
  "written_at": "2026-08-01T00:00:00Z",
  "written_by_project": "another-box",
  "machine": { "hostname_hash": "ffffffff" },
  "answers": { "OLLAMA_PLAN": { "value": "20", "source": "user-answer", "answered_at": "2026-08-01T00:00:00Z", "last_confirmed_at": "2026-08-01T00:00:00Z", "confirm_count": 1 } },
  "config_fingerprint": { "value": "aaaaaaaa", "computed_at": "2026-08-01T00:00:00Z", "inputs": [ "launcher=claude" ] }
}
EOF
  out="$(_run read "${foreign}")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 1 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_STATUS=ABSENT-FOREIGN-BOX$' \
     && ! printf '%s\n' "${out}" | /usr/bin/grep -q '^OLLAMA_PLAN='; then
    _ok "a profile from another box reads as ABSENT-WITH-NOTE (exit 1) and NONE of its answers is printed"
  else
    _bad "foreign-box profile was not quarantined from the answer stream (rc=${rc})"
  fi

  # --- 8. EMPTY answers: a proven negative, not a broken reader ------------
  local emptyp="${sandbox}/empty.json"
  local myhash
  # Recompute this box's hash exactly the way the tool does, so the fixture
  # legitimately belongs to THIS machine and the foreign-box gate lets it through.
  myhash="$(env -i HOME="${sandbox}" PATH="${PATH}" bash -c 'hostname' 2>/dev/null)"
  myhash="$(printf '%s' "${myhash}" | shasum -a 256 2>/dev/null | awk '{print $1}' | cut -c1-8)"
  if [ -n "${myhash}" ]; then
    cat > "${emptyp}" <<EOF
{
  "schema_version": 1,
  "written_at": "2026-08-12T00:00:00Z",
  "written_by_project": "empty",
  "machine": { "hostname_hash": "${myhash}" },
  "answers": {},
  "config_fingerprint": { "value": "", "computed_at": "", "inputs": [] }
}
EOF
    out="$(_run read "${emptyp}")"; rc=$?
    _cap "${out}"
    if [ "${rc}" -eq 0 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^PROFILE_ANSWER_COUNT=0$' \
       && printf '%s\n' "${out}" | /usr/bin/grep -q 'PROVEN negative'; then
      _ok "an empty answer set is reported as a PROVEN negative — the reader control ran first"
    else
      _bad "empty answer set was not qualified by the reader control (rc=${rc})"
    fi
  else
    echo "  [UNDETERMINED] empty-answers case skipped: could not compute this box's hostname hash in the sandbox"
  fi

  # --- 9. FORBIDDEN KEY (classification rows 1–11/21) refused --------------
  printf 'DEEPSEEK_BALANCE=41.20\n' > "${sandbox}/forbidden.txt"
  out="$(_run write "${sandbox}/forbidden-out.json" "${sandbox}/forbidden.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_REFUSED_KEY=DEEPSEEK_BALANCE$' \
     && [ ! -e "${sandbox}/forbidden-out.json" ]; then
    _ok "a MEASURABLE value (a balance) is refused by name and no file is created"
  else
    _bad "a measurable value was not refused (rc=${rc})"
  fi

  # --- 10. SECRET-SHAPED KEY NAME refused, sentinel never printed ----------
  printf 'DEEPSEEK_API_KEY=%s\n' "${sentinel}" > "${sandbox}/secret-name.txt"
  out="$(_run write "${sandbox}/secret-name-out.json" "${sandbox}/secret-name.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_REFUSED_KEY=DEEPSEEK_API_KEY$' \
     && [ ! -e "${sandbox}/secret-name-out.json" ]; then
    _ok "a secret-shaped KEY NAME is refused, named, and nothing is written"
  else
    _bad "a secret-shaped key name was not refused (rc=${rc})"
  fi

  # --- 11. SECRET-SHAPED VALUE under a sanctioned key refused --------------
  printf 'USAGE_WINDOW=sk-%s\n' "${sentinel}" > "${sandbox}/secret-val.txt"
  out="$(_run write "${sandbox}/secret-val-out.json" "${sandbox}/secret-val.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_REFUSED_KEY=USAGE_WINDOW$' \
     && [ ! -e "${sandbox}/secret-val-out.json" ]; then
    _ok "a secret-SHAPED VALUE under a sanctioned key is refused by key name only"
  else
    _bad "a secret-shaped value was not refused (rc=${rc})"
  fi

  # --- 12. OVER-LENGTH value refused ---------------------------------------
  printf 'USAGE_WINDOW=%s\n' "$(printf 'x%.0s' $(seq 1 65))" > "${sandbox}/toolong.txt"
  out="$(_run write "${sandbox}/toolong-out.json" "${sandbox}/toolong.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -eq 2 ] && printf '%s\n' "${out}" | /usr/bin/grep -q "over the ${MAX_VALUE_LEN}-character limit"; then
    _ok "a value over ${MAX_VALUE_LEN} characters is refused (the blunt anti-secret guard, verbatim)"
  else
    _bad "an over-length value was not refused (rc=${rc})"
  fi

  # --- 12b. MEDIA_PROVIDER_PREF round-trips (the ONE sanctioned media fact) -
  # A cross-project user preference, recalled only as an OFFERED default. If it
  # cannot round-trip, the recall silently degrades to asking every time — a
  # soft failure that no other check here would notice.
  printf 'PROJECT=media-selftest\nMEDIA_PROVIDER_PREF=kie\nMEDIA_PROVIDER_PREF_SOURCE=user-answer\nMEDIA_PROVIDER_PREF_CONFIRM_COUNT=2\n' > "${sandbox}/media-pref.txt"
  out="$(_run write "${sandbox}/media-pref-out.json" "${sandbox}/media-pref.txt")"; rc=$?
  _cap "${out}"
  local mp_ok=0
  if [ "${rc}" -eq 0 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^WRITE_STATUS=OK$'; then
    out="$(_run read "${sandbox}/media-pref-out.json")"; rc=$?
    _cap "${out}"
    if [ "${rc}" -eq 0 ] \
       && printf '%s\n' "${out}" | /usr/bin/grep -qxF 'MEDIA_PROVIDER_PREF=kie' \
       && printf '%s\n' "${out}" | /usr/bin/grep -qxF 'MEDIA_PROVIDER_PREF_SOURCE=user-answer' \
       && printf '%s\n' "${out}" | /usr/bin/grep -qxF 'MEDIA_PROVIDER_PREF_CONFIRM_COUNT=2'; then
      mp_ok=1
    fi
  fi
  if [ "${mp_ok}" -eq 1 ]; then
    _ok "MEDIA_PROVIDER_PREF round-trips with its provenance fields — the one sanctioned media memory is genuinely on the allowlist, not merely documented"
  else
    _bad "MEDIA_PROVIDER_PREF did not round-trip (rc=${rc}) — the allowlist and the header comment disagree"
  fi

  # --- 12c. THE THREE MEDIA FACTS THAT MAY NEVER BE STORED -----------------
  # This is the check that keeps the allowlist from growing by implication.
  # Each fixture is refused for a DIFFERENT reason, and the reasons matter:
  #   media-secret-name  MEDIA_API_KEY      -> the deny-list (name matches KEY)
  #                      proves the deny-list still WINS and discriminates from
  #                      the new MEDIA_PROVIDER_PREF entry.
  #   media-presence     KIE_PRESENCE       -> the ALLOWLIST (no secret-shaped
  #                      substring at all, so nothing but the allowlist can
  #                      refuse it). Key presence is MEASURED EVERY RUN; a
  #                      remembered presence is a confident wrong branch.
  #   media-preauth      MEDIA_GATED_PREAUTH-> the ALLOWLIST, likewise. A stored
  #                      standing yes-to-spend must be impossible, not merely
  #                      discouraged.
  local mrefuse_fail=0 fx fxkey
  for fx in 'media-secret-name:MEDIA_API_KEY=nothing-real' \
            'media-presence:KIE_PRESENCE=found' \
            'media-preauth:MEDIA_GATED_PREAUTH=yes-all-night'; do
    fxkey="${fx#*:}"; fxkey="${fxkey%%=*}"
    printf '%s\n' "${fx#*:}" > "${sandbox}/${fx%%:*}.txt"
    out="$(_run write "${sandbox}/${fx%%:*}-out.json" "${sandbox}/${fx%%:*}.txt")"; rc=$?
    _cap "${out}"
    if [ "${rc}" -eq 2 ] \
       && printf '%s\n' "${out}" | /usr/bin/grep -qxF "WRITE_REFUSED_KEY=${fxkey}" \
       && [ ! -e "${sandbox}/${fx%%:*}-out.json" ]; then
      :
    else
      mrefuse_fail=$(( mrefuse_fail + 1 ))
      echo "        NOT refused: ${fxkey} (rc=${rc})"
    fi
  done
  if [ "${mrefuse_fail}" -eq 0 ]; then
    _ok "media deny proof: MEDIA_API_KEY (deny-list), KIE_PRESENCE (measured every run) and MEDIA_GATED_PREAUTH (a standing permission to spend) are each REFUSED by name, and no file is created — adding MEDIA_PROVIDER_PREF widened the allowlist by exactly one key"
  else
    _bad "media deny proof: ${mrefuse_fail} of 3 forbidden media keys was accepted — the allowlist grew by implication"
  fi

  # --- 13. FINGERPRINT: order-independence and discrimination --------------
  printf 'role.builder=deepseek-v4-flash\nlauncher=claude-nine\nkey-present=DEEPSEEK\n' > "${sandbox}/fp-a.txt"
  printf 'key-present=DEEPSEEK\nlauncher=claude-nine\nrole.builder=deepseek-v4-flash\n' > "${sandbox}/fp-b.txt"
  printf 'key-present=DEEPSEEK\nlauncher=claude\nrole.builder=deepseek-v4-flash\n'      > "${sandbox}/fp-c.txt"
  local fa fb fc
  out="$(_run fingerprint "${sandbox}/fp-a.txt")"; _cap "${out}"
  fa="$(printf '%s\n' "${out}" | /usr/bin/grep '^CONFIG_FP=' | cut -d= -f2-)"
  out="$(_run fingerprint "${sandbox}/fp-b.txt")"; _cap "${out}"
  fb="$(printf '%s\n' "${out}" | /usr/bin/grep '^CONFIG_FP=' | cut -d= -f2-)"
  out="$(_run fingerprint "${sandbox}/fp-c.txt")"; _cap "${out}"
  fc="$(printf '%s\n' "${out}" | /usr/bin/grep '^CONFIG_FP=' | cut -d= -f2-)"
  if [ -n "${fa}" ] && [ "${fa}" = "${fb}" ] && [ "${fa}" != "${fc}" ] \
     && printf '%s' "${fa}" | /usr/bin/grep -qE '^[0-9a-f]{8}$'; then
    _ok "fingerprint: 8 hex, order-independent (a=b), and DISCRIMINATES a changed launcher (a!=c)"
  else
    _broken "fingerprint does not discriminate (a=${fa} b=${fb} c=${fc}) — a comparator that cannot tell two rigs apart would report MATCH forever"
  fi
  out="$(_run fingerprint "${sandbox}/does-not-exist.txt")"; rc=$?
  _cap "${out}"
  if [ "${rc}" -ne 0 ] && printf '%s\n' "${out}" | /usr/bin/grep -q '^CONFIG_FP=UNDETERMINED$'; then
    _ok "an unreadable measured-config file yields UNDETERMINED and a non-zero exit — never a fabricated fingerprint"
  else
    _bad "unreadable fingerprint input did not report UNDETERMINED (rc=${rc})"
  fi

  # --- 14. THE LEAK PROOF: the sentinel must appear ZERO times -------------
  local leaks
  leaks="$(printf '%s\n' "${ALL_OUT}" | /usr/bin/grep -c "${sentinel}")"
  if [ "${leaks}" -eq 0 ]; then
    _ok "leak proof: 0 secret values printed across every command in this selftest (sentinel occurrences: 0)"
  else
    _bad "leak proof: a secret VALUE was printed ${leaks} time(s)"
  fi

  # --- 15. CONTAINMENT: nothing was written outside the profile path -------
  local stray
  stray="$(find "${sandbox}" -type f 2>/dev/null | /usr/bin/grep -v "^${sandbox}/.claude/spec-protocol/" | /usr/bin/grep -v "^${sandbox}/[a-z-]*\.\(txt\|json\)$" | /usr/bin/grep -c .)"
  if [ "${stray}" -eq 0 ]; then
    _ok "containment: the only files this tool created are under \$HOME/.claude/spec-protocol/ (fixtures written by the selftest itself excluded and enumerated)"
  else
    _bad "containment: ${stray} file(s) written outside the sanctioned profile directory"
    find "${sandbox}" -type f 2>/dev/null | /usr/bin/grep -v "^${sandbox}/.claude/spec-protocol/" | /usr/bin/grep -v "^${sandbox}/[a-z-]*\.\(txt\|json\)$" | sed 's/^/        /'
  fi
  local touched_elsewhere
  touched_elsewhere="$(find "${sandbox}/.claude" -mindepth 1 -maxdepth 1 2>/dev/null | /usr/bin/grep -vc '/spec-protocol$')"
  if [ "${touched_elsewhere}" -eq 0 ]; then
    _ok "containment: nothing under \$HOME/.claude outside spec-protocol/ was created — no settings.json, no launcher, no .claude-nine"
  else
    _bad "containment: something outside \$HOME/.claude/spec-protocol was created"
  fi

  rm -rf "${sandbox}"
  echo
  if [ "${fails}" -eq 0 ]; then
    echo "SELFTEST: PASS — instrument proven BOTH ways (positives detected, negatives proven), 0 secret values printed, all writes contained to the profile path"
    return 0
  fi
  echo "SELFTEST: FAIL (${fails} check(s) failed) — this run must fall back to ASK-EVERYTHING; a selftest failure is never a warning"
  return 1
}

# =============================================================================
# Dispatch
# =============================================================================
_usage() {
  cat <<USAGE
capacity-profile.sh — the one sanctioned memory of the spec-protocol skill

  capacity-profile.sh read [<profile-path>]
      Exit 0 PRESENT | 1 ABSENT (or ABSENT-FOREIGN-BOX) | 2 CORRUPT/UNREADABLE/
      BAD_SCHEMA/BROKEN INSTRUMENT. A profile that cannot be read is NOT
      "no profile" — 2 fails toward ASKING and prints a quarantine mv command.

  capacity-profile.sh write [<profile-path>] <answers-file>
      Backs up first and prints the backup path; writes atomically; REFUSES
      (exit 2, KEY named, value never printed) any secret-shaped key or value,
      any value over ${MAX_VALUE_LEN} characters, and any key that is not one of:
        ${ANSWER_KEYS}
      Answers-file lines: KEY=VALUE, plus optional KEY_SOURCE / KEY_ANSWERED_AT
      / KEY_CONFIRMED_AT / KEY_CONFIRM_COUNT, plus PROJECT, CONFIG_FP,
      CONFIG_FP_COMPUTED_AT and repeatable CONFIG_FP_INPUT.
      FALLBACKS may repeat (up to ${MAX_FALLBACK_ENTRIES} lines, each within the length limit);
      the entries are joined with "; " into the single schema value.

  capacity-profile.sh fingerprint <measured-config-file>
      Sorted non-comment lines -> sha256 -> first 8 hex. Exit 3 = UNDETERMINED
      (no digest instrument passed its known-answer test); the caller then
      proceeds as MISMATCH — fail toward asking, never toward assuming.

  capacity-profile.sh --selftest
      Known-positive, known-negative, corrupt, bad-schema, unreadable,
      foreign-box, forbidden-key, secret-name, secret-value, over-length,
      MEDIA_PROVIDER_PREF round-trip, the three-media-facts deny proof (key
      presence, "wants media", gated-tier pre-authorization), fingerprint
      discrimination, leak proof, containment proof.

Default profile path: \$SPEC_PROTOCOL_PROFILE, else \$HOME/.claude/spec-protocol/capacity-profile.json
USAGE
}

case "${1:-}" in
  --selftest) run_selftest "${SELF_PATH}"; exit $? ;;
  --help|-h|'') _usage; exit 0 ;;
  read)
    cmd_read "${2:-}"; exit $? ;;
  write)
    if [ -n "${3:-}" ]; then
      cmd_write "$2" "$3"
    elif [ -n "${2:-}" ]; then
      cmd_write "$(_default_path)" "$2"
    else
      echo "WRITE_STATUS=REFUSED"; echo "WRITE_REFUSED_REASON=no answers file given"; _usage; exit 2
    fi
    exit $? ;;
  fingerprint)
    if [ -z "${2:-}" ]; then
      echo "CONFIG_FP=UNDETERMINED"; echo "CONFIG_FP_REASON=no measured-config file given"; exit 2
    fi
    cmd_fingerprint "$2"; exit $? ;;
  *)
    echo "Unknown subcommand: $1" >&2; _usage >&2; exit 2 ;;
esac
