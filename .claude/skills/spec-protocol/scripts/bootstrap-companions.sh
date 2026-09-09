#!/usr/bin/env bash
# bootstrap-companions.sh — detect-first, source-locked installer for Spec
# Protocol companion skills. Idempotent: safe to run repeatedly; never
# creates duplicate installations.
#
# Sources come ONLY from references/dependency-sources.md (no GitHub
# searching, no fork picking). Every dependency reports
# Installed / Already Installed / Failed, with its exact source URL.
# A Failed status never silently downgrades to Skipped.
#
# Never prints API keys or any secret value.
set -uo pipefail

# --- arguments --------------------------------------------------------
# --selftest runs ONLY the knowledge-pack resolver against fixture
# directories and exits; it installs nothing and touches no real store.
# --hooks-only runs ONLY the dispatch gate hook install (RC-23d) against the
# ACTIVE config root and exits, running no other group.
KP_SELFTEST=0
HOOK_ONLY=0
while [ $# -gt 0 ]; do
  case "${1:-}" in
    --selftest) KP_SELFTEST=1 ;;
    --hooks-only) HOOK_ONLY=1 ;;
    -h|--help)
      printf '%s\n' "usage: bootstrap-companions.sh [--selftest] [--hooks-only]"
      printf '%s\n' "  --selftest    resolve every knowledge-pack folder against fixtures; install nothing"
      printf '%s\n' "  --hooks-only  install and register the dispatch gate hook in the ACTIVE config root, then stop"
      exit 0 ;;
    *) printf '%s\n' "unknown argument: ${1:-}" >&2; exit 2 ;;
  esac
  shift
done

CLAUDE_CONFIG_DIR_ACTUAL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# The shared-vs-separate comparison is ALWAYS $HOME/.claude vs the claude-nine
# dir — comparing CLAUDE_CONFIG_DIR (an env var the caller may inherit) against
# itself proves nothing. A genuinely shared setup has no separate claude-nine
# dir at all; a separate one is detected by its own .claude.json existing.
CC9_CONFIG_DIR="${CLAUDE_NINE_CONFIG_DIR:-$HOME/.claude-nine}"
if [ ! -f "$CC9_CONFIG_DIR/.claude.json" ]; then
  CC9_IS_SEPARATE=0
else
  CC9_IS_SEPARATE=1
fi

PASS=0
FAIL=0
WARN=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '✗ %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '! %s\n' "$*"; WARN=$((WARN+1)); }

# --- detection helpers ------------------------------------------------

skill_dir_exists() {
  local name="$1"
  [ -d "$HOME/.claude/skills/$name" ] && return 0
  [ -L "$HOME/.claude/skills/$name" ] && return 0
  # Installers like ui-ux-pro-max-cli write into $PWD/.claude/skills.
  find "$PWD" -maxdepth 3 -type d -path "*/.claude/skills/$name" -print -quit 2>/dev/null | grep -q . && return 0
  [ -d "$PWD/.claude/skills/$name" ] && return 0
  return 1
}

# Claude Code plugin registry: ~/.claude/plugins/installed_plugins.json has a
# nested "plugins" map whose keys are "<name>@<marketplace>".
plugin_installed() {
  local name="$1"
  [ -f "$HOME/.claude/plugins/installed_plugins.json" ] \
    && jq -e --arg s "$name" '.plugins | keys | map(select(startswith($s + "@"))) | length > 0' \
        "$HOME/.claude/plugins/installed_plugins.json" >/dev/null 2>&1
}

known_marketplace() {
  local name="$1"
  [ -f "$HOME/.claude/plugins/known_marketplaces.json" ] \
    && jq -e --arg s "$name" 'has($s)' \
        "$HOME/.claude/plugins/known_marketplaces.json" >/dev/null 2>&1
}

claude_skill_list() {
  # Discovery from the AI coding environment itself: the authoritative
  # check. claude may be absent on a bare box — then we fall back to
  # directory evidence and say so (UNDETERMINED beats a confident zero).
  if command -v claude >/dev/null 2>&1; then
    claude --help 2>/dev/null | grep -qi "skill" || true
  fi
}

uipro_installed() {
  command -v uipro >/dev/null 2>&1
}

