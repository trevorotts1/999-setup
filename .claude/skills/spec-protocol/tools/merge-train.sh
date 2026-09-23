#!/usr/bin/env bash
# merge-train.sh — the one merge writer's mechanical half (references/pipeline.md
# Stage 5, "Land vs Merged").
#
#   merge-train.sh [--project <home>] <repo> <branch>...
#   merge-train.sh <home> --batch [<branch>...]
#   merge-train.sh --selftest
#
# --batch (the tick runs it every MERGE_BATCH_MINUTES, default 15): the repo is the
# repo-anchor receipt's repoRoot (else <home> itself). With no branches named, the
# batch is every unit/<id> branch whose latest QC-RECORD in the ledger
# (CONTROL/LEDGER.md, or <state dir>/spec-protocol/LEDGER.md on a profiled project)
# is verdict=PASS or outcome=CLIENT-ACCEPTED, that is not yet an ancestor of HEAD,
# and that is not parked at its current tip. ONE pass: each unit merged --no-ff in
# ledger order, the test command run ONCE, pushed ONCE. A red gate is bisected
# (halves retried on top of what already passed) until the offending unit(s) are
# found; they are undone and parked with the failing output:
#   REPAIR: unit=<branch> reason=batch-gate-red log=<file>
# A conflicting unit is skipped, never blocking the rest, and parked for the
# conflict-resolver seat (haiku chain):
#   CONFLICT: unit=<branch> against=<integration branch> seat=conflict-resolver
# Parked units sit in <record dir>/merge-train/parked.tsv and are retried once their
# branch tip moves (the repair or resolution committed). Nothing waiting prints
#   MERGE-TRAIN BATCH | nothing waiting    (exit 0)
# A second batch while one runs prints MERGE-TRAIN BATCH | already running (exit 0).
# The gate is killed after MERGE_TRAIN_GATE_TIMEOUT seconds (default 1800) = red.
#
# Profiled project (.spec-protocol.json with commands.merged): once per MERGED unit
# the argv is run at <home>, never through a shell, with {taskId} (the branch's last
# path part) {commit} {branch} substituted. A local-only anchor (no origin) whose
# checked-out branch is the trunk runs it for each LANDED unit instead: that local
# trunk is the project's only trunk. The lines still say LANDED, never MERGED. A hook
# failure prints MERGE-TRAIN | commands.merged failed ... and is never fatal.
#
# Runs in <repo> on whatever branch is checked out (the integration branch).
# For each unit branch, in the order given, one at a time:
#   git merge --no-ff --no-edit <branch>, then the project's test command.
#   A conflict or a red test STOPS the train: the merge is undone (the branch is
#   left exactly as it was before that unit) and nothing after it is tried.
#   A green unit prints   LANDED: unit=<branch> commit=<sha> tests=<pass|none>
#   and the builder's worktree for that branch (<repo>/.worktrees/<id>, the one the
#   workflow templates create) is removed; the branch itself is kept. `.worktrees/`
#   goes in the repo's local info/exclude so live worktrees never dirty the tree.
# Then (also after a stop, for the units that did land), when the repo has an
# `origin`, HEAD is pushed to origin/<trunk> and every
# landed commit that `git merge-base --is-ancestor` proves is on the remote trunk
# prints   MERGED: unit=<branch> commit=<sha> trunk=origin/<trunk>
# No origin (a local-only anchor) -> LANDED lines only: landed is never reported as
# merged. With --project, each line also goes to CONTROL/LEDGER.md through
# tools/ledger.sh (legacy) or <state dir>/merge-train.log (profiled), and a project
# whose repo-anchor receipt says "source": "operator-owner" pushes with the
# operator's SPEC_PROTOCOL_OPERATOR_GH_TOKEN (operator.env), handed to git only.
# Any other github.com origin (the client's own account): when gh is logged in,
# `gh auth setup-git` runs before the push so git has the client's credentials.
#
# The test command: MERGE_TRAIN_TEST_CMD when set, else `npm test` when
# package.json carries a real scripts.test (not npm's "no test specified"), else none.
# The trunk: MERGE_TRAIN_TRUNK, default main.
#
# Exit: 0 every unit landed (and merged, when there is an origin) |
#       3 stopped: conflict, red test, or push refused (--batch: a unit was parked
#         or the push refused; the rest of the batch still landed) |
#       2 undetermined | 1 usage
#
# Not done here (the merge-writer does them): version bump, changelog entry, the
# batch's annotated tag.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
TRUNK="${MERGE_TRAIN_TRUNK:-main}"
PROJECT=""
landed=() units=() halted="" TC="" MT="" PARKED=0 TRIED=() TSHAS=()

