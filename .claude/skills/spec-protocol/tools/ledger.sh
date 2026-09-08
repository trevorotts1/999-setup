#!/usr/bin/env bash
# ledger.sh — atomic, LOCKED write primitive for all project MD files
# Usage: ledger.sh <home> <file> <line> [upsert-key]
#        ledger.sh --selftest
#
# Appends <line> to <home>/<file> via .tmp + rename, with the whole
# read-modify-write wrapped in a lock. Copy-append-rename alone is NOT
# atomic across concurrent writers: two writers can each read the same
# starting state, and the second writer's rename clobbers the first
# writer's line after its own tail-check already passed. The lock is what
# makes the read-modify-write indivisible; the .tmp+rename is what keeps
# each LOCKED write crash-safe.
#
# [upsert-key], if given, gives overwrite-in-place semantics: any existing
# line containing the literal substring "| <upsert-key> |" is removed
# before <line> is appended, so the file ends up with exactly one line for
# that key. This is what HEARTBEAT.md needs — "one line per live agent,
# overwritten on every real progress step" (references/documents.md,
# document 13) — call it with the agent's own label as the key. Omit it
# for plain append (every other document: LEDGER.md, dispatch-log.md, etc).
#
# Locking: flock(1) when present (Linux; macOS if installed via
# `brew install util-linux`/similar) — held on a real file descriptor, so a
# crashed holder's lock releases itself when the fd closes, no staleness
# logic needed. On stock macOS (no flock), falls back to a mkdir-based lock
# — mkdir is atomic on every POSIX filesystem — with a stale-lock timeout,
# because a crashed holder's lock DOES need explicit reclaiming there.
# Lock acquisition failure is never silent: it retries with backoff, then
# fails LOUDLY, naming the exact lock path, rather than proceeding unlocked
# and risking a lost line.
#
# Every line matching the `| CLAIM |` marker ALSO has its `plan=` field
# appended to <home>/CONTROL/last-intents.txt, rolling, last 20. That file is
# the input anchor.sh's class 5 (repeated-intent stall) reads through
# --intents; before this, nothing wrote it and class 5 was undetermined on
# every run. See the block at the bottom of this file.
#
# THE SCORE LINE CLASS (references/gauntlet.md section 5 — the per-round score
# and the plateau rule). Every judge verdict writes ONE line of this shape:
#
#   SCORE | unit=<id> | round=<n> | score=<x.x> | best=<x.x> | delta=<d>
#
# optionally carrying the usual "<ISO8601Z> | " prefix every other ledger line
# carries. `score` is that round's 0-10 trend score, `best` is the best score
# the unit has reached in any round, and `delta` is how far `best` rose since
# the previous round (0.0 on round 1) — the number the plateau rule reads.
# The class is CHECKED HERE, before the lock is taken: a line that opens the
# SCORE class but does not carry all five fields in that order, with a numeric
# round, score, best and delta, is REFUSED with exit 2 and never written. A
# malformed SCORE line is a silent hole in the curve that the plateau rule
# (gauntlet.md sections 5 and 9), the `warn` progress analysis (gauntlet.md
# 13.2) and the morning report's per-unit curve (documents.md, document 14) are
# all computed from — a loud refusal is the cheaper failure. Nothing else about
# the line is judged, and NO OTHER line class is shape-checked here.
#
# --selftest proves both halves of that: the SCORE class (a well-formed line
# accepted and written, a malformed one refused and NOT written) and the
# CLAIM / RESULT shapes of references/anti-drift.md section 8, including that a
# CLAIM extends CONTROL/last-intents.txt and a RESULT does not. It writes only
# into a temporary directory it creates and removes.
#
# Includes iCloud pin-local mitigation for ~/Downloads.
#
# Forked from skill-warfix/tools/ledger.sh (that copy is untouched — this
# one adds the lock and the upsert mode; the two are no longer identical).

set -euo pipefail

