#!/usr/bin/env bash
# release.sh — cut, tag, push and PROVE one release per repository.
#
#   release.sh <project> [--repo <name>] --version <x.y.z>
#   release.sh <project> [--repo <name>] --bump patch|minor|major
#   release.sh --selftest
#
# THE REPOSITORIES. <workdir>/repos.json (workdir = <project>/CONTROL, or
# <statedir>/spec-protocol on a profiled project): a JSON array of
# {"name","root","trunk","remote"} ({"repos": [...]} is read too). No registry: the
# one repo the repo-anchor receipt names (repoRoot, branch, remote), else <project>
# itself. Without --repo every registered repo is released in turn, and one repo's
# refusal never stops the next. "remote" is a git remote name or URL; empty means
# origin when the repo has one, else local-only.
#
# Per repo it REFUSES (RELEASE-REFUSED: repo=<name> reason=<why>) unless:
#   the trunk is checked out and clean (`git status --porcelain` empty);
#   the remote trunk, after a fetch, is already contained in the local trunk;
#   nothing waits in that repo's merge train: "waiting" means NOT YET PROVEN MERGED,
#     merge-train.sh's own rule -- no unit/<id> branch whose latest ledger QC-RECORD
#     passed (verdict=PASS or outcome=CLIENT-ACCEPTED) has a tip that is not an
#     ancestor of the just-fetched remote trunk (or of local HEAD, local-only), and
#     no requeue.tsv entry for this repo either;
#   the repo's gate is green: MERGE_TRAIN_TEST_CMD, else a real `npm test`, else none
#     (the gate merge-train.sh runs), killed after MERGE_TRAIN_GATE_TIMEOUT s (1800);
#   the tag v<x.y.z> is on neither the local repo nor the remote (a tag is never
#     moved). One exception, the retry after a refused push: the local annotated tag
#     already sits on HEAD and the remote lacks it; then only the push and proof run.
# Then: VERSION := x.y.z (created when missing); CHANGELOG.md's "## [Unreleased]"
# becomes "## [x.y.z] — <UTC date>" under a fresh empty [Unreleased] (file and
# heading created when missing); README.md's first line that says "version" and
# carries a semver gets the new one (else "Version: x.y.z" goes under its first
# heading; README.md is created when missing); one commit "release x.y.z"; the
# ANNOTATED tag v<x.y.z> (never lightweight); one atomic push of trunk plus tag.
#
# PROOF OF MINT, from the remote: `git ls-remote --tags` lists v<x.y.z> as an
# annotated tag (a peeled ^{} entry) whose commit is the release commit, and
# VERSION, CHANGELOG.md and README.md on that commit all carry x.y.z. Only then:
#   MINTED: repo=<name> version=<x.y.z> tag=v<x.y.z> commit=<sha>
# otherwise MINT-FAILED: repo=<name> reason=<why>. A local-only repo does all but
# the push, proves the same facts on the local tag, and prints
#   MINTED-LOCAL: repo=<name> version=<x.y.z> tag=v<x.y.z> commit=<sha>
# Every result line is also recorded: unprofiled -> CONTROL/LEDGER.md through
# tools/ledger.sh; profiled -> <workdir>/release.log (the project's state is never
# written).
#
# The --bump base: VERSION, else the highest v<semver> tag, else 0.0.0.
# An operator-owned repo (receipt "source": "operator-owner") pushes with
# SPEC_PROTOCOL_OPERATOR_GH_TOKEN exactly as merge-train.sh does: in git's env
# only, never printed, never in a URL or git config.
#
# Exit: 0 every repo MINTED / MINTED-LOCAL | 3 a repo refused or its mint failed |
#       2 undetermined | 1 usage
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
PROJECT="" ONLY="" VERSION_ARG="" BUMP="" WORST=0 OPTOK=""
SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+$'

