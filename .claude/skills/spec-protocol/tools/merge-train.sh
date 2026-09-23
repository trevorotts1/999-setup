#!/usr/bin/env bash
# merge-train.sh — the one merge writer's mechanical half (references/pipeline.md
# Stage 5, "Land vs Merged").
#
#   merge-train.sh [--project <home>] <repo> <branch>...
#   merge-train.sh <home> --batch [--repo <name>] [<branch>...]
#   merge-train.sh --selftest
#
# ONE TRAIN PER REPO. A project may have more than one repository. The registry is
# <workdir>/repos.json (workdir = CONTROL/, or <state dir>/spec-protocol/ on a profiled
# project): {"repos": [...]} (or a bare array) of {"name","root","trunk","remote"},
# written by tools/repo-anchor.sh; remote is a remote name or a URL, null on a
# local-only repo.
# No registry = one repo: the repo-anchor receipt's repoRoot (else <home>), trunk
# MERGE_TRAIN_TRUNK (default main), remote origin, named after the root's basename.
# --batch without --repo runs EVERY registered repo's train at once, each in its own
# process under its own lock (<workdir>/merge-train/<name>/batch.lock; with no
# registry <workdir>/merge-train/batch.lock): one repo's red gate or slow suite never
# blocks another. Exit is the worst of the trains (2, else 3, else 0).
#
# --batch (the tick runs it every MERGE_BATCH_MINUTES, default 10). With no branches
# named, the batch is every unit/<id> branch whose latest QC-RECORD in the ledger
# (CONTROL/LEDGER.md, or <state dir>/spec-protocol/LEDGER.md on a profiled project)
# is verdict=PASS or outcome=CLIENT-ACCEPTED, plus every branch re-queued for this
# repo in <workdir>/merge-train/requeue.tsv (<repo>\t<branch>\t<reason>\t<time>, one
# line per unit, appended by the watcher; the batch takes the file with mv and puts
# back the other repos' lines). A unit is WAITING while its tip is not proven merged
# (below) and it is not parked at its current tip (a re-queued unit ignores parking).
# ONE pass: each unit merged --no-ff in ledger order, the test command run ONCE, pushed
# ONCE. A red gate is bisected (halves retried on top of what already passed) until
# the offending unit(s) are found; they are undone and parked with the failing output:
#   REPAIR: unit=<branch> reason=batch-gate-red log=<file>
# A conflicting unit is skipped, never blocking the rest, and parked for the
# conflict-resolver seat (haiku chain):
#   CONFLICT: unit=<branch> against=<integration branch> seat=conflict-resolver
# Parked units sit in <train dir>/parked.tsv and are retried once their branch tip
# moves (the repair or resolution committed). Nothing waiting prints
#   MERGE-TRAIN BATCH | nothing waiting    (exit 0)
# A second batch on the same repo while one runs prints
#   MERGE-TRAIN BATCH | already running    (exit 0)
# The gate is killed after MERGE_TRAIN_GATE_TIMEOUT seconds (default 1800) = red.
#
# PROOF OF MERGE — the only definition of merged. After the push, `git fetch`, then
# EACH landed unit's commit must be an ancestor of <remote>/<trunk> (or, on a
# local-only repo whose checked-out branch IS the trunk, of that local trunk):
#   MERGED: unit=<branch> commit=<sha> trunk=<remote>/<trunk> repo=<name>
# A unit that fails the proof is never recorded merged; it prints
#   MERGE-UNPROVEN: unit=<branch> repo=<name> reason=<why>
# and stays waiting, so the next batch retries it (exit 3). A local-only repo whose
# checked-out branch is not the trunk only LANDS: landed is never reported as merged.
#
# CLEANUP AFTER PROOF, every time, per proven unit: its worktree is removed (--force
# only when every uncommitted change in it is already in the proven trunk), its local
# branch deleted, its remote unit branch deleted when one was pushed, `git worktree
# prune` run, and its gate log and parked row (the files this train made for it)
# deleted:  CLEANED: unit=<branch> repo=<name> ...
# A worktree or branch whose commits are NOT proven merged is never deleted:
#   KEPT-UNMERGED: unit=<branch> repo=<name> reason=<why>
#
# CHANGELOG per merged batch: one line per proven unit appended under
# `## [Unreleased]` in the repo's CHANGELOG.md (file and heading created when
# missing), one follow-up commit in the same batch, pushed and proven. No version
# number is written here (tools/release.sh does that).
#
# Profiled project (.spec-protocol.json with commands.merged): once per MERGED unit
# the argv is run at <home>, never through a shell, with {taskId} (the branch's last
# path part) {commit} {branch} substituted. A hook failure prints
# MERGE-TRAIN | commands.merged failed ... and is never fatal.
#
# The single-unit form runs in <repo> on whatever branch is checked out, one unit at
# a time in the order given; a conflict or a red test STOPS the train (that merge is
# undone, nothing after it is tried). What landed before the stop is still pushed,
# proven, cleaned and changelogged. A green unit prints
#   LANDED: unit=<branch> commit=<sha> tests=<pass|none>
# `.worktrees/` goes in the repo's local info/exclude so live worktrees never dirty it.
# With --project, each line also goes to CONTROL/LEDGER.md through tools/ledger.sh
# (legacy) or <state dir>/merge-train.log (profiled), and a project whose repo-anchor
# receipt says "source": "operator-owner" pushes with the operator's
# SPEC_PROTOCOL_OPERATOR_GH_TOKEN (operator.env), handed to git only. Any other
# github.com remote (the client's own account): when gh is logged in,
# `gh auth setup-git` runs first so git has the client's credentials.
#
# The test command: MERGE_TRAIN_TEST_CMD when set, else `npm test` when
# package.json carries a real scripts.test (not npm's "no test specified"), else none.
#
# Exit: 0 every unit landed (and merged, when proof is possible) |
#       3 stopped: conflict, red test, push refused or a unit MERGE-UNPROVEN
#         (--batch: a unit was parked or unproven; the rest of the batch still landed) |
#       2 undetermined | 1 usage
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
TRUNK="${MERGE_TRAIN_TRUNK:-main}"
REMOTE=origin RNAME="" PROOF="" PROOF_LABEL=""
PROJECT="" REPO_ARG="" RD=""
landed=() units=() halted="" TC="" MT="" PARKED=0 TRIED=() TSHAS=() REQUEUED=()

