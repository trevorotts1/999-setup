#!/usr/bin/env bash
# build-fixture.sh — synthetic project fixtures for the boss-cron portability
# suite (WS-48, Master Spec section 24).
#
# Self-contained: builds a synthetic HOME (claude + claude-nine session
# stores, ~/Downloads/projects with two unrelated projects plus a legacy
# six-wave campaign history project) and prints the fixture root. The user
# path is synthetic — the script never references this checkout or any real
# developer home — so the portability assertions run against arbitrary
# user-shaped paths (spec 24: arbitrary macOS and Windows user paths work).
#
# Usage: build-fixture.sh <scratch-root> <home-dir>
#
# Exit 0 and print the fixture root on success; non-zero with the failure on
# stderr otherwise. Safe to delete the fixture root after the run.

set -u

if [ "$#" -ne 2 ]; then
  echo "usage: build-fixture.sh <scratch-root> <home-dir>" >&2
  exit 2
fi

ROOT="$1"
HOME_DIR="$2"

rm -rf "${ROOT}"
mkdir -p "${ROOT}"

# Session-store name the runtime derives for this user (same rule as the
# runtime: '-' + $HOME with leading '/' stripped, '/' -> '-').
ENCODED="-$(printf '%s' "${HOME_DIR}" | sed 's#^/##; s#/#-#g')"

# 1) A live workflow-run tree, shaped like the harness writes it:
#    <session>/subagents/workflows/<runId>/{journal.jsonl,agent-<id>.meta.json}
#    with a CURRENT journal (the run is live).
for store in ".claude" ".claude-nine"; do
  RUN_DIR="${HOME_DIR}/${store}/projects/${ENCODED}/session-0001/subagents/workflows/wf_fixture-live-0001"
  mkdir -p "${RUN_DIR}"
  printf '%s\n' \
    '{"type":"started","agentId":"agent-live-01","ts":"2026-08-21T00:00:00Z"}' \
    '{"type":"started","agentId":"agent-live-02","ts":"2026-08-21T00:00:00Z"}' \
    > "${RUN_DIR}/journal.jsonl"
  printf '{"model":"opus"}\n' > "${RUN_DIR}/agent-agent-live-01.meta.json"
  printf '{"model":"sonnet"}\n' > "${RUN_DIR}/agent-agent-live-02.meta.json"
  # Touch the journal NOW so its mtime is current — the staleness backstop
  # (RUN_STALENESS_SECONDS) treats an old journal as a dead run.
  touch "${RUN_DIR}/journal.jsonl"
done

# 2) Two unrelated projects under ~/Downloads/projects. Each carries
#    CONTROL/project_state.json with a truthy run_status and a CONTROL/LEDGER.md
#    — the shape the entry-mode and research gates scan — but the two projects
#    share NOTHING: different CONTROL dirs, no cross-references.
PROJECTS="${HOME_DIR}/Downloads/projects"
for proj in alpha-one beta-two; do
  PDIR="${PROJECTS}/${proj}"
  mkdir -p "${PDIR}/CONTROL"
  printf '{"run_status":"IN_PROGRESS","checkpoints":[]}\n' > "${PDIR}/CONTROL/project_state.json"
  printf '%s\n' \
    "- \`CREATED 2026-08-21T00:00:00Z: fixture baseline\`" \
    "- \`ENTRY-MODE: interview\`" \
    "- \`BUILD-TARGET: WEB_APP\`" \
    "- \`INPUT-CAPTURED: ${ROOT}/inputs/${proj}-brief.txt\`" \
    > "${PDIR}/CONTROL/LEDGER.md"
done
mkdir -p "${ROOT}/inputs"
printf 'alpha brief\n' > "${ROOT}/inputs/alpha-one-brief.txt"
printf 'beta brief\n' > "${ROOT}/inputs/beta-two-brief.txt"

# 3) A legacy six-wave campaign project (historical campaign evidence — kept,
#    never deleted, per spec 24 "do not delete historical evidence simply to
#    hide it"). Its CONTROL/LEDGER.md is a record of the old campaign; the
#    suite proves no generic CUSTOMER project is governed by it.
CAMPAIGN="${PROJECTS}/legacy-six-wave-campaign"
mkdir -p "${CAMPAIGN}/CONTROL"
printf '{"run_status":"COMPLETED","checkpoints":[]}\n' > "${CAMPAIGN}/CONTROL/project_state.json"
printf '%s\n' \
  "- \`CREATED 2026-08-15T00:00:00Z: legacy campaign baseline\`" \
  "- \`ENTRY-MODE: pointed\`" \
  "- \`WAVE 1 DISPATCH 2026-08-15T00:00:00Z: legacy campaign wave 1\`" \
  "- \`WAVE 2 DISPATCH 2026-08-16T00:00:00Z: legacy campaign wave 2\`" \
  "- \`WAVE 3 DISPATCH 2026-08-17T00:00:00Z: legacy campaign wave 3\`" \
  "- \`WAVE 4 DISPATCH 2026-08-18T00:00:00Z: legacy campaign wave 4\`" \
  "- \`WAVE 5 DISPATCH 2026-08-19T00:00:00Z: legacy campaign wave 5\`" \
  "- \`WAVE 6 DISPATCH 2026-08-20T00:00:00Z: legacy campaign wave 6\`" \
  > "${CAMPAIGN}/CONTROL/LEDGER.md"

# 4) A synthetic dispatch-log with one research row (for the research gate
#    checks) in project alpha-one, and NONE in beta-two — so the two projects
#    provably do not bleed into each other.
printf '%s\n' \
  "2026-08-21T00:05:00Z | research WEB_APP | discovery | [opus x1] reader | run-0001 | BUILD-TARGET: WEB_APP | INPUT-CAPTURED: ${ROOT}/inputs/alpha-one-brief.txt" \
  > "${PROJECTS}/alpha-one/CONTROL/dispatch-log.md"

echo "${ROOT}"
exit 0