usage() { sed -n '2,6p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1; }
worst() { (( $1 > WORST )) && WORST=$1; return 0; }

state_rel() { # documents.state's directory relative to <home>; empty when unprofiled
  [[ -f "$1/.spec-protocol.json" ]] || return 0
  local st
  st="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["documents"]["state"])' "$1/.spec-protocol.json" 2>/dev/null)" || return 1
  dirname "$st"
}

record() { # record <line> -- print it and file it where this project keeps its lines
  printf '%s\n' "$1"
  if [[ -f "$PROJECT/.spec-protocol.json" ]]; then
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$WORKDIR/release.log" 2>/dev/null
  else
    "$DIR/ledger.sh" "$PROJECT" CONTROL/LEDGER.md "$1" >/dev/null 2>&1
  fi
  return 0
}

# ---- the operator token (same rule as merge-train.sh) ------------------------------
operator_token() {
  local f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env" v="${SPEC_PROTOCOL_OPERATOR_GH_TOKEN:-}"
  if [[ -z "$v" && -r "$f" ]]; then
    v="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?SPEC_PROTOCOL_OPERATOR_GH_TOKEN[[:space:]]*=[[:space:]]*//p' "$f" | tail -n 1 | tr -d '\r')"
    v="${v%%[[:space:]]*}"; v="${v#[\"\']}"; v="${v%[\"\']}"
  fi
  printf '%s' "$v"
}
remote_git() {
  if [[ -n "$OPTOK" ]]; then
    GH_TOKEN="$OPTOK" git -c credential.helper= \
      -c 'credential.helper=!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' "$@"
  else
    git "$@"
  fi
}

# ---- the registry --------------------------------------------------------------------
IFS= read -r -d '' PYREPOS <<'PY' || true
import json, os, sys
workdir, receipt, home = sys.argv[1:4]
reg = os.path.join(workdir, "repos.json")
def out(name, root, trunk, remote, source=""):
    print("\x1f".join([name or os.path.basename(root.rstrip("/")), root, trunk or "", remote or "", source or ""]))
src = ""
try:
    rc = json.load(open(receipt))
    src = rc.get("source") or ""
except Exception:
    rc = None
if os.path.exists(reg):
    doc = json.load(open(reg))
    if isinstance(doc, dict):
        doc = doc.get("repos", [])
    for e in doc:
        root = e["root"] if os.path.isabs(e["root"]) else os.path.join(home, e["root"])
        s = src if rc and os.path.realpath(rc.get("repoRoot") or "") == os.path.realpath(root) else ""
        out(e.get("name"), root, e.get("trunk"), e.get("remote"), s)
elif rc and rc.get("repoRoot"):
    out("", rc["repoRoot"], rc.get("branch"), rc.get("remote"), src)
else:
    out("", home, "", "", "")
PY

remote_name() { # remote_name <registry remote> -- the git remote to push; empty = local-only
  local want="$1" r
  if [[ -z "$want" ]]; then git remote get-url origin >/dev/null 2>&1 && printf 'origin'; return 0; fi
  git remote get-url "$want" >/dev/null 2>&1 && { printf '%s' "$want"; return 0; }
  for r in $(git remote); do [[ "$(git remote get-url "$r")" == "$want" ]] && { printf '%s' "$r"; return 0; }; done
  return 1
}

# ---- the checks ----------------------------------------------------------------------
ready_ids() { # unit ids whose latest QC-RECORD passed (the rule merge-train.sh batches by)
  awk '
    /^[0-9][0-9][0-9][0-9]-/ { u = "" }
    /QC-RECORD unit=/ { match($0, /unit=[^ |]+/); u = substr($0, RSTART + 5, RLENGTH - 5)
                        if (!(u in seen)) { seen[u] = 1; order[++n] = u } }
    u != "" && /verdict=/ { match($0, /verdict=[A-Z-]+/); ok[u] = (substr($0, RSTART + 8, RLENGTH - 8) == "PASS") }
    u != "" && /outcome=CLIENT-ACCEPTED/ { ok[u] = 1 }
    END { for (i = 1; i <= n; i++) if (ok[order[i]]) print order[i] }' "$1"
}
waiting() { # waiting <ref> <repo-name> -- units NOT YET PROVEN MERGED, matching
            # merge-train.sh's own rule exactly: a unit's tip must be an ancestor
            # of <ref> (FETCH_HEAD's resolved sha when a remote trunk was just
            # fetched, else local HEAD) to count as merged, and a requeue.tsv
            # entry for THIS repo (merge-train.sh's take_requeue()) counts as
            # waiting too, the same as a ledger-ready unit.
  local ref="${1:-HEAD}" rname="${2:-}" u tip rq rn branch rest
  if [[ -r "$WORKDIR/LEDGER.md" ]]; then
    while IFS= read -r u; do
      tip="$(git rev-parse --verify --quiet "unit/$u^{commit}")" || continue
      git merge-base --is-ancestor "$tip" "$ref" || printf 'unit/%s ' "$u"
    done < <(ready_ids "$WORKDIR/LEDGER.md")
  fi
  rq="$WORKDIR/merge-train/requeue.tsv"
  if [[ -n "$rname" && -f "$rq" ]]; then
    while IFS=$'\t' read -r rn branch rest; do
      [[ "$rn" == "$rname" && -n "$branch" ]] || continue
      tip="$(git rev-parse --verify --quiet "$branch^{commit}")" || continue
      git merge-base --is-ancestor "$tip" "$ref" || printf '%s ' "$branch"
    done < "$rq"
  fi
}
test_cmd() {
  if [[ -n "${MERGE_TRAIN_TEST_CMD:-}" ]]; then printf '%s' "$MERGE_TRAIN_TEST_CMD"; return; fi
  [[ -f package.json ]] && python3 -c 'import json,sys
t=(json.load(open("package.json")).get("scripts") or {}).get("test","")
sys.exit(0 if t and "no test specified" not in t else 1)' 2>/dev/null && printf 'npm test'
}

next_version() { # next_version <base> <patch|minor|major>
  python3 - "$1" "$2" <<'PY'
import sys
a, b, c = map(int, sys.argv[1].split("."))
print({"patch": f"{a}.{b}.{c+1}", "minor": f"{a}.{b+1}.0", "major": f"{a+1}.0.0"}[sys.argv[2]])
PY
}
current_version() {
  local v
  v="$(tr -d '[:space:]' < VERSION 2>/dev/null)"
  [[ "$v" =~ $SEMVER_RE ]] && { printf '%s' "$v"; return; }
  v="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' | sed 's/^v//' | grep -E "$SEMVER_RE" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
  printf '%s' "${v:-0.0.0}"
}

# ---- the edits -----------------------------------------------------------------------
IFS= read -r -d '' PYEDIT <<'PY' || true
import os, re, sys
ver, date, name = sys.argv[1:4]
open("VERSION", "w").write(ver + "\n")
# CHANGELOG.md: [Unreleased] becomes this release, a fresh empty [Unreleased] above it.
text = open("CHANGELOG.md").read() if os.path.exists("CHANGELOG.md") else "# Changelog\n"
head = f"## [Unreleased]\n\n## [{ver}] — {date}\n"
m = re.search(r"^## \[Unreleased\][^\n]*\n", text, re.M)
if m:
    text = text[:m.start()] + head + text[m.end():]
else:
    t = re.search(r"^# [^\n]*\n", text, re.M)
    at = t.end() if t else 0
    text = text[:at] + "\n" + head + "\n- No entries were recorded under [Unreleased].\n\n" + text[at:].lstrip("\n")
open("CHANGELOG.md", "w").write(text.rstrip("\n") + "\n")
# README.md: the first "version" line carrying a semver, else a Version: line near the top.
SEM = re.compile(r"(?<![\d.])\d+\.\d+\.\d+(?!\.?\d)")
text = open("README.md").read() if os.path.exists("README.md") else f"# {name}\n"
lines = text.splitlines(True)
for i, l in enumerate(lines):
    if re.search(r"version", l, re.I) and SEM.search(l):
        lines[i] = SEM.sub(ver, l, count=1)
        break
else:
    at = next((i + 1 for i, l in enumerate(lines) if l.startswith("#")), 0)
    lines[at:at] = ["\n", f"Version: {ver}\n"] + (["\n"] if at < len(lines) else [])
open("README.md", "w").write("".join(lines))
PY

carries() { # carries <commit> <version> -- VERSION, CHANGELOG.md, README.md all say it
  local c="$1" v="$2" re
  re="(^|[^0-9.])${v//./\\.}([^0-9]|\$)"
  [[ "$(git show "$c:VERSION" 2>/dev/null | tr -d '[:space:]')" == "$v" ]] || { printf 'VERSION on the release commit is not %s' "$v"; return 1; }
  git show "$c:CHANGELOG.md" 2>/dev/null | grep -qF "## [$v]" || { printf 'CHANGELOG.md on the release commit has no [%s] section' "$v"; return 1; }
  git show "$c:README.md" 2>/dev/null | grep -i version | grep -qE "$re" || { printf 'README.md on the release commit has no version line saying %s' "$v"; return 1; }
}

# ---- one repo ------------------------------------------------------------------------
release_one() { # release_one <name> <root> <trunk> <registry remote> <receipt source>
  local name="$1" root="$2" trunk="$3" rem ver tag commit gate why out peeled resume=""
  refuse() { record "RELEASE-REFUSED: repo=$name reason=$1"; worst 3; }
  cd "$root" 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { printf 'RELEASE UNDETERMINED | repo=%s: %s is not a git working copy\n' "$name" "$root"; worst 2; return; }
  trunk="${trunk:-${MERGE_TRAIN_TRUNK:-main}}"
  rem="$(remote_name "$4")" || { printf 'RELEASE UNDETERMINED | repo=%s: no git remote matches the registry remote\n' "$name"; worst 2; return; }
  OPTOK=""
  if [[ -n "$rem" && "$5" == operator-owner ]]; then
    OPTOK="$(operator_token)"
    [[ -n "$OPTOK" ]] || { refuse "the repo is under the operator's owner and SPEC_PROTOCOL_OPERATOR_GH_TOKEN is not set in operator.env"; return; }
  elif [[ -n "$rem" && "$(git remote get-url "$rem")" == *github.com* ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh auth setup-git >/dev/null 2>&1 || true
  fi

  [[ "$(git rev-parse --abbrev-ref HEAD)" == "$trunk" ]] || { refuse "the trunk $trunk is not checked out ($(git rev-parse --abbrev-ref HEAD) is)"; return; }
  [[ -z "$(git status --porcelain)" ]] || { refuse "the trunk has uncommitted changes"; return; }
  local wait_ref=HEAD
  if [[ -n "$rem" ]]; then
    remote_git ls-remote --exit-code --heads "$rem" "$trunk" >/dev/null 2>&1; case $? in
      0) remote_git fetch --quiet "$rem" "$trunk" 2>/dev/null || { printf 'RELEASE UNDETERMINED | repo=%s: fetch of %s/%s failed\n' "$name" "$rem" "$trunk"; worst 2; return; }
         wait_ref="$(git rev-parse FETCH_HEAD)"
         git merge-base --is-ancestor "$wait_ref" HEAD || { refuse "$rem/$trunk has commits the local trunk lacks"; return; } ;;
      2) ;;  # the remote has no trunk yet: this push creates it
      *) printf 'RELEASE UNDETERMINED | repo=%s: git ls-remote %s failed\n' "$name" "$rem"; worst 2; return ;;
    esac
  fi
  out="$(waiting "$wait_ref" "$name")"
  [[ -z "$out" ]] || { refuse "units still waiting in the merge train: ${out% }"; return; }
  gate="$(test_cmd)"
  if [[ -n "$gate" ]] && ! perl -e 'alarm shift; exec @ARGV' "${MERGE_TRAIN_GATE_TIMEOUT:-1800}" bash -c "$gate" >/dev/null 2>&1; then
    refuse "the gate is red ($gate)"; return
  fi

  if [[ -n "$VERSION_ARG" ]]; then ver="$VERSION_ARG"; else ver="$(next_version "$(current_version)" "$BUMP")"; fi
  tag="v$ver"
  if [[ -n "$rem" ]] && remote_git ls-remote --tags "$rem" 2>/dev/null | awk -v r="refs/tags/$tag" '$2 == r { f = 1 } END { exit !f }'; then
    refuse "the tag $tag already exists on $rem; a tag is never moved"; return
  fi
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    if [[ -n "$rem" && "$(git cat-file -t "refs/tags/$tag")" == tag && "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse HEAD)" ]]; then
      resume=1   # the push of this release was refused earlier: push and prove it now
    else
      refuse "the tag $tag already exists; a tag is never moved"; return
    fi
  fi

  if [[ -z "$resume" ]]; then
    python3 -c "$PYEDIT" "$ver" "$(date -u +%Y-%m-%d)" "$name" || { record "MINT-FAILED: repo=$name reason=the VERSION/CHANGELOG/README edit failed"; worst 3; return; }
    git add VERSION CHANGELOG.md README.md && git commit -q -m "release $ver" \
      || { record "MINT-FAILED: repo=$name reason=the release commit failed"; worst 3; return; }
    git tag -a "$tag" -m "release $ver" || { record "MINT-FAILED: repo=$name reason=the annotated tag could not be created"; worst 3; return; }
  fi
  commit="$(git rev-parse HEAD)"

  if [[ -z "$rem" ]]; then
    why="$(carries "$commit" "$ver")" || { record "MINT-FAILED: repo=$name reason=$why"; worst 3; return; }
    if [[ "$(git cat-file -t "refs/tags/$tag")" == tag && "$(git rev-parse "$tag^{commit}")" == "$commit" ]]; then
      record "MINTED-LOCAL: repo=$name version=$ver tag=$tag commit=$commit"
    else
      record "MINT-FAILED: repo=$name reason=the local tag $tag is not an annotated tag on $commit"; worst 3
    fi
    return
  fi
  remote_git push --quiet --atomic "$rem" "HEAD:refs/heads/$trunk" "refs/tags/$tag" 2>/dev/null \
    || { record "MINT-FAILED: repo=$name reason=push of $trunk and $tag to $rem refused; the commit and tag are local only; re-run with --version $ver to retry the push"; worst 3; return; }
  out="$(remote_git ls-remote --tags "$rem" 2>/dev/null)" || { record "MINT-FAILED: repo=$name reason=git ls-remote $rem failed after the push"; worst 3; return; }
  peeled="$(awk -v r="refs/tags/$tag^{}" '$2 == r { print $1 }' <<<"$out")"
  [[ -n "$peeled" ]] || { record "MINT-FAILED: repo=$name reason=$rem has no annotated tag $tag"; worst 3; return; }
  [[ "$peeled" == "$commit" ]] || { record "MINT-FAILED: repo=$name reason=$tag on $rem points at $peeled, not the release commit $commit"; worst 3; return; }
  why="$(carries "$peeled" "$ver")" || { record "MINT-FAILED: repo=$name reason=$why"; worst 3; return; }
  record "MINTED: repo=$name version=$ver tag=$tag commit=$commit"
}