mcp_registered() {
  # Plain claude's config store is always $HOME/.claude.json — never a
  # caller-inherited CLAUDE_CONFIG_DIR value (that env var belongs to the
  # claude-nine launch, not to this script's runtime).
  local server="$1"
  [ -f "$HOME/.claude.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$HOME/.claude.json" >/dev/null 2>&1
}

mcp_registered_cc9() {
  local server="$1"
  [ -f "$CC9_CONFIG_DIR/.claude.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$CC9_CONFIG_DIR/.claude.json" >/dev/null 2>&1
}

mcp_registered_project() {
  local server="$1"
  [ -f "$PWD/.mcp.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$PWD/.mcp.json" >/dev/null 2>&1
}

# Project-scoped store: entries nested under .projects/<path>/mcpServers in
# the main .claude.json files (claude mcp add --scope project writes there).
mcp_in_projects_store() {
  local file="$1" server="$2"
  [ -f "$file" ] \
    && jq -e --arg s "$server" '.projects | to_entries[] | ((.value.mcpServers // {})[$s]) != null' \
        "$file" >/dev/null 2>&1
}

# Any store entry whose URL contains the fragment (for servers whose config
# key may vary, e.g. the Vercel CLI's).
mcp_url_in_any_store() {
  local frag="$1"
  for f in "$HOME/.claude.json" "$CC9_CONFIG_DIR/.claude.json" "$PWD/.mcp.json"; do
    [ -f "$f" ] || continue
    jq -e --arg f "$frag" '.mcpServers | to_entries[] | select((.value.url // "") | contains($f))' \
        "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}

# --- the knowledge pack (group 5: openclaw-skills) --------------------
#
# The manifest is references/knowledge-pack.json. It names the folders as
# they exist in the onboarding repository and in an installed OpenClaw, and
# it names the lookup order this resolver follows, per folder, in the
# manifest's own order:
#
#   1. ~/.openclaw/skills/<folder>   — the box already has OpenClaw
#   2. <local checkout>/<folder>     — ~/openclaw-onboarding by default
#   3. github:<folder>@<pin>         — reported as pull-required, and pulled
#                                      ONLY when the GitHub token the skill
#                                      already holds for the client's own
#                                      repository is present
#
# Anything resolved is cached at <skill>/companions/openclaw-skills/<folder>/
# and every folder's SOURCE and TAG go into the installation report.
#
# The skill READS these folders (SKILL.md, INSTRUCTIONS.md, INSTALL.md,
# PREREQS.json, models.json, QC.md) and follows the steps with its own tools.
# It never asks OpenClaw's agent to run anything. The folder's own qc-*.sh is
# the acceptance check.

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"
KP_MANIFEST="${KP_MANIFEST:-$SKILL_ROOT/references/knowledge-pack.json}"
KP_OPENCLAW_SKILLS_DIR="${KP_OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills}"
KP_CHECKOUT_DIR="${KP_CHECKOUT_DIR:-$HOME/openclaw-onboarding}"
KP_CACHE_DIR="${KP_CACHE_DIR:-$SKILL_ROOT/companions/openclaw-skills}"

KP_TOTAL=0
KP_OK=0
KP_PULL=0
KP_REPORT=""

# Read a top-level scalar from the manifest. jq first, python3 second; a box
# with neither gets a named failure, never a guessed folder list.
kp_get() {
  local k="$1"
  [ -f "$KP_MANIFEST" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$k" '.[$k] // empty' "$KP_MANIFEST"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' \
      "$KP_MANIFEST" "$k"
  else
    return 2
  fi
}

# Every folder in the manifest, in the manifest's order, one per line.
kp_folders() {
  [ -f "$KP_MANIFEST" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.folders | to_entries[] | .value[]' "$KP_MANIFEST"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
for group in d["folders"].values():
    for folder in group:
        print(folder)' "$KP_MANIFEST"
  else
    return 2
  fi
}

KP_SOURCE="$(kp_get source 2>/dev/null || true)"
[ -n "$KP_SOURCE" ] || KP_SOURCE="https://github.com/trevorotts1/openclaw-onboarding"
KP_PIN="$(kp_get pin 2>/dev/null || true)"
[ -n "$KP_PIN" ] || KP_PIN="unset"

# The token value NEVER reaches stdout of this script: it is captured into a
# local and handed to git through a credential helper that reads it from the
# environment, so it never appears in an argument list either.
kp_token_value() {
  [ "${KP_FORCE_NO_TOKEN:-0}" = "1" ] && return 1
  [ -n "${GITHUB_TOKEN:-}" ] && { printf '%s' "$GITHUB_TOKEN"; return 0; }
  [ -n "${GH_TOKEN:-}" ]     && { printf '%s' "$GH_TOKEN"; return 0; }
  [ -n "${GITHUB_PAT:-}" ]   && { printf '%s' "$GITHUB_PAT"; return 0; }
  if command -v gh >/dev/null 2>&1; then
    local t
    t="$(gh auth token 2>/dev/null || true)"
    [ -n "$t" ] && { printf '%s' "$t"; return 0; }
  fi
  return 1
}

kp_token_present() { kp_token_value >/dev/null 2>&1; }

# Prints "<source>|<path>". Returns 0 when the folder is on disk, 1 when a
# pull is required.
kp_resolve() {
  local folder="$1"
  if [ -d "$KP_OPENCLAW_SKILLS_DIR/$folder" ]; then
    printf 'openclaw-install|%s\n' "$KP_OPENCLAW_SKILLS_DIR/$folder"; return 0
  fi
  if [ -d "$KP_CHECKOUT_DIR/$folder" ]; then
    printf 'local-checkout|%s\n' "$KP_CHECKOUT_DIR/$folder"; return 0
  fi
  if [ -d "$KP_CACHE_DIR/$folder" ]; then
    printf 'cache|%s\n' "$KP_CACHE_DIR/$folder"; return 0
  fi
  printf 'pull-required|%s/tree/%s/%s\n' "$KP_SOURCE" "$KP_PIN" "$folder"; return 1
}

kp_cache_folder() {
  local folder="$1" src="$2"
  [ -d "$src" ] || return 1
  [ -d "$KP_CACHE_DIR/$folder" ] && return 0
  mkdir -p "$KP_CACHE_DIR/$folder" 2>/dev/null || return 1
  cp -R "$src/." "$KP_CACHE_DIR/$folder/" 2>/dev/null || return 1
  return 0
}

# The pull. Runs ONLY when kp_token_present said yes.
kp_pull_folder() {
  local folder="$1" tag="$2" tok work
  tok="$(kp_token_value)" || return 1
  command -v git >/dev/null 2>&1 || return 1
  [ "$tag" = "unset" ] && return 1
  work="$(mktemp -d "${TMPDIR:-/tmp}/spec-protocol-kp.XXXXXX")" || return 1
  KP_GH_TOKEN="$tok" GIT_TERMINAL_PROMPT=0 git \
    -c credential.helper='!f(){ printf "username=x-access-token\npassword=%s\n" "$KP_GH_TOKEN"; }; f' \
    -c advice.detachedHead=false \
    clone --depth 1 --branch "$tag" --filter=blob:none --sparse \
    "$KP_SOURCE.git" "$work/repo" >/dev/null 2>&1 || { rm -rf "$work"; return 1; }
  git -C "$work/repo" sparse-checkout set "$folder" >/dev/null 2>&1 || { rm -rf "$work"; return 1; }
  if [ ! -d "$work/repo/$folder" ]; then rm -rf "$work"; return 1; fi
  mkdir -p "$KP_CACHE_DIR/$folder" 2>/dev/null || { rm -rf "$work"; return 1; }
  cp -R "$work/repo/$folder/." "$KP_CACHE_DIR/$folder/" 2>/dev/null || { rm -rf "$work"; return 1; }
  rm -rf "$work"
  return 0
}

kp_run_group() {
  local folders folder line src path
  folders="$(kp_folders 2>/dev/null || true)"
  if [ -z "$folders" ]; then
    bad "Knowledge pack: could not read $KP_MANIFEST (tried jq, then python3). Source: $KP_SOURCE — report this failure; never guess the folder list."
    return 1
  fi
  KP_TOTAL=0; KP_OK=0; KP_PULL=0; KP_REPORT=""
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    KP_TOTAL=$((KP_TOTAL + 1))
    line="$(kp_resolve "$folder")"
    src="${line%%|*}"
    path="${line#*|}"
    case "$src" in
      openclaw-install|local-checkout)
        kp_cache_folder "$folder" "$path" || warn "$folder resolved at $path but could not be cached into $KP_CACHE_DIR/$folder"
        ;;
      pull-required)
        if kp_token_present; then
          if kp_pull_folder "$folder" "$KP_PIN"; then
            src="github@$KP_PIN"
            path="$KP_CACHE_DIR/$folder"
          else
            src="pull-failed"
          fi
        fi
        ;;
    esac
    case "$src" in
      pull-required)
        KP_PULL=$((KP_PULL + 1))
        warn "$folder: pull-required — $path (pin $KP_PIN). No GitHub token present, so no pull was attempted."
        ;;
      pull-failed)
        bad "$folder: pull failed from $KP_SOURCE at pin $KP_PIN — report this failure; do not substitute another repository."
        ;;
      *)
        KP_OK=$((KP_OK + 1))
        ok "$folder: source=$src tag=$KP_PIN"
        ;;
    esac
    KP_REPORT="${KP_REPORT}    $folder: source=$src tag=$KP_PIN path=$path
"
  done <<< "$folders"
  return 0
}

# --- selftest ---------------------------------------------------------
# Three phases against fixture directories: the OpenClaw install first, a
# local checkout second, neither (and no token) third. Installs nothing,
# writes nothing outside its own temp directory.
kp_selftest() {
  local tmp folders folder line src rc=0 n=0 phase_fail
  folders="$(kp_folders 2>/dev/null || true)"
  if [ -z "$folders" ]; then
    printf '✗ selftest: could not read %s (tried jq, then python3)\n' "$KP_MANIFEST"
    return 1
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/spec-protocol-kp-selftest.XXXXXX")" || {
    printf '✗ selftest: mktemp failed\n'; return 1; }

  KP_OPENCLAW_SKILLS_DIR="$tmp/openclaw/skills"
  KP_CHECKOUT_DIR="$tmp/checkout"
  KP_CACHE_DIR="$tmp/cache"
  KP_FORCE_NO_TOKEN=1
  mkdir -p "$KP_OPENCLAW_SKILLS_DIR" "$KP_CHECKOUT_DIR" "$KP_CACHE_DIR"

  # A fixture folder carries the reading list and its own acceptance script.
  kp_fixture() {
    local root="$1" f="$2"
    mkdir -p "$root/$f"
    printf '# %s (fixture)\n' "$f" > "$root/$f/SKILL.md"
    printf '{"fixture": true}\n' > "$root/$f/PREREQS.json"
    printf '# QC (fixture)\n' > "$root/$f/QC.md"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$root/$f/qc-fixture.sh"
  }

  printf '\n===== knowledge-pack selftest: %s =====\n' "$KP_MANIFEST"
  printf 'folders in manifest: %s\n' "$(printf '%s\n' "$folders" | grep -c .)"

  # ---- phase 1: the OpenClaw install ----
  n=0; phase_fail=0
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    kp_fixture "$KP_OPENCLAW_SKILLS_DIR" "$folder"
  done <<< "$folders"
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    n=$((n + 1))
    line="$(kp_resolve "$folder")"; src="${line%%|*}"
    if [ "$src" != "openclaw-install" ]; then
      printf '✗ phase 1 %s: expected openclaw-install, got %s\n' "$folder" "$src"; phase_fail=1
    fi
    kp_cache_folder "$folder" "${line#*|}" || { printf '✗ phase 1 %s: cache write failed\n' "$folder"; phase_fail=1; }
    [ -f "$KP_CACHE_DIR/$folder/SKILL.md" ] || { printf '✗ phase 1 %s: not cached\n' "$folder"; phase_fail=1; }
  done <<< "$folders"
  if [ "$phase_fail" -eq 0 ]; then
    printf '✓ phase 1: %s/%s folders resolved from the fixture ~/.openclaw/skills, all cached\n' "$n" "$n"
  else
    rc=1
  fi

  # ---- phase 2: the local checkout ----
  rm -rf "$KP_OPENCLAW_SKILLS_DIR" "$KP_CACHE_DIR"
  mkdir -p "$KP_OPENCLAW_SKILLS_DIR" "$KP_CACHE_DIR"
  n=0; phase_fail=0
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    kp_fixture "$KP_CHECKOUT_DIR" "$folder"
  done <<< "$folders"
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    n=$((n + 1))
    line="$(kp_resolve "$folder")"; src="${line%%|*}"
    if [ "$src" != "local-checkout" ]; then
      printf '✗ phase 2 %s: expected local-checkout, got %s\n' "$folder" "$src"; phase_fail=1
    fi
    kp_cache_folder "$folder" "${line#*|}" || { printf '✗ phase 2 %s: cache write failed\n' "$folder"; phase_fail=1; }
    [ -f "$KP_CACHE_DIR/$folder/SKILL.md" ] || { printf '✗ phase 2 %s: not cached\n' "$folder"; phase_fail=1; }
  done <<< "$folders"
  if [ "$phase_fail" -eq 0 ]; then
    printf '✓ phase 2: %s/%s folders resolved from the fixture local checkout, all cached\n' "$n" "$n"
  else
    rc=1
  fi

  # ---- phase 3: neither, and no token ----
  rm -rf "$KP_CHECKOUT_DIR" "$KP_CACHE_DIR"
  mkdir -p "$KP_CHECKOUT_DIR" "$KP_CACHE_DIR"
  n=0; phase_fail=0
  if kp_token_present; then
    printf '✗ phase 3: KP_FORCE_NO_TOKEN=1 but a token still reported present\n'; phase_fail=1
  fi
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    n=$((n + 1))
    line="$(kp_resolve "$folder")"; src="${line%%|*}"
    if [ "$src" != "pull-required" ]; then
      printf '✗ phase 3 %s: expected pull-required, got %s\n' "$folder" "$src"; phase_fail=1
    fi
    case "${line#*|}" in
      "$KP_SOURCE/tree/$KP_PIN/$folder") : ;;
      *) printf '✗ phase 3 %s: pull-required path did not name the GitHub path and pin\n' "$folder"; phase_fail=1 ;;
    esac
  done <<< "$folders"
  if [ "$phase_fail" -eq 0 ]; then
    printf '✓ phase 3: %s/%s folders reported pull-required at %s/tree/%s/<folder>, no pull attempted\n' \
      "$n" "$n" "$KP_SOURCE" "$KP_PIN"
  else
    rc=1
  fi

  rm -rf "$tmp"
  if [ "$rc" -eq 0 ]; then
    printf '\nselftest: PASS (3 phases, %s folders each)\n' "$n"
  else
    printf '\nselftest: FAIL\n'
  fi
  return "$rc"
}

