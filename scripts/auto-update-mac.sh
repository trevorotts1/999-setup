#!/usr/bin/env bash
# auto-update-mac.sh - non-interactive, idempotent "update if behind" entry point
# for the 999-setup checkout on a macOS box. Called by the scheduled auto-update run.
#
#   bash scripts/auto-update-mac.sh [--checkout DIR] [--check] [--lock-wait SECONDS]
#
# What it does, in order:
#   1. Refuses on anything but macOS (uname -s != Darwin): exit 64, nothing touched.
#   2. Finds the 999 checkout (--checkout, $NINE_999_CHECKOUT, ~/999-setup,
#      ~/Documents/999-setup) and reads its installed version (VERSION file).
#   3. Takes the shared box update lease (onboarding's scripts/box-update-lock.sh, lease file
#      /tmp/openclaw-update.lock or $OPENCLAW_UPDATE_LEASE). When the auto-update run that
#      launched this script owns the lease, this script rides it (a child never re-acquires and
#      never releases it). A live foreign owner is polled every 30 s up to --lock-wait
#      (default 1800 s), then exit 75 DEFERRED with nothing changed.
#   4. Reads the latest version: git fetch origin main, then VERSION at origin/main.
#   5. Installed >= latest  -> result=CURRENT, exit 0, nothing written.
#      Installed <  latest  -> fast-forward the checkout to origin/main, then run
#      setup-macos.sh --skills-only (the existing skills-only refresh path, with no
#      other flag). That path never changes 9Router settings, tokens, models,
#      providers or the claude-nine launcher. If it fails, the checkout is put back
#      to the commit it was on, so the next run is still "behind" and retries.
#   6. Last stdout line is always one machine-readable result line:
#        AUTO-UPDATE-999 result=<CURRENT|UPDATED|BEHIND|DEFERRED|REFUSED|FAILED> before=v<x.y.z> after=v<x.y.z> latest=v<x.y.z> rc=<n> reason=<text>
#      The v-prefixed versions are what the beacon's versions["999"] before/after carry.
#      --check prints BEHIND or CURRENT and writes nothing (no fetch merge, no lock).
#
# Exit codes: 0 CURRENT/UPDATED/(--check) | 64 not macOS | 65 no checkout |
#   66 a VERSION unreadable | 67 fetch failed | 68 fast-forward refused |
#   69 skills-only refresh failed | 70 lock helper missing or lease filesystem error |
#   75 lock busy past the wait (DEFERRED) | 2 bad usage.
#
# Test hooks (never needed on a real box): AUTO_UPDATE_UNAME overrides `uname -s`;
# AUTO_UPDATE_LOCK_HELPER overrides the helper path; AUTO_UPDATE_LOCK_POLL overrides the 30 s
# poll; AUTO_UPDATE_ORIGIN_REF overrides origin/main.
set -uo pipefail

CHECKOUT="${NINE_999_CHECKOUT:-}"
CHECK=0
LOCK_WAIT="${AUTO_UPDATE_LOCK_WAIT:-1800}"
LEASE="${OPENCLAW_UPDATE_LEASE:-/tmp/openclaw-update.lock}"
LOCK_HELPER="${AUTO_UPDATE_LOCK_HELPER:-${OPENCLAW_ROOT:-$HOME/.openclaw}/scripts/box-update-lock.sh}"
LOCK_POLL="${AUTO_UPDATE_LOCK_POLL:-30}"
ORIGIN_REF="${AUTO_UPDATE_ORIGIN_REF:-origin/main}"

BEFORE="-"; AFTER="-"; LATEST="-"
HAVE_LOCK=0

result() { # result <RESULT> <rc> <reason>
  printf 'AUTO-UPDATE-999 result=%s before=%s after=%s latest=%s rc=%s reason=%s\n' "$1" "$BEFORE" "$AFTER" "$LATEST" "$2" "$3"
  exit "$2"
}
release_lock() {
  # Only this process's own lease is removed; a lease inherited from the launching run is left to it.
  if [ "$HAVE_LOCK" = 1 ]; then box_update_lock_release; HAVE_LOCK=0; fi
}
trap release_lock EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --checkout) [ $# -ge 2 ] || result FAILED 2 "--checkout needs a directory"; CHECKOUT="$2"; shift ;;
    --check) CHECK=1 ;;
    --lock-wait) [ $# -ge 2 ] || result FAILED 2 "--lock-wait needs seconds"; LOCK_WAIT="$2"; shift ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) result FAILED 2 "unknown argument: $1 (options: --checkout DIR | --check | --lock-wait SECONDS)" ;;
  esac
  shift
done
case "$LOCK_WAIT" in ''|*[!0-9]*) result FAILED 2 "--lock-wait must be whole seconds, got: $LOCK_WAIT" ;; esac

# 1. macOS only. Nothing else runs first.
OS="${AUTO_UPDATE_UNAME:-$(uname -s)}"
[ "$OS" = "Darwin" ] || result REFUSED 64 "999-setup updates only on macOS (uname -s = $OS); nothing was touched"

# 2. Locate the checkout.
if [ -z "$CHECKOUT" ]; then
  for c in "$HOME/999-setup" "$HOME/Documents/999-setup"; do
    [ -f "$c/VERSION" ] && [ -e "$c/.git" ] && { CHECKOUT="$c"; break; }
  done
