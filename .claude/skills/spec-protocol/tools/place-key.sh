#!/usr/bin/env bash
# place-key.sh — file a credential from the CLIPBOARD into a key store, by
# NAME, without any person or model ever reading the value.
#
# Usage:
#   place-key.sh <NAME> <store-path>
#   place-key.sh --selftest
#
# THE FLOW THIS REPLACES. The skill used to hand a non-technical client a
# terminal chore ("open a NEW terminal window, paste this line, and swap the
# placeholder in it for your key") or, worse, ask them to paste the key into
# the chat. A pasted key lands in the transcript, in the session history, in
# every ledger the run writes, and possibly in a commit — and it cannot be
# un-leaked. The client-facing sentence is now one line, and this script does
# the rest:
#
#   "I need your <credential>. Copy it, then say ready, and I'll file it
#    without ever reading it out loud."
#
# WHAT THIS SCRIPT GUARANTEES
#   - The value is read from the clipboard into a shell variable and written to
#     the store with `printf` (a shell BUILTIN — the value never becomes an
#     argv entry of any process, so it is never visible in `ps`).
#   - The value is NEVER printed, echoed, logged, or returned. Every line this
#     script writes to stdout is a NAME, a PATH, or a status word. The selftest
#     proves it with a sentinel that must appear ZERO times in the output.
#   - The store line is REPLACED when the NAME is already there, APPENDED when
#     it is not — so re-running after a bad copy/paste cannot leave two lines
#     for one name, and cannot leave the stale one winning.
#   - The store is chmod 600 (POSIX platforms; see the Windows note below).
#   - Presence is then RE-DETECTED by NAME through `tools/env-sweep.sh` — the
#     same instrument the rest of the skill believes — and the only thing
#     printed is "present" or "absent".
#
# EXIT CODES
#   0 — placed, and the sweep re-detected it: present
#   2 — the clipboard is EMPTY (nothing was written; any existing line is left
#       exactly as it was — an empty clipboard must never erase a good key)
#   3 — placed, but the sweep still reports it absent, AND the sweep's own
#       selftest passed (so the instrument is sound and this is a real finding)
#   4 — precondition failure: bad NAME, a store the sweep does not read, no
#       clipboard instrument on this platform, or an unwritable store. Nothing
#       is read from the clipboard and nothing is written.
#   5 — UNDETERMINED: the sweep is missing, failed, its selftest failed, or it
#       has no report line covering this NAME. Never reported as "absent" —
#       a broken instrument is a fact about the checker, not about the client.
#
# WINDOWS / POWERSHELL NOTE. Under Git Bash (MINGW/MSYS/CYGWIN) this script
# runs as-is and reads the clipboard with `powershell.exe -NoProfile -Command
# Get-Clipboard`. Native PowerShell with NO Git Bash cannot run this file at
# all — it cannot run any of this skill's shell tools (references/platform.md
# §2) — and on that machine the placement is done by the client's own assistant
# with the PowerShell equivalent, in this exact order:
#
#   $k = Get-Clipboard
#   if ([string]::IsNullOrWhiteSpace($k)) { "clipboard empty"; exit 2 }
#   $p = Join-Path $env:USERPROFILE ".env"
#   $keep = @(); if (Test-Path $p) { $keep = Get-Content $p | Where-Object { $_ -notmatch '^\s*NAME=' } }
#   Set-Content -Path $p -Value ($keep + ("NAME=" + $k.Trim()))
#   icacls $p /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null   # no chmod on Windows
#   Remove-Variable k
#
# `NAME` is substituted for the real variable name; the value is never echoed,
# never interpolated into a command line, and the variable is removed at the
# end. The RE-DETECT half CANNOT run there — `env-sweep.sh` needs bash — so the
# verdict on a PowerShell-only box is UNDETERMINED with that reason named,
# never "absent", until Git Bash is installed (the E6 prerequisite).

set -o pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)"
SWEEP="${PLACE_KEY_SWEEP:-${SCRIPT_DIR}/env-sweep.sh}"

# --- The stores env-sweep.sh actually reads ----------------------------------
# ⛔ A placement target must be a file the CHECKER READS. Naming any other file
# guarantees the client does everything right and is still told the key is
# missing — a false negative that reads as their mistake. These three are the
# stores tools/env-sweep.sh loads (its own "Searched:" report line is the
# authority on any given box).
sweep_stores() {
  printf '%s\n' "${HOME}/.env" "${HOME}/.openclaw/secrets/.env" "${HOME}/.openclaw/.env"
}