# --- the dispatch gate hook (RC-23d) ----------------------------------
#
# tools/hooks/dispatch-gate.py is the wall that refuses an unbooked Workflow
# launch (SHAPE 7) and a launch past the budget (SHAPE 6). Before this block
# NOTHING installed it: references/workflows.md documented a manual `cp` into
# ~/.claude/hooks/ for an operator to run once. On the 2026-09-07 routed
# launcher no one ran it, so every dispatch bypassed tools/dispatch-check.sh
# and CONTROL/dispatch-log.md ended the run with six rows and not one `agents=`
# field (RC-23). A wall that installs itself is the only kind that is there.
#
# ONE ROOT ONLY. The install goes into the ACTIVE config root — CLAUDE_CONFIG_DIR
# when it is set, $HOME/.claude otherwise — and NEVER into the sibling root.
# Writing the other launcher's store is the exact act RC-20 forbids: it would
# change enforcement for sessions this run is not part of, silently. The sibling
# root is NAMED in the output, as the thing deliberately not written.
#
# DETECT FIRST, NEVER DESTROY. A byte-identical hook already in place is reported
# as already current and nothing is copied. A DIFFERENT file is backed up beside
# itself, with the backup path printed, before it is replaced. settings.json is
# backed up the same way and only ever GAINS one entry in its Workflow matcher.
# The hook must print ALL PASS from its own --selftest before it is wired
# (references/workflows.md, "Installing it") — an unproven wall is not wired.
#
# A FAILED INSTALL IS A FINDING, NEVER A STOPPED BUILD. Every failure path calls
# warn(), files a HOOK-INSTALL finding to the project ledger when a project can
# be resolved, and returns 0. The build continues without the wall and says so.

