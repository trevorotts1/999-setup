#!/usr/bin/env bash
# merge-train.sh — the one merge writer's mechanical half (references/pipeline.md
# Stage 5, "Land vs Merged").
#
#   merge-train.sh [--project <home>] <repo> <branch>...
#   merge-train.sh --selftest
#
# Runs in <repo> on whatever branch is checked out (the integration branch).
# For each unit branch, in the order given, one at a time:
#   git merge --no-ff --no-edit <branch>, then the project's test command.
#   A conflict or a red test STOPS the train: the merge is undone (the branch is
#   left exactly as it was before that unit) and nothing after it is tried.
#   A green unit prints   LANDED: unit=<branch> commit=<sha> tests=<pass|none>
# Then (also after a stop, for the units that did land), when the repo has an
# `origin`, HEAD is pushed to origin/<trunk> and every
# landed commit that `git merge-base --is-ancestor` proves is on the remote trunk
# prints   MERGED: unit=<branch> commit=<sha> trunk=origin/<trunk>
# No origin (a local-only anchor) -> LANDED lines only: landed is never reported as
# merged. With --project, each line also goes to CONTROL/LEDGER.md through
# tools/ledger.sh (legacy) or <state dir>/merge-train.log (profiled).
#
# The test command: MERGE_TRAIN_TEST_CMD when set, else `npm test` when
# package.json carries a real scripts.test (not npm's "no test specified"), else none.
# The trunk: MERGE_TRAIN_TRUNK, default main.
#
# Exit: 0 every unit landed (and merged, when there is an origin) |
#       3 stopped: conflict, red test, or push refused | 2 undetermined | 1 usage
#
# Not done here (the merge-writer does them): version bump, changelog entry, the
# batch's annotated tag.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
TRUNK="${MERGE_TRAIN_TRUNK:-main}"
PROJECT=""

say() { printf '%s\n' "$*"; [[ -n "$PROJECT" ]] && record "$PROJECT" "$*"; return 0; }
stop() { printf 'MERGE-TRAIN STOP | %s\n' "$*"; exit 3; }
undetermined() { printf 'MERGE-TRAIN UNDETERMINED | %s\n' "$*"; exit 2; }

record() { # record <home> <line>
  local st
  if [[ -f "$1/.spec-protocol.json" ]]; then
    st="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["documents"]["state"])' "$1/.spec-protocol.json" 2>/dev/null)" || return 1
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$1/$(dirname "$st")/merge-train.log"
  else
    "$DIR/ledger.sh" "$1" CONTROL/LEDGER.md "$2" >/dev/null
  fi
}

test_cmd() {
  if [[ -n "${MERGE_TRAIN_TEST_CMD:-}" ]]; then printf '%s' "$MERGE_TRAIN_TEST_CMD"; return; fi
  [[ -f package.json ]] && python3 -c 'import json,sys
t=(json.load(open("package.json")).get("scripts") or {}).get("test","")
sys.exit(0 if t and "no test specified" not in t else 1)' 2>/dev/null && printf 'npm test'
}

