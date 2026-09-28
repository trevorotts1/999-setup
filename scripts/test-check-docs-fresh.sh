#!/usr/bin/env bash
# Self-test for check-docs-fresh.sh. Proves the checker actually discriminates:
# it must PASS on the real repo right now (the known-good control) and FAIL on
# two known-bad mutations (a stale README version, a tag missing its
# CHANGELOG entry) — a checker that passes everything is worthless.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
CHECK="$REPO_ROOT/scripts/check-docs-fresh.sh"

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf 'PASS: %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

wt=""
cleanup() { [ -n "$wt" ] && git -C "$REPO_ROOT" worktree remove --force "$wt" >/dev/null 2>&1; return 0; }
trap cleanup EXIT

# 1. Known-good control: the real repo must pass right now.
if (cd "$REPO_ROOT" && bash "$CHECK") >/dev/null 2>&1; then
  ok "real repo passes check-docs-fresh.sh"
else
  bad "real repo should pass check-docs-fresh.sh but did not"
fi

# 2. Known-bad: a stale README version must fail.
wt="$(mktemp -d)/wt-stale-readme"
git -C "$REPO_ROOT" worktree add -q --detach "$wt" HEAD
perl -pi -e 's/`spec-protocol` [0-9]+\.[0-9]+\.[0-9]+,/`spec-protocol` 0.0.0,/' "$wt/README.md"
out="$( (cd "$wt" && bash "$CHECK") 2>&1 || true )"
if ! (cd "$wt" && bash "$CHECK") >/dev/null 2>&1 && printf '%s' "$out" | grep -q 'spec-protocol'; then
  ok "stale README version is caught"
else
  bad "stale README version was NOT caught (got: $out)"
fi
git -C "$REPO_ROOT" worktree remove --force "$wt"
wt=""

# 3. Known-bad: a tag with no CHANGELOG entry must fail.
wt="$(mktemp -d)/wt-missing-entry"
git -C "$REPO_ROOT" worktree add -q --detach "$wt" HEAD
latest_tag="$(git -C "$wt" tag -l 'v[0-9]*' | sort -V | tail -1)"
perl -0pi -e "s/## \[\Q${latest_tag#v}\E\].*?(?=\n## \[|\z)//s" "$wt/CHANGELOG.md"
out="$( (cd "$wt" && bash "$CHECK") 2>&1 || true )"
if ! (cd "$wt" && bash "$CHECK") >/dev/null 2>&1 && printf '%s' "$out" | grep -q "$latest_tag"; then
  ok "tag missing its CHANGELOG entry ($latest_tag) is caught"
else
  bad "missing CHANGELOG entry for $latest_tag was NOT caught (got: $out)"
fi
git -C "$REPO_ROOT" worktree remove --force "$wt"
wt=""

printf '\nSUITES: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