# ============================================================================
# grep resolution — resolved ONCE, here, because two things need it: the SCORE
# class check (which runs before the lock is taken) and the CLAIM writer at the
# bottom of this file. An empty LGREP is never treated as "no match": it means
# the class of a line is UNKNOWN, and both readers say so out loud.
# ============================================================================
LGREP="/usr/bin/grep"
if [[ ! -x "${LGREP}" ]]; then
  if [[ -x /bin/grep ]]; then LGREP="/bin/grep"; else LGREP="$(command -v grep 2>/dev/null || true)"; fi
fi

# The SCORE line class (references/gauntlet.md section 5). Two expressions: one
# that says "this line is OF the SCORE class", one that says "and it is well
# formed". A line matching the first and failing the second is the only thing
# this script ever refuses on shape.
SCORE_CLASS_RE='(^|[|])[[:space:]]*SCORE[[:space:]]*[|]'
SCORE_SHAPE_RE='^([^|]*[|][[:space:]]*)?SCORE[[:space:]]*[|][[:space:]]*unit=[^|]+[|][[:space:]]*round=[0-9]+[[:space:]]*[|][[:space:]]*score=-?[0-9]+(\.[0-9]+)?[[:space:]]*[|][[:space:]]*best=-?[0-9]+(\.[0-9]+)?[[:space:]]*[|][[:space:]]*delta=-?[0-9]+(\.[0-9]+)?[[:space:]]*$'

is_score_line()  { printf '%s' "$1" | "${LGREP}" -qE "${SCORE_CLASS_RE}"; }
score_shape_ok() { printf '%s' "$1" | "${LGREP}" -qE "${SCORE_SHAPE_RE}"; }

# ============================================================================
# --selftest — the instrument proves itself before anyone trusts a line it
# wrote. Every case runs THE REAL WRITER, recursively, exactly as a caller
# would: no case asserts against a regex in isolation, because a shape checker
# that is never driven through the writer proves nothing about the writer.
#
# The accept cases are also the CONTROL for the refuse cases: a checker that
# refused everything, or accepted everything, fails this set as a whole. A
# refusal that is not accompanied by proof the line was NOT written is not a
# refusal, so every refuse case re-reads the file.
# ============================================================================
ST_PASSES=0
ST_FAILS=0
ST_HOME=""
ST_SELF=""
ST_RC=0
ST_ERR=""

st_ok()   { printf 'PASS | %s\n' "$1"; ST_PASSES=$((ST_PASSES + 1)); }
st_bad()  { printf 'FAIL | %s | %s\n' "$1" "$2"; ST_FAILS=$((ST_FAILS + 1)); }

st_write() {
  set +e
  ST_ERR="$(bash "${ST_SELF}" "${ST_HOME}" "$@" 2>&1 >/dev/null)"
  ST_RC=$?
  set -e
}

st_last() { tail -n 1 "${ST_HOME}/$1" 2>/dev/null || true; }
st_lines() { if [[ -f "${ST_HOME}/$1" ]]; then wc -l < "${ST_HOME}/$1" | tr -d ' '; else printf '0'; fi; }