main() {
  local sd receipt found="" name root trunk remote src
  [[ -d "$1" ]] || { printf 'RELEASE UNDETERMINED | cannot enter the project home %s\n' "$1"; exit 2; }
  PROJECT="$(cd "$1" && pwd)"; shift
  while (( $# )); do
    case "$1" in
      --repo) ONLY="${2:-}"; shift 2 || usage ;;
      --version) VERSION_ARG="${2:-}"; shift 2 || usage ;;
      --bump) BUMP="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [[ -n "$VERSION_ARG" || -n "$BUMP" ]] && [[ -z "$VERSION_ARG" || -z "$BUMP" ]] || usage
  [[ -z "$VERSION_ARG" || "$VERSION_ARG" =~ $SEMVER_RE ]] || usage
  [[ -z "$BUMP" || "$BUMP" =~ ^(patch|minor|major)$ ]] || usage
  sd="$(state_rel "$PROJECT")" || { printf 'RELEASE UNDETERMINED | cannot read documents.state from %s/.spec-protocol.json\n' "$PROJECT"; exit 2; }
  if [[ -f "$PROJECT/.spec-protocol.json" ]]; then
    WORKDIR="$PROJECT/$sd/spec-protocol"; receipt="$PROJECT/$sd/repo-anchor.json"
  else
    WORKDIR="$PROJECT/CONTROL"; receipt="$PROJECT/CONTROL/repo-anchor.json"
  fi
  mkdir -p "$WORKDIR" 2>/dev/null
  local repos
  repos="$(python3 -c "$PYREPOS" "$WORKDIR" "$receipt" "$PROJECT" 2>/dev/null)" \
    || { printf 'RELEASE UNDETERMINED | cannot read %s/repos.json\n' "$WORKDIR"; exit 2; }
  while IFS=$'\x1f' read -r name root trunk remote src; do
    [[ -n "$root" ]] || continue
    [[ -z "$ONLY" || "$ONLY" == "$name" ]] || continue
    found=1
    ( release_one "$name" "$root" "$trunk" "$remote" "$src"; exit "$WORST" ); worst $?
  done <<<"$repos"
  [[ -n "$found" ]] || { printf 'RELEASE UNDETERMINED | no registered repo is named %s\n' "${ONLY:-<any>}"; exit 2; }
  exit "$WORST"
}

