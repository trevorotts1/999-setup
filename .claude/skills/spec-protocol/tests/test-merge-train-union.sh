#!/usr/bin/env bash
# test-merge-train-union.sh — the CHANGELOG-only union resolver in tools/merge-train.sh.
#
# try_set/park are extracted FROM THE REAL SCRIPT BY FUNCTION NAME, so this test
# exercises the shipped code, not a copy. Two controls:
#   positive — three branches each insert a different section into a nested
#              CHANGELOG.md; all three must land, every section kept, no conflict
#              markers, clean tree, real 2-parent merge commits. Run from a
#              SUBDIRECTORY of the repo, which is where relative paths used to break.
#   negative — a conflict whose unmerged file is NOT CHANGELOG.md must still park
#              with a clean tree and no MERGE_HEAD (the resolver must not swallow it).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../tools/merge-train.sh"
fail=0
say_fail() { printf 'FAIL: %s\n' "$*" >&2; fail=1; }

[ -f "$SRC" ] || { say_fail "real script not found: $SRC"; exit 1; }

# Extract the two functions from the real script by name (starts at ^name(), ends at the first column-0 }).
extract_fn() { sed -n "/^$1() {/,/^}/p" "$SRC"; }
try_set_src="$(extract_fn try_set)"
park_src="$(extract_fn park)"
[[ -n "$try_set_src" ]] || { say_fail "try_set not found in $SRC"; exit 1; }
[[ -n "$park_src" ]] || { say_fail "park not found in $SRC"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

new_repo() { # new_repo <dir> — init a repo on main with a local identity
  local d="$1"
  git init -q "$d"
  git -C "$d" symbolic-ref HEAD refs/heads/main
  git -C "$d" config user.email t@example.com
  git -C "$d" config user.name t
}

# Load globals + the two real functions. say is a stub (the real one records to a project ledger).
load_train() {
  MT="$TMP/mt"; mkdir -p "$MT"
  TRIED=() TSHAS=() PARKED=0 PROJECT=""
  say() { printf '%s\n' "$*"; }
  eval "$park_src"
  eval "$try_set_src"
}

# ---- positive control: three CHANGELOG-only branches, nested path, subdir cwd ----
R1="$TMP/r1"
new_repo "$R1"
mkdir -p "$R1/pkg" "$R1/sub"
printf '# Changelog\n\n## [Unreleased]\n\n- base entry\n' > "$R1/pkg/CHANGELOG.md"
printf 'code\n' > "$R1/code.txt"
git -C "$R1" add -A
git -C "$R1" commit -qm base

for n in 42 43 44; do
  git -C "$R1" checkout -q -b "u$n" main
  printf '# Changelog\n\n## [Unreleased]\n\n## [2.7.%s]\n- section %s\n\n- base entry\n' "$n" "$n" > "$R1/pkg/CHANGELOG.md"
  git -C "$R1" commit -qam "insert 2.7.$n"
  git -C "$R1" checkout -q main
done

load_train
cd "$R1/sub"
try_set u42 u43 u44
rc=$?
cd "$HERE" || true
[ "$rc" = 0 ] || say_fail "positive: try_set returned $rc from a subdirectory cwd"
[ "${#TRIED[@]}" = 3 ] || say_fail "positive: TRIED=${#TRIED[@]} != 3 (not all three branches landed)"
[ "${PARKED:-0}" = 0 ] || say_fail "positive: PARKED=${PARKED:-0} != 0 (nothing should park)"
[ "$(git -C "$R1" rev-parse --abbrev-ref HEAD)" = "main" ] || say_fail "positive: HEAD is not main after try_set"

for n in 42 43 44; do
  grep -qF "## [2.7.$n]" "$R1/pkg/CHANGELOG.md" || say_fail "positive: section 2.7.$n lost by the union"
done
grep -qE '^(<<<<<<<|=======|>>>>>>>)' "$R1/pkg/CHANGELOG.md" && say_fail "positive: conflict markers left in pkg/CHANGELOG.md"
[ -z "$(git -C "$R1" status --porcelain)" ] || say_fail "positive: working tree not clean"

merges="$(git -C "$R1" rev-list --min-parents=2 --count HEAD)"
[ "$merges" = 3 ] || say_fail "positive: $merges 2-parent merge commits, expected 3"

# ---- negative control: a non-CHANGELOG conflict still parks, cleanly ----
R2="$TMP/r2"
new_repo "$R2"
mkdir -p "$R2/pkg"
printf '# Changelog\n\n## [Unreleased]\n\n- base entry\n' > "$R2/pkg/CHANGELOG.md"
printf 'line A\n' > "$R2/code.txt"
git -C "$R2" add -A
git -C "$R2" commit -qm base

git -C "$R2" checkout -q -b other main
printf 'line B\n' > "$R2/code.txt"
git -C "$R2" commit -qam "other edits code.txt"
git -C "$R2" checkout -q main
printf 'line C\n' > "$R2/code.txt"
git -C "$R2" commit -qam "main edits code.txt"

load_train
cd "$R2"
try_set other
cd "$HERE" || true
[ "${#TRIED[@]}" = 0 ] || say_fail "negative: TRIED non-empty (a non-CHANGELOG conflict must not land)"
[ "${PARKED:-0}" = 1 ] || say_fail "negative: PARKED=${PARKED:-0} != 1 (the conflict was not parked)"
[ -z "$(git -C "$R2" status --porcelain)" ] || say_fail "negative: working tree not clean (abort failed)"
[ ! -e "$R2/.git/MERGE_HEAD" ] || say_fail "negative: MERGE_HEAD left behind (merge not aborted)"
[ "$(cat "$R2/code.txt")" = "line C" ] || say_fail "negative: code.txt mangled"

if [ "$fail" = 0 ]; then echo "merge-train union resolver: OK"; fi
exit "$fail"