run_selftest() {
  ST_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  ST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/ledger-selftest.XXXXXX")"
  trap 'rm -rf "${ST_HOME}"' EXIT
  printf 'ledger.sh --selftest | self=%s | home=%s\n' "${ST_SELF}" "${ST_HOME}"

  local L LEDGER INTENTS_BEFORE INTENTS_AFTER GUARD ML ML_BEFORE ML_AFTER
  LEDGER="CONTROL/LEDGER.md"

  # --- 1. SCORE, well formed, bare — the exact shape gauntlet.md section 5 writes
  L='SCORE | unit=U1 | round=2 | score=7.1 | best=7.1 | delta=1.3'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 0 )) && [[ "$(st_last "${LEDGER}")" == "${L}" ]]; then
    st_ok "SCORE class accepted and written: ${L}"
  else
    st_bad "SCORE class accepted and written" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] err=${ST_ERR}"
  fi

  # --- 2. SCORE with the ISO8601Z prefix every other ledger line carries
  L='2026-09-07T04:11:00Z | SCORE | unit=U1 | round=3 | score=8.2 | best=8.2 | delta=1.1'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 0 )) && [[ "$(st_last "${LEDGER}")" == "${L}" ]]; then
    st_ok "SCORE class accepted with a timestamp prefix"
  else
    st_bad "SCORE class accepted with a timestamp prefix" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] err=${ST_ERR}"
  fi

  # --- 3. SCORE missing a field — REFUSED, exit 2, and NOT written
  GUARD="$(st_last "${LEDGER}")"
  L='SCORE | unit=U1 | round=4 | score=8.4 | best=8.4'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 2 )) && [[ "$(st_last "${LEDGER}")" == "${GUARD}" ]]; then
    st_ok "malformed SCORE (no delta=) refused with exit 2 and not written"
  else
    st_bad "malformed SCORE (no delta=) refused" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] err=${ST_ERR}"
  fi

  # --- 4. SCORE with a non-numeric score — REFUSED, exit 2, and NOT written
  L='SCORE | unit=U1 | round=4 | score=high | best=8.4 | delta=0.2'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 2 )) && [[ "$(st_last "${LEDGER}")" == "${GUARD}" ]]; then
    st_ok "malformed SCORE (score=high) refused with exit 2 and not written"
  else
    st_bad "malformed SCORE (score=high) refused" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] err=${ST_ERR}"
  fi

  # --- 5. the CLAIM shape (anti-drift.md section 8) — written, and its plan= lands
  #        in CONTROL/last-intents.txt, which is class 5's only input
  L='2026-09-07T04:12:00Z | CLAIM | unit=U1 | agent=builder-a | model=builder | plan=build the home page'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 0 )) && [[ "$(st_last "${LEDGER}")" == "${L}" ]] \
     && [[ "$(st_last CONTROL/last-intents.txt)" == "build the home page" ]]; then
    st_ok "CLAIM shape written and its plan= appended to CONTROL/last-intents.txt"
  else
    st_bad "CLAIM shape written and intent appended" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] intent=[$(st_last CONTROL/last-intents.txt)] err=${ST_ERR}"
  fi

  # --- 6. the RESULT shape — written, and it does NOT extend the intent window
  #        (the discrimination control for case 5: a writer that appended for
  #        every line would pass case 5 and fail here)
  INTENTS_BEFORE="$(st_lines CONTROL/last-intents.txt)"
  L='2026-09-07T04:20:00Z | RESULT | unit=U1 | PASS | evidence=CONTROL/LEDGER.md'
  st_write "${LEDGER}" "${L}"
  INTENTS_AFTER="$(st_lines CONTROL/last-intents.txt)"
  if (( ST_RC == 0 )) && [[ "$(st_last "${LEDGER}")" == "${L}" ]] \
     && [[ "${INTENTS_BEFORE}" == "${INTENTS_AFTER}" ]]; then
    st_ok "RESULT shape written and the intent window left alone (${INTENTS_BEFORE} lines)"
  else
    st_bad "RESULT shape written, intent window unchanged" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] before=${INTENTS_BEFORE} after=${INTENTS_AFTER} err=${ST_ERR}"
  fi

  # --- 7. the control that keeps the SCORE check honest: an ordinary line of no
  #        class at all is written untouched
  L='2026-09-07T04:21:00Z | NOTE | unit=U1 | a line of no class at all'
  st_write "${LEDGER}" "${L}"
  if (( ST_RC == 0 )) && [[ "$(st_last "${LEDGER}")" == "${L}" ]]; then
    st_ok "control: an unclassed line is written untouched (the SCORE check is class-specific)"
  else
    st_bad "control: an unclassed line is written untouched" "rc=${ST_RC} last=[$(st_last "${LEDGER}")] err=${ST_ERR}"
  fi

  # --- 8. upsert mode still holds one line per key (HEARTBEAT's contract)
  st_write "CONTROL/HEARTBEAT.md" '2026-09-07T04:22:00Z | builder-a | U1 | build' 'builder-a'
  st_write "CONTROL/HEARTBEAT.md" '2026-09-07T04:27:00Z | builder-a | U1 | judge' 'builder-a'
  if (( ST_RC == 0 )) && [[ "$(st_lines CONTROL/HEARTBEAT.md)" == "1" ]]; then
    st_ok "upsert mode keeps exactly one line per key"
  else
    st_bad "upsert mode keeps one line per key" "rc=${ST_RC} lines=$(st_lines CONTROL/HEARTBEAT.md) err=${ST_ERR}"
  fi

  # --- 9. a ONE-LINE write: rc 0 with the line on disk. This is the CONTROL for
  #        cases 10 and 11 — a verification that refused every write, or accepted
  #        every write, fails this set as a whole rather than one case of it.
  L='2026-09-07T04:30:00Z | NOTE | unit=U2 | a one-line payload (multi-line control)'
  st_write "CONTROL/multiline.md" "${L}"
  if (( ST_RC == 0 )) && [[ "$(st_last CONTROL/multiline.md)" == "${L}" ]]; then
    st_ok "one-line write returns 0 with the line present (control for the multi-line cases)"
  else
    st_bad "one-line write returns 0 with the line present" "rc=${ST_RC} last=[$(st_last CONTROL/multiline.md)] err=${ST_ERR}"
  fi

  # --- 10. a SIX-LINE write — the QC RECORD shape of SKILL.md, the payload that
  #         used to exit 1 after its bytes had already landed. rc 0, all six
  #         lines present, in order, and the file grew by exactly six.
  ML='QC RECORD | unit=U2 | round=1