# --- Absolute, symlink-resolved path for a file that need not exist yet ------
resolve_path() {
  local p="$1" d b
  case "${p}" in
    "~")   p="${HOME}" ;;
    "~/"*) p="${HOME}/${p#\~/}" ;;
  esac
  d="$(dirname "${p}")"
  b="$(basename "${p}")"
  if [ -d "${d}" ]; then
    d="$(cd "${d}" 2>/dev/null && pwd -P)" || return 1
  fi
  printf '%s/%s\n' "${d%/}" "${b}"
}

# --- Which env-sweep report line covers this NAME ----------------------------
# The alias lists are tools/env-sweep.sh's own, name for name. A NAME that is
# not here has NO report line, so its presence cannot be re-detected through
# the sweep — that is UNDETERMINED (exit 5), never "absent".
sweep_label_for_name() {
  case "$1" in
    GITHUB_TOKEN|GH_TOKEN|GITHUB_ACCESS_TOKEN) echo "GITHUB" ;;
    DEEPSEEK_API_KEY|DEEPSEEK_KEY|DEEPSEEK_DIRECT_API_KEY) echo "DEEPSEEK" ;;
    OLLAMA_API_KEY|OLLAMA_CLOUD_KEY|OLLAMA_KEY) echo "OLLAMA_CLOUD" ;;
    OPENROUTER_API_KEY|OPENROUTER_KEY|OPENROUTER_TOKEN) echo "OPENROUTER" ;;
    VERCEL_TOKEN|VERCEL_API_TOKEN|VERCEL_ACCESS_TOKEN) echo "VERCEL" ;;
    GOHIGHLEVEL_API_KEY|GHL_API_KEY|GOHIGHLEVEL_LOCATION_PIT|GHL_LOCATION_PIT|CAF_API_KEY|PIT_TOKEN|GHL_PIT|GOHIGHLEVEL_PIT|CONVERTANDFLOW_API_KEY|CONVERTANDFLOW_PIT|CONVERT_AND_FLOW_API_KEY) echo "GHL_PIT" ;;
    GOHIGHLEVEL_LOCATION_ID|GHL_LOCATION_ID|CAF_LOCATION_ID) echo "GHL_LOCATION_ID" ;;
    GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN|CAF_FIREBASE_REFRESH_TOKEN|GHL_FIREBASE_REFRESH_TOKEN|GOHIGHLEVEL_FIREBASE_TOKEN|GHL_FIREBASE_TOKEN) echo "GHL_FIREBASE" ;;
    KIE_API_KEY|KIE_AI_API_KEY|KIE_KEY) echo "KIE" ;;
    AGNES_AI_API_KEY|AGNES_API_KEY|AGNES_KEY) echo "AGNES" ;;
    *) return 1 ;;
  esac
}

# --- Choose the clipboard instrument -----------------------------------------
# SELECTION RUNS IN THE PARENT SHELL, on purpose. read_clipboard is called from
# a command substitution — a SUBSHELL — so anything it assigned would be lost
# on return, and the report would name no instrument at all. Selection sets the
# two facts the report needs (which instrument answered; which were tried), and
# read_clipboard then does nothing but run the chosen one.
CLIP_INSTRUMENT=""
CLIP_TRIED=""
select_clipboard_instrument() {
  local os
  # A test fixture stands in for the clipboard so the selftest can run
  # unattended and on a box with no GUI session. It is the ONLY way a value
  # enters this script other than the real clipboard.
  if [ -n "${PLACE_KEY_FIXTURE+x}" ]; then
    CLIP_INSTRUMENT="PLACE_KEY_FIXTURE"
    CLIP_TRIED="PLACE_KEY_FIXTURE"
    return 0
  fi
  os="$(uname -s 2>/dev/null)" || os=""
  case "${os}" in
    Darwin)
      CLIP_TRIED="pbpaste"
      command -v pbpaste >/dev/null 2>&1 && { CLIP_INSTRUMENT="pbpaste"; return 0; }
      ;;
    Linux)
      CLIP_TRIED="xclip -o -selection clipboard, wl-paste -n"
      command -v xclip    >/dev/null 2>&1 && { CLIP_INSTRUMENT="xclip";    return 0; }
      command -v wl-paste >/dev/null 2>&1 && { CLIP_INSTRUMENT="wl-paste"; return 0; }
      ;;
    MINGW*|MSYS*|CYGWIN*)
      CLIP_TRIED="powershell.exe Get-Clipboard, powershell Get-Clipboard"
      command -v powershell.exe >/dev/null 2>&1 && { CLIP_INSTRUMENT="powershell.exe Get-Clipboard"; return 0; }
      command -v powershell     >/dev/null 2>&1 && { CLIP_INSTRUMENT="powershell Get-Clipboard";     return 0; }
      ;;
    *)
      CLIP_TRIED="none — uname -s printed '${os}', which this script has no clipboard instrument for"
      ;;
  esac
  return 1
}

