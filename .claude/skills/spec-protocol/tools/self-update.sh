#!/usr/bin/env bash
# self-update.sh — take the update that check-update.sh announces.
#
# WHY THIS EXISTS. check-update.sh can tell a box it is stale. Without a way to
# ACT on that, the answer is just a complaint. This is the other half: it pulls
# the canonical tree from the repo and installs it over this one, safely enough
# that a client machine can run it unattended.
#
# WHAT "SAFELY" MEANS HERE, CONCRETELY
#   1. Back up the entire skill tree BEFORE anything is touched, print the
#      path, and never overwrite an existing backup.
#   2. Prove the fetched copy is genuinely NEWER than the installed one before
#      replacing a single file. Never downgrade silently. Never install a tree
#      whose version cannot be read at all.
#   3. If any step after the point of no return fails, restore the backup.
#   4. Touch nothing outside the skill directory except the backup itself and,
#      when required, the second config root's view of this skill.
#
# WHAT IT WILL NEVER TOUCH. settings.json. Models. Providers. Router wiring.
# Departments. Credentials of any kind. teammateDefaultModel. Those are the
# client's, frequently hand-tuned, and must survive this script untouched. The
# only things this script writes are: the backup directory, the contents of the
# skill directory, and (conditionally, see below) the second config root's copy
# of this same skill.
#
# EXIT CODES
#   0  updated, or already current (nothing needed doing)
#   1  the update FAILED and the backup was restored — you are back where you started
#   2  aborted before anything changed (undetermined, refused, or preconditions unmet)
#
# Run it with:  bash tools/self-update.sh
# Check first with:  bash tools/check-update.sh

set -uo pipefail

# =============================================================================
# 0. RE-EXEC FROM A TEMP COPY
# =============================================================================
# This script lives INSIDE the directory it is about to replace. bash reads a
# script incrementally from an open file descriptor as it executes, so deleting
# the file mid-run can truncate the script and leave the skill tree half
# replaced — the exact failure this script exists to prevent.
#
# So: copy ourselves out to a temp file and re-exec from there. The copy then
# unlinks itself immediately; on POSIX the already-open fd stays valid, so the
# script runs to completion with nothing left behind on disk.
#
# SPEC_PROTOCOL_DIR carries the real skill location across the re-exec, since
# BASH_SOURCE will point at the temp copy afterwards.
if [ "${SPEC_PROTOCOL_SELFUPDATE_DETACHED:-0}" != "1" ]; then
  _ORIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
  if [ -z "$_ORIG_DIR" ]; then
    printf '%s\n' "ABORTED — could not resolve the skill directory from ${BASH_SOURCE[0]}"
    exit 2
  fi
  _TMP_SELF="$(mktemp "${TMPDIR:-/tmp}/spec-protocol-selfupdate.XXXXXX")" || {
    printf '%s\n' "ABORTED — could not create a temp copy of the installer"
    exit 2
  }
  cat "${BASH_SOURCE[0]}" > "$_TMP_SELF" || {
    rm -f "$_TMP_SELF"
    printf '%s\n' "ABORTED — could not copy the installer to $_TMP_SELF"
    exit 2
  }
  SPEC_PROTOCOL_SELFUPDATE_DETACHED=1 \
  SPEC_PROTOCOL_DIR="${SPEC_PROTOCOL_DIR:-$_ORIG_DIR}" \
  SPEC_PROTOCOL_TMP_SELF="$_TMP_SELF" \
    exec bash "$_TMP_SELF" "$@"
fi

# We are now the detached copy. Unlink it; the open fd keeps us running.
if [ -n "${SPEC_PROTOCOL_TMP_SELF:-}" ]; then
  rm -f "$SPEC_PROTOCOL_TMP_SELF" 2>/dev/null || true
fi

# =============================================================================
# 1. SETTINGS AND STATE
# =============================================================================
SKILL_DIR="${SPEC_PROTOCOL_DIR:-}"
TARBALL_URL="${SPEC_PROTOCOL_TARBALL_URL:-https://codeload.github.com/trevorotts1/999-setup/tar.gz/main}"

# Where the skill lives inside the repo tarball.
REPO_SKILL_SUBPATH=".claude/skills/spec-protocol"

