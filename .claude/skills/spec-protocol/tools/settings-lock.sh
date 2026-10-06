#!/usr/bin/env bash
# settings-lock.sh — SOURCE this; it never runs anything by itself. Lock-aware writes for a Claude Code settings.json.
# One identical copy lives in each skill that writes a settings file (nine-router-setup/scripts/common,
# spec-protocol/tools); tests/test-settings-lock.sh fails when the copies differ.
#
#   sl_unlock FILE ...   for each FILE that is locked (macOS uchg, Linux chattr +i, or read-only): unlock it, remember it,
#                        print ONE line, and arrange for it to be re-locked when this shell exits (EXIT/INT/TERM/HUP, even on
#                        failure). Returns 1 when a lock cannot be cleared (the caller must not write that file).
#   sl_relock_all        re-lock everything sl_unlock opened (also runs by itself at exit). Warns when the file is no longer
#                        valid JSON but still re-locks it. A file that was never locked is never locked.
#   sl_unflag FILE       clear a lock flag a `cp -p` backup inherited from a locked file.
#   sl_guard FILE cmd..  sl_unlock FILE; run cmd; sl_relock_all; return cmd's status.
# Default for a box is NO lock; the owner opts in with Hook Skill's --lock-settings.
_SL_OPEN=""      # newline list of "kind<TAB>file" opened by sl_unlock
_SL_TRAPPED=0

_sl_kind() {     # prints uchg | immutable | readonly | (nothing)
  local f="$1" fl
  [ -e "$f" ] || return 0
  if [ "$(uname -s)" = "Darwin" ]; then
    fl="$(/usr/bin/stat -f %Sf "$f" 2>/dev/null)"
    case ",$fl," in *,uchg,*|*,schg,*) echo uchg; return 0 ;; esac
  elif command -v lsattr >/dev/null 2>&1; then
    fl="$(lsattr -d "$f" 2>/dev/null | awk '{print $1}')"
    case "$fl" in *i*) echo immutable; return 0 ;; esac
  fi
  if [ "$(id -u)" = "0" ]; then
    if [ -z "$(find "$f" -maxdepth 0 -perm -u+w 2>/dev/null)" ]; then echo readonly; fi
  elif [ ! -w "$f" ]; then
    echo readonly
  fi
  return 0
}

_sl_apply() {    # kind file -> lock it
  case "$1" in
    uchg) chflags uchg "$2" ;;
    immutable) chattr +i "$2" ;;
    readonly) chmod a-w "$2" ;;
  esac
}

sl_unlock() {
  local f k
  for f in "$@"; do
    k="$(_sl_kind "$f")"
    [ -n "$k" ] || continue
    case "$k" in
      uchg) chflags nouchg "$f" 2>/dev/null ;;
      immutable) chattr -i "$f" 2>/dev/null ;;
      readonly) chmod u+w "$f" 2>/dev/null ;;
    esac
    if [ -n "$(_sl_kind "$f")" ]; then
      echo "settings-lock: $f is locked ($k) and could not be unlocked; NOT writing it. Unlock it yourself, then re-run." >&2
      return 1
    fi
    _SL_OPEN="${_SL_OPEN}${k}	${f}
"
    echo "settings-lock: $f was locked ($k); unlocked for this write and re-locked after"
  done
  if [ "$_SL_TRAPPED" = 0 ] && [ -n "$_SL_OPEN" ]; then
    _SL_TRAPPED=1
    local tf prev=""
    tf="$(mktemp "${TMPDIR:-/tmp}/sl-trap.XXXXXX")" || tf=""
    if [ -n "$tf" ]; then
      trap -p EXIT > "$tf" 2>/dev/null   # chain, never replace, an EXIT trap the caller already set
      if [ -s "$tf" ]; then eval "set -- $(cat "$tf")"; prev="${3:-}"; fi
      rm -f "$tf"
    fi
    _SL_PREV_EXIT="$prev"
    trap '_sl_on_exit' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
  fi
  return 0
}

_sl_on_exit() {
  local rc=$?
  sl_relock_all
  if [ -n "${_SL_PREV_EXIT:-}" ]; then eval "$_SL_PREV_EXIT"; fi
  return $rc
}

sl_relock_all() {
  local line k f ok
  [ -n "$_SL_OPEN" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    k="${line%%	*}"; f="${line#*	}"
    if [ -f "$f" ]; then
      ok=0
      if command -v python3 >/dev/null 2>&1; then python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$f" 2>/dev/null && ok=1
      elif command -v node >/dev/null 2>&1; then node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" 2>/dev/null && ok=1
      else ok=1; fi
      [ "$ok" = 1 ] || echo "settings-lock: WARNING $f is not valid JSON after the write (re-locking anyway)" >&2
      _sl_apply "$k" "$f" 2>/dev/null || echo "settings-lock: WARNING could not re-lock $f. Re-lock it yourself." >&2
    fi
  done <<EOF
$_SL_OPEN
EOF
  _SL_OPEN=""
}

# sl_unflag FILE — a backup made with `cp -p` of a locked file inherits the macOS lock flag, which would make the backup
# undeletable. Call it right after such a copy.
sl_unflag() {
  if [ "$(uname -s)" = "Darwin" ]; then chflags nouchg "$1" 2>/dev/null || true; fi
  return 0
}

sl_guard() {
  local f="$1" rc=0
  shift
  sl_unlock "$f" || return 1
  "$@" || rc=$?
  sl_relock_all
  return $rc
}