# --- Read the clipboard ------------------------------------------------------
# Prints the raw clipboard on stdout for capture by a command substitution.
read_clipboard() {
  case "${CLIP_INSTRUMENT}" in
    PLACE_KEY_FIXTURE)            printf '%s' "${PLACE_KEY_FIXTURE}" ;;
    pbpaste)                      pbpaste ;;
    xclip)                        xclip -o -selection clipboard 2>/dev/null ;;
    wl-paste)                     wl-paste -n 2>/dev/null ;;
    "powershell.exe Get-Clipboard") powershell.exe -NoProfile -Command Get-Clipboard 2>/dev/null ;;
    "powershell Get-Clipboard")     powershell -NoProfile -Command Get-Clipboard 2>/dev/null ;;
    *) return 1 ;;
  esac
}

# --- Trim to the single line a credential is ---------------------------------
# Takes the first line, drops a trailing CR (a Get-Clipboard value arrives
# CRLF-terminated), and strips surrounding whitespace. The value is only ever
# handled here and in the write; it is never printed.
trim_value() {
  local v="$1"
  v="${v%%$'\n'*}"
  v="${v%$'\r'}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "${v}"
}

usage() {
  echo "Usage: place-key.sh <NAME> <store-path>" >&2
  echo "       place-key.sh --selftest" >&2
}

# --- The placement -----------------------------------------------------------
place_key() {
  local name="$1" store_arg="$2"
  local store raw value tmp grep_rc write_mode label sweep_out sweep_rc status

  if [ -z "${name}" ] || [ -z "${store_arg}" ]; then
    usage
    return 4
  fi

  # NAME must be a shell variable name — it becomes the left-hand side of an
  # assignment line, and it is the thing the sweep looks for.
  case "${name}" in
    [A-Za-z_]*) ;;
    *) echo "REFUSED: '${name}' is not a valid environment variable name (must match ^[A-Za-z_][A-Za-z0-9_]*$)" >&2; return 4 ;;
  esac
  if printf '%s' "${name}" | /usr/bin/grep -qv '^[A-Za-z_][A-Za-z0-9_]*$'; then
    echo "REFUSED: '${name}' is not a valid environment variable name (must match ^[A-Za-z_][A-Za-z0-9_]*$)" >&2
    return 4
  fi

  store="$(resolve_path "${store_arg}")" || {
    echo "REFUSED: could not resolve the store path '${store_arg}'" >&2
    return 4
  }

  # The store must be one the sweep reads. Checked BEFORE the clipboard is
  # touched, so a refusal costs the client nothing and the key is never written
  # somewhere the re-detect cannot see.
  local ok=1 candidate
  while IFS= read -r candidate; do
    [ "$(resolve_path "${candidate}")" = "${store}" ] && ok=0
  done <<EOF
