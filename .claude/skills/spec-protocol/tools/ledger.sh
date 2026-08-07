#!/usr/bin/env bash
# ledger.sh — atomic-write primitive for all project MD files
# Usage: ledger.sh <home> <file> <line>
# Appends <line> to <home>/<file> via .tmp + rename (atomic).
# Includes iCloud pin-local mitigation for ~/Downloads.
#
# Inherited from skill-warfix/tools/ledger.sh. Identical mechanism.

set -euo pipefail

HOME_DIR="${1:?Usage: ledger.sh <home> <file> <line>}"
FILE="${2:?Usage: ledger.sh <home> <file> <line>}"
LINE="${3:?Usage: ledger.sh <home> <file> <line>}"

TARGET="${HOME_DIR}/${FILE}"
TMP="${TARGET}.tmp.$$"

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

# --- Atomic append ---
# Ensure the target directory exists. (Done unconditionally: a brand-new home
# is the normal first-write case, NOT an eviction — the eviction check below
# runs only AFTER the write succeeds.)
mkdir -p "${HOME_DIR}"

# Sweep stale .tmp files from interrupted prior writes (crash between the cp
# and the mv). A .tmp with no final is an incomplete write; the resume protocol
# drops it. We drop it here too so it never accumulates.
find "${HOME_DIR}" -maxdepth 1 -name "${FILE}.tmp.*" -type f -delete 2>/dev/null || true

# If target exists, copy it to tmp first, then append
if [[ -f "${TARGET}" ]]; then
  cp "${TARGET}" "${TMP}"
else
  : > "${TMP}"
fi

printf '%s\n' "${LINE}" >> "${TMP}"

# Atomic rename
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
