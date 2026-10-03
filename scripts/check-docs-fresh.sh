#!/usr/bin/env bash
# Fails when the docs have drifted from the source of truth:
#   1. README.md's per-skill version line disagrees with that skill's VERSION file.
#   2. The latest release tag (v*, and nine-router-setup-v* when present) disagrees
#      with the corresponding VERSION file or with what README.md states.
#   3. Any annotated release tag has no dated entry in CHANGELOG.md.
#   4. CONTROL/bundled-components.json's recorded version per skill disagrees
#      with that skill's VERSION file.
# Read-only. Needs full tag history (`git fetch --tags` / `fetch-depth: 0` in CI).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
say() { printf '%s\n' "$*" >&2; }

skill_version() { tr -d '[:space:]' < ".claude/skills/$1/VERSION" 2>/dev/null; }
component_version() {
  grep -A3 "\"$1\": \[" CONTROL/bundled-components.json 2>/dev/null \
    | grep -o '"version"[^,}]*' | head -1 | sed -E 's/.*"([^"]+)"[[:space:]]*$/\1/'
}

# --- 1. README vs each skill's VERSION file -------------------------------
for skill in spec-protocol nine-router-setup kaizen eli5 bro blackceo-signature-page hook-skill; do
  ver="$(skill_version "$skill")"
  if [ -z "$ver" ]; then
    say "FAIL: .claude/skills/$skill/VERSION is missing or empty"
    fail=1
    continue
  fi
  if ! grep -qF "\`$skill\` $ver" README.md; then
    say "FAIL: README.md does not state \`$skill\` $ver (its current VERSION file)"
    fail=1
  fi
done

# --- 1b. CONTROL/bundled-components.json vs each skill's VERSION file -----
if [ -f CONTROL/bundled-components.json ]; then
  for skill in spec-protocol nine-router-setup kaizen eli5 bro blackceo-signature-page hook-skill; do
    ver="$(skill_version "$skill")"
    [ -z "$ver" ] && continue  # already reported above
    recorded="$(component_version "$skill")"
    if [ -z "$recorded" ]; then
      say "FAIL: CONTROL/bundled-components.json has no version recorded for $skill"
      fail=1
    elif [ "$recorded" != "$ver" ]; then
      say "FAIL: CONTROL/bundled-components.json records $skill $recorded, VERSION file says $ver"
      fail=1
    fi
  done
fi

# --- 2. Latest tag vs VERSION file / README --------------------------------
latest_main_tag="$(git tag -l 'v[0-9]*' | sort -V | tail -1)"
if [ -n "$latest_main_tag" ]; then
  latest_main_ver="${latest_main_tag#v}"
  spec_ver="$(skill_version spec-protocol)"
  if [ "$latest_main_ver" != "$spec_ver" ]; then
    say "FAIL: latest tag $latest_main_tag != spec-protocol VERSION ($spec_ver)"
    fail=1
  fi
fi

latest_nrs_tag="$(git tag -l 'nine-router-setup-v[0-9]*' | sort -V | tail -1)"
if [ -n "$latest_nrs_tag" ]; then
  latest_nrs_ver="${latest_nrs_tag#nine-router-setup-v}"
  nrs_ver="$(skill_version nine-router-setup)"
  if [ "$latest_nrs_ver" != "$nrs_ver" ]; then
    say "FAIL: latest tag $latest_nrs_tag != nine-router-setup VERSION ($nrs_ver)"
    fail=1
  fi
fi

# --- 3. Every annotated tag needs a CHANGELOG.md entry ---------------------
# A tag counts as documented when CHANGELOG.md has a "## [<version>]" or
# "## [<name> <version>]" header for it, OR it is co-tagged (same commit) with
# another tag that already has such a header (e.g. a nine-router-setup-vX.Y.Z
# cut on the exact commit a vA.B.C release already documents).
has_header() {
  grep -qE "^## \[([A-Za-z0-9_-]+ )?$(printf '%s' "$1" | sed 's/\./\\./g')\]" CHANGELOG.md
}

# ponytail: release tags only (v* / nine-router-setup-v*), annotated or lightweight
# (tag-push checkouts rewrite the pushed ref as lightweight). Extend grep for new shapes.
mapfile -t tags < <(git for-each-ref --format='%(refname:short)' refs/tags \
  | grep -E '^(nine-router-setup-)?v[0-9]' || true)

declare -A documented_commit
for t in "${tags[@]}"; do
  ver="${t#nine-router-setup-v}"; ver="${ver#v}"
  if has_header "$ver"; then
    documented_commit["$(git rev-list -n1 "$t")"]=1
  fi
done

for t in "${tags[@]}"; do
  ver="${t#nine-router-setup-v}"; ver="${ver#v}"
  has_header "$ver" && continue
  sha="$(git rev-list -n1 "$t")"
  [ "${documented_commit[$sha]:-0}" = "1" ] && continue
  say "FAIL: tag $t (version $ver) has no CHANGELOG.md entry"
  fail=1
done

if [ "$fail" = "0" ]; then
  say "check-docs-fresh: OK"
fi
exit "$fail"
