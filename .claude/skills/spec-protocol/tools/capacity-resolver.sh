#!/usr/bin/env bash
# capacity-resolver.sh — map the capacity interview answers to numbers
# Usage: capacity-resolver.sh <answers-file>
#        capacity-resolver.sh --selftest
#
# <answers-file> is a simple KEY=VALUE file written by the orchestrator
# after the capacity interview, containing the plain answers:
#
#   HARNESS=claude-nine|regular            (required)
#   LAUNCHER=claude|claude-nine|claude-codex   (optional; derived from HARNESS)
#   BUILDER_PROVIDER=anthropic|deepseek-direct|deepseek-ollama|ollama-cloud|agnes|openrouter
#   DEEPSEEK_TIER=flash|pro               (when provider is deepseek-direct; default flash)
#   OLLAMA_PLAN=20|100                    (when provider is ollama-cloud)
#   AGNES_PLAN=free|40|100                (when provider is agnes)
#   THROTTLE=full|gentle                  (default full for deepseek-direct, gentle otherwise)
#   RESERVE_PCT=<number>                  (Law 44 — default 25)
#   MODE=team|single                      (default single — Agent Teams off until probed + consented)
#   COMMANDERS=<n>                        (default 4 when MODE=team: BUILD, VISUAL QA, TECHNICAL QA, RELEASE/INTEGRATION)
#   CORES=<n>                             (default: MEASURED at run time — never inherited)
#   PROJECT=<name>                        (cosmetic — names the ledger)
#   ROLE_BUILDER=<alias>→<resolved model>  (and ROLE_RESEARCHER / ROLE_VISUAL /
#                                          ROLE_TECHNICAL / ROLE_SECURITY / ROLE_RELEASE —
#                                          the three-hop resolution is read from the LIVE
#                                          config by the conductor; this script only RECORDS it)
#
# Prints a Capacity Ledger card carrying the same fields as the Capacity
# Ledger template, so the conductor can paste it straight into
# <project>/CAPACITY-LEDGER.md. This is the mechanical half of the capacity
# interview; the skill presents the results in plain English.
#
# THE THREE AXES, NEVER CONFLATED:
#   AXIS 1 WIDTH  — per-workflow concurrency = min(16, cores−2), cores MEASURED
#                   at run time; hard ceiling of 30 workflows per session.
#   AXIS 2 BUDGET — how many agents run EVER this session (1,000 per session);
#                   a decrementing count, never a simultaneity limit.
#   AXIS 3 POLICY — the operator cap (20 concurrent agents per wave on
#                   Anthropic-billed Claude Code) and the provider ceiling
#                   minus its reserve.
# The wave width is the SMALLEST of the three; this script shows all three
# with the winner marked.
#
# The concurrency numbers below are Trevor's live-account DOCTRINE and stay
# (see references/capacity.md). They are NOT to be web-researched away —
# except the Agnes figures, which are VERIFY-LIVE: web-research the current
# rules at run time and fall back to these only when research fails,
# recording which source was used.

set -u

WORKFLOW_CEILING=30          # Trevor's explicit rule: 30 workflows per session, hard
OPERATOR_WAVE_CAP=20         # standing operator doctrine, Anthropic-billed Claude Code
SESSION_AGENT_BUDGET=1000    # CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION — a LIFETIME COUNT
GAUNTLET_EXPECTED=52         # 8+16+16+8+4 — expected initial gauntlet run
GAUNTLET_SOFT_LOW=75         # normal complete project 75–125
GAUNTLET_SOFT_HIGH=125
GAUNTLET_REVIEW=150          # at 150: analyze whether measurable progress still occurs
GAUNTLET_HARD_STOP=200       # HARD STOP — preserve the best stable build, blocker report
REPAIR_WAVE_CAP=12           # selective repair: N = failed workstreams, one repairer each, ≤12/wave

# --- Measure cores. Never inherit a number. -----------------------------------
measure_cores() {
  local n=""
  if command -v sysctl >/dev/null 2>&1; then
    n="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi
  if [[ -z "${n}" ]] && command -v nproc >/dev/null 2>&1; then
    n="$(nproc 2>/dev/null || true)"
  fi
  if [[ -z "${n}" ]]; then
    echo ""    # UNDETERMINED is a correct answer — the caller must ask
    return 1
  fi
  echo "${n}"
}