judge=judge-b (a seat that did not build U2)
provenance=STRIPPED
bar=reference-app (fetched 2026-09-07)
verdict=PASS
outcome=PASSED'
  ML_BEFORE="$(st_lines CONTROL/multiline.md)"
  st_write "CONTROL/multiline.md" "${ML}"
  ML_AFTER="$(st_lines CONTROL/multiline.md)"
  if (( ST_RC == 0 )) && (( ML_AFTER - ML_BEFORE == 6 )) \
     && [[ "$(tail -n 6 "${ST_HOME}/CONTROL/multiline.md")" == "${ML}" ]]; then
    st_ok "six-line write returns 0 with all six lines present and in order (${ML_BEFORE}->${ML_AFTER})"
  else
    st_bad "six-line write returns 0 with all six lines in order" "rc=${ST_RC} before=${ML_BEFORE} after=${ML_AFTER} tail6=[$(tail -n 6 "${ST_HOME}/CONTROL/multiline.md" 2>/dev/null)] err=${ST_ERR}"
  fi

  # --- 11. THE DISCRIMINATING CASE: the same six-line payload again, so the file
  #         ALREADY ends in the payload's last line before this write starts.
  #         The tail half of the verification is satisfied here whether or not
  #         the append landed, so this case passes only because the COUNT half
  #         is computed correctly — a count taken from the wrong baseline (the
  #         post-rename target, or the pre-upsert-filter copy) fails right here.
  ML_BEFORE="$(st_lines CONTROL/multiline.md)"
  st_write "CONTROL/multiline.md" "${ML}"
  ML_AFTER="$(st_lines CONTROL/multiline.md)"
  if (( ST_RC == 0 )) && (( ML_AFTER - ML_BEFORE == 6 )) \
     && [[ "$(tail -n 6 "${ST_HOME}/CONTROL/multiline.md")" == "${ML}" ]]; then
    st_ok "six-line write into a file already ending in the payload's last line returns 0 and grew by exactly 6 (the count check is what proves this append landed)"
  else
    st_bad "six-line write onto an identical trailing line" "rc=${ST_RC} before=${ML_BEFORE} after=${ML_AFTER} err=${ST_ERR}"
  fi

  printf 'ledger.sh --selftest | passes=%d fails=%d\n' "${ST_PASSES}" "${ST_FAILS}"
  if (( ST_FAILS > 0 )); then return 1; fi
  return 0
}