HOOK_GREP="/usr/bin/grep"
[ -x "$HOOK_GREP" ] || HOOK_GREP="$(command -v grep 2>/dev/null || true)"

HOOK_SRC="$SKILL_ROOT/tools/hooks/dispatch-gate.py"
HOOK_ACTIVE_ROOT="${CLAUDE_CONFIG_DIR_ACTUAL%/}"
HOOK_DEST_DIR="$HOOK_ACTIVE_ROOT/hooks"
HOOK_DEST="$HOOK_DEST_DIR/dispatch-gate.py"
HOOK_SETTINGS="$HOOK_ACTIVE_ROOT/settings.json"
HOOK_STATUS=""
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  HOOK_ROOT_SOURCE="CLAUDE_CONFIG_DIR"
else
  HOOK_ROOT_SOURCE="\$HOME/.claude (CLAUDE_CONFIG_DIR is unset)"
fi

# The root this install must NOT touch. Named, never written.
hook_sibling_root() {
  if [ "$HOOK_ACTIVE_ROOT" = "${HOME%/}/.claude" ]; then
    printf '%s' "${CC9_CONFIG_DIR%/}"
  else
    printf '%s' "${HOME%/}/.claude"
  fi
}

# A finding goes to the project ledger when a project can be resolved, and is
# reported here either way: a finding that cannot be filed is never dropped.
hook_finding() {
  local line="$1" proj="" led="$SKILL_ROOT/tools/ledger.sh"
  if [ -n "${SPEC_PROJECT:-}" ] && [ -d "${SPEC_PROJECT%/}/CONTROL" ]; then
    proj="${SPEC_PROJECT%/}"
  elif [ -d "$PWD/CONTROL" ]; then
    proj="$PWD"
  fi
  if [ -z "$proj" ]; then
    say "    finding NOT filed to a ledger: no CONTROL/ resolved from SPEC_PROJECT or \$PWD ($PWD). It stands in this report."
    return 0
  fi
  if [ ! -x "$led" ]; then
    say "    finding NOT filed to a ledger: $led is missing or not executable. It stands in this report."
    return 0
  fi
  if "$led" "$proj" "CONTROL/LEDGER.md" "$line" >/dev/null 2>&1; then
    say "    finding filed: $proj/CONTROL/LEDGER.md"
  else
    say "    finding NOT filed: $led returned non-zero for $proj/CONTROL/LEDGER.md. It stands in this report."
  fi
  return 0
}

# cmp decides whether the installed copy is the same file; the sha256 is what
# the report quotes. A box with neither shasum nor sha256sum says UNDETERMINED
# rather than printing a number it did not compute.
hook_sha() {
  local f="$1"
  [ -f "$f" ] || return 1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" 2>/dev/null | awk '{print $1}'
  else
    printf 'UNDETERMINED(no shasum, no sha256sum)'
  fi
}

