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

vercel_unprotect_previews() { # <repo root> — turn off Vercel Authentication on previews
  # PATCH /v9/projects/<projectId>[?teamId=<orgId>] {"ssoProtection":null}, ids read from
  # .vercel/project.json. The bearer header goes to curl on STDIN (-K -), never argv.
  # rc 0 on 2xx; else rc 1 with the reason in UNPROTECT_WHY.
  local tok ids pid org q code
  UNPROTECT_WHY=""
  tok="$(_vercel_token)"
  [[ -n "$tok" ]] || { UNPROTECT_WHY="no VERCEL_TOKEN to call the Vercel API with"; return 1; }
  ids="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["projectId"],d.get("orgId",""))' \
    "$1/.vercel/project.json" 2>/dev/null)" || { UNPROTECT_WHY="no readable .vercel/project.json"; return 1; }
  pid="${ids%% *}"; org="${ids#* }"
  q=""; [[ "$org" == team_* ]] && q="?teamId=$org"
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$tok" \
    | curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -K - -X PATCH \
        -H 'Content-Type: application/json' -d '{"ssoProtection":null}' \
        "https://api.vercel.com/v9/projects/$pid$q" 2>/dev/null)" || code=000
  [[ "$code" == 2?? ]] && return 0
  UNPROTECT_WHY="the project PATCH answered $code"; return 1
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
