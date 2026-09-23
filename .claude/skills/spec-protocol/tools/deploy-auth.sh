# deploy-auth.sh — SOURCED by publish.sh and provision-db.sh; not run on its own.
#
# Finds the Vercel CLI and the operator's Vercel credential, and runs the CLI
# with that credential in THAT CHILD'S environment only.
#
#   vercel_resolve            sets VERCEL_CMD (an array); rc 1 when nothing can run it
#   vercel_run <args...>      runs "${VERCEL_CMD[@]}" <args...> with VERCEL_TOKEN set
#                             for that one process when a credential exists
#   VERCEL_WHERE              after vercel_resolve: which source was used (for reports)
#
# CLI, first that exists: $<seam var> (tests) -> `vercel` on PATH ->
#   ${NINE_ROUTER_NPM_PREFIX:-~/.local/share/999/npm}/bin/vercel -> ~/.npm-global/bin/vercel
#   -> `npx --yes vercel@latest`.
# Credential: VERCEL_TOKEN in the environment, else the VERCEL_TOKEN=... line of
#   ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env — PARSED, never
#   sourced, never printed, never put on a command line (argv is visible in `ps`).
#   None found: the CLI runs with whatever `vercel login` left on this machine.

VERCEL_CMD=()
VERCEL_WHERE=""

vercel_resolve() { # vercel_resolve [seam-value]
  local c p
  if [[ -n "${1:-}" ]]; then VERCEL_CMD=("$1"); VERCEL_WHERE="seam"; return 0; fi
  if c="$(command -v vercel 2>/dev/null)" && [[ -n "$c" ]]; then
    VERCEL_CMD=("$c"); VERCEL_WHERE="PATH"; return 0
  fi
  for p in "${NINE_ROUTER_NPM_PREFIX:-$HOME/.local/share/999/npm}/bin/vercel" "$HOME/.npm-global/bin/vercel"; do
    if [[ -x "$p" ]]; then VERCEL_CMD=("$p"); VERCEL_WHERE="$p"; return 0; fi
  done
  if c="$(command -v npx 2>/dev/null)" && [[ -n "$c" ]]; then
    VERCEL_CMD=("$c" --yes vercel@latest); VERCEL_WHERE="npx"; return 0
  fi
  return 1
}

_vercel_token() { # prints the credential into a command substitution only
  local f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env" v
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then printf '%s' "$VERCEL_TOKEN"; return 0; fi
  [[ -r "$f" ]] || return 0
  v="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?VERCEL_TOKEN[[:space:]]*=[[:space:]]*//p' "$f" | tail -n 1 | tr -d '\r')"
  v="${v%%[[:space:]]*}"; v="${v#[\"\']}"; v="${v%[\"\']}"
  printf '%s' "$v"
}

vercel_run() { # vercel_run <args...> — output is the CLI's, with the credential masked
  local tok out rc
  tok="$(_vercel_token)"
  if [[ -n "$tok" ]]; then
    out="$(VERCEL_TOKEN="$tok" "${VERCEL_CMD[@]}" "$@" 2>&1)"; rc=$?
    out="${out//"$tok"/***}"
  else
    out="$("${VERCEL_CMD[@]}" "$@" 2>&1)"; rc=$?
  fi
  printf '%s\n' "$out"
  return "$rc"
}