# The registrar. Appends ONE command to the Workflow matcher's hooks array and
# changes nothing else in the file; the syntax gate already there keeps its
# place, first. It refuses (exit 3) rather than repairing a settings.json whose
# shape it does not recognise, because rewriting an operator's store on a guess
# is worse than an unwired hook plus a finding.
read -r -d '' HOOK_REGISTER_PY <<'HOOKPYEOF'
import json, os, shutil, sys, time

settings, command = sys.argv[1], sys.argv[2]
try:
    data = {}
    if os.path.exists(settings):
        with open(settings, "r", encoding="utf-8") as fh:
            text = fh.read().strip()
        if text:
            data = json.loads(text)
        if not isinstance(data, dict):
            print("REFUSED the top level of %s is a %s, not an object" % (settings, type(data).__name__))
            sys.exit(3)
    pre = data.setdefault("PreToolUse", [])
    if not isinstance(pre, list):
        print("REFUSED PreToolUse in %s is not a list" % settings)
        sys.exit(3)
    entry = None
    for candidate in pre:
        if isinstance(candidate, dict) and candidate.get("matcher") == "Workflow":
            entry = candidate
            break
    if entry is None:
        entry = {"matcher": "Workflow", "hooks": []}
        pre.append(entry)
    hooks = entry.setdefault("hooks", [])
    if not isinstance(hooks, list):
        print("REFUSED the Workflow matcher's hooks in %s is not a list" % settings)
        sys.exit(3)
    for hook in hooks:
        if isinstance(hook, dict) and "dispatch-gate.py" in str(hook.get("command", "")):
            print("ALREADY-REGISTERED %s" % hook.get("command"))
            sys.exit(0)
    hooks.append({"type": "command", "command": command, "timeout": 30})
    if os.path.exists(settings):
        backup = settings + ".bak-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        shutil.copy2(settings, backup)
        print("BACKUP %s" % backup)
    tmp = "%s.tmp.%d" % (settings, os.getpid())
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, settings)
    print("REGISTERED %s" % command)
except Exception as exc:
    print("REFUSED %s: %s" % (type(exc).__name__, exc))
    sys.exit(3)
HOOKPYEOF

install_dispatch_gate_hook() {
  local sib ts out rc reg copied="" sha_src sha_dst
  sib="$(hook_sibling_root)"
  say ""
  say "Checking the dispatch gate hook (SHAPE 6/7 — RC-23d)..."
  say "Source: $HOOK_SRC"
  say "Active config root: $HOOK_ACTIVE_ROOT (resolved from $HOOK_ROOT_SOURCE)"
  say "NOT written, by rule (RC-20, own root only): $sib"

  if [ ! -f "$HOOK_SRC" ]; then
    HOOK_STATUS="FINDING — source absent, SHAPE 6/7 not installed"
    warn "FINDING: the hook source $HOOK_SRC is absent, so SHAPE 6/7 cannot be installed. The build continues WITHOUT the write-ahead wall; every dispatch must still book itself through tools/dispatch-check.sh."
    hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=source-absent path=$HOOK_SRC — SHAPE 6/7 not installed, dispatch bookings unenforced"
    return 0
  fi

  mkdir -p "$HOOK_DEST_DIR" 2>/dev/null
  if [ ! -d "$HOOK_DEST_DIR" ]; then
    HOOK_STATUS="FINDING — $HOOK_DEST_DIR not creatable"
    warn "FINDING: could not create $HOOK_DEST_DIR, so the hook has nowhere to live and SHAPE 6/7 is not installed. Nothing else was touched."
    hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=dest-dir-uncreatable path=$HOOK_DEST_DIR — SHAPE 6/7 not installed"
    return 0
  fi

  sha_src="$(hook_sha "$HOOK_SRC")"
  if [ -f "$HOOK_DEST" ] && cmp -s "$HOOK_SRC" "$HOOK_DEST"; then
    copied="already current"
    say "Already current: $HOOK_DEST is byte-identical to the skill's copy (sha256 $sha_src) — nothing copied."
  else
    if [ -e "$HOOK_DEST" ]; then
      sha_dst="$(hook_sha "$HOOK_DEST")"
      ts="$(date -u +%Y%m%dT%H%M%SZ)"
      if cp -p "$HOOK_DEST" "$HOOK_DEST.bak-$ts" 2>/dev/null; then
        say "A DIFFERENT hook was already installed (sha256 $sha_dst). Backed up, never destroyed: $HOOK_DEST.bak-$ts"
      else
        HOOK_STATUS="FINDING — existing hook could not be backed up, nothing overwritten"
        warn "FINDING: $HOOK_DEST exists and differs from the skill's copy (sha256 $sha_dst), and the backup to $HOOK_DEST.bak-$ts FAILED. Nothing was overwritten — a stale wall is still a wall, and destroying the operator's file to install ours is never the trade."
        hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=backup-failed path=$HOOK_DEST installed_sha=$sha_dst skill_sha=$sha_src — the installed hook may be stale and was left in place"
        return 0
      fi
    fi
    if cp "$HOOK_SRC" "$HOOK_DEST.tmp.$$" 2>/dev/null \
       && chmod +x "$HOOK_DEST.tmp.$$" 2>/dev/null \
       && mv "$HOOK_DEST.tmp.$$" "$HOOK_DEST" 2>/dev/null; then
      copied="installed"
      say "Installed: $HOOK_DEST (sha256 $sha_src)"
    else
      rm -f "$HOOK_DEST.tmp.$$" 2>/dev/null
      HOOK_STATUS="FINDING — copy into the active root failed"
      warn "FINDING: copying $HOOK_SRC to $HOOK_DEST failed, so SHAPE 6/7 is not installed. The build continues without the wall."
      hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=copy-failed path=$HOOK_DEST — SHAPE 6/7 not installed"
      return 0
    fi
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    HOOK_STATUS="FINDING — python3 absent, hook in place but UNPROVEN and NOT wired"
    warn "FINDING: python3 is not on PATH, so $HOOK_DEST could not run its own --selftest and is NOT registered. An unproven wall is never wired (references/workflows.md, 'Installing it')."
    hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=python3-absent path=$HOOK_DEST — hook copied, unproven, not wired"
    return 0
  fi
  out="$(python3 "$HOOK_DEST" --selftest 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | "$HOOK_GREP" -q 'ALL PASS'; then
    HOOK_STATUS="FINDING — selftest failed, NOT wired"
    warn "FINDING: python3 $HOOK_DEST --selftest exited $rc without printing ALL PASS, so it is NOT registered — a hook that fails its own selftest is a BROKEN INSTRUMENT and wiring it would block launches for the wrong reason. Last lines: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
    hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=selftest-failed rc=$rc path=$HOOK_DEST — hook copied, not wired"
    return 0
  fi
  say "Proven: python3 $HOOK_DEST --selftest exited 0 with ALL PASS."

  out="$(python3 -c "$HOOK_REGISTER_PY" "$HOOK_SETTINGS" "python3 $HOOK_DEST" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    HOOK_STATUS="FINDING — proven but NOT wired"
    warn "FINDING: $HOOK_SETTINGS was NOT changed (exit $rc): $out. The hook file is in place and proven but not wired, so SHAPE 6/7 will not fire. Wire it by hand — references/workflows.md, 'Installing it' — and leave the other root alone."
    hook_finding "HOOK-INSTALL: root=$HOOK_ACTIVE_ROOT verdict=registration-refused rc=$rc settings=$HOOK_SETTINGS — hook present and proven, SHAPE 6/7 not wired"
    return 0
  fi
  printf '%s\n' "$out" | "$HOOK_GREP" '^BACKUP ' | sed 's|^BACKUP |    settings backup: |' || true
  if printf '%s' "$out" | "$HOOK_GREP" -q '^ALREADY-REGISTERED'; then
    reg="already registered"
  else
    reg="registered"
    say "Registered in $HOOK_SETTINGS: PreToolUse -> matcher Workflow -> python3 $HOOK_DEST (appended after the syntax gate, which keeps its place)"
  fi
  ok "Dispatch gate hook: $copied, proven, $reg — in $HOOK_ACTIVE_ROOT only"
  HOOK_STATUS="$copied, proven, $reg at $HOOK_DEST (sibling root $sib untouched)"
  return 0
}

