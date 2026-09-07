#!/usr/bin/env bash
# prompt-band.sh — the PROMPT BAND gate for every image prompt this skill sends
# to a paid API. It is the checker `references/media-pipeline.md` section 4
# names, and it is the only instrument allowed to answer "does this prompt pass
# the band?" — never a model's own estimate, never a count done by eye.
#
# THE BAND (references/media-pipeline.md section 4, the operator's standing rule):
#   FLOOR   5,000 stripped characters — below it the prompt is REJECTED
#   TARGET  9,000 stripped characters — the quality target, reported never enforced
#   MAX    18,000 stripped characters — above it the prompt is REJECTED
#
# STRIPPED means every whitespace character — spaces, tabs, newlines, carriage
# returns, form feeds, vertical tabs — is removed before counting. Unicode is
# counted in CHARACTERS, not bytes, so an em dash counts once.
#
# USAGE
#   prompt-band.sh <file>            count the file, print the verdict
#   prompt-band.sh -                 count stdin
#   prompt-band.sh --selftest        prove the instrument, then exit
#   prompt-band.sh --band            print the three numbers and exit 0
#
# OUTPUT — one line, machine-readable, and it never echoes the prompt:
#   PROMPT-BAND | stripped=<n> | floor=5000 | target=9000 | max=18000 | verdict=<PASS|REJECT-FLOOR|REJECT-MAX> | sha256=<hex>
# The sha256 is of the STRIPPED text, so a work item can record which prompt was
# gated without the prompt itself travelling into a ledger.
#
# EXIT CODES
#   0 — PASS (inside the band)
#   1 — REJECT (below the floor or above the maximum) — a build step that
#       ignores this exit code is the defect the gate exists to prevent
#   2 — UNDETERMINED: the input could not be read (missing file, unreadable,
#       no argument). Never reported as a REJECT — a broken instrument is a
#       fact about the checker, not about the prompt.
#   3 — the selftest FAILED: this checker may not be believed until it is fixed.
set -u

FLOOR=5000
TARGET=9000
MAX=18000

die_undetermined() {
  echo "PROMPT-BAND | verdict=UNDETERMINED | reason=$1" >&2
  exit 2
}