selftest() {
  local t out rc fails=0
  t="$(mktemp -d "${TMPDIR:-/tmp}/release-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  export GIT_AUTHOR_NAME=st GIT_AUTHOR_EMAIL=st@example.invalid GIT_COMMITTER_NAME=st GIT_COMMITTER_EMAIL=st@example.invalid
  unset MERGE_TRAIN_TEST_CMD
  git init -q --bare "$t/origin.git"
  git init -q -b main "$t/r"
  ( cd "$t/r" && printf '# App\n\nCurrent version: 0.1.0\n' > README.md && echo 0.1.0 > VERSION \
    && printf '# Changelog\n\n## [Unreleased]\n\n- a merged unit\n\n## [0.1.0] — 2026-01-01\n\n- first\n' > CHANGELOG.md \
    && git add -A && git commit -qm base && git remote add origin "$t/origin.git" && git push -q origin main ) \
    || { echo "SELFTEST UNDETERMINED fixture"; exit 2; }
  mkdir -p "$t/p/CONTROL"
  printf '[{"name":"app","root":"%s","trunk":"main","remote":"origin"}]\n' "$t/r" > "$t/p/CONTROL/repos.json"

  out="$(MERGE_TRAIN_TEST_CMD=true bash "$SELF" "$t/p" --bump minor 2>&1)"; rc=$?
  local c; c="$(git -C "$t/r" rev-parse HEAD)"
  if (( rc == 0 )) && grep -qx "MINTED: repo=app version=0.2.0 tag=v0.2.0 commit=$c" <<<"$out" \
     && git -C "$t/origin.git" ls-remote --tags . | grep -q "^$c	refs/tags/v0.2.0^{}\$" \
     && [[ "$(git -C "$t/origin.git" rev-parse main)" == "$c" ]] \
     && grep -q '^Current version: 0.2.0$' "$t/r/README.md" \
     && grep -q '^## \[0.2.0\] — ' "$t/r/CHANGELOG.md" && head -4 "$t/r/CHANGELOG.md" | grep -q '^## \[Unreleased\]$' \
     && grep -q 'MINTED: repo=app' "$t/p/CONTROL/LEDGER.md"; then
    echo "SELFTEST ok   0.2.0 minted: annotated tag on the remote at the release commit, VERSION/CHANGELOG/README moved, recorded"
  else echo "SELFTEST FAIL mint: rc=$rc"; printf '%s\n' "$out"; fails=1; fi

  echo junk > "$t/r/junk.txt"
  out="$(MERGE_TRAIN_TEST_CMD=true bash "$SELF" "$t/p" --bump patch 2>&1)"; rc=$?
  if (( rc == 3 )) && grep -q '^RELEASE-REFUSED: repo=app reason=the trunk has uncommitted changes' <<<"$out" \
     && ! git -C "$t/r" rev-parse -q --verify refs/tags/v0.2.1 >/dev/null \
     && ! git -C "$t/origin.git" ls-remote --tags . | grep -q v0.2.1; then
    echo "SELFTEST ok   a dirty trunk is refused and nothing is tagged"
  else echo "SELFTEST FAIL dirty: rc=$rc"; printf '%s\n' "$out"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  ''|-*) usage ;;
  *) main "$@" ;;
esac