if [[ "${1:-}" == "--selftest" ]]; then
  if run_selftest; then exit 0; else exit 1; fi
fi

HOME_DIR="${1:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
FILE="${2:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
LINE="${3:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
UPSERT_KEY="${4:-}"

# ============================================================================
# The SCORE class gate — runs BEFORE the lock and before any file is touched,
# so a refused line leaves nothing behind. See the header for the shape and for
# why a malformed SCORE line is refused rather than written.
# ============================================================================
if [[ -z "${LGREP}" ]]; then
  echo "WARNING: ledger.sh found no usable grep (/usr/bin/grep, /bin/grep, PATH), so it could NOT check whether this line is of the SCORE class; the line is being written unchecked and any SCORE curve read from this ledger is UNDETERMINED until this is fixed" >&2
elif is_score_line "${LINE}"; then
  if ! score_shape_ok "${LINE}"; then
    echo "ERROR: ledger.sh refused a malformed SCORE line and wrote NOTHING. The class requires all five fields, in order, with numeric round/score/best/delta: SCORE | unit=<id> | round=<n> | score=<x.x> | best=<x.x> | delta=<d> (an ISO8601Z prefix is allowed). Got: ${LINE}" >&2
    exit 2
  fi
fi

TARGET="${HOME_DIR}/${FILE}"
TMP="${TARGET}.tmp.$$"
LOCKFILE="${TARGET}.lock"
LOCKDIR="${TARGET}.lock.d"

# --- iCloud pin-local mitigation (run once per home) ---
PIN_SENTINEL="${HOME_DIR}/.ledger-pinned"
if [[ ! -f "${PIN_SENTINEL}" ]]; then
  # Attempt brctl download if available (macOS iCloud)
  if command -v brctl &>/dev/null; then
    brctl download "${HOME_DIR}" 2>/dev/null || true
  fi
  # Attempt xattr pinning if supported
  if command -v xattr &>/dev/null; then
    xattr -w com.apple.metadata:com_apple_cloudDocs:PID 0 "${HOME_DIR}" 2>/dev/null || true
  fi
  # Create sentinel so we do not repeat this on every write
  touch "${PIN_SENTINEL}" 2>/dev/null || true
fi

# Ensure TARGET's own directory exists (not just HOME_DIR) — FILE can carry
# subdirectory components (e.g. "CONTROL/HEARTBEAT.md"), and the lock file
# lives beside TARGET, so both need the same parent directory to exist.
# Done unconditionally: a brand-new home is the normal first-write case, NOT
# an eviction — the eviction check below runs only AFTER the write succeeds.
mkdir -p "$(dirname "${TARGET}")"

# ============================================================================
# Acquire the lock. Everything that reads-then-writes TARGET happens after
# this point, and only after this point.
# ============================================================================
LOCK_TIMEOUT_SECS=30
LOCK_DEADLINE_SECS=45
STALE_LOCK_SECS=60
LOCK_HELD_VIA=""

release_lock() {
  if [[ "${LOCK_HELD_VIA}" == "flock" ]]; then
    exec 200>&- 2>/dev/null || true
  elif [[ "${LOCK_HELD_VIA}" == "mkdir" ]]; then
    rm -rf "${LOCKDIR}" 2>/dev/null || true
  fi
}
trap release_lock EXIT

now_epoch() { date -u +%s; }