$(sweep_stores)
EOF
  if [ "${ok}" -ne 0 ]; then
    {
      echo "REFUSED: ${store} is not a store tools/env-sweep.sh reads, so a key filed there could never be re-detected."
      echo "Stores it reads on this box:"
      sweep_stores | sed 's/^/  /'
      echo "Never create ~/.openclaw/ to hold a key on a box that has no OpenClaw — on a non-fleet box the target is ~/.env."
    } >&2
    return 4
  fi

  if [ -e "${store}" ] && [ ! -w "${store}" ]; then
    echo "REFUSED: ${store} exists but is not writable by this user." >&2
    return 4
  fi
  if [ ! -e "${store}" ] && [ ! -w "$(dirname "${store}")" ]; then
    echo "REFUSED: $(dirname "${store}") is not writable, so ${store} cannot be created." >&2
    return 4
  fi

  # --- Read the clipboard. Nothing is written before this succeeds.
  if ! select_clipboard_instrument; then
    {
      echo "UNDETERMINED: no clipboard instrument answered on this platform."
      echo "Tried: ${CLIP_TRIED:-nothing}"
      echo "This is a statement about this machine's tools, not about the client's key."
    } >&2
    return 4
  fi
  raw="$(read_clipboard)" || {
    {
      echo "UNDETERMINED: ${CLIP_INSTRUMENT} failed to run."
      echo "This is a statement about this machine's tools, not about the client's key."
    } >&2
    return 4
  }
  value="$(trim_value "${raw}")"
  raw=""
  if [ -z "${value}" ]; then
    echo "NAME: ${name}"
    echo "CLIPBOARD: EMPTY (read via ${CLIP_INSTRUMENT})"
    echo "WRITE: none — nothing was changed in ${store}"
    echo "Ask them to copy the key again, then say ready."
    return 2
  fi

  # --- Write: replace the NAME's line if present, append it if not.
  # grep is given the NAME, never the value. rc 1 means "every line filtered
  # out", which is a legitimate empty result here; rc >= 2 is a real error.
  write_mode="appended"
  tmp="$(mktemp "${store}.place-key.XXXXXX")" || {
    echo "REFUSED: could not create a temporary file beside ${store}" >&2
    return 4
  }
  if [ -f "${store}" ]; then
    if /usr/bin/grep -qE "^[[:space:]]*(export[[:space:]]+)?${name}=" "${store}"; then
      write_mode="replaced"
    fi
    grep_rc=0
    /usr/bin/grep -vE "^[[:space:]]*(export[[:space:]]+)?${name}=" "${store}" > "${tmp}" || grep_rc=$?
    if [ "${grep_rc}" -ge 2 ]; then
      rm -f "${tmp}"
      echo "REFUSED: could not read ${store} to rewrite it (grep exit ${grep_rc}). Nothing was changed." >&2
      return 4
    fi
  fi
  # printf is a shell builtin: the value never becomes an argv entry, so it is
  # never visible in the process table.
  printf '%s=%s\n' "${name}" "${value}" >> "${tmp}" || {
    rm -f "${tmp}"
    echo "REFUSED: could not write the new line. Nothing was changed in ${store}." >&2
    return 4
  }
  value=""
  chmod 600 "${tmp}" 2>/dev/null
  mv -f "${tmp}" "${store}" || {
    rm -f "${tmp}"
    echo "REFUSED: could not move the new store into place. ${store} is unchanged." >&2
    return 4
  }
  chmod 600 "${store}" 2>/dev/null

  echo "NAME: ${name}"
  echo "STORE: ${store}"
  echo "CLIPBOARD: read via ${CLIP_INSTRUMENT} (the value was never printed)"
  echo "WRITE: ${write_mode}"
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      echo "MODE: PLATFORM-SKIP — Windows has no POSIX modes; restrict with: icacls \"${store}\" /inheritance:r /grant:r \"%USERNAME%:(R,W)\"" ;;
    *)
      echo "MODE: $(ls -l "${store}" 2>/dev/null | cut -c1-10)" ;;
  esac

  # --- Re-detect by NAME through the sweep. Present / absent, nothing else.
  label="$(sweep_label_for_name "${name}")" || {
    echo "RE-DETECT: UNDETERMINED — tools/env-sweep.sh has no report line covering ${name}, so its presence cannot be re-detected through the instrument this skill believes. The line was written to ${store}; verify by name with whatever reads that store."
    return 5
  }
  if [ ! -f "${SWEEP}" ]; then
    echo "RE-DETECT: UNDETERMINED — the sweep was not found at ${SWEEP}. This is a fact about the checker, not about the key."
    return 5
  fi
  sweep_rc=0
  sweep_out="$(SWEEP_NO_NETWORK=1 bash "${SWEEP}" --target funnel 2>&1)" || sweep_rc=$?
  if [ "${sweep_rc}" -ne 0 ]; then
    echo "RE-DETECT: UNDETERMINED — the sweep exited ${sweep_rc}. A checker that failed to run says nothing about the key."
    return 5
  fi
  status="$(printf '%s\n' "${sweep_out}" | /usr/bin/grep -E "^${label}: " | head -1 | sed "s/^${label}: //")"
  if [ -z "${status}" ]; then
    echo "RE-DETECT: UNDETERMINED — the sweep printed no ${label} line."
    return 5
  fi
  if [ "${status}" != "MISSING" ]; then
    echo "RE-DETECT: present (sweep report line ${label})"
    return 0
  fi

  # An absence is a CLAIM, so it carries a claim's burden: run the sweep's own
  # selftest as the control before saying "absent". If the control fails, the
  # instrument is broken and that is what gets reported.
  local control_rc=0
  bash "${SWEEP}" --selftest >/dev/null 2>&1 || control_rc=$?
  if [ "${control_rc}" -ne 0 ]; then
    echo "RE-DETECT: UNDETERMINED — the sweep reported ${label} MISSING, but its own selftest FAILED (exit ${control_rc}). A broken checker is never evidence about the client's key."
    return 5
  fi
  {
    echo "RE-DETECT: absent (sweep report line ${label}); the sweep's selftest PASSED, so the instrument is sound"
    echo "  written to: ${store} (line begins ${name}=)"
    echo "  stores the sweep reads:"
    sweep_stores | sed 's/^/    /'
    echo "  NOT read by the sweep, by design: shell rc files (.zshrc/.bashrc/.profile), project .env and .env.local"
    echo "  likeliest cause: another store later in precedence carries the same NAME with an empty value"
  }
  return 3
}