per_workflow_width() {
  local cores="$1" w
  w=$(( cores - 2 ))
  if (( w > 16 )); then w=16; fi
  if (( w < 1 )); then w=1; fi
  echo "${w}"
}

# =============================================================================
# THE RESOLVER
# =============================================================================
resolve() {
  local ANSWERS="$1"

  if [[ ! -f "${ANSWERS}" ]]; then
    echo "ERROR: answers file not found: ${ANSWERS}" >&2
    return 2
  fi

  HARNESS=""; LAUNCHER=""; BUILDER_PROVIDER=""; DEEPSEEK_TIER=""
  OLLAMA_PLAN=""; AGNES_PLAN=""; THROTTLE=""; RESERVE_PCT=""
  MODE=""; COMMANDERS=""; CORES=""; PROJECT=""
  ROLE_BUILDER=""; ROLE_RESEARCHER=""; ROLE_VISUAL=""
  ROLE_TECHNICAL=""; ROLE_SECURITY=""; ROLE_RELEASE=""

  while IFS='=' read -r k v; do
    [[ -z "${k}" ]] && continue
    case "${k}" in
      \#*) continue ;;
      HARNESS) HARNESS="${v}" ;;
      LAUNCHER) LAUNCHER="${v}" ;;
      BUILDER_PROVIDER) BUILDER_PROVIDER="${v}" ;;
      DEEPSEEK_TIER) DEEPSEEK_TIER="${v}" ;;
      OLLAMA_PLAN) OLLAMA_PLAN="${v}" ;;
      AGNES_PLAN) AGNES_PLAN="${v}" ;;
      THROTTLE) THROTTLE="${v}" ;;
      RESERVE_PCT) RESERVE_PCT="${v}" ;;
      MODE) MODE="${v}" ;;
      COMMANDERS) COMMANDERS="${v}" ;;
      CORES) CORES="${v}" ;;
      PROJECT) PROJECT="${v}" ;;
      ROLE_BUILDER) ROLE_BUILDER="${v}" ;;
      ROLE_RESEARCHER) ROLE_RESEARCHER="${v}" ;;
      ROLE_VISUAL) ROLE_VISUAL="${v}" ;;
      ROLE_TECHNICAL) ROLE_TECHNICAL="${v}" ;;
      ROLE_SECURITY) ROLE_SECURITY="${v}" ;;
      ROLE_RELEASE) ROLE_RELEASE="${v}" ;;
    esac
  done < "${ANSWERS}"

  if [[ "${HARNESS}" != "claude-nine" && "${HARNESS}" != "regular" ]]; then
    echo "ERROR: HARNESS must be claude-nine or regular (got: ${HARNESS})" >&2
    return 2
  fi

  [[ -z "${PROJECT}" ]] && PROJECT="<project>"
  [[ -z "${MODE}" ]] && MODE="single"
  if [[ "${MODE}" != "team" && "${MODE}" != "single" ]]; then
    echo "ERROR: MODE must be team or single (got: ${MODE})" >&2
    return 2
  fi
  if [[ "${MODE}" == "team" ]]; then
    [[ -z "${COMMANDERS}" ]] && COMMANDERS=4
  else
    COMMANDERS=0
  fi
  [[ -z "${BUILDER_PROVIDER}" ]] && BUILDER_PROVIDER="anthropic"
  [[ -z "${LAUNCHER}" ]] && { if [[ "${HARNESS}" == "regular" ]]; then LAUNCHER="claude"; else LAUNCHER="claude-nine"; fi; }
  [[ -z "${RESERVE_PCT}" ]] && RESERVE_PCT=25

  # --- AXIS 1: WIDTH ---------------------------------------------------------
  local cores_source="MEASURED"
  if [[ -z "${CORES}" ]]; then
    CORES="$(measure_cores)" || true
    if [[ -z "${CORES}" ]]; then
      echo "ERROR: could not measure cores (sysctl/nproc both unavailable)." >&2
      echo "       UNDETERMINED — ASK the operator for the core count and rerun" >&2
      echo "       with CORES=<n> in the answers file. Never assume a width." >&2
      return 3
    fi
  else
    cores_source="SUPPLIED"
  fi
  local PER_WORKFLOW HARNESS_MAX
  PER_WORKFLOW="$(per_workflow_width "${CORES}")"
  HARNESS_MAX=$(( WORKFLOW_CEILING * PER_WORKFLOW ))

  # --- AXIS 3: POLICY — the provider ceiling minus its reserve ---------------
  # Provider ceilings are the CANON BLOCK's numbers, copied verbatim.
  local PROVIDER_CEILING=0 PROVIDER_USABLE=0 PROVIDER_LABEL="" PROVIDER_APPLIES=1
  local REQUEST_BUDGET="not window-metered — governed by rate-limit responses; on 429/limit → park-and-resume (Loop 6), never retry-hammer"
  local BURN_GOVERNOR=""
  local PROVIDER_NOTE=""
  case "${BUILDER_PROVIDER}" in
    anthropic)
      PROVIDER_APPLIES=0
      PROVIDER_LABEL="Anthropic subscription (window-metered, opaque — the runtime rate-limit response is the meter)"
      BURN_GOVERNOR="subscription; watch for 429/limit responses; commanders counted at full session rate (pessimistic shared bucket)"
      ;;
    deepseek-direct)
      [[ -z "${DEEPSEEK_TIER}" ]] && DEEPSEEK_TIER="flash"
      case "${DEEPSEEK_TIER}" in
        flash)
          PROVIDER_CEILING=2500
          PROVIDER_LABEL="DeepSeek v4 Flash, direct (9Router) — 2,500 concurrent subagents"
          ;;
        pro)
          PROVIDER_CEILING=500
          PROVIDER_LABEL="DeepSeek v4 Pro, direct (9Router) — 500 concurrent subagents"
          ;;
        *)
          echo "ERROR: DEEPSEEK_TIER must be flash or pro (got: ${DEEPSEEK_TIER})" >&2
          return 2
          ;;
      esac
      PROVIDER_USABLE=$(( PROVIDER_CEILING - (PROVIDER_CEILING * RESERVE_PCT / 100) ))
      BURN_GOVERNOR="pay-per-token — pre-run balance check + a rough estimate, stated plainly as a rough estimate, not a final number"
      ;;
    deepseek-ollama)
      PROVIDER_CEILING=10
      PROVIDER_USABLE=8
      PROVIDER_LABEL="DeepSeek via Ollama Cloud — NEVER the builder (behind version)"
      PROVIDER_NOTE="DeepSeek via Ollama Cloud is never the builder — it is behind version. Re-ask the provider question."
      BURN_GOVERNOR="subscription slots; hold the reserve"
      ;;
    ollama-cloud)
      case "${OLLAMA_PLAN}" in
        20)
          PROVIDER_CEILING=3
          PROVIDER_USABLE=2            # Trevor's reserve — never consume 100%
          PROVIDER_LABEL="Ollama Cloud \$20 plan — 3 concurrent, USE 2"
          PROVIDER_NOTE="Two concurrent slots. Builder and critic SHARE them: allocate 1+1 or time-slice, and show the allocation. A 24-unit build is ≥12 sequential rounds per stage — say so up front."
          ;;
        100)
          PROVIDER_CEILING=10
          PROVIDER_USABLE=8            # Trevor's reserve
          PROVIDER_LABEL="Ollama Cloud \$100 plan — 10 concurrent, USE 8"
          ;;
        *)
          echo "ERROR: OLLAMA_PLAN must be 20 or 100 (got: ${OLLAMA_PLAN})" >&2
          return 2
          ;;
      esac
      BURN_GOVERNOR="fixed concurrency slots; the reserve is never spent"
      ;;
    agnes)
      # Agnes is REQUEST-RATE limited, not concurrency limited. It carries
      # LOW-FREQUENCY roles (blind critic verdicts, ~1–2 per unit) — never the
      # builder swarm.
      PROVIDER_CEILING=1
      PROVIDER_USABLE=1
      case "${AGNES_PLAN}" in
        free)
          PROVIDER_LABEL="Agnes AI, free — 20 requests/minute (VERIFY-LIVE)"
          REQUEST_BUDGET="15 requests/min (20/min ceiling − 25% reserve)"
          ;;
        40)
          PROVIDER_LABEL="Agnes AI, \$40 plan — 1,500 requests / 5 hours (VERIFY-LIVE)"
          REQUEST_BUDGET="1,125 requests / 5h (1,500 − 25%) = 3.75/min sustained; at ~25 API requests per agent-task → 45 Agnes agent-tasks per 5-hour window (state the assumption, measure it over the first 5 tasks, re-derive)"
          ;;
        100)
          PROVIDER_LABEL="Agnes AI, \$100 plan — 7,500 requests / 5 hours (VERIFY-LIVE)"
          REQUEST_BUDGET="5,625 requests / 5h (7,500 − 25%) = 18.75/min sustained"
          ;;
        *)
          echo "ERROR: AGNES_PLAN must be free, 40 or 100 (got: ${AGNES_PLAN})" >&2
          return 2
          ;;
      esac
      PROVIDER_NOTE="Agnes is request-rate limited, not concurrency limited. It carries LOW-FREQUENCY roles (blind critic verdicts, ~1–2 per unit) — never the builder swarm. WEB-RESEARCH agnes-ai.com's current rate rules FIRST; these figures are the FALLBACK, and the ledger records which source was used."
      BURN_GOVERNOR="count requests per 5-hour window; when projected window spend > budget, throttle in order: raise interval → lower N → drop planner frequency → drop tier"
      ;;
    openrouter)
      PROVIDER_CEILING=8
      PROVIDER_USABLE=8
      PROVIDER_LABEL="OpenRouter — fallback role only; detect key, research current limits (VERIFY-LIVE)"
      PROVIDER_NOTE="OpenRouter is cost-metered — estimate the token burn and warn plainly if the account may run low. Recommend DeepSeek direct."
      BURN_GOVERNOR="cost-metered — burn-rate warn"
      ;;
    *)
      echo "ERROR: BUILDER_PROVIDER must be anthropic|deepseek-direct|deepseek-ollama|ollama-cloud|agnes|openrouter (got: ${BUILDER_PROVIDER})" >&2
      return 2
      ;;
  esac

  # The operator cap applies to the Anthropic-billed path only. On the user's
  # own 9Router provider keys there is no operator cap beyond the reserve.
  local OPERATOR_APPLIES=0
  if [[ "${BUILDER_PROVIDER}" == "anthropic" ]]; then OPERATOR_APPLIES=1; fi

  # --- THE RECONCILIATION RULE ----------------------------------------------
  # The wave width is the SMALLEST of three numbers: (1) the harness delivery
  # capacity — workflows-in-flight × min(16, cores−2), capped at 30 workflows;
  # (2) the operator cap for the provider class — 20 concurrent agents per wave
  # on Anthropic-billed Claude Code, no operator cap on the user's own 9Router
  # provider keys beyond the reserve; (3) the provider ceiling minus the
  # reserve (Law 44). The smallest number always governs, and the Capacity
  # Ledger records all three with the winner marked.
  local GOVERNING="${HARNESS_MAX}" GOVERN_SRC="harness"
  if (( OPERATOR_APPLIES == 1 )) && (( OPERATOR_WAVE_CAP < GOVERNING )); then
    GOVERNING="${OPERATOR_WAVE_CAP}"; GOVERN_SRC="operator cap"
  fi
  if (( PROVIDER_APPLIES == 1 )) && (( PROVIDER_USABLE < GOVERNING )); then
    GOVERNING="${PROVIDER_USABLE}"; GOVERN_SRC="provider ceiling − reserve"
  fi

  # --- THE COMMANDER DEDUCTION ----------------------------------------------
  # A commander is a FULL session: its own context window, full-rate token
  # burn, one persistent concurrent agent. The lead plus N commanders occupy
  # N+1 persistent slots INSIDE the governing number, BEFORE any workflow
  # width is allocated.
  local PERSISTENT=0 WIDTH="${GOVERNING}" TEAM_REFUSED=0
  if [[ "${MODE}" == "team" ]]; then
    PERSISTENT=$(( COMMANDERS + 1 ))
    if (( PERSISTENT >= GOVERNING )); then
      TEAM_REFUSED=1
      PERSISTENT=0
      WIDTH="${GOVERNING}"
    else
      WIDTH=$(( GOVERNING - PERSISTENT ))
    fi
  fi

  local WORKFLOWS
  WORKFLOWS=$(( (WIDTH + PER_WORKFLOW - 1) / PER_WORKFLOW ))
  (( WORKFLOWS < 1 )) && WORKFLOWS=1
  if (( WORKFLOWS > WORKFLOW_CEILING )); then WORKFLOWS="${WORKFLOW_CEILING}"; fi
  local AGENTS_PER_WF="${PER_WORKFLOW}"
  if (( WIDTH < PER_WORKFLOW )); then AGENTS_PER_WF="${WIDTH}"; fi

  if [[ -z "${THROTTLE}" ]]; then
    if [[ "${BUILDER_PROVIDER}" == "deepseek-direct" ]]; then THROTTLE="full"; else THROTTLE="gentle"; fi
  fi

  role_or_unresolved() {
    if [[ -n "$1" ]]; then echo "$1"; else echo "UNRESOLVED(resolve from live config)"; fi
  }

  # --- THE CARD (the Capacity Ledger's own fields, in its own order) ---------
  cat <<CARD