# Portable mtime: BSD stat (macOS) first, GNU stat (Linux) second. Prints
# the mtime and exits 0 on success. Exits 1 with NOTHING printed if the path
# cannot be stat'd — e.g. it was removed by its owner in the race window
# between the caller's "-d" check and this call. That is NOT evidence of
# staleness (it usually means the opposite: ownership just changed hands
# cleanly) and callers must never treat a stat failure as "age = infinity."
mtime_epoch() {
  stat -f %m "$1" 2>/dev/null && return 0
  stat -c %Y "$1" 2>/dev/null && return 0
  return 1
}

if command -v flock >/dev/null 2>&1; then
  exec 200>"${LOCKFILE}"
  if flock -w "${LOCK_TIMEOUT_SECS}" 200; then
    LOCK_HELD_VIA="flock"
  else
    echo "ERROR: ledger.sh could not acquire lock ${LOCKFILE} within ${LOCK_TIMEOUT_SECS}s (flock). Refusing to write ${TARGET} unlocked — that is exactly the lost-line bug this lock exists to close. Another writer is stuck holding it; inspect that process before retrying, do not delete the lock file blindly." >&2
    exit 1
  fi
else
  # mkdir-based lock: no flock on this host (stock macOS has none). mkdir is
  # atomic on every POSIX filesystem, so exactly one concurrent invocation
  # ever succeeds. A stale-lock timeout recovers from a holder that crashed
  # mid-critical-section (flock does not need this — its lock dies with the
  # fd; a directory does not).
  #
  # Retries are JITTERED (a random pick, not a fixed doubling schedule).
  # Under real contention every loser wakes on the same deterministic
  # schedule and re-races in lockstep — a thundering herd that reliably
  # starves some writers even though the lock is only ever held for
  # milliseconds at a time (measured: fixed 0.25s-doubling-capped-at-2s
  # backoff over 14 attempts lost 6 of 20 concurrent writers in testing).
  # Jitter desynchronizes the herd; the deadline (wall-clock, not an
  # attempt count) keeps trying for as long as real contention plausibly
  # lasts instead of giving up after an attempt budget sized for the wrong
  # failure mode.
  SLEEP_CHOICES=(0.05 0.07 0.09 0.11 0.13 0.15 0.17 0.19 0.21 0.23)
  START_TS="$(now_epoch)"
  ACQUIRED=0
  while true; do
    if mkdir "${LOCKDIR}" 2>/dev/null; then
      printf 'pid=%s acquired=%s\n' "$$" "$(now_epoch)" > "${LOCKDIR}/owner" 2>/dev/null || true
      ACQUIRED=1
      break
    fi
    if [[ -d "${LOCKDIR}" ]]; then
      # TOCTOU guard: only reclaim on a SUCCESSFUL stat that proves real
      # age. If stat fails here, the dir vanished between the "-d" check
      # above and this line — almost always because the true owner just
      # released it (possibly to a new legitimate owner already racing to
      # recreate it) — never treat that as staleness. Doing so was a real,
      # reproduced bug: it deleted another writer's freshly-created,
      # zero-age lock out from under it and cost that writer its line.
      if LOCK_MTIME="$(mtime_epoch "${LOCKDIR}")"; then
        LOCK_AGE=$(( $(now_epoch) - LOCK_MTIME ))
        if (( LOCK_AGE > STALE_LOCK_SECS )); then
          # Prior holder crashed without releasing (LOCK_AGE exceeds the
          # time any real critical section here should ever take) —
          # reclaim it.
          rm -rf "${LOCKDIR}" 2>/dev/null || true
          continue
        fi
      fi
    fi
    if (( $(now_epoch) - START_TS >= LOCK_DEADLINE_SECS )); then
      break
    fi
    sleep "${SLEEP_CHOICES[$(( RANDOM % ${#SLEEP_CHOICES[@]} ))]}"
  done
  if (( ACQUIRED != 1 )); then
    echo "ERROR: ledger.sh could not acquire lock dir ${LOCKDIR} within ${LOCK_DEADLINE_SECS}s. Refusing to write ${TARGET} unlocked — that is exactly the lost-line bug this lock exists to close. Inspect ${LOCKDIR}/owner (pid + acquire time) before removing it; only remove it yourself once you have confirmed that pid is dead." >&2
    exit 1
  fi
  LOCK_HELD_VIA="mkdir"