fi
[ -n "$CHECKOUT" ] && [ -f "$CHECKOUT/VERSION" ] && git -C "$CHECKOUT" rev-parse --git-dir >/dev/null 2>&1 \
  || result FAILED 65 "no 999-setup git checkout with a VERSION file found (looked at --checkout, NINE_999_CHECKOUT, ~/999-setup, ~/Documents/999-setup)"
CHECKOUT="$(cd "$CHECKOUT" && pwd -P)"

# version helpers: "1.39.0" -> validated; is_behind A B = A < B numerically.
valid_ver() { printf '%s' "$1" | /usr/bin/awk '/^[0-9]+(\.[0-9]+){1,3}$/ {ok=1} END {exit ok?0:1}'; }
is_behind() {
  /usr/bin/awk -v a="$1" -v b="$2" 'BEGIN {
    na=split(a,x,"."); nb=split(b,y,"."); n=(na>nb)?na:nb
    for(i=1;i<=n;i++){ xi=(i<=na)?x[i]+0:0; yi=(i<=nb)?y[i]+0:0
      if(xi<yi) exit 0; if(xi>yi) exit 1 }
    exit 1 }'
}
read_ver() { tr -d ' \t\r\n' < "$1" 2>/dev/null; }

BEFORE="$(read_ver "$CHECKOUT/VERSION")"
valid_ver "$BEFORE" || result FAILED 66 "installed VERSION is unreadable or not a version number (found: ${BEFORE:-empty})"
RAW_BEFORE="$BEFORE"; BEFORE="v$BEFORE"

take_lock() { # rc 0 held, 1 busy past the wait, 2 helper missing, 3 filesystem error
  [ -f "$LOCK_HELPER" ] || return 2
  # shellcheck disable=SC1090
  . "$LOCK_HELPER" || return 2
  local waited=0 rc run_id="${BFX_LOCK_RUN_ID:-auto-update-999-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  while :; do
    box_update_lock_acquire "$LEASE" "$run_id" "999-update" "$CHECKOUT" >&2; rc=$?
    case "$rc" in
      0) HAVE_LOCK=1; return 0 ;;
      3) [ "$waited" -lt "$LOCK_WAIT" ] || return 1
         sleep "$LOCK_POLL"; waited=$((waited + LOCK_POLL)) ;;
      *) return 3 ;;
    esac
  done
}

# --check is strictly read-only: no lock, no merge. It still reads origin through a temporary fetch.
if [ "$CHECK" = 0 ]; then
  take_lock; LRC=$?
  case "$LRC" in
    0) ;;
    1) result DEFERRED 75 "the box update lease ($LEASE) stayed busy for ${LOCK_WAIT}s; nothing changed, try again at the next scheduled run" ;;
    2) result FAILED 70 "shared lock helper missing at $LOCK_HELPER (delivered by the onboarding update); refusing to update without the lock" ;;
    *) result FAILED 70 "could not take the box update lease at $LEASE (filesystem error)" ;;
  esac
fi

# 4. Latest version on GitHub main.
git -C "$CHECKOUT" fetch --quiet origin main </dev/null >/dev/null 2>&1 \
  || result FAILED 67 "could not fetch origin main for the 999 checkout at $CHECKOUT"
RAW_LATEST="$(git -C "$CHECKOUT" show "$ORIGIN_REF:VERSION" 2>/dev/null | tr -d ' \t\r\n')"
valid_ver "$RAW_LATEST" || result FAILED 66 "latest VERSION on $ORIGIN_REF is unreadable (found: ${RAW_LATEST:-empty})"
LATEST="v$RAW_LATEST"

# 5. Compare. Only behind updates.
if ! is_behind "$RAW_BEFORE" "$RAW_LATEST"; then
  AFTER="$BEFORE"
  result CURRENT 0 "installed $BEFORE is not behind latest $LATEST; nothing changed"
fi
if [ "$CHECK" = 1 ]; then
  result BEHIND 0 "installed $BEFORE is behind latest $LATEST; --check changed nothing"
fi

OLD_HEAD="$(git -C "$CHECKOUT" rev-parse HEAD)"
git -C "$CHECKOUT" merge --ff-only --quiet "$ORIGIN_REF" </dev/null >/dev/null 2>&1 \
  || result FAILED 68 "could not fast-forward the checkout to $ORIGIN_REF (local changes or a diverged branch); nothing was changed"

SETUP="$CHECKOUT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
if [ ! -f "$SETUP" ]; then
  git -C "$CHECKOUT" reset --keep "$OLD_HEAD" >/dev/null 2>&1
  result FAILED 69 "setup-macos.sh missing in the updated checkout; checkout put back to $BEFORE"
fi
# The existing skills-only refresh path, and nothing else: no other flag.
bash "$SETUP" --skills-only </dev/null; SRC=$?
if [ "$SRC" -ne 0 ]; then
  git -C "$CHECKOUT" reset --keep "$OLD_HEAD" >/dev/null 2>&1
  AFTER="v$(read_ver "$CHECKOUT/VERSION")"
  result FAILED 69 "setup-macos.sh --skills-only exited $SRC; checkout put back to $BEFORE so the next run retries"
fi

AFTER="v$(read_ver "$CHECKOUT/VERSION")"
result UPDATED 0 "updated $BEFORE -> $AFTER by the skills-only refresh; 9Router settings, tokens, models and launcher untouched"