say() { printf '%s\n' "$*"; [[ -n "$PROJECT" ]] && record "$PROJECT" "$*"; return 0; }
stop() { printf 'MERGE-TRAIN STOP | %s\n' "$*"; exit 3; }
undetermined() { printf 'MERGE-TRAIN UNDETERMINED | %s\n' "$*"; exit 2; }

state_rel() { # state_rel <home> -- documents.state's directory relative to <home>; empty when unprofiled
  [[ -f "$1/.spec-protocol.json" ]] || return 0
  local st
  st="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["documents"]["state"])' "$1/.spec-protocol.json" 2>/dev/null)" || return 1
  dirname "$st"
}

record() { # record <home> <line>
  local sd
  if [[ -f "$1/.spec-protocol.json" ]]; then
    sd="$(state_rel "$1")" || return 1
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$1/$sd/merge-train.log"
  else
    "$DIR/ledger.sh" "$1" CONTROL/LEDGER.md "$2" >/dev/null
  fi
}

wt_remove() { # wt_remove <branch> -- drop the worktree that has <branch> checked out
  local p
  p="$(git worktree list --porcelain | awk -v b="branch refs/heads/$1" '/^worktree /{w=substr($0,10)} $0==b{print w}')"
  [[ -n "$p" && "$p" != "$(git rev-parse --show-toplevel)" ]] || return 0
  git worktree remove --force "$p" >/dev/null 2>&1 || printf 'MERGE-TRAIN | unit=%s landed; its worktree was not removed: %s\n' "$1" "$p"
}

# A repo that repo-anchor created under the operator's owner (receipt "source":
# "operator-owner") only had credentials for its first push. Its push and fetch get
# SPEC_PROTOCOL_OPERATOR_GH_TOKEN (environment first, else one KEY=value line of
# operator.env -- parsed, never sourced) as GH_TOKEN in THAT git process's env only,
# through a one-shot credential helper: never printed, never in a URL or git config.
OPTOK=""
receipt_path() { # the --project's repo-anchor receipt path (it may not exist)
  local sd
  if [[ -f "$PROJECT/.spec-protocol.json" ]]; then
    sd="$(state_rel "$PROJECT")" || return 1
    printf '%s' "$PROJECT/$sd/repo-anchor.json"
  else
    printf '%s' "$PROJECT/CONTROL/repo-anchor.json"
  fi
}
receipt_field() { # receipt_field <receipt> <key> -- empty when absent or unreadable
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")' "$1" "$2" 2>/dev/null
}
receipt_source() { # the --project's repo-anchor receipt "source", empty when none
  [[ -n "$PROJECT" ]] || return 0
  local r
  r="$(receipt_path)" || return 0
  receipt_field "$r" source
}
operator_token() {
  local f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env" v="${SPEC_PROTOCOL_OPERATOR_GH_TOKEN:-}"
  if [[ -z "$v" && -r "$f" ]]; then
    v="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?SPEC_PROTOCOL_OPERATOR_GH_TOKEN[[:space:]]*=[[:space:]]*//p' "$f" | tail -n 1 | tr -d '\r')"
    v="${v%%[[:space:]]*}"; v="${v#[\"\']}"; v="${v%[\"\']}"
  fi
  printf '%s' "$v"
}
remote_git() { # remote_git <git args...> -- push/fetch, with the operator token when the anchor needs it
  if [[ -n "$OPTOK" ]]; then
    GH_TOKEN="$OPTOK" git -c credential.helper= \
      -c 'credential.helper=!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' "$@"
  else
    git "$@"
  fi
}