fi

# ============================================================================
# Everything below runs holding the lock — this whole block is one
# indivisible read-modify-write from every other writer's point of view.
# ============================================================================

# Sweep stale .tmp files from interrupted prior writes (crash between the cp
# and the mv). A .tmp with no final is an incomplete write; the resume protocol
# drops it. We drop it here too so it never accumulates. Safe under the lock:
# no other writer can be mid-write right now.
find "$(dirname "${TARGET}")" -maxdepth 1 -name "${FILE##*/}.tmp.*" -type f -delete 2>/dev/null || true

# If target exists, copy it to tmp first, then modify, then append.
if [[ -f "${TARGET}" ]]; then
  cp "${TARGET}" "${TMP}"
else
  : > "${TMP}"
fi

if [[ -n "${UPSERT_KEY}" ]]; then
  # Overwrite-in-place: drop this key's existing line before re-adding it.
  # grep -v exits 1 when every line matched (file becomes empty) or the
  # file was already empty — both are valid outcomes here, not errors.
  grep -v -F "| ${UPSERT_KEY} |" "${TMP}" > "${TMP}.filtered" 2>/dev/null || true
  mv "${TMP}.filtered" "${TMP}"
fi

# The line count of the file as it will stand IMMEDIATELY BEFORE this payload
# is appended (i.e. after any upsert filter above, so an upsert's own deletion
# is never mistaken for a short append). The verification below subtracts this
# from the final count to prove the append added exactly the payload's lines.
PRE_N=$(wc -l < "${TMP}" | tr -d ' ')

printf '%s\n' "${LINE}" >> "${TMP}"

# Atomic rename — still inside the lock, so no other writer's read of
# TARGET's prior state can land between our read (the cp above) and this
# write.
mv "${TMP}" "${TARGET}"

# --- Post-write eviction check ---
# Only meaningful once the home existed and a prior write had landed: if the
# target file we just rewrote has vanished (iCloud evicted it out from under
# us), the data may not be on local storage. A freshly created home is fine.
if [[ ! -f "${TARGET}" ]]; then
  WARN_LINE="$(date -u +%Y-%m-%dT%H:%M:%SZ) | WARNING | iCloud-eviction | ${HOME_DIR} is iCloud-evicted — files may be missing. Run: brctl download ${HOME_DIR}"
  printf '%s\n' "${WARN_LINE}" >> "${TARGET}"
  echo "WARNING: iCloud eviction detected for ${HOME_DIR}" >&2
fi

# --- Verify THIS write landed. Two parts, because a payload is not always one
# line: the file's last line must equal the payload's LAST line, AND the file's
# line count must have grown by exactly the payload's line count.
#
# The tail half is still a tail and not a whole-file grep for the original
# reason: a whole-file grep would pass on an earlier identical line and mask a
# failed append. For a multi-line payload the tail half alone can no longer
# carry that guarantee on its own — a file that already ended in the payload's
# last line would satisfy it whether or not this append landed — so the COUNT
# half now carries it: the file cannot have grown by exactly the payload's line
# count unless this append is what grew it. (The old check compared the file's
# last line against the WHOLE payload, so every multi-line write reported a
# failed write after its bytes had already landed.) ---
PAYLOAD_LAST="${LINE##*$'\n'}"
PAYLOAD_N=$(printf '%s\n' "${LINE}" | wc -l | tr -d ' ')
POST_N=$(wc -l < "${TARGET}" | tr -d ' ')
if [[ "$(tail -n 1 "${TARGET}")" != "${PAYLOAD_LAST}" ]] || (( POST_N - PRE_N != PAYLOAD_N )); then
  echo "ERROR: ledger write verification failed — ${TARGET} does not end with the last line just written, or did not grow by the ${PAYLOAD_N} line(s) just written (before=${PRE_N} after=${POST_N})" >&2
  exit 1