# CAPACITY LEDGER — ${PROJECT} — $(date -u '+%Y-%m-%dT%H:%M:%SZ')
Launcher: ${LAUNCHER}      Harness mode: ${HARNESS}
Cores: ${CORES} (${cores_source}) → per-workflow concurrency min(16, cores−2) = ${PER_WORKFLOW}
Context ceiling (session): per resolved model — see ROLE RESOLUTION (claude-codex on \`cx/\` = ~372K real, NOT the profile's 900K)
ROLE RESOLUTION (three hops: doctrine role → configured alias → resolved model; RECORD it, never reroute):
  orchestrator=lead seat
  builder=$(role_or_unresolved "${ROLE_BUILDER}")
  researcher=$(role_or_unresolved "${ROLE_RESEARCHER}")
  visual-verifier=$(role_or_unresolved "${ROLE_VISUAL}")
  technical-judge=$(role_or_unresolved "${ROLE_TECHNICAL}")
  security-judge=$(role_or_unresolved "${ROLE_SECURITY}")
  release-judge=$(role_or_unresolved "${ROLE_RELEASE}")
Ceilings: ${PROVIDER_LABEL} | operator cap $( (( OPERATOR_APPLIES == 1 )) && echo "${OPERATOR_WAVE_CAP}/wave" || echo "n/a (own provider keys)" )
Reserve applied: ${RESERVE_PCT}%$( (( PROVIDER_APPLIES == 1 )) && echo " → provider usable ${PROVIDER_USABLE} of ${PROVIDER_CEILING}" || echo " (no numeric provider ceiling to reserve against)" )
Governing number: harness ${WORKFLOW_CEILING}×${PER_WORKFLOW}=${HARNESS_MAX} | operator-cap $( (( OPERATOR_APPLIES == 1 )) && echo "${OPERATOR_WAVE_CAP}" || echo "n/a" ) | provider $( (( PROVIDER_APPLIES == 1 )) && echo "${PROVIDER_USABLE}" || echo "n/a" ) → GOVERNS: ${GOVERNING} (${GOVERN_SRC})
CARD

  if [[ "${MODE}" == "team" ]]; then
    if (( TEAM_REFUSED == 1 )); then
      cat <<CARD
AGENT TEAM: mode=team REFUSED BY ARITHMETIC — lead+${COMMANDERS} commanders = $(( COMMANDERS + 1 )) persistent slots > governing number ${GOVERNING}.
  The when-to-use gate answers SINGLE-SESSION and says so plainly. The commander
  stations collapse onto the lead and the same canonical loop runs single-session.
CARD
    else
      cat <<CARD
AGENT TEAM: mode=team (probe + consent required before any spawn — feature-not-enabled is a SILENT NO-OP)
  commanders=${COMMANDERS} → persistent slots = lead+${COMMANDERS} = ${PERSISTENT} → ${WIDTH} remain for workflow width
  Commanders are NOT agent executions against the 52/150/200 gauntlet budget, but their
  burn IS budgeted (full session rate, pessimistic shared bucket) and their liveness IS
  part of the reconciler's state-delta fingerprint. Teammates do NOT survive /resume —
  the resumed lead re-spawns them from disk (references/resume.md step 8.5).
CARD
    fi
  else
    cat <<CARD
AGENT TEAM: mode=single — no persistent commanders; the commander stations collapse onto the lead.
CARD
  fi

  cat <<CARD
WAVE SIZE: ${WIDTH}$( [[ "${MODE}" == "team" && "${TEAM_REFUSED}" -eq 0 ]] && echo " (workflow width) + ${PERSISTENT} persistent = ${GOVERNING}" )    WORKFLOW COUNT: ${WORKFLOWS}    AGENTS PER WORKFLOW: ≤${AGENTS_PER_WF}
AGENT BUDGET DECLARATION (all eight §17 quantities):
  1. number of workflows: ${WORKFLOWS}
  2. agents per workflow: ≤${AGENTS_PER_WF}
  3. maximum concurrency: ${GOVERNING} (${GOVERN_SRC})
  4. model role per workflow: from ROLE RESOLUTION above — by role and alias, resolved model cited
  5. expected total agent executions: ${GAUNTLET_EXPECTED} for the initial gauntlet run (8+16+16+8+4), scaled to this task graph
  6. selective-repair formula: N = failed workstreams, one repairer each, ≤${REPAIR_WAVE_CAP}/wave
  7. soft budget: ${GAUNTLET_SOFT_LOW}–${GAUNTLET_SOFT_HIGH} scaled to this project's task graph; at ${GAUNTLET_REVIEW} analyze whether measurable progress is still occurring
  8. hard safety cap: ${GAUNTLET_HARD_STOP} executions → HARD STOP, preserve the best stable build, produce a blocker report (run_status=STOPPED_CAP)
Session agent budget (AXIS 2 — a LIFETIME COUNT, never a width): ${SESSION_AGENT_BUDGET} per session,
  tracked as a DECREMENTING budget in project_state.json (agents.session_budget_remaining).
  Every workflow's declared AGENT COUNT plus the repair formula must SUM against it BEFORE
  dispatch. Commander sessions are separate processes — whether they draw from the same
  ${SESSION_AGENT_BUDGET} is UNDETERMINED; budget pessimistically as if they do until probed.
Request budget per 5h window: ${REQUEST_BUDGET}
Burn governor: ${BURN_GOVERNOR}
Throttle: ${THROTTLE}
Fallback: builder/QC/merger/critic each fall back one tier — never onto the tier that produced the work being judged.
CARD

  if [[ -n "${PROVIDER_NOTE}" ]]; then
    echo "NOTE: ${PROVIDER_NOTE}"
  fi

  cat <<'CARD'

IMPORTANT CAPACITY RULE: "Provider capacity is NOT an instruction to maximize agent
count. Do not spawn additional agents simply because DeepSeek or OpenRouter can
support them. Every spawned agent must have: unique responsibility; evidence to
inspect or work to perform; an explicit deliverable; an acceptance criterion. More
agents are useful only when the work can actually be decomposed into independent
valuable tasks. Quality per agent matters more than raw agent count."

Waves narrower than the ceiling run at the width the dependency graph allows (Law 45)
— the ceiling only ever lowers the dispatch, never widens a wave.
CARD

  return 0
}

# =============================================================================
# THE SELFTEST — synthetic answers, asserted numbers, plus instrument proof
# =============================================================================
run_selftest() {
  local tmp fails out
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/capacity-resolver-selftest.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create temp dir" >&2; return 1; }
  fails=0

  echo "SELFTEST — capacity-resolver.sh"
  echo

  _assert() {  # _assert <label> <needle> <haystack-file>
    if /usr/bin/grep -qF -- "$2" "$3"; then
      echo "  [PASS] $1"
    else
      echo "  [FAIL] $1 — expected to find: $2"
      fails=$(( fails + 1 ))
    fi
  }
  _refute() {
    if /usr/bin/grep -qF -- "$2" "$3"; then
      echo "  [FAIL] $1 — must NOT contain: $2"
      fails=$(( fails + 1 ))
    else
      echo "  [PASS] $1"
    fi
  }

  # --- Scenario (b): 9Router + DeepSeek v4 Flash direct, 12-core machine -----
  cat > "${tmp}/b.answers" <<'EOF'
HARNESS=claude-nine
LAUNCHER=claude-nine
BUILDER_PROVIDER=deepseek-direct
DEEPSEEK_TIER=flash
CORES=12
MODE=single
PROJECT=selftest-b
EOF
  resolve "${tmp}/b.answers" > "${tmp}/b.out" 2>"${tmp}/b.err"
  echo "SCENARIO (b) — deepseek-direct, 12 cores, single session"
  _assert "per-workflow = 10" "min(16, cores−2) = 10" "${tmp}/b.out"
  _assert "harness 30×10=300" "harness 30×10=300" "${tmp}/b.out"
  _assert "provider usable 1875 of 2500" "provider usable 1875 of 2500" "${tmp}/b.out"
  _assert "GOVERNS: 300 (harness)" "GOVERNS: 300 (harness)" "${tmp}/b.out"
  _assert "WAVE SIZE 300 / WORKFLOW COUNT 30 / ≤10" "WAVE SIZE: 300    WORKFLOW COUNT: 30    AGENTS PER WORKFLOW: ≤10" "${tmp}/b.out"
  # The needle is BUILT, never written literally: the dead "20 x 16" promise
  # must not survive anywhere in this file either.
  _refute "no dead 320 promise" "$(printf '= %d' $(( 20 * 16 )) )" "${tmp}/b.out"

  # --- Scenario (a) TEAM: plain Claude Code / Anthropic, 12-core, 4 commanders
  cat > "${tmp}/a.answers" <<'EOF'
HARNESS=regular
LAUNCHER=claude
BUILDER_PROVIDER=anthropic
CORES=12
MODE=team
COMMANDERS=4
PROJECT=selftest-a
EOF
  resolve "${tmp}/a.answers" > "${tmp}/a.out" 2>"${tmp}/a.err"
  echo "SCENARIO (a) — Anthropic, 12 cores, Agent Team with 4 commanders"
  _assert "GOVERNS: 20 (operator cap)" "GOVERNS: 20 (operator cap)" "${tmp}/a.out"
  _assert "lead+4 = 5 persistent → 15 remain" "commanders=4 → persistent slots = lead+4 = 5 → 15 remain for workflow width" "${tmp}/a.out"
  _assert "wave 15 + 5 persistent = 20" "WAVE SIZE: 15 (workflow width) + 5 persistent = 20" "${tmp}/a.out"
  _assert "WORKFLOW COUNT: 2" "WORKFLOW COUNT: 2    AGENTS PER WORKFLOW: ≤10" "${tmp}/a.out"

  # --- Scenario (c): Ollama Cloud $20 — the arithmetic REFUSES team mode -----
  cat > "${tmp}/c.answers" <<'EOF'
HARNESS=claude-nine
BUILDER_PROVIDER=ollama-cloud
OLLAMA_PLAN=20
CORES=12
MODE=team
COMMANDERS=4
PROJECT=selftest-c
EOF
  resolve "${tmp}/c.answers" > "${tmp}/c.out" 2>"${tmp}/c.err"
  echo "SCENARIO (c) — Ollama Cloud \$20 (ceiling 3, USE 2)"
  _assert "GOVERNS: 2 (provider)" "GOVERNS: 2 (provider ceiling − reserve)" "${tmp}/c.out"
  _assert "team mode refused by arithmetic" "REFUSED BY ARITHMETIC" "${tmp}/c.out"
  _assert "1 workflow × 2 agents" "WORKFLOW COUNT: 1    AGENTS PER WORKFLOW: ≤2" "${tmp}/c.out"

  # --- Scenario (d): Ollama Cloud $100 + Agnes $40 request budget -----------
  cat > "${tmp}/d.answers" <<'EOF'
HARNESS=claude-nine
BUILDER_PROVIDER=ollama-cloud
OLLAMA_PLAN=100
CORES=12
MODE=single
PROJECT=selftest-d
EOF
  resolve "${tmp}/d.answers" > "${tmp}/d.out" 2>"${tmp}/d.err"
  echo "SCENARIO (d) — Ollama Cloud \$100 (ceiling 10, USE 8)"
  _assert "GOVERNS: 8" "GOVERNS: 8 (provider ceiling − reserve)" "${tmp}/d.out"
  _assert "1 workflow × 8 agents" "WORKFLOW COUNT: 1    AGENTS PER WORKFLOW: ≤8" "${tmp}/d.out"

  cat > "${tmp}/d2.answers" <<'EOF'
HARNESS=claude-nine
BUILDER_PROVIDER=agnes
AGNES_PLAN=40
CORES=12
MODE=single
PROJECT=selftest-d2
EOF
  resolve "${tmp}/d2.answers" > "${tmp}/d2.out" 2>"${tmp}/d2.err"
  echo "SCENARIO (d) — Agnes \$40 request budget"
  _assert "1,125 / 5h = 3.75/min" "1,125 requests / 5h (1,500 − 25%) = 3.75/min sustained" "${tmp}/d2.out"
  _assert "45 Agnes agent-tasks per window" "45 Agnes agent-tasks per 5-hour window" "${tmp}/d2.out"

  # --- INSTRUMENT PROOF: the resolver must FAIL on bad input ----------------
  # (A checker that accepts everything proves nothing about what it accepts.)
  echo "INSTRUMENT PROOF — the resolver must discriminate"
  cat > "${tmp}/bad.answers" <<'EOF'
HARNESS=regular
BUILDER_PROVIDER=not-a-real-provider
CORES=12
EOF
  if resolve "${tmp}/bad.answers" > "${tmp}/bad.out" 2>"${tmp}/bad.err"; then
    echo "  [FAIL] known-bad provider was ACCEPTED — this checker cannot be trusted"
    fails=$(( fails + 1 ))
  else
    echo "  [PASS] known-bad provider rejected (exit $?)"
  fi
  cat > "${tmp}/bad2.answers" <<'EOF'
HARNESS=nonsense
BUILDER_PROVIDER=anthropic
EOF
  if resolve "${tmp}/bad2.answers" > "${tmp}/bad2.out" 2>"${tmp}/bad2.err"; then
    echo "  [FAIL] known-bad harness was ACCEPTED — this checker cannot be trusted"
    fails=$(( fails + 1 ))
  else
    echo "  [PASS] known-bad harness rejected"
  fi
  if resolve "${tmp}/does-not-exist.answers" > /dev/null 2>&1; then
    echo "  [FAIL] a missing answers file was ACCEPTED"
    fails=$(( fails + 1 ))
  else
    echo "  [PASS] missing answers file rejected (a read failure is never an empty answer)"
  fi

  # --- LIVE MEASUREMENT: the formula holds on THIS machine ------------------
  echo "LIVE — cores measured on this machine (no CORES supplied)"
  cat > "${tmp}/live.answers" <<'EOF'
HARNESS=regular
BUILDER_PROVIDER=anthropic
MODE=single
PROJECT=selftest-live
EOF
  if resolve "${tmp}/live.answers" > "${tmp}/live.out" 2>"${tmp}/live.err"; then
    local lc lw
    lc="$(/usr/bin/grep -m1 '^Cores: ' "${tmp}/live.out" | awk '{print $2}')"
    lw="$(/usr/bin/grep -m1 '^Cores: ' "${tmp}/live.out" | awk -F'= ' '{print $2}')"
    local expect
    expect="$(per_workflow_width "${lc}")"
    if [[ "${lw}" == "${expect}" ]]; then
      echo "  [PASS] measured cores=${lc} → per-workflow=${lw} = min(16, ${lc}−2)"
    else
      echo "  [FAIL] measured cores=${lc} gave per-workflow=${lw}, formula says ${expect}"
      fails=$(( fails + 1 ))
    fi
    _assert "MEASURED, not inherited" "(MEASURED)" "${tmp}/live.out"
  else
    echo "  [FAIL] live run did not resolve (see ${tmp}/live.err)"
    fails=$(( fails + 1 ))
  fi

  rm -rf "${tmp}"
  echo
  if (( fails == 0 )); then
    echo "SELFTEST: PASS — all scenario and instrument checks passed"
    return 0
  fi
  echo "SELFTEST: FAIL (${fails} check(s) failed)"
  return 1
}

# =============================================================================
if [[ "${1:-}" == "--selftest" ]]; then
  run_selftest
  exit $?
fi

ANSWERS="${1:?Usage: capacity-resolver.sh <answers-file> | --selftest}"
resolve "${ANSWERS}"
exit $?