if [ "$KP_SELFTEST" -eq 1 ]; then
  kp_selftest
  exit $?
fi

# --hooks-only: the wall, and nothing else. Exits 0 even on a finding — RC-23d
# says a failed hook install is a finding, never a stopped build.
if [ "$HOOK_ONLY" -eq 1 ]; then
  install_dispatch_gate_hook
  say ""
  say "Result: $PASS ok, $FAIL failed, $WARN warnings (hook install only)."
  say "Dispatch gate hook: ${HOOK_STATUS:-not run}"
  exit 0
fi

# --- report -----------------------------------------------------------

report() {
  say ""
  say "===== 12-item installation report ====="
  say "1. Companion capability: see sections above (Frontend Design / UI/UX Pro Max / Supabase / Kie.ai / Agnes AI)."
  say "2. Exact repository URL: see sections above (each dependency states its source URL)."
  say "3. Installed version when available: see sections above."
  say "4. Installation location: user scope \$HOME/.claude/skills (or project .claude/skills), plugins/marketplaces per Claude Code, MCP servers in the active config store."
  say "5. Installation method: command shown in each section above."
  say "6. Claude Code discovery status: $( [ -x "$(command -v claude 2>/dev/null || true)" ] && echo "checked (see sections)" || echo "UNDETERMINED — claude binary not found on PATH" )"
  say "7. Claude-nine discovery status: $( if [ -d "$CC9_CONFIG_DIR" ]; then echo "checked (see sections)"; else echo "UNDETERMINED — $CC9_CONFIG_DIR not present on this box"; fi )"
  say "8. Supabase MCP status: see Supabase section."
  say "8b. GitHub MCP status: see GitHub MCP section (OAuth default; PAT optional)."
  say "8c. Vercel MCP status: see Vercel MCP section (vercel CLI auth)."
  say "9. Supabase authentication status: see Supabase section."
  say "10. Kie.ai configuration status: Kie.ai is PRIMARY and already implemented inside Spec Protocol — preserved, not reinstalled (see references/dependency-sources.md section 4)."
  say "11. Agnes AI configuration status: Agnes is the APPROVED ALTERNATIVE — configured only when the project chooses it; never required, never auto-subscribed."
  say "11b. OpenClaw knowledge pack (group 5, openclaw-skills): ${KP_OK:-0} of ${KP_TOTAL:-0} folders resolved, ${KP_PULL:-0} pull-required. Manifest: references/knowledge-pack.json. Source: $KP_SOURCE (pin $KP_PIN). Cache: $KP_CACHE_DIR/<folder>/. Per-folder source and tag:"
  if [ -n "${KP_REPORT:-}" ]; then printf '%s' "$KP_REPORT"; else say "    (group not run)"; fi
  say "11c. Dispatch gate hook (SHAPE 6/7): ${HOOK_STATUS:-not run}. Installed and registered in the ACTIVE config root ONLY (${HOOK_ACTIVE_ROOT:-unresolved}); the sibling root is named and never written (RC-20)."
  say "12. Manual client action: Supabase account/dashboard onboarding when the client lacks one (https://supabase.com/dashboard); browser OAuth for Supabase MCP and for any MCP server that requires it."
  say ""
  say "Result: $PASS ok, $FAIL failed, $WARN warnings."
  [ "$FAIL" -eq 0 ]
}

# =====================================================================
# 1. FRONTEND DESIGN — https://github.com/anthropics/claude-plugins-official
# =====================================================================
say ""
say "Checking Frontend Design..."
say "Source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design"

FD_INSTALLED=0
if skill_dir_exists frontend-design || plugin_installed frontend-design; then
  FD_INSTALLED=1
fi

if [ "$FD_INSTALLED" -eq 1 ]; then
  ok "Installed and healthy"
  say "Source verified: anthropics/claude-plugins-official"