fi

# ============================================================================
# CLASS 5's INPUT — the rolling stated-intent window.
#
# references/anti-drift.md section 3 hands anchor.sh CONTROL/last-intents.txt
# as its --intents input, and section 4's class 5 (the repeated-intent stall —
# the "let me find the endpoint" signature) is what reads it. Nothing in the
# skill ever WROTE that file, so class 5 was UNDETERMINED on every run of every
# project — a detector with no input.
#
# Every CLAIM line already carries the unit's stated plan, which IS the
# intent the detector needs, and every CLAIM line comes through here. So the
# writer belongs here: one line per CLAIM, rolling, the last 20.
#
# It runs AFTER the verified write of the real line, and it can never fail
# that write: a problem updating the derived file is a loud warning on stderr,
# never a non-zero exit that would make the caller (anchor.sh's ledger_write)
# report a TOOLING FAILURE for a line that actually landed.
#
# The whole read-modify-write below still holds this TARGET's lock, so
# concurrent CLAIM writers to the same ledger are serialized here exactly as
# they are for the ledger itself.
# ============================================================================
# LGREP was resolved at the top of this file (the SCORE class gate needs it
# before the lock); it is the same grep this block uses.

append_intent() {
  local intents_file="${HOME_DIR}/CONTROL/last-intents.txt"
  local itmp="${intents_file}.tmp.$$"
  local plan
  # plan=<...> up to the next field separator. A CLAIM with no plan= field is
  # a malformed claim, not a reason to write nothing: the line still gets an
  # entry, marked, so the window keeps one entry per claim and the defect is
  # visible instead of silently shortening the window.
  plan="$(printf '%s' "${LINE}" | sed -n 's/.*[|][[:space:]]*plan=//p' | sed 's/[[:space:]]*[|].*$//')"
  if [[ -z "${plan}" ]]; then
    plan="(no plan= field) $(printf '%s' "${LINE}" | sed 's/^[^|]*[|]//')"
  fi
  plan="$(printf '%s' "${plan}" | tr -d '\n\r' | cut -c1-300)"
  mkdir -p "$(dirname "${intents_file}")" || return 1
  : > "${itmp}" || return 1
  if [[ -f "${intents_file}" ]]; then
    tail -n 19 "${intents_file}" >> "${itmp}" || return 1
  fi
  printf '%s\n' "${plan}" >> "${itmp}" || return 1
  mv "${itmp}" "${intents_file}" || return 1
  return 0
}

if [[ "${FILE}" != *last-intents.txt ]]; then
  if [[ -z "${LGREP}" ]]; then
    # No usable grep means this line's class is UNKNOWN, not "not a CLAIM".
    # Say so rather than skipping in silence and leaving class 5 quietly blind.
    echo "WARNING: ledger.sh found no usable grep (/usr/bin/grep, /bin/grep, PATH), so it could not tell whether this was a CLAIM line; ${HOME_DIR}/CONTROL/last-intents.txt was NOT updated and anchor.sh's class 5 (repeated-intent) will be undetermined" >&2
  elif printf '%s' "${LINE}" | "${LGREP}" -qE '[|][[:space:]]*CLAIM[[:space:]]*[|]'; then
    if ! append_intent; then
      rm -f "${HOME_DIR}/CONTROL/last-intents.txt.tmp.$$" 2>/dev/null || true
      echo "WARNING: ledger.sh wrote ${TARGET} but could not update ${HOME_DIR}/CONTROL/last-intents.txt — anchor.sh's class 5 (repeated-intent) will be undetermined until this is fixed" >&2
    fi
  fi
fi

exit 0