train() {
  local repo="$1" b sha tc tests landed=() units=() i halted=""
  shift
  cd "$repo" 2>/dev/null || undetermined "cannot enter $repo"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || undetermined "$repo is not a git working copy"
  [[ -z "$(git status --porcelain)" ]] || undetermined "$repo has uncommitted changes; the train merges onto a clean tree only"
  tc="$(test_cmd)"
  for b in "$@"; do
    git rev-parse --verify --quiet "$b^{commit}" >/dev/null || { halted="unit branch $b does not exist"; break; }
    if ! git merge --no-ff --no-edit "$b" >/dev/null 2>&1; then
      git merge --abort >/dev/null 2>&1
      halted="unit=$b conflicts with $(git rev-parse --abbrev-ref HEAD); nothing after it was merged"; break
    fi
    tests=none
    if [[ -n "$tc" ]]; then
      if bash -c "$tc" >/dev/null 2>&1; then tests=pass
      else
        git reset --hard ORIG_HEAD >/dev/null 2>&1
        halted="unit=$b tests red ($tc); its merge was undone, nothing after it was merged"; break
      fi
    fi
    sha="$(git rev-parse HEAD)"
    say "LANDED: unit=$b commit=$sha tests=$tests"
    landed+=("$sha"); units+=("$b")
  done

  # What landed before a stop is still pushed and proven; the stop is reported last.
  if (( ${#landed[@]} == 0 )); then [[ -n "$halted" ]] && stop "$halted"; exit 0; fi
  git remote get-url origin >/dev/null 2>&1 || { printf 'MERGE-TRAIN | no origin: landed only, not merged\n'; [[ -n "$halted" ]] && stop "$halted"; exit 0; }
  git push --quiet origin "HEAD:refs/heads/$TRUNK" 2>&1 || stop "push to origin/$TRUNK refused; units are landed, not merged"
  git fetch --quiet origin "$TRUNK" 2>&1 || undetermined "fetch of origin/$TRUNK failed after the push"
  for i in "${!landed[@]}"; do
    if git merge-base --is-ancestor "${landed[$i]}" FETCH_HEAD; then
      say "MERGED: unit=${units[$i]} commit=${landed[$i]} trunk=origin/$TRUNK"
    else
      stop "unit=${units[$i]} commit=${landed[$i]} is not an ancestor of origin/$TRUNK"
    fi
  done
  [[ -n "$halted" ]] && stop "$halted"
  exit 0
}

selftest() {
  local t out rc fails=0
  t="$(mktemp -d "${TMPDIR:-/tmp}/mtrain-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  export GIT_AUTHOR_NAME=st GIT_AUTHOR_EMAIL=st@example.invalid GIT_COMMITTER_NAME=st GIT_COMMITTER_EMAIL=st@example.invalid
  git init -q --bare "$t/origin.git"
  git init -q -b main "$t/r"
  ( cd "$t/r" && echo base > f && git add f && git commit -qm base \
    && git remote add origin "$t/origin.git" && git push -q origin main \
    && git checkout -qb u1 && echo a > a && git add a && git commit -qm u1 \
    && git checkout -q main && git checkout -qb u2 && echo bad > bad && git add bad && git commit -qm u2 \
    && git checkout -q main && git checkout -qb u3 && echo c > c && git add c && git commit -qm u3 \
    && git checkout -q main ) || { echo "SELFTEST UNDETERMINED fixture"; exit 2; }
  # test command goes red once u2's file is present: u1 lands+merges, u2 stops the train, u3 never runs
  out="$(MERGE_TRAIN_TEST_CMD='test ! -e bad' bash "$SELF" "$t/r" u1 u2 u3 2>&1)"; rc=$?
  if (( rc == 3 )) && grep -q '^MERGED: unit=u1 ' <<<"$out" \
     && ! grep -q 'unit=u3' <<<"$out" && [[ ! -e "$t/r/bad" ]] \
     && [[ "$(git -C "$t/r" log --merges --oneline | wc -l | tr -d ' ')" == 1 ]]; then
    echo "SELFTEST ok   u1 merged, red u2 undone and stops the train, u3 untried"
  else echo "SELFTEST FAIL stop-on-red: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  # green run over u3 alone pushes and proves trunk ancestry -> MERGED line
  out="$(MERGE_TRAIN_TEST_CMD='true' bash "$SELF" "$t/r" u3 2>&1)"; rc=$?
  if (( rc == 0 )) && grep -q '^MERGED: unit=u3 .* trunk=origin/main' <<<"$out"; then
    echo "SELFTEST ok   green unit pushed and MERGED only after ancestry proof"
  else echo "SELFTEST FAIL merged: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  --project) PROJECT="${2:-}"; shift 2 || exit 1 ;;
esac
[[ $# -ge 2 ]] || { sed -n '2,30p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1; }
train "$@"