test_cmd() {
  if [[ -n "${MERGE_TRAIN_TEST_CMD:-}" ]]; then printf '%s' "$MERGE_TRAIN_TEST_CMD"; return; fi
  [[ -f package.json ]] && python3 -c 'import json,sys
t=(json.load(open("package.json")).get("scripts") or {}).get("test","")
sys.exit(0 if t and "no test specified" not in t else 1)' 2>/dev/null && printf 'npm test'
}

# commands.merged (profiled projects): one argv run per merged unit, at <home>, never
# through a shell. Only the exit code is reported; the hook's output is never echoed.
IFS= read -r -d '' PYHOOK <<'PY' || true
import json, subprocess, sys
root, tid, sha, br = sys.argv[1:5]
cmd = (json.load(open(root + "/.spec-protocol.json")).get("commands") or {}).get("merged")
if cmd is None:
    sys.exit(0)
if not (isinstance(cmd, list) and cmd and all(isinstance(a, str) and a for a in cmd)):
    print("commands.merged is not an argv array")
    sys.exit(2)
argv = [a.replace("{taskId}", tid).replace("{commit}", sha).replace("{branch}", br) for a in cmd]
try:
    r = subprocess.run(argv, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
except Exception as e:
    print(type(e).__name__)
    sys.exit(2)
sys.exit(r.returncode)
PY
merged_hook() { # merged_hook <branch> <commit>
  [[ -n "$PROJECT" && -f "$PROJECT/.spec-protocol.json" ]] || return 0
  local out rc
  out="$(python3 -c "$PYHOOK" "$PROJECT" "${1##*/}" "$2" "$1" 2>/dev/null)"; rc=$?
  (( rc == 0 )) || say "MERGE-TRAIN | commands.merged failed unit=$1 rc=$rc ${out}"
  return 0
}

enter_repo() { # enter_repo <repo> -- cd, prove a clean git working copy, keep .worktrees/ excluded
  local ex
  cd "$1" 2>/dev/null || undetermined "cannot enter $1"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || undetermined "$1 is not a git working copy"
  ex="$(git rev-parse --git-path info/exclude)"
  grep -qx '.worktrees/' "$ex" 2>/dev/null || { mkdir -p "$(dirname "$ex")" && echo '.worktrees/' >> "$ex"; }
  [[ -z "$(git status --porcelain)" ]] || undetermined "$1 has uncommitted changes; the train merges onto a clean tree only"
}

# Push once, prove trunk ancestry per landed unit, run commands.merged, report the stop last.
finish() { # finish <receipt source>
  local i
  if (( ${#landed[@]} == 0 )); then [[ -n "$halted" ]] && stop "$halted"; exit 0; fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    printf 'MERGE-TRAIN | no origin: landed only, not merged\n'
    if [[ "$(git rev-parse --abbrev-ref HEAD)" == "$TRUNK" ]]; then
      for i in "${!landed[@]}"; do merged_hook "${units[$i]}" "${landed[$i]}"; done
    fi
    [[ -n "$halted" ]] && stop "$halted"; exit 0
  fi
  if [[ "$1" == operator-owner ]]; then
    OPTOK="$(operator_token)"
    [[ -n "$OPTOK" ]] || stop "the repo is under the operator's owner and SPEC_PROTOCOL_OPERATOR_GH_TOKEN is not set in operator.env; units are landed, not merged"
  elif [[ "$(git config --get remote.origin.url)" == *github.com* ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    # A repo on the client's own account: gh holds the login, git needs it as a
    # credential helper. Idempotent; a failure here surfaces as the push refusal below.
    gh auth setup-git >/dev/null 2>&1 || true
  fi
  remote_git push --quiet origin "HEAD:refs/heads/$TRUNK" 2>&1 || stop "push to origin/$TRUNK refused; units are landed, not merged"
  remote_git fetch --quiet origin "$TRUNK" 2>&1 || undetermined "fetch of origin/$TRUNK failed after the push"
  for i in "${!landed[@]}"; do
    if git merge-base --is-ancestor "${landed[$i]}" FETCH_HEAD; then
      say "MERGED: unit=${units[$i]} commit=${landed[$i]} trunk=origin/$TRUNK"
      merged_hook "${units[$i]}" "${landed[$i]}"
    else
      stop "unit=${units[$i]} commit=${landed[$i]} is not an ancestor of origin/$TRUNK"
    fi
  done
  [[ -n "$halted" ]] && stop "$halted"
  exit 0
}

train() {
  local repo="$1" b sha tests src
  shift
  src="$(receipt_source)"
  enter_repo "$repo"
  TC="$(test_cmd)"
  for b in "$@"; do
    git rev-parse --verify --quiet "$b^{commit}" >/dev/null || { halted="unit branch $b does not exist"; break; }
    if ! git merge --no-ff --no-edit "$b" >/dev/null 2>&1; then
      git merge --abort >/dev/null 2>&1
      halted="unit=$b conflicts with $(git rev-parse --abbrev-ref HEAD); nothing after it was merged"; break
    fi
    tests=none
    if [[ -n "$TC" ]]; then
      if bash -c "$TC" >/dev/null 2>&1; then tests=pass
      else
        git reset --hard ORIG_HEAD >/dev/null 2>&1
        halted="unit=$b tests red ($TC); its merge was undone, nothing after it was merged"; break
      fi
    fi
    sha="$(git rev-parse HEAD)"
    say "LANDED: unit=$b commit=$sha tests=$tests"
    wt_remove "$b"
    landed+=("$sha"); units+=("$b")
  done
  # What landed before a stop is still pushed and proven; the stop is reported last.
  finish "$src"
}

# ---- --batch ---------------------------------------------------------------------

ready_ids() { # ready_ids <ledger> -- unit ids whose latest QC-RECORD passed, in ledger order
  awk '
    /^[0-9][0-9][0-9][0-9]-/ { u = "" }                      # a new ledger entry ends the last record
    /QC-RECORD unit=/ { match($0, /unit=[^ |]+/); u = substr($0, RSTART + 5, RLENGTH - 5)
                        if (!(u in seen)) { seen[u] = 1; order[++n] = u } }
    u != "" && /verdict=/ { match($0, /verdict=[A-Z-]+/); ok[u] = (substr($0, RSTART + 8, RLENGTH - 8) == "PASS") }
    u != "" && /outcome=CLIENT-ACCEPTED/ { ok[u] = 1 }
    END { for (i = 1; i <= n; i++) if (ok[order[i]]) print order[i] }' "$1"
}

park() { # park <branch> <conflict|red> [gate output]
  local tip log=none
  tip="$(git rev-parse "$1^{commit}")"
  if [[ "$2" == red ]]; then
    log="$MT/$(printf '%s' "$1" | tr '/' '_').gate.log"
    cp "$3" "$log" 2>/dev/null || log=none
    say "REPAIR: unit=$1 reason=batch-gate-red log=$log"
  else
    say "CONFLICT: unit=$1 against=$(git rev-parse --abbrev-ref HEAD) seat=conflict-resolver"
  fi
  printf '%s\t%s\t%s\t%s\n' "$1" "$tip" "$2" "$log" >> "$MT/parked.tsv"
  PARKED=$((PARKED + 1))
}

try_set() { # try_set <branch>... -- merge each --no-ff onto HEAD; a conflict is aborted and parked
  local b
  TRIED=() TSHAS=()
  for b in "$@"; do
    if git merge --no-ff --no-edit "$b" >/dev/null 2>&1; then
      TRIED+=("$b"); TSHAS+=("$(git rev-parse HEAD)")
    else
      git merge --abort >/dev/null 2>&1; park "$b" conflict
    fi
  done
}

gate() { # gate <output file> -- the test command once on HEAD, killed at the timeout
  [[ -n "$TC" ]] || return 0
  # ponytail: alarm kills the gate's shell, not grandchildren it left behind.
  perl -e 'alarm shift; exec @ARGV' "${MERGE_TRAIN_GATE_TIMEOUT:-1800}" bash -c "$TC" >"$1" 2>&1
}

solve() { # solve <branch>... -- land the subset that keeps the gate green, bisecting on red
  (( $# )) || return 0
  local base i half
  base="$(git rev-parse HEAD)"
  try_set "$@"
  (( ${#TRIED[@]} )) || return 0
  if gate "$MT/.gate.out"; then
    for i in "${!TRIED[@]}"; do
      say "LANDED: unit=${TRIED[$i]} commit=${TSHAS[$i]} tests=$([[ -n "$TC" ]] && echo pass || echo none)"
      landed+=("${TSHAS[$i]}"); units+=("${TRIED[$i]}")
    done
    return 0
  fi
  git reset -q --hard "$base"
  if (( ${#TRIED[@]} == 1 )); then park "${TRIED[0]}" red "$MT/.gate.out"; return 0; fi
  local -a s=("${TRIED[@]}")
  half=$(( ${#s[@]} / 2 ))
  solve "${s[@]:0:half}"
  solve "${s[@]:half}"
}

batch() { # batch [<branch>...]
  local sd rd ledger repo src b tip pid u
  local -a want=() ready=()
  sd="$(state_rel "$PROJECT")" || undetermined "cannot read documents.state from $PROJECT/.spec-protocol.json"
  if [[ -f "$PROJECT/.spec-protocol.json" ]]; then rd="$PROJECT/$sd/spec-protocol"; else rd="$PROJECT/CONTROL"; fi
  ledger="$rd/LEDGER.md"; MT="$rd/merge-train"
  mkdir -p "$MT" || undetermined "cannot create $MT"
  if ! mkdir "$MT/batch.lock" 2>/dev/null; then
    pid="$(cat "$MT/batch.lock/pid" 2>/dev/null)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then printf 'MERGE-TRAIN BATCH | already running (pid %s)\n' "$pid"; exit 0; fi
    rm -rf "$MT/batch.lock"; mkdir "$MT/batch.lock" 2>/dev/null || undetermined "cannot take the lock $MT/batch.lock"
  fi
  echo $$ > "$MT/batch.lock/pid"
  trap 'rm -rf "$MT/batch.lock"' EXIT

  repo="$(receipt_field "$(receipt_path)" repoRoot)"
  src="$(receipt_source)"
  enter_repo "${repo:-$PROJECT}"
  if (( $# )); then want=("$@")
  else
    [[ -r "$ledger" ]] || { printf 'MERGE-TRAIN BATCH | nothing waiting (no ledger at %s)\n' "$ledger"; exit 0; }
    while IFS= read -r u; do want+=("unit/$u"); done < <(ready_ids "$ledger")
  fi
  for b in ${want[@]+"${want[@]}"}; do
    tip="$(git rev-parse --verify --quiet "$b^{commit}")" || { printf 'MERGE-TRAIN BATCH | %s passed but has no branch; skipped\n' "$b"; continue; }
    git merge-base --is-ancestor "$tip" HEAD && continue
    awk -F'\t' -v b="$b" -v t="$tip" '$1 == b && $2 == t { f = 1 } END { exit !f }' "$MT/parked.tsv" 2>/dev/null && continue
    ready+=("$b")
  done
  (( ${#ready[@]} )) || { printf 'MERGE-TRAIN BATCH | nothing waiting\n'; exit 0; }

  TC="$(test_cmd)"
  say "MERGE-TRAIN BATCH | ${#ready[@]} unit(s) onto $(git rev-parse --abbrev-ref HEAD): ${ready[*]} | gate=${TC:-none}"
  solve "${ready[@]}"
  for b in ${units[@]+"${units[@]}"}; do wt_remove "$b"; done
  (( PARKED == 0 )) || halted="$PARKED unit(s) parked (REPAIR/CONFLICT lines above); the rest of the batch landed"
  finish "$src"
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
    && git checkout -q main && git worktree add -q .worktrees/u3 -b u3 \
    && ( cd .worktrees/u3 && echo c > c && git add c && git commit -qm u3 ) ) || { echo "SELFTEST UNDETERMINED fixture"; exit 2; }
  # test command goes red once u2's file is present: u1 lands+merges, u2 stops the train, u3 never runs
  out="$(MERGE_TRAIN_TEST_CMD='test ! -e bad' bash "$SELF" "$t/r" u1 u2 u3 2>&1)"; rc=$?
  if (( rc == 3 )) && grep -q '^MERGED: unit=u1 ' <<<"$out" \
     && ! grep -q 'unit=u3' <<<"$out" && [[ ! -e "$t/r/bad" ]] \
     && [[ "$(git -C "$t/r" log --merges --oneline | wc -l | tr -d ' ')" == 1 ]]; then
    echo "SELFTEST ok   u1 merged, red u2 undone and stops the train, u3 untried"
  else echo "SELFTEST FAIL stop-on-red: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  # green run over u3 alone pushes and proves trunk ancestry -> MERGED line
  out="$(MERGE_TRAIN_TEST_CMD='true' bash "$SELF" "$t/r" u3 2>&1)"; rc=$?
  if (( rc == 0 )) && grep -q '^MERGED: unit=u3 .* trunk=origin/main' <<<"$out" && [[ ! -e "$t/r/.worktrees/u3" ]]; then
    echo "SELFTEST ok   green unit pushed and MERGED only after ancestry proof; its worktree removed"
  else echo "SELFTEST FAIL merged: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  # batch on a profiled project: B1 B2 B3 passed their judges, B4 failed, B5 conflicts
  # with B1. One pass, one gate: B2 (red) is bisected out, B5 skipped, B1+B3 merged and
  # recorded once each through commands.merged; a second batch finds nothing waiting.
  mkdir -p "$t/p/state/spec-protocol"
  printf '{"documents":{"state":"state/state.json"},"commands":{"merged":["sh","rec.sh","{taskId}","{commit}","{branch}"]}}\n' > "$t/p/.spec-protocol.json"
  printf 'printf "%%s %%s %%s\\n" "$1" "$2" "$3" >> merged.txt\n' > "$t/p/rec.sh"
  printf '{"repoRoot":"%s","source":"existing"}\n' "$t/r" > "$t/p/state/repo-anchor.json"
  { for u in B1:PASS B2:PASS B3:PASS B4:FAIL B5:PASS; do
      printf '2026-01-01T00:00:00Z | QC-RECORD unit=%s judge=j bar=b | writer=ledger.sh\nbar-fetch=f\nverdict=%s\noutcome=PASSED\nblind=yes model-independence=PROVEN self-qc=no\nprovenance=STRIPPED\n' "${u%%:*}" "${u##*:}"
    done; } > "$t/p/state/spec-protocol/LEDGER.md"
  ( cd "$t/r" && for u in B1:f B2:bad2 B3:x3 B4:x4 B5:f; do
      git checkout -qb "unit/${u%%:*}" main && echo "${u%%:*}" > "${u##*:}" && git add -A && git commit -qm "${u%%:*}" || exit 1
    done && git checkout -q main ) || { echo "SELFTEST UNDETERMINED batch fixture"; exit 2; }
  out="$(MERGE_TRAIN_TEST_CMD='test ! -e bad2' bash "$SELF" "$t/p" --batch 2>&1)"; rc=$?
  if (( rc == 3 )) && grep -q '^MERGED: unit=unit/B1 ' <<<"$out" && grep -q '^MERGED: unit=unit/B3 ' <<<"$out" \
     && grep -q '^REPAIR: unit=unit/B2 reason=batch-gate-red log=' <<<"$out" && grep -q '^CONFLICT: unit=unit/B5 ' <<<"$out" \
     && ! grep -q 'unit/B4' <<<"$out" && [[ ! -e "$t/r/bad2" ]] \
     && [[ "$(awk '{print $1, $3}' "$t/p/merged.txt" 2>/dev/null | tr '\n' ,)" == "B1 unit/B1,B3 unit/B3," ]] \
     && [[ "$(MERGE_TRAIN_TEST_CMD='test ! -e bad2' bash "$SELF" "$t/p" --batch 2>&1)" == "MERGE-TRAIN BATCH | nothing waiting" ]]; then
    echo "SELFTEST ok   batch: red B2 bisected out, conflicting B5 skipped, B1+B3 merged in one push and recorded, rerun waits"
  else echo "SELFTEST FAIL batch: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  --project) PROJECT="${2:-}"; shift 2 || exit 1; PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd || printf '%s' "$PROJECT")" ;;
esac
if [[ "${2:-}" == --batch ]]; then
  PROJECT="$(cd "$1" 2>/dev/null && pwd)" || undetermined "cannot enter the project home $1"
  shift 2
  batch "$@"
fi
[[ $# -ge 2 ]] || { sed -n '2,64p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1; }
train "$@"
