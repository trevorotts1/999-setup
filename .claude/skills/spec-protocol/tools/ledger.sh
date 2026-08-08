#!/usr/bin/env bash
# ledger.sh — atomic, LOCKED write primitive for all project MD files
# Usage: ledger.sh <home> <file> <line> [upsert-key]
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
# Includes iCloud pin-local mitigation for ~/Downloads.
#
# Forked from skill-warfix/tools/ledger.sh (that copy is untouched — this
# one adds the lock and the upsert mode; the two are no longer identical).

set -euo pipefail

HOME_DIR="${1:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
FILE="${2:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
LINE="${3:?Usage: ledger.sh <home> <file> <line> [upsert-key]}"
UPSERT_KEY="${4:-}"

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

# --- Verify THIS write landed (tail, not whole-file grep: a whole-file grep
# would pass on an earlier identical line and mask a failed append) ---
if [[ "$(tail -n 1 "${TARGET}")" != "${LINE}" ]]; then
  echo "ERROR: ledger write verification failed — last line of ${TARGET} is not the line just written" >&2
  exit 1
fi

exit 0