# strip_count <text-on-stdin> -> prints "<count> <sha256>"
strip_and_measure() {
  # Remove every whitespace character, count characters (not bytes), and hash
  # the stripped form. LC_ALL=C.UTF-8 where available keeps wc -m honest on
  # multibyte input; plain C would count bytes, which is the wrong unit.
  local stripped
  stripped=$(tr -d '[:space:]')
  local n
  n=$(printf '%s' "${stripped}" | LC_ALL=en_US.UTF-8 wc -m 2>/dev/null | tr -d ' ')
  if [ -z "${n}" ]; then
    n=$(printf '%s' "${stripped}" | wc -m | tr -d ' ')
  fi
  local h
  if command -v shasum >/dev/null 2>&1; then
    h=$(printf '%s' "${stripped}" | shasum -a 256 | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    h=$(printf '%s' "${stripped}" | sha256sum | awk '{print $1}')
  else
    h="unavailable"
  fi
  printf '%s %s\n' "${n}" "${h}"
}

verdict_for() {
  local n="$1"
  if [ "${n}" -lt "${FLOOR}" ]; then echo "REJECT-FLOOR"; return; fi
  if [ "${n}" -gt "${MAX}" ]; then echo "REJECT-MAX"; return; fi
  echo "PASS"
}

run_one() {
  local src="$1" measured n h v
  if [ "${src}" = "-" ]; then
    measured=$(strip_and_measure)
  else
    [ -e "${src}" ] || die_undetermined "no such file"
    [ -r "${src}" ] || die_undetermined "file not readable"
    measured=$(strip_and_measure < "${src}")
  fi
  n=${measured%% *}
  h=${measured##* }
  case "${n}" in (''|*[!0-9]*) die_undetermined "count instrument returned '${n}'";; esac
  v=$(verdict_for "${n}")
  echo "PROMPT-BAND | stripped=${n} | floor=${FLOOR} | target=${TARGET} | max=${MAX} | verdict=${v} | sha256=${h}"
  [ "${v}" = "PASS" ] && return 0
  return 1
}

selftest() {
  local tmp fails=0
  tmp=$(mktemp -d) || { echo "SELFTEST | UNDETERMINED | cannot mktemp" >&2; exit 3; }
  trap 'rm -rf "${tmp}"' EXIT

  _case() { # _case <label> <char-count> <expected-verdict> <expected-rc>
    local label="$1" count="$2" want="$3" wantrc="$4" f out rc got
    f="${tmp}/${label}.txt"
    # Build the fixture with whitespace mixed in, so the STRIPPING is proven and
    # not merely the counting: every fixture carries newlines and spaces that
    # must not be counted.
    awk -v n="${count}" 'BEGIN{ for(i=0;i<n;i++){ printf "x"; if(i%40==39) printf " \n\t" } }' > "${f}"
    out=$("$0" "${f}"); rc=$?
    got=$(printf '%s' "${out}" | sed -n 's/.*verdict=\([A-Z-]*\).*/\1/p')
    local gotn
    gotn=$(printf '%s' "${out}" | sed -n 's/.*stripped=\([0-9]*\).*/\1/p')
    if [ "${got}" = "${want}" ] && [ "${rc}" = "${wantrc}" ] && [ "${gotn}" = "${count}" ]; then
      echo "SELFTEST ok   | ${label} | stripped=${gotn} verdict=${got} rc=${rc}"
    else
      echo "SELFTEST FAIL | ${label} | stripped=${gotn} (want ${count}) verdict=${got} (want ${want}) rc=${rc} (want ${wantrc})"
      fails=$((fails + 1))
    fi
  }

  # Known-negative below the floor, the boundary itself, the target, the
  # boundary above the maximum, and one character past it. The two boundary
  # cases are the ones that catch an off-by-one in the comparison.
  _case below-floor      4999  REJECT-FLOOR 1
  _case floor-exact      5000  PASS         0
  _case target-exact     9000  PASS         0
  _case max-exact       18000  PASS         0
  _case above-max       18001  REJECT-MAX   1

  # The instrument must refuse to answer about a file it cannot read, and must
  # NOT call that a REJECT.
  local out rc
  out=$("$0" "${tmp}/does-not-exist.txt" 2>&1); rc=$?
  if [ "${rc}" = "2" ]; then
    echo "SELFTEST ok   | missing-file | rc=2 UNDETERMINED, not a reject"
  else
    echo "SELFTEST FAIL | missing-file | rc=${rc} (want 2) out=${out}"
    fails=$((fails + 1))
  fi

  # Whitespace-only input strips to zero and is therefore below the floor —
  # proving the strip really happens rather than the raw length being used.
  printf '   \n\t\n   \n' > "${tmp}/ws.txt"
  out=$("$0" "${tmp}/ws.txt"); rc=$?
  if [ "${rc}" = "1" ] && printf '%s' "${out}" | grep -q 'stripped=0 '; then
    echo "SELFTEST ok   | whitespace-only | stripped=0 rc=1"
  else
    echo "SELFTEST FAIL | whitespace-only | rc=${rc} out=${out}"
    fails=$((fails + 1))
  fi

  # stdin path answers the same as the file path for the same bytes.
  local a b
  a=$("$0" "${tmp}/target-exact.txt")
  b=$("$0" - < "${tmp}/target-exact.txt")
  if [ "${a}" = "${b}" ]; then
    echo "SELFTEST ok   | stdin-equals-file"
  else
    echo "SELFTEST FAIL | stdin-equals-file | '${a}' vs '${b}'"
    fails=$((fails + 1))
  fi

  if [ "${fails}" -eq 0 ]; then
    echo "SELFTEST PASS | 8 checks | floor=${FLOOR} target=${TARGET} max=${MAX}"
    exit 0
  fi
  echo "SELFTEST FAILED | ${fails} check(s) failed — this checker may not be believed" >&2
  exit 3
}

case "${1:-}" in
  --selftest) selftest ;;
  --band)     echo "PROMPT-BAND | floor=${FLOOR} | target=${TARGET} | max=${MAX}"; exit 0 ;;
  "" )        die_undetermined "no input given (usage: prompt-band.sh <file>|- |--selftest)" ;;
  *)          run_one "$1" ;;
esac