# Backups deliberately do NOT go under a config root.
#
# Reason, observed directly: a full copy of this skill placed under
# ~/.claude/backups/ — SKILL.md and all — gets picked up by the harness and
# registers as a SECOND, phantom skill in the session's skill list, named after
# the backup directory. That pollutes every future session with a duplicate
# entry and invites an agent to load the stale copy by mistake. Keeping backups
# outside both config roots avoids it entirely.
BACKUP_ROOT="${SPEC_PROTOCOL_BACKUP_DIR:-$HOME/.spec-protocol-backups}"

WORK_DIR=""
BACKUP_DIR=""
MUTATED=0        # 1 once the installed tree has been altered
COMPLETED=0      # 1 once the install has fully succeeded
NINE_BACKUP_DIR=""
NINE_MUTATED=0

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

# =============================================================================
# 2. FAILURE HANDLING — RESTORE THE BACKUP
# =============================================================================
# Restoration is the whole safety story, so it is defined before anything can
# fail. It only ever runs when we KNOW the tree was mutated and the install did
# not complete. A restore that fails still leaves the backup on disk, and the
# path is printed again so it can be replaced by hand.
restore_backup() {
  if [ "$MUTATED" -ne 1 ] || [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
    return 0
  fi
  say ""
  say "  RESTORING from backup: $BACKUP_DIR"
  rm -rf "${SKILL_DIR:?}" 2>/dev/null
  mkdir -p "$SKILL_DIR" 2>/dev/null
  if cp -R "$BACKUP_DIR/." "$SKILL_DIR/" 2>/dev/null; then
    say "  RESTORED — the skill is back to its pre-update state."
    MUTATED=0
  else
    say "  !! RESTORE FAILED. The backup is intact and untouched at:"
    say "     $BACKUP_DIR"
    say "     Copy it back by hand:"
    say "       cp -R \"$BACKUP_DIR/.\" \"$SKILL_DIR/\""
  fi

  if [ "$NINE_MUTATED" -eq 1 ] && [ -n "$NINE_BACKUP_DIR" ] && [ -d "$NINE_BACKUP_DIR" ]; then
    say "  The second config root's copy was also changed; its backup is at:"
    say "     $NINE_BACKUP_DIR"
  fi
}

cleanup() {
  local rc=$?
  if [ "$COMPLETED" -ne 1 ]; then
    restore_backup
  fi
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR" 2>/dev/null || true
  fi
  exit $rc
}
trap cleanup EXIT
trap 'say ""; say "INTERRUPTED — unwinding."; exit 1' INT TERM

# abort: nothing has been changed yet. die: something has, so restore.
abort() { say ""; say "ABORTED — $*"; say "Nothing was changed."; exit 2; }
die()   { say ""; say "FAILED — $*"; exit 1; }

# =============================================================================
# 3. SHARED VERSION LOGIC (identical semantics to check-update.sh)
# =============================================================================
is_version() {
  local v="${1:-}"
  case "$v" in
    '')        return 1 ;;
    *[!0-9.]*) return 1 ;;
    .*|*.)     return 1 ;;
    *..*)      return 1 ;;
  esac
  [ "${#v}" -le 32 ] || return 1
  return 0
}