# --- Selftest ----------------------------------------------------------------
# Runs the REAL script as a child in a sandbox HOME, with a fixture standing in
# for the clipboard. Proves: the line lands, the value never appears in the
# output, a repeat placement REPLACES rather than duplicates, an empty
# clipboard exits 2 and changes NOTHING, the store ends at mode 600, and both
# precondition refusals fire before anything is read or written.
run_selftest() {
  local self="$1"
  local sandbox sentinel sentinel2 fails=0
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/place-key-selftest.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create sandbox HOME" >&2
    return 1
  }
  sentinel="SENTINEL-CLIP-VALUE-4b71e0c5-DO-NOT-PRINT"
  sentinel2="SENTINEL-CLIP-SECOND-9d02aa13-DO-NOT-PRINT"

  echo "SELFTEST — place-key.sh"
  echo "  sandbox HOME: ${sandbox}"
  echo

  local store="${sandbox}/.env"
  local out1 rc1 out2 rc2 out3 rc3 out4 rc4 out5 rc5

  # --- Run 1: the happy path.
  out1="$(env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      PLACE_KEY_FIXTURE="${sentinel}" \
      bash "${self}" KIE_API_KEY "${store}" 2>&1)"
  rc1=$?

  # --- Run 2: the same NAME again with a DIFFERENT value — must REPLACE.
  out2="$(env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      PLACE_KEY_FIXTURE="${sentinel2}" \
      bash "${self}" KIE_API_KEY "${store}" 2>&1)"
  rc2=$?

  # --- Run 3: an EMPTY clipboard — must exit 2 and change nothing.
  out3="$(env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      PLACE_KEY_FIXTURE="   " \
      bash "${self}" KIE_API_KEY "${store}" 2>&1)"
  rc3=$?

  # --- Run 4: a store the sweep does not read — refused before the clipboard.
  out4="$(env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      PLACE_KEY_FIXTURE="${sentinel}" \
      bash "${self}" KIE_API_KEY "${sandbox}/not-a-store.env" 2>&1)"
  rc4=$?

  # --- Run 5: an invalid NAME.
  out5="$(env -i HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      PLACE_KEY_FIXTURE="${sentinel}" \
      bash "${self}" "9BAD NAME" "${store}" 2>&1)"
  rc5=$?

  # --- Check 1: the happy path placed the key and the sweep saw it, and the
  # report NAMES the instrument that read the clipboard. That last clause is
  # not cosmetic: instrument selection used to happen inside the command
  # substitution that reads the clipboard — a subshell — so the name was lost
  # on return and every report said "read via " with nothing after it. An
  # unnamed instrument cannot be re-run by a reader, which is exactly what
  # RULE 2 requires of every source.
  if [ "${rc1}" -eq 0 ] \
     && printf '%s\n' "${out1}" | /usr/bin/grep -q '^RE-DETECT: present' \
     && printf '%s\n' "${out1}" | /usr/bin/grep -q '^CLIPBOARD: read via PLACE_KEY_FIXTURE '; then
    echo "  [PASS] placement: exit 0, the sweep re-detected KIE_API_KEY as present, and the report names the instrument that read the clipboard"
  else
    echo "  [FAIL] placement: exit ${rc1}; expected 0 with 'RE-DETECT: present' and a named CLIPBOARD instrument"
    fails=$((fails + 1))
  fi

  # --- Check 2: the store carries exactly the fixture value.
  # Compared line-by-line in the shell — never grepped with the value on a
  # command line, and never printed.
  local line found_first=0 found_second=0 name_lines=0
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      KIE_API_KEY=*) name_lines=$((name_lines + 1)) ;;
    esac
    [ "${line}" = "KIE_API_KEY=${sentinel}" ] && found_first=1
    [ "${line}" = "KIE_API_KEY=${sentinel2}" ] && found_second=1
  done < "${store}"
  if [ "${found_first}" -eq 0 ] && [ "${found_second}" -eq 1 ] && [ "${name_lines}" -eq 1 ]; then
    echo "  [PASS] store content: exactly ONE KIE_API_KEY line, carrying the SECOND value — the second placement replaced the first, it did not duplicate or lose it"
  else
    echo "  [FAIL] store content: ${name_lines} KIE_API_KEY line(s); first-value present=${found_first} second-value present=${found_second} (want 0 and 1)"
    fails=$((fails + 1))
  fi

  # --- Check 3: the replace run reported itself as a replace.
  if [ "${rc2}" -eq 0 ] && printf '%s\n' "${out2}" | /usr/bin/grep -q '^WRITE: replaced'; then
    echo "  [PASS] replace semantics: the second run reported WRITE: replaced"
  else
    echo "  [FAIL] replace semantics: exit ${rc2}; expected 0 with 'WRITE: replaced'"
    fails=$((fails + 1))
  fi

  # --- Check 4: THE LEAK PROOF. No run may print either value.
  local leaks
  leaks="$(printf '%s\n%s\n%s\n%s\n%s\n' "${out1}" "${out2}" "${out3}" "${out4}" "${out5}" \
      | /usr/bin/grep -cE "${sentinel}|${sentinel2}")"
  if [ "${leaks}" -eq 0 ]; then
    echo "  [PASS] leak proof: 0 clipboard values printed across all five runs"
  else
    echo "  [FAIL] leak proof: a clipboard VALUE appeared in the output ${leaks} time(s)"
    fails=$((fails + 1))
  fi

  # --- Check 5: an empty clipboard exits 2 and leaves the store alone.
  local still_there=0
  while IFS= read -r line || [ -n "${line}" ]; do
    [ "${line}" = "KIE_API_KEY=${sentinel2}" ] && still_there=1
  done < "${store}"
  if [ "${rc3}" -eq 2 ] && [ "${still_there}" -eq 1 ]; then
    echo "  [PASS] empty clipboard: exit 2 and the existing key line is untouched — an empty clipboard never erases a good key"
  else
    echo "  [FAIL] empty clipboard: exit ${rc3} (want 2); existing line survived=${still_there} (want 1)"
    fails=$((fails + 1))
  fi

  # --- Check 6: the store is mode 600.
  local mode
  mode="$(ls -l "${store}" | cut -c1-10)"
  if [ "${mode}" = "-rw-------" ]; then
    echo "  [PASS] permissions: the store is ${mode}"
  else
    echo "  [FAIL] permissions: the store is ${mode}, expected -rw-------"
    fails=$((fails + 1))
  fi

  # --- Check 7: both precondition refusals fire, and neither writes anything.
  if [ "${rc4}" -eq 4 ] && [ ! -e "${sandbox}/not-a-store.env" ] && [ "${rc5}" -eq 4 ]; then
    echo "  [PASS] preconditions: an unswept store exits 4 and creates no file; an invalid NAME exits 4"
  else
    echo "  [FAIL] preconditions: unswept-store exit ${rc4} (want 4), file created=$([ -e "${sandbox}/not-a-store.env" ] && echo yes || echo no) (want no), invalid-name exit ${rc5} (want 4)"
    fails=$((fails + 1))
  fi

  rm -rf "${sandbox}"
  echo
  if [ "${fails}" -eq 0 ]; then
    echo "SELFTEST: PASS (7/7) — key filed, re-detected by name, 0 values printed"
    return 0
  fi
  echo "SELFTEST: FAIL (${fails} check(s) failed)"
  return 1
}

case "${1:-}" in
  --selftest)
    run_selftest "${BASH_SOURCE[0]}"
    exit $?
    ;;
  -h|--help|"")
    usage
    exit 4
    ;;
esac

place_key "$1" "$2"
exit $?