say() { printf '%s\n' "$*"; [[ -n "$PROJECT" ]] && record "$PROJECT" "$*"; return 0; }
stop() { printf 'MERGE-TRAIN STOP | %s\n' "$*"; exit 3; }
undetermined() { printf 'MERGE-TRAIN UNDETERMINED | %s\n' "$*"; exit 2; }

state_rel() { # state_rel <home> -- documents.state's directory relative to <home>; empty when unprofiled
  [[ -f "$1/.spec-protocol.json" ]] || return 0
  local st
  st="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["documents"]["state"])' "$1/.spec-protocol.json" 2>/dev/null)" || return 1
  dirname "$st"
}

record_file() { # record_file <home> -- where this train's lines are recorded
  local sd
  if [[ -f "$1/.spec-protocol.json" ]]; then sd="$(state_rel "$1")" || return 1; printf '%s' "$1/$sd/merge-train.log"
  else printf '%s' "$1/CONTROL/LEDGER.md"; fi
}

record() { # record <home> <line>
  if [[ -f "$1/.spec-protocol.json" ]]; then
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$(record_file "$1")"
  else
    "$DIR/ledger.sh" "$1" CONTROL/LEDGER.md "$2" >/dev/null
  fi
}

wt_path() { # wt_path <branch> -- the worktree that has <branch> checked out (not the main one)
  local p
  p="$(git worktree list --porcelain | awk -v b="branch refs/heads/$1" '/^worktree /{w=substr($0,10)} $0==b{print w}')"
  [[ -n "$p" && "$p" != "$(git rev-parse --show-toplevel)" ]] && printf '%s' "$p"
  return 0
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
remote_url() { git remote get-url "$REMOTE" 2>/dev/null || { [[ "$REMOTE" == *[/:]* ]] && printf '%s' "$REMOTE"; }; }
has_remote() { [[ -n "$REMOTE" && -n "$(remote_url)" ]]; } # a remote name, or a URL used as-is
creds() { # creds <receipt source> -- arrange push/fetch credentials; never fatal here
  has_remote || return 0
  if [[ "$1" == operator-owner ]]; then
    OPTOK="$(operator_token)"
  elif [[ "$(remote_url)" == *github.com* ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    # A repo on the client's own account: gh holds the login, git needs it as a
    # credential helper. Idempotent; a failure here surfaces as the push refusal.
    gh auth setup-git >/dev/null 2>&1 || true
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
  [[ -n "$RNAME" ]] || RNAME="$(basename "$(git rev-parse --show-toplevel)")"
}

# ---- after proof: CHANGELOG and cleanup --------------------------------------------

IFS= read -r -d '' PYCHANGELOG <<'PY' || true
import os, sys
path, add = sys.argv[1], sys.argv[2].rstrip("\n").split("\n")
lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else ["# Changelog"]
h = next((i for i, l in enumerate(lines) if l.strip().lower().startswith("## [unreleased]")), None)
if h is None:  # the heading goes above the first release section, else at the end
    h = next((i for i, l in enumerate(lines) if l.startswith("## ")), len(lines))
    lines[h:h] = ["## [Unreleased]", ""]
    if h > 0 and lines[h - 1].strip():
        lines.insert(h, ""); h += 1
end = next((i for i in range(h + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
j = end
while j > h + 1 and not lines[j - 1].strip():
    j -= 1
lines[j:end] = ([""] if j == h + 1 else []) + add + ([""] if end < len(lines) else [])
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
changelog() { # changelog <index>... -- one line per proven unit, one commit, pushed and proven
  (( $# )) || return 0
  local i add="" sha
  for i in "$@"; do
    add+="- ${units[$i]}: $(git log -1 --format=%s "${units[$i]}" 2>/dev/null || echo merged) (merge ${landed[$i]:0:12})"$'\n'
  done
  python3 -c "$PYCHANGELOG" CHANGELOG.md "$add" && git add CHANGELOG.md \
    && git commit -q -m "changelog: merge batch, $# unit(s) [$RNAME]" >/dev/null 2>&1 \
    || { say "MERGE-TRAIN | CHANGELOG.md could not be committed in $RNAME"; return 0; }
  sha="$(git rev-parse HEAD)"
  has_remote || return 0
  if remote_git push --quiet "$REMOTE" "HEAD:refs/heads/$TRUNK" 2>&1 && remote_git fetch --quiet "$REMOTE" "$TRUNK" 2>&1 \
     && git merge-base --is-ancestor "$sha" FETCH_HEAD; then PROOF="$(git rev-parse FETCH_HEAD)"
  else say "MERGE-TRAIN | CHANGELOG commit $sha is not proven on $PROOF_LABEL; the next batch's push carries it"; fi
}

contained() { # contained <worktree> -- every uncommitted change in it already exists at $PROOF
  local f want
  while IFS= read -r -d '' f; do
    want="$(git rev-parse -q --verify "$PROOF:$f" 2>/dev/null)"
    if [[ -e "$1/$f" || -L "$1/$f" ]]; then
      [[ -n "$want" && "$(git -C "$1" hash-object -- "$f" 2>/dev/null)" == "$want" ]] || return 1
    else
      [[ -z "$want" ]] || return 1
    fi
  done < <(git -C "$1" diff --name-only -z HEAD; git -C "$1" ls-files --others --exclude-standard -z)
  return 0
}

cleanup() { # cleanup <branch> -- only ever called for a unit whose merge is proven
  local b="$1" tip p force="" rb=none
  tip="$(git rev-parse --verify --quiet "$b^{commit}")" || return 0
  if ! git merge-base --is-ancestor "$tip" "$PROOF"; then
    say "KEPT-UNMERGED: unit=$b repo=$RNAME reason=branch tip $tip has commits not proven merged into $PROOF_LABEL"; return 0
  fi
  p="$(wt_path "$b")"
  if [[ -n "$p" ]]; then
    if [[ -n "$(git -C "$p" status --porcelain 2>/dev/null)" ]]; then
      contained "$p" || { say "KEPT-UNMERGED: unit=$b repo=$RNAME reason=worktree $p has uncommitted changes the merge does not contain"; return 0; }
      force=--force
    fi
    git worktree remove $force "$p" >/dev/null 2>&1 \
      || { say "KEPT-UNMERGED: unit=$b repo=$RNAME reason=git worktree remove failed for $p"; return 0; }
  fi
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "$b" ]] || git branch -D "$b" >/dev/null 2>&1
  if has_remote && git ls-remote --exit-code "$REMOTE" "refs/heads/$b" >/dev/null 2>&1; then
    remote_git push --quiet "$REMOTE" --delete "$b" >/dev/null 2>&1 && rb=deleted || rb=delete-refused
  fi
  if [[ -n "$MT" ]]; then
    rm -f "$MT/$(printf '%s' "$b" | tr '/' '_').gate.log"
    [[ -f "$MT/parked.tsv" ]] && awk -F'\t' -v b="$b" '$1 != b' "$MT/parked.tsv" > "$MT/parked.tsv.$$" && mv "$MT/parked.tsv.$$" "$MT/parked.tsv"
  fi
  say "CLEANED: unit=$b repo=$RNAME worktree=${p:-none} branch=deleted remote-branch=$rb"
}

# Push once, PROVE each landed unit, run commands.merged, CHANGELOG, clean up, report the stop last.
finish() { # finish <receipt source>
  local i b unproven=0
  local -a proven=()
  if (( ${#landed[@]} == 0 )); then [[ -n "$halted" ]] && stop "$halted"; exit 0; fi
  if has_remote; then
    creds "$1"
    [[ "$1" != operator-owner || -n "$OPTOK" ]] \
      || stop "the repo is under the operator's owner and SPEC_PROTOCOL_OPERATOR_GH_TOKEN is not set in operator.env; units are landed, not merged"
    remote_git push --quiet "$REMOTE" "HEAD:refs/heads/$TRUNK" 2>&1 || stop "push to $REMOTE/$TRUNK refused; units are landed, not merged"
    remote_git fetch --quiet "$REMOTE" "$TRUNK" 2>&1 || undetermined "fetch of $REMOTE/$TRUNK failed after the push; nothing is recorded merged"
    PROOF="$(git rev-parse FETCH_HEAD)"; PROOF_LABEL="$REMOTE/$TRUNK"
  elif [[ "$(git rev-parse --abbrev-ref HEAD)" == "$TRUNK" ]]; then
    PROOF="$(git rev-parse "refs/heads/$TRUNK")"; PROOF_LABEL="$TRUNK(local)"
  else
    printf 'MERGE-TRAIN | no remote and %s is not the trunk: landed only, not merged\n' "$(git rev-parse --abbrev-ref HEAD)"
    [[ -n "$halted" ]] && stop "$halted"; exit 0
  fi
  for i in "${!landed[@]}"; do
    if git merge-base --is-ancestor "${landed[$i]}" "$PROOF"; then
      say "MERGED: unit=${units[$i]} commit=${landed[$i]} trunk=$PROOF_LABEL repo=$RNAME"
      merged_hook "${units[$i]}" "${landed[$i]}"
      proven+=("$i")
    else
      say "MERGE-UNPROVEN: unit=${units[$i]} repo=$RNAME reason=commit ${landed[$i]} is not an ancestor of $PROOF_LABEL after fetch; re-queued"
      say "KEPT-UNMERGED: unit=${units[$i]} repo=$RNAME reason=merge not proven"
      unproven=$((unproven + 1))
    fi
  done
  changelog ${proven[@]+"${proven[@]}"}
  for i in ${proven[@]+"${proven[@]}"}; do cleanup "${units[$i]}"; done
  git worktree prune >/dev/null 2>&1
  (( unproven == 0 )) || halted="${halted:+$halted; }$unproven unit(s) MERGE-UNPROVEN, waiting for the next batch"
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

registry() { # registry <repos.json> -- name<TAB>root<TAB>trunk<TAB>remote per entry ("-" = no remote)
  python3 - "$1" "$PROJECT" <<'PY'
import json, os, re, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
repos = doc.get("repos") if isinstance(doc, dict) else doc
if not isinstance(repos, list):
    sys.exit(2)
for r in repos:
    name, root = r.get("name") or "", r.get("root") or ""
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name) or not root:
        sys.exit(2)
    print("\t".join([name, os.path.join(sys.argv[2], root), r.get("trunk") or "main", r.get("remote") or "-"]))
PY
}

all_repos() { # all_repos <repos.json> [<branch>...] -- every registered repo's train, in parallel
  local reg="$1" out n rc worst=0 i=0
  shift
  local -a names=() pids=()
  out="$(registry "$reg")" || undetermined "cannot read the repo registry $reg"
  while IFS=$'\t' read -r n _; do [[ -n "$n" ]] && names+=("$n"); done <<<"$out"
  (( ${#names[@]} )) || { printf 'MERGE-TRAIN BATCH | nothing waiting (no repos in %s)\n' "$reg"; exit 0; }
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/mtrain-all.XXXXXX")" || undetermined "cannot create a temp dir"
  for n in "${names[@]}"; do
    bash "$SELF" "$PROJECT" --batch --repo "$n" "$@" > "$tmp/$n.out" 2>&1 & pids+=("$!")
  done
  for n in "${names[@]}"; do
    wait "${pids[$i]}"; rc=$?; i=$((i + 1))
    cat "$tmp/$n.out"
    if (( rc == 2 || worst == 2 )); then worst=2; elif (( rc != 0 )); then worst=3; fi
  done
  rm -rf "$tmp"
  exit "$worst"
}

take_requeue() { # take_requeue -- this repo's lines of requeue.tsv into REQUEUED; the rest go back
  local rq="$RD/merge-train/requeue.tsv" line rest
  [[ -f "$rq" ]] && mv "$rq" "$rq.$$" 2>/dev/null || return 0
  # ponytail: a watcher append racing the mv lands in the moved file; lost only if it is written after the read below.
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || continue
    rest="${line#*$'\t'}"
    if [[ "${line%%$'\t'*}" == "$RNAME" ]]; then REQUEUED+=("${rest%%$'\t'*}"); else printf '%s\n' "$line" >> "$rq"; fi
  done < "$rq.$$"
  rm -f "$rq.$$"
}

elsewhere() { # elsewhere <branch> -- the unit belongs to another registered repo, or was already merged and cleaned
  local r
  grep -qF "MERGED: unit=$1 " "$(record_file "$PROJECT")" 2>/dev/null && return 0
  for r in ${OTHER_ROOTS[@]+"${OTHER_ROOTS[@]}"}; do git -C "$r" rev-parse --verify --quiet "$1^{commit}" >/dev/null && return 0; done
  return 1
}

batch() { # batch [--repo <name>] [<branch>...]
  local sd ledger repo="" src b tip pid u wait_ref n root tr rem reg
  local -a want=() ready=()
  OTHER_ROOTS=()
  if [[ "${1:-}" == --repo ]]; then REPO_ARG="${2:-}"; [[ -n "$REPO_ARG" ]] || { echo "--repo needs a name"; exit 1; }; shift 2; fi
  sd="$(state_rel "$PROJECT")" || undetermined "cannot read documents.state from $PROJECT/.spec-protocol.json"
  if [[ -f "$PROJECT/.spec-protocol.json" ]]; then RD="$PROJECT/$sd/spec-protocol"; else RD="$PROJECT/CONTROL"; fi
  ledger="$RD/LEDGER.md"; reg="$RD/repos.json"
  if [[ -f "$reg" ]]; then
    [[ -n "$REPO_ARG" ]] || all_repos "$reg" "$@"
    while IFS=$'\t' read -r n root tr rem; do
      [[ -n "$n" ]] || continue
      if [[ "$n" == "$REPO_ARG" ]]; then repo="$root"; TRUNK="$tr"; REMOTE="$rem"; [[ "$rem" != - ]] || REMOTE=""
      else OTHER_ROOTS+=("$root"); fi
    done < <(registry "$reg" || echo)
    [[ -n "$repo" ]] || undetermined "no repo named '$REPO_ARG' in $reg"
    RNAME="$REPO_ARG"; MT="$RD/merge-train/$RNAME"
  else
    repo="$(receipt_field "$(receipt_path)" repoRoot)"; repo="${repo:-$PROJECT}"
    RNAME="$(basename "$repo")"; MT="$RD/merge-train"
    [[ -z "$REPO_ARG" || "$REPO_ARG" == "$RNAME" ]] || undetermined "no repo registry at $reg, and the one repo is '$RNAME', not '$REPO_ARG'"
  fi
  mkdir -p "$MT" || undetermined "cannot create $MT"
  if ! mkdir "$MT/batch.lock" 2>/dev/null; then
    pid="$(cat "$MT/batch.lock/pid" 2>/dev/null)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then printf 'MERGE-TRAIN BATCH | already running (pid %s)\n' "$pid"; exit 0; fi
    rm -rf "$MT/batch.lock"; mkdir "$MT/batch.lock" 2>/dev/null || undetermined "cannot take the lock $MT/batch.lock"
  fi
  echo $$ > "$MT/batch.lock/pid"
  trap 'rm -rf "$MT/batch.lock"' EXIT

  src="$(receipt_source)"
  enter_repo "$repo"
  # Waiting = not proven merged: not an ancestor of <remote>/<trunk> after a fetch
  # (best effort here; the proof after the push is not), else of local HEAD.
  wait_ref=HEAD
  if has_remote; then
    creds "$src"
    remote_git fetch --quiet "$REMOTE" "$TRUNK" >/dev/null 2>&1 && wait_ref="$(git rev-parse FETCH_HEAD)"
  fi
  take_requeue
  if (( $# )); then want=("$@")
  elif [[ -r "$ledger" ]]; then
    while IFS= read -r u; do want+=("unit/$u"); done < <(ready_ids "$ledger")
  fi
  for b in ${REQUEUED[@]+"${REQUEUED[@]}"}; do [[ " ${want[*]-} " == *" $b "* ]] || want+=("$b"); done
  for b in ${want[@]+"${want[@]}"}; do
    tip="$(git rev-parse --verify --quiet "$b^{commit}")" || {
      elsewhere "$b" || printf 'MERGE-TRAIN BATCH | %s passed but has no branch in %s; skipped\n' "$b" "$RNAME"; continue; }
    git merge-base --is-ancestor "$tip" "$wait_ref" && continue
    if [[ " ${REQUEUED[*]-} " != *" $b "* ]]; then
      awk -F'\t' -v b="$b" -v t="$tip" '$1 == b && $2 == t { f = 1 } END { exit !f }' "$MT/parked.tsv" 2>/dev/null && continue
    fi
    ready+=("$b")
  done
  (( ${#ready[@]} )) || { printf 'MERGE-TRAIN BATCH | nothing waiting\n'; exit 0; }

  TC="$(test_cmd)"
  say "MERGE-TRAIN BATCH | repo=$RNAME ${#ready[@]} unit(s) onto $(git rev-parse --abbrev-ref HEAD): ${ready[*]} | gate=${TC:-none}"
  solve "${ready[@]}"
  (( PARKED == 0 )) || halted="$PARKED unit(s) parked (REPAIR/CONFLICT lines above); the rest of the batch landed"
  finish "$src"
}

selftest() {
  local t out rc fails=0
  t="$(mktemp -d "${TMPDIR:-/tmp}/mtrain-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  export GIT_AUTHOR_NAME=st GIT_AUTHOR_EMAIL=st@example.invalid GIT_COMMITTER_NAME=st GIT_COMMITTER_EMAIL=st@example.invalid
  unset MERGE_TRAIN_TRUNK
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
  # green run over u3 alone pushes and proves trunk ancestry -> MERGED line, then cleanup
  out="$(MERGE_TRAIN_TEST_CMD='true' bash "$SELF" "$t/r" u3 2>&1)"; rc=$?
  if (( rc == 0 )) && grep -q '^MERGED: unit=u3 .* trunk=origin/main repo=r' <<<"$out" && [[ ! -e "$t/r/.worktrees/u3" ]] \
     && ! git -C "$t/r" rev-parse --verify --quiet u3 >/dev/null; then
    echo "SELFTEST ok   green unit pushed and MERGED only after ancestry proof; its worktree and branch removed"
  else echo "SELFTEST FAIL merged: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  # batch on a profiled project: B1 B2 B3 passed their judges, B4 failed, B5 conflicts
  # with B1. One pass, one gate: B2 (red) is bisected out, B5 skipped, B1+B3 merged and
  # recorded once each through commands.merged; a second batch finds nothing waiting.
  mkdir -p "$t/p/state/spec-protocol"
  printf '{"documents":{"state":"state/state.json"},"commands":{"merged":["sh","rec.sh","{taskId}","{commit}","{branch}"]}}\n' > "$t/p/.spec-protocol.json"
  printf 'printf "%%s %%s %%s\\n" "$1" "$2" "$3" >> merged.txt\n' > "$t/p/rec.sh"
  printf '{"repoRoot":"%s","source":"existing"}\n' "$t/r" > "$t/p/state/repo-anchor.json"
  qc() { local u; for u in "$@"; do
      printf '2026-01-01T00:00:00Z | QC-RECORD unit=%s judge=j bar=b | writer=ledger.sh\nbar-fetch=f\nverdict=%s\noutcome=PASSED\nblind=yes model-independence=PROVEN self-qc=no\nprovenance=STRIPPED\n' "${u%%:*}" "${u##*:}"
    done; }
  qc B1:PASS B2:PASS B3:PASS B4:FAIL B5:PASS > "$t/p/state/spec-protocol/LEDGER.md"
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

  # A2+A3+A4: proof of merge, cleanup after proof, CHANGELOG. The remote's post-receive
  # hook rolls main back, so the push "succeeds" but the fetch shows the units absent:
  # both are MERGE-UNPROVEN and KEPT. Hook removed -> the re-queued units merge; P1's
  # worktree, local and remote branch and gate log are deleted; P2's worktree holds an
  # uncommitted file the merge lacks, so P2 is KEPT-UNMERGED; CHANGELOG lists both.
  git init -q --bare "$t/q.git"; git init -q -b main "$t/q"
  mkdir -p "$t/p2/state/spec-protocol/merge-train"
  printf '{"documents":{"state":"state/state.json"}}\n' > "$t/p2/.spec-protocol.json"
  printf '{"repoRoot":"%s","source":"existing"}\n' "$t/q" > "$t/p2/state/repo-anchor.json"
  qc P1:PASS P2:PASS > "$t/p2/state/spec-protocol/LEDGER.md"
  echo old-red > "$t/p2/state/spec-protocol/merge-train/unit_P1.gate.log"
  ( cd "$t/q" && echo base > f && git add f && git commit -qm base && git remote add origin "$t/q.git" && git push -q origin main \
    && for u in P1 P2; do git worktree add -q ".worktrees/$u" -b "unit/$u" main && ( cd ".worktrees/$u" && echo "$u" > "$u" && git add "$u" && git commit -qm "unit $u" ) || exit 1; done \
    && git push -q origin unit/P1 && echo scratch > .worktrees/P2/uncommitted ) || { echo "SELFTEST UNDETERMINED proof fixture"; exit 2; }
  printf '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && git update-ref refs/heads/main "$old"; done; exit 0\n' > "$t/q.git/hooks/post-receive"
  chmod +x "$t/q.git/hooks/post-receive"
  out="$(MERGE_TRAIN_TEST_CMD=true bash "$SELF" "$t/p2" --batch 2>&1)"; rc=$?
  local ok1=0
  (( rc == 3 )) && grep -q '^MERGE-UNPROVEN: unit=unit/P1 repo=q reason=' <<<"$out" && grep -q '^KEPT-UNMERGED: unit=unit/P1 ' <<<"$out" \
    && ! grep -q '^MERGED:' <<<"$out" && [[ -d "$t/q/.worktrees/P1" ]] && git -C "$t/q" rev-parse -q --verify unit/P1 >/dev/null && ok1=1
  rm -f "$t/q.git/hooks/post-receive"
  out2="$(MERGE_TRAIN_TEST_CMD=true bash "$SELF" "$t/p2" --batch 2>&1)"; rc=$?
  if (( ok1 && rc == 0 )) && grep -q '^MERGED: unit=unit/P1 .* repo=q' <<<"$out2" && grep -q '^CLEANED: unit=unit/P1 .*remote-branch=deleted' <<<"$out2" \
     && [[ ! -e "$t/q/.worktrees/P1" && ! -e "$t/p2/state/spec-protocol/merge-train/unit_P1.gate.log" ]] \
     && ! git -C "$t/q" rev-parse -q --verify unit/P1 >/dev/null && ! git -C "$t/q.git" rev-parse -q --verify unit/P1 >/dev/null \
     && grep -q '^KEPT-UNMERGED: unit=unit/P2 .*uncommitted' <<<"$out2" && [[ -f "$t/q/.worktrees/P2/uncommitted" ]] \
     && git -C "$t/q.git" show main:CHANGELOG.md 2>/dev/null | awk '/^## \[Unreleased\]/{s=1} s' | grep -q '^- unit/P1: unit P1' \
     && git -C "$t/q.git" show main:CHANGELOG.md | grep -q '^- unit/P2: unit P2'; then
    echo "SELFTEST ok   proof: unproven units kept and re-queued; once proven, P1 cleaned (worktree, branch, remote branch, gate log), dirty P2 kept, CHANGELOG lists both"
  else echo "SELFTEST FAIL proof/cleanup: first rc=3? ok1=$ok1 second rc=$rc"; printf '%s\n--\n%s\n' "$out" "$out2"; fails=1; fi

  # A1: two repos in one registry. x's unit turns the gate red, y's is green: both
  # trains run, x parks X1, y merges Y1. Then a re-queue line for x retries parked X1.
  mkdir -p "$t/m/state/spec-protocol"
  printf '{"documents":{"state":"state/state.json"}}\n' > "$t/m/.spec-protocol.json"
  for n in x y; do
    git init -q --bare "$t/$n.git"; git init -q -b main "$t/$n"
    ( cd "$t/$n" && echo base > f && git add f && git commit -qm base && git remote add origin "$t/$n.git" && git push -q origin main \
      && git checkout -qb "unit/$(tr a-z A-Z <<<"$n")1" && echo "$n" > "$([[ $n == x ]] && echo bad3 || echo ok)" && git add -A && git commit -qm "$n 1" \
      && git checkout -q main ) || { echo "SELFTEST UNDETERMINED two-repo fixture"; exit 2; }
  done
  # y's remote is given as a URL (a path), not a remote name
  printf '{"repos":[{"name":"x","root":"%s","trunk":"main","remote":"origin"},{"name":"y","root":"%s","trunk":"main","remote":"%s"}]}\n' "$t/x" "$t/y" "$t/y.git" > "$t/m/state/spec-protocol/repos.json"
  qc X1:PASS Y1:PASS > "$t/m/state/spec-protocol/LEDGER.md"
  out="$(MERGE_TRAIN_TEST_CMD='test ! -e bad3' bash "$SELF" "$t/m" --batch 2>&1)"; rc=$?
  printf 'x\tunit/X1\tselftest\t2026-01-01T00:00:00Z\ny\tunit/none\tkeep\t2026-01-01T00:00:00Z\n' > "$t/m/state/spec-protocol/merge-train/requeue.tsv"
  out2="$(MERGE_TRAIN_TEST_CMD='test ! -e bad3' bash "$SELF" "$t/m" --batch --repo x 2>&1)"
  if (( rc == 3 )) && grep -q '^REPAIR: unit=unit/X1 ' <<<"$out" && grep -q '^MERGED: unit=unit/Y1 .* repo=y' <<<"$out" \
     && ! grep -q 'no branch' <<<"$out" && [[ -f "$t/m/state/spec-protocol/merge-train/x/parked.tsv" ]] \
     && grep -q '^REPAIR: unit=unit/X1 ' <<<"$out2" && [[ "$(cut -f1,2 "$t/m/state/spec-protocol/merge-train/requeue.tsv")" == $'y\tunit/none' ]]; then
    echo "SELFTEST ok   two repos: x's red gate parks X1 while y's train merges Y1; a re-queue line retries parked X1"
  else echo "SELFTEST FAIL two-repo: rc=$rc"; printf '%s\n--\n%s\n' "$out" "$out2"; fails=1; fi
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
[[ $# -ge 2 ]] || { sed -n '2,89p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1; }
train "$@"