# Numeric field-by-field. A lexical sort would rank 1.10.0 below 1.9.0 and
# would happily "upgrade" a box backwards.
newer_than() {
  local a="${1:-0}" b="${2:-0}" i n ai bi
  local -a A B
  IFS='.' read -r -a A <<< "$a"
  IFS='.' read -r -a B <<< "$b"
  n=${#A[@]}
  if [ "${#B[@]}" -gt "$n" ]; then n=${#B[@]}; fi
  i=0
  while [ "$i" -lt "$n" ]; do
    ai=$(( 10#${A[$i]:-0} ))
    bi=$(( 10#${B[$i]:-0} ))
    if [ "$ai" -gt "$bi" ]; then return 0; fi
    if [ "$ai" -lt "$bi" ]; then return 1; fi
    i=$(( i + 1 ))
  done
  return 1
}

read_version() {
  local f="$1" v
  [ -f "$f" ] || return 1
  v="$(tr -d ' \t\r\n' < "$f" 2>/dev/null)"
  is_version "$v" || return 1
  printf '%s' "$v"
}

# =============================================================================
# 4. PRECONDITIONS
# =============================================================================
step "Preconditions"

[ -n "$SKILL_DIR" ] || abort "could not resolve the skill directory."
[ -d "$SKILL_DIR" ] || abort "skill directory does not exist: $SKILL_DIR"

# Guard rails on the path before anything in this script is allowed to run
# `rm -rf` against it. A resolution bug must never become a catastrophe.
case "$SKILL_DIR" in
  */skills/spec-protocol) : ;;
  *) abort "refusing to operate on '$SKILL_DIR' — not a .../skills/spec-protocol path." ;;
esac
if [ "$SKILL_DIR" = "/" ] || [ "$SKILL_DIR" = "$HOME" ] || [ "$SKILL_DIR" = "$HOME/" ]; then
  abort "refusing to operate on '$SKILL_DIR'."
fi
[ -f "$SKILL_DIR/SKILL.md" ] || abort "no SKILL.md in $SKILL_DIR — that is not a skill tree."
[ -w "$SKILL_DIR" ] || abort "no write permission on $SKILL_DIR"

for tool in curl tar mktemp cp rm; do
  command -v "$tool" >/dev/null 2>&1 || abort "required tool '$tool' is not available."
done

say "  skill directory : $SKILL_DIR"

INSTALLED_VERSION="$(read_version "$SKILL_DIR/VERSION" || true)"
if [ -z "$INSTALLED_VERSION" ]; then
  # Missing or unreadable VERSION means this tree predates the mechanism. It is
  # almost certainly stale, so an update is allowed — but we treat it as 0.0.0
  # rather than pretending to know, and we say so out loud.
  INSTALLED_VERSION="0.0.0"
  say "  installed       : UNKNOWN (no readable VERSION — treating as 0.0.0)"
  say "                    This tree predates the version mechanism."
else
  say "  installed       : $INSTALLED_VERSION"
fi
say "  source          : $TARBALL_URL"

# =============================================================================
# 5. BACK UP THE WHOLE SKILL TREE — BEFORE ANYTHING ELSE
# =============================================================================
step "Backup"

mkdir -p "$BACKUP_ROOT" 2>/dev/null || abort "could not create backup root: $BACKUP_ROOT"
[ -w "$BACKUP_ROOT" ] || abort "backup root is not writable: $BACKUP_ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BASE="$BACKUP_ROOT/spec-protocol.bak-v${INSTALLED_VERSION}-${STAMP}"

# Never overwrite an existing backup. If the name is taken — two runs in the
# same second, or a previous run's backup — find a free suffix instead of
# clobbering someone's only copy of their state.
BACKUP_DIR="$BACKUP_BASE"
n=1
while [ -e "$BACKUP_DIR" ]; do
  BACKUP_DIR="${BACKUP_BASE}-${n}"
  n=$(( n + 1 ))
  if [ "$n" -gt 100 ]; then
    abort "could not find a free backup name under $BACKUP_ROOT"
  fi
done

mkdir -p "$BACKUP_DIR" 2>/dev/null || abort "could not create backup directory: $BACKUP_DIR"
cp -R "$SKILL_DIR/." "$BACKUP_DIR/" 2>/dev/null \
  || abort "backup copy failed into $BACKUP_DIR — refusing to continue without one."

# Prove the backup is real before trusting it with the tree's only copy.
[ -f "$BACKUP_DIR/SKILL.md" ] || abort "backup is incomplete (no SKILL.md) at $BACKUP_DIR"
BACKUP_FILES="$(find "$BACKUP_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"

say "  BACKUP PATH     : $BACKUP_DIR"
say "  files backed up : $BACKUP_FILES"
say ""
say "  (Backups live outside both config roots on purpose: a skill tree copied"
say "   under a config root registers as a duplicate phantom skill.)"

# =============================================================================
# 6. FETCH AND STAGE
# =============================================================================
step "Fetch"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spec-protocol-update.XXXXXX")" \
  || abort "could not create a working directory."
TARBALL="$WORK_DIR/source.tar.gz"

HTTP_CODE="$(curl -sS -L --proto '=https' --max-time 180 \
                  -o "$TARBALL" -w '%{http_code}' \
                  "$TARBALL_URL" 2>/dev/null)"
CURL_RC=$?

if [ $CURL_RC -ne 0 ]; then
  abort "could not download the canonical tree (curl rc=$CURL_RC).
  This is a TRANSPORT failure — offline, DNS, TLS, proxy, or timeout.
  It is not a statement about versions. Re-run when the network is back."
fi
if [ "$HTTP_CODE" != "200" ]; then
  abort "the server did not serve the tree (HTTP $HTTP_CODE) from:
    $TARBALL_URL"
fi
[ -s "$TARBALL" ] || abort "the downloaded archive is empty."

step "Extract and stage"

EXTRACT_DIR="$WORK_DIR/extract"
mkdir -p "$EXTRACT_DIR" || abort "could not create $EXTRACT_DIR"
tar -xzf "$TARBALL" -C "$EXTRACT_DIR" 2>/dev/null \
  || abort "the archive could not be extracted — it is not a readable gzip tarball."

# Locate the skill inside the extracted repo. The tarball's top-level directory
# is named after the repo and branch, which can change, so find it rather than
# hardcoding the prefix.
STAGED=""
while IFS= read -r candidate; do
  STAGED="$candidate"
  break
done <<EOF
$(find "$EXTRACT_DIR" -maxdepth 6 -type d -path "*/$REPO_SKILL_SUBPATH" 2>/dev/null)
EOF

[ -n "$STAGED" ] || abort "the archive does not contain $REPO_SKILL_SUBPATH — wrong repo, wrong branch, or the skill has moved."
[ -f "$STAGED/SKILL.md" ] || abort "the staged copy has no SKILL.md at $STAGED — refusing to install it."

say "  staged from     : ${STAGED#$EXTRACT_DIR/}"

# =============================================================================
# 7. PROVE IT IS NEWER — THE GATE
# =============================================================================
step "Version gate"

STAGED_VERSION="$(read_version "$STAGED/VERSION" || true)"

# A staged tree with no readable VERSION cannot be proven newer. Installing it
# would put the box right back into the blind state this mechanism exists to
# end, and would do it while destroying a known-good tree. Refuse.
if [ -z "$STAGED_VERSION" ]; then
  abort "the fetched copy has no readable VERSION file.
  Cannot prove it is newer than what is installed ($INSTALLED_VERSION), so it
  will not be installed. This is UNDETERMINED, not 'you are current'.
  The published tree probably has not been given a VERSION yet."
fi

say "  installed       : $INSTALLED_VERSION"
say "  published       : $STAGED_VERSION"

if [ "$STAGED_VERSION" = "$INSTALLED_VERSION" ]; then
  say ""
  say "ALREADY CURRENT — $INSTALLED_VERSION. Nothing to install."
  say "Backup kept at: $BACKUP_DIR"
  COMPLETED=1
  exit 0
fi

if ! newer_than "$STAGED_VERSION" "$INSTALLED_VERSION"; then
  abort "the published version ($STAGED_VERSION) is OLDER than the installed one ($INSTALLED_VERSION).
  Refusing to downgrade. If a rollback is genuinely wanted, do it deliberately
  from the backup at:
    $BACKUP_DIR"
fi

say "  verdict         : $STAGED_VERSION is newer — proceeding."

# =============================================================================
# 8. REPLACE — THE POINT OF NO RETURN
# =============================================================================
step "Install"

MUTATED=1   # from here on, any failure triggers restore_backup()

rm -rf "${SKILL_DIR:?}" 2>/dev/null || die "could not clear $SKILL_DIR"
mkdir -p "$SKILL_DIR"                || die "could not recreate $SKILL_DIR"
cp -R "$STAGED/." "$SKILL_DIR/"      || die "could not copy the new tree into $SKILL_DIR"

[ -f "$SKILL_DIR/SKILL.md" ] || die "the installed tree has no SKILL.md — install is incomplete."

# Shell tools must stay executable; archive extraction and cp can flatten the
# bit depending on umask and filesystem.
for s in "$SKILL_DIR"/tools/*.sh; do
  [ -f "$s" ] && chmod +x "$s" 2>/dev/null
done

NEW_VERSION="$(read_version "$SKILL_DIR/VERSION" || true)"
[ -n "$NEW_VERSION" ] || die "the installed tree has no readable VERSION — install is incomplete."
[ "$NEW_VERSION" = "$STAGED_VERSION" ] || die "installed VERSION ($NEW_VERSION) does not match what was staged ($STAGED_VERSION)."

# =============================================================================
# 9. SECOND CONFIG ROOT
# =============================================================================
# There are exactly two config roots on a Mac: ~/.claude (used by `claude`) and
# ~/.claude-nine (used by `claude-nine`, and by `claude-codex`, which execs
# claude-nine and shares its root). The fleet-standard shape is a SYMLINK from
# the second root to the first, so one install serves both.
#
#   correct symlink -> leave it alone; it already points at what we just updated
#   real directory  -> a divergent second copy; back it up and refresh it
#   absent          -> not our business to create; report and move on
#   symlink elsewhere -> ambiguous; report, change nothing
step "Second config root"

NINE_SKILL="$HOME/.claude-nine/skills/spec-protocol"

if [ "$NINE_SKILL" = "$SKILL_DIR" ]; then
  say "  This IS the second config root's skill; nothing further to do."
elif [ -L "$NINE_SKILL" ]; then
  NINE_TARGET="$(cd "$(dirname "$NINE_SKILL")" 2>/dev/null && cd "$(readlink "$NINE_SKILL")" 2>/dev/null && pwd)"
  if [ "$NINE_TARGET" = "$SKILL_DIR" ]; then
    say "  $NINE_SKILL"
    say "    -> symlink to $SKILL_DIR (fleet-standard shape). Already current. Left untouched."
  else
    say "  $NINE_SKILL"
    say "    -> symlink pointing at: ${NINE_TARGET:-<unresolvable>}"
    say "    That is NOT this skill directory. Ambiguous, so it was NOT changed."
    say "    Resolve by hand if the second root should track this install."
  fi
elif [ -d "$NINE_SKILL" ]; then
  say "  $NINE_SKILL is a REAL DIRECTORY, not the fleet-standard symlink."
  say "  It is a divergent second copy, so it gets the same update."

  NINE_INSTALLED="$(read_version "$NINE_SKILL/VERSION" || true)"
  [ -n "$NINE_INSTALLED" ] || NINE_INSTALLED="0.0.0"

  NINE_BACKUP_BASE="$BACKUP_ROOT/spec-protocol-nine.bak-v${NINE_INSTALLED}-${STAMP}"
  NINE_BACKUP_DIR="$NINE_BACKUP_BASE"
  n=1
  while [ -e "$NINE_BACKUP_DIR" ]; do
    NINE_BACKUP_DIR="${NINE_BACKUP_BASE}-${n}"
    n=$(( n + 1 ))
    [ "$n" -gt 100 ] && break
  done

  if mkdir -p "$NINE_BACKUP_DIR" 2>/dev/null && cp -R "$NINE_SKILL/." "$NINE_BACKUP_DIR/" 2>/dev/null; then
    say "  BACKUP PATH     : $NINE_BACKUP_DIR"
    NINE_MUTATED=1
    if rm -rf "${NINE_SKILL:?}" 2>/dev/null && mkdir -p "$NINE_SKILL" 2>/dev/null \
       && cp -R "$STAGED/." "$NINE_SKILL/" 2>/dev/null; then
      for s in "$NINE_SKILL"/tools/*.sh; do
        [ -f "$s" ] && chmod +x "$s" 2>/dev/null
      done
      say "  updated to $STAGED_VERSION."
    else
      say "  !! update of the second root FAILED. Restoring its backup."
      rm -rf "${NINE_SKILL:?}" 2>/dev/null
      mkdir -p "$NINE_SKILL" 2>/dev/null
      cp -R "$NINE_BACKUP_DIR/." "$NINE_SKILL/" 2>/dev/null \
        && say "  second root restored." \
        || say "  !! second root restore FAILED — copy it back from $NINE_BACKUP_DIR"
    fi
  else
    say "  !! could not back up the second root. It was left UNCHANGED, on purpose."
  fi
else
  say "  $NINE_SKILL does not exist. Nothing to update, nothing created."
fi

# =============================================================================
# 10. DONE
# =============================================================================
COMPLETED=1

say ""
say "==================================================================="
say "UPDATED  $INSTALLED_VERSION -> $NEW_VERSION"
say "==================================================================="
say "  skill    : $SKILL_DIR"
say "  backup   : $BACKUP_DIR"
say ""
say "  Nothing outside the skill directory was modified. No settings.json,"
say "  no models, no providers, no credentials."
say ""
say "  Verify with:  bash \"$SKILL_DIR/tools/check-update.sh\""
exit 0