else
  if command -v claude >/dev/null 2>&1; then
    say "Not detected — installing from the locked source..."
    if claude plugin marketplace add anthropics/claude-plugins-official 2>&1 | sed 's/^/  /'; then
      if claude plugin install frontend-design@claude-plugins-official 2>&1 | sed 's/^/  /'; then
        if skill_dir_exists frontend-design; then
          ok "Installed and healthy"
          say "Source verified: anthropics/claude-plugins-official"
        else
          warn "Install command ran; directory evidence not found yet — restart Claude Code and re-run this script."
        fi
      else
        bad "Plugin install failed. Source: https://github.com/anthropics/claude-plugins-official — report this failure; do not substitute another repository."
      fi
    else
      warn "marketplace add returned non-zero — the marketplace may already exist. Trying install directly..."
      if claude plugin install frontend-design@claude-plugins-official 2>&1 | sed 's/^/  /'; then
        ok "Installed and healthy"
        say "Source verified: anthropics/claude-plugins-official"
      else
        bad "Plugin install failed. Source: https://github.com/anthropics/claude-plugins-official — report this failure; do not substitute another repository."
      fi
    fi
  else
    warn "claude binary not on PATH — cannot run plugin install. Manual step: run /plugin install frontend-design@claude-plugins-official inside Claude Code."
  fi
fi

# =====================================================================
# 2. UI/UX PRO MAX — https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
# =====================================================================
say ""
say "Checking UI/UX Pro Max..."
say "Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill"

if skill_dir_exists ui-ux-pro-max; then
  if uipro_installed; then
    ok "Installed and healthy"
  else
    warn "Skill installed; uipro CLI not on PATH (npx installs do not add it globally) — run 'npx ui-ux-pro-max-cli' for CLI functions or 'npm install -g ui-ux-pro-max-cli@latest' if the CLI is wanted."
  fi
  say "Source verified: nextlevelbuilder/ui-ux-pro-max-skill"
else
  say "Not detected — installing from the locked source..."
  if npx --yes ui-ux-pro-max-cli init --ai claude 2>&1 | sed 's/^/  /'; then
    if skill_dir_exists ui-ux-pro-max; then
      if uipro_installed; then
        ok "Installed and healthy"
      else
        warn "Skill installed; uipro CLI not on PATH — run 'npx ui-ux-pro-max-cli' for CLI functions or 'npm install -g ui-ux-pro-max-cli@latest' if the CLI is wanted."
      fi
      say "Source verified: nextlevelbuilder/ui-ux-pro-max-skill"
    else
      bad "Install failed. Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — report this failure; do not substitute another fork."
    fi
  else
    bad "Install failed. Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — report this failure; do not substitute another fork."
  fi
fi

# =====================================================================
# 3. SUPABASE — https://github.com/supabase/agent-skills
#              + https://github.com/supabase-community/supabase-plugin
# =====================================================================
say ""
say "Checking Supabase..."
say "Skills source: https://github.com/supabase/agent-skills"
say "Plugin source: https://github.com/supabase-community/supabase-plugin"

SUPABASE_OK=0
if skill_dir_exists supabase && skill_dir_exists supabase-postgres-best-practices; then
  ok "Skills installed"
  SUPABASE_OK=1
else
  say "Skills not detected — installing from the locked source..."
  if npx --yes skills add supabase/agent-skills 2>&1 | sed 's/^/  /'; then
    if skill_dir_exists supabase; then
      ok "Skills installed"
      SUPABASE_OK=1
    else
      warn "skills add ran; skill dirs not detected yet — restart Claude Code and re-run this script."
    fi
  else
    bad "Skills install failed. Source: https://github.com/supabase/agent-skills — report this failure; do not substitute another repository."
  fi
fi

if plugin_installed supabase; then
  ok "Plugin installed"
else
  say "Plugin not detected — installing from the locked source..."
  # The open-plugins installer prompts interactively ("Install? [Y/n]") and
  # hangs headless. Answer it and retry on a non-zero exit.
  if yes | npx --yes plugins add supabase-community/supabase-plugin 2>&1 | sed 's/^/  /'; then
    if plugin_installed supabase; then
      ok "Plugin installed"
    else
      warn "plugins add ran; plugin registry entry not detected yet — restart Claude Code and re-run this script."
    fi
  else
    bad "Plugin install failed. Source: https://github.com/supabase-community/supabase-plugin — report this failure; do not substitute another repository."
  fi
fi

if mcp_registered supabase || mcp_registered_cc9 supabase || mcp_registered_project supabase \
   || mcp_in_projects_store "$HOME/.claude.json" supabase || mcp_in_projects_store "$CC9_CONFIG_DIR/.claude.json" supabase; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v claude >/dev/null 2>&1; then
    claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp" 2>&1 | sed 's/^/  /' \
      && { mcp_registered_project supabase && ok "MCP available (project scope)" || warn "add ran; project .mcp.json entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Supabase MCP add failed. Source: https://supabase.com/docs/guides/getting-started/mcp — report this failure; do not substitute another endpoint."
  else
    warn "claude binary not on PATH — manual step: claude mcp add --scope project --transport http supabase \"https://mcp.supabase.com/mcp\""
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 supabase; then
  warn "Supabase MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: browser OAuth (claude /mcp -> supabase -> Authenticate) — never ask the client to paste secret keys into AI chat. Undetermined until /mcp shows the server."

# =====================================================================
# 3c. GITHUB MCP — https://api.githubcopilot.com/mcp/
# =====================================================================
say ""
say "Checking GitHub MCP..."
say "Source: https://github.com/github/github-mcp-server (hosted endpoint: https://api.githubcopilot.com/mcp/)"

if mcp_registered github || mcp_registered_cc9 github || mcp_registered_project github \
   || mcp_in_projects_store "$HOME/.claude.json" github || mcp_in_projects_store "$CC9_CONFIG_DIR/.claude.json" github; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v claude >/dev/null 2>&1; then
    claude mcp add --transport http github "https://api.githubcopilot.com/mcp/" 2>&1 | sed 's/^/  /'
    rc=$?
    if [ $rc -eq 0 ]; then
      { mcp_registered github || mcp_in_projects_store "$HOME/.claude.json" github; } && ok "MCP available" \
        || warn "add ran; entry not detected yet — restart Claude Code and re-run this script."
    elif [ $rc -eq 1 ] && { mcp_registered github || mcp_in_projects_store "$HOME/.claude.json" github; }; then
      # rc=1 with an existing entry = "already exists in local config" —
      # Already Installed, not Failed.
      ok "MCP available (already registered)"
    else
      bad "GitHub MCP add failed. Source: https://github.com/github/github-mcp-server — report this failure; do not substitute another endpoint."
    fi
  else
    warn "claude binary not on PATH — manual step: claude mcp add --transport http github \"https://api.githubcopilot.com/mcp/\""
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 github; then
  warn "GitHub MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: OAuth by default (browser login on first use). A GitHub PAT is optional and takes precedence when set — it must live in an env file or secret store, never in the repository."

# =====================================================================
# 3d. VERCEL MCP — https://mcp.vercel.com
# =====================================================================
say ""
say "Checking Vercel MCP..."
say "Source: https://vercel.com/docs/cli/mcp (hosted endpoint: https://mcp.vercel.com)"

if mcp_registered vercel || mcp_url_in_any_store "mcp.vercel.com"; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v vercel >/dev/null 2>&1; then
    say "vercel CLI present; configuring Claude Code..."
    vercel mcp --clients "Claude Code" 2>&1 | sed 's/^/  /' \
      && { mcp_url_in_any_store "mcp.vercel.com" && ok "MCP available" || warn "vercel mcp ran; entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Vercel MCP setup failed. Source: https://vercel.com/docs/cli/mcp — report this failure; do not substitute another endpoint."
  elif command -v npx >/dev/null 2>&1; then
    say "vercel CLI absent; running via npx (--clients is REQUIRED non-interactively; without it the command fails with missing_clients)..."
    npx --yes vercel mcp --clients "Claude Code" 2>&1 | sed 's/^/  /' \
      && { mcp_url_in_any_store "mcp.vercel.com" && ok "MCP available" || warn "vercel mcp ran; entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Vercel MCP setup failed. Source: https://vercel.com/docs/cli/mcp — report this failure; do not substitute another endpoint."
  else
    warn "Neither vercel CLI nor npx available — manual step: vercel mcp --clients \"Claude Code\" (or npx plugins add vercel/vercel-plugin)"
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 vercel && ! mcp_url_in_any_store "mcp.vercel.com"; then
  warn "Vercel MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: the Vercel CLI handles auth (vercel login); the MCP session scopes to the linked Vercel project. Never ask the client to paste a token into AI chat."

# =====================================================================
# 4. KIE.AI — PRIMARY image/video. https://kie.ai / https://docs.kie.ai
# =====================================================================
say ""
say "Checking Kie.ai (PRIMARY image/video)..."
say "Source: https://kie.ai/ (docs: https://docs.kie.ai/)"
warn "Kie.ai is already implemented inside Spec Protocol — PRESERVE and improve the existing implementation; do not replace it. (references/dependency-sources.md section 4)"

# =====================================================================
# 5. AGNES AI — APPROVED ALTERNATIVE. https://agnes-ai.com
# =====================================================================
say ""
say "Checking Agnes AI (APPROVED ALTERNATIVE)..."
say "Source: https://agnes-ai.com/ (API base: https://apihub.agnes-ai.com/v1)"
say "Status: ALTERNATIVE — configure only when the project chooses Agnes over Kie.ai. Never require both providers. Never create a paid subscription automatically."

# =====================================================================
# 5b. OPENCLAW-SKILLS — the knowledge pack. THIS IS THE FIFTH GROUP.
#     Source: https://github.com/trevorotts1/openclaw-onboarding
#     Manifest: references/knowledge-pack.json (thirteen folders)
# =====================================================================
say ""
say "Checking the OpenClaw knowledge pack (group 5: openclaw-skills)..."
say "Manifest: $KP_MANIFEST"
say "Source: $KP_SOURCE (pin: $KP_PIN)"
say "Lookup order per folder: $KP_OPENCLAW_SKILLS_DIR/<folder>, then $KP_CHECKOUT_DIR/<folder>, then github:<folder>@$KP_PIN."
say "Cache: $KP_CACHE_DIR/<folder>/. Reading list per folder: SKILL.md, INSTRUCTIONS.md, INSTALL.md, PREREQS.json, models.json, QC.md. Acceptance: the folder's own qc-*.sh."
kp_run_group

# =====================================================================
# 6. HIGGSFIELD POLICY
# =====================================================================
say ""
say "Higgsfield: NOT a mandatory dependency — never auto-installed, never required."
say "Source: none (policy; see references/dependency-sources.md section 6)"

# =====================================================================
# 7. CLAUDE-NINE / 9ROUTER COMPATIBILITY (install-once rule)
# =====================================================================
say ""
say "Claude-nine / 9Router compatibility check..."
if [ "$CC9_IS_SEPARATE" -eq 1 ]; then
  warn "Separate claude-nine config dir detected ($CC9_CONFIG_DIR has its own .claude.json). MCP servers must be registered in BOTH stores (\$HOME/.claude.json and $CC9_CONFIG_DIR/.claude.json) — a server in only one is invisible to the other's sessions. Personal skills under \$HOME/.claude/skills are shared by both; project skills are shared when both launch from the same project directory."
else
  say "No separate claude-nine config dir on this box — shared-config install-once rule applies. Validate by launching both plain 'claude' and 'claude-nine' and confirming discovery."
fi
say "9Router rule: DO NOT modify model-routing rules merely to make a skill available."

# =====================================================================
# 8. THE DISPATCH GATE HOOK — tools/hooks/dispatch-gate.py (RC-23d)
#    Active config root only. Detect first, back up, never destroy, and a
#    failed install is a finding in the ledger rather than a stopped build.
# =====================================================================
install_dispatch_gate_hook

# =====================================================================
report
