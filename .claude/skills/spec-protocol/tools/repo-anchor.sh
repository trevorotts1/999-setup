#!/usr/bin/env bash
# repo-anchor.sh — THE REPOSITORY THE BUILD IS MERGED INTO
#
# Usage:
#   repo-anchor.sh <project-home> [--slug <name>] [--remote <url>] [--operator-remote <url>]
#   repo-anchor.sh <project-home> --check
#   repo-anchor.sh --selftest
#   repo-anchor.sh --help
#
# EXIT CODES
#   0  ANCHORED — the repo root exists, origin is set, `git ls-remote --exit-code`
#      proved the branch on that remote, the receipt is written, the repo's entry
#      is upserted in the registry <workdir>/repos.json (one per repo; a second
#      --slug is a second repo and leaves the first repo's receipt alone), and on a
#      legacy project one REPO-ANCHOR line is filed through tools/ledger.sh
#      / ANCHORED LOCAL-ONLY — no remote could be arranged (no origin, no
#      --remote, `gh auth status` failed, no --operator-remote, and no operator
#      owner, or every `gh repo create` attempt failed): the git repository and its
#      first commit exist, the receipt says "source": "local-only" and
#      "remote": null, and the ledger line says the work is NOT YET ONLINE.
#      Declining GitHub never stops a build. A re-run tries again to go online.
#      / --check: the receipt matches (a GitHub remote must also be PRIVATE)
#   3  ALREADY ANCHORED (a run: the receipt already matches origin, nothing to do)
#      / NOT ANCHORED (--check: no receipt at all, a receipt whose remote no
#      longer matches `git remote get-url origin`, or a GitHub remote whose
#      `gh repo view --json visibility` is not PRIVATE)
#   2  UNDETERMINED — the named source could not be read or the proof failed
#      (including a `gh repo view` that failed on --check: never a pass).
#      Never a verdict about the repository; the source is always named.
#
# REMOTE SOURCES, in order: existing origin; --remote; the client's own gh login;
# --operator-remote; SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER (the environment, else a
# KEY=value line in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env",
# parsed, never sourced) -> `gh repo create <owner>/<slug> --private`, run with
# GH_TOKEN=<SPEC_PROTOCOL_OPERATOR_GH_TOKEN from that file> for that one call only;
# else local-only. A failed create (name taken, ...) retries <slug>-2 .. <slug>-5.
#
# ON A PROFILED PROJECT (.spec-protocol.json) no GitHub repository is ever created
# unless the profile names one: existing origin; --remote; the profile's repo.remote
# (a git URL, added as origin); the profile's repo.createPrivate (<owner>/<name>,
# created PRIVATE via the client's own gh login, exactly that name, no -2 retries);
# else LOCAL-ONLY, with the reason in the receipt. --operator-remote, the operator
# owner and gh's default owner are never used there.
#
# WHY THIS EXISTS. The skill's own description promises "merged-to-GitHub".
# SKILL.md section 6 says GitHub is arranged at minute one via `gh auth login --web`,
# with `gh auth status` proving it before the first builder; step 17 says "Determine
# GitHub (new or existing) and smoke-test the token"; references/pipeline.md:782
# records `GITHUB: operator-provided remote (client declined own account)` as the
# DEFAULT when the client declines; references/documents.md:63 places the working
# copies at `<project>/repos/<repository-name>/`; pipeline.md:942 proves a merge by
# showing it as an ancestor of the remote main. And yet
#   grep -rn "git init\|gh repo\|git remote" SKILL.md references/ tools/ scripts/ templates/
# found exactly ONE hit across the whole skill — a comment in tools/env-sweep.sh:164
# about never putting a token in a remote URL. NOTHING created the repository.
# NOTHING created the remote. On any project. A run reached its first QC handoff on
# a folder that was not a git repository at all: the prose said "determine GitHub",
# nothing did it, and nothing refused the builders. This is the instrument that does
# it, and tools/hooks/dispatch-gate.py SHAPE 9 is the wall that refuses a build
# dispatch until its receipt exists.
#
# THE TOKEN IS NEVER INTERPOLATED INTO A URL, and `gh auth status` output is
# captured and DISCARDED beyond its return code — it prints the logged-in account.
# tools/env-sweep.sh:164 states the rule this file obeys: a credential in a git
# remote URL is visible in the process table for the life of the request. Every URL
# this script records or prints passes through redact() first.
#
# WHAT IT NEVER DOES. It never rewrites an existing repository's history, never
# renames an existing repository's default branch (a different one is REPORTED and
# kept), never pushes to a remote that was already there, and never creates a
# repository on an account it was not pointed at. `--check` touches the network
# for one thing only: `gh repo view --json visibility` on a GitHub remote (a
# local-only receipt or a non-GitHub remote skips it).
#
# ENVIRONMENT KNOBS (the selftest's; a real run needs none)
#   REPO_ANCHOR_GH_CMD    the `gh` to run (a fixture stub in the selftest), in the
#                         same spirit as tools/watch-tick.sh's WATCH_TICK_CRONTAB_CMD
#   REPO_ANCHOR_GH_OWNER  create as <owner>/<slug>; unset means gh's DEFAULT owner,
#                         which is the client's own authenticated account
#
# --selftest proves the instrument inside one mktemp -d, against a STUB gh. It
# never creates a repository on any real GitHub account.

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

GH_CMD="${REPO_ANCHOR_GH_CMD:-gh}"

usage() { sed -n '2,33p' "${SELF}"; }

# --- named instruments -------------------------------------------------------
# `command -v` proves a NAME resolves, never that the program RUNS, so each one
# is run once before anything is claimed with it.
GIT="$(command -v git 2>/dev/null || true)"
PY="$(command -v python3 2>/dev/null || true)"

undetermined() { printf 'REPO-ANCHOR UNDETERMINED | %s\n' "$1" >&2; exit 2; }

[[ -n "${GIT}" ]] || undetermined "no git on PATH (command -v git) — the repository cannot be read or created, so nothing is claimed about it"
"${GIT}" --version >/dev/null 2>&1 \
  || undetermined "git resolves to '${GIT}' but '${GIT} --version' did not run (rc=$?) — a name that resolves is not a program that runs"
[[ -n "${PY}" ]] || undetermined "no python3 on PATH (command -v python3) — the profile and the receipt are JSON and are never parsed by shell eval"
"${PY}" -c 'pass' >/dev/null 2>&1 \
  || undetermined "python3 resolves to '${PY}' but did not run — the receipt writer and the profile reader both need it"

# --- credential hygiene ------------------------------------------------------
# Every URL that is recorded, compared or printed goes through this first.
redact() {
  printf '%s' "$1" \
    | sed -e 's|://[^/@]*@|://|g' \
          -e 's/gh[pousr]_[A-Za-z0-9]\{1,\}/<redacted>/g' \
          -e 's/github_pat_[A-Za-z0-9_]\{1,\}/<redacted>/g'
}

# A slug safe as both a directory name and a GitHub repository name.
slugify() {
  printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -e 's/[^a-z0-9._-]\{1,\}/-/g' -e 's/^-\{1,\}//' -e 's/-\{1,\}$//'
}

# --- the profile, read with python3 and never with shell eval ----------------
# rc 0 with the value on stdout; rc 3 the key is absent; rc 2 unreadable.
profile_field() { # profile_field <profile.json> <dotted.key>
  "${PY}" - "$1" "$2" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        doc = json.load(fh)
except FileNotFoundError:
    sys.exit(3)
except Exception:
    sys.exit(2)
cur = doc
for key in sys.argv[2].split("."):
    if not isinstance(cur, dict) or key not in cur:
        sys.exit(3)
    cur = cur[key]
if not isinstance(cur, str) or not cur.strip():
    sys.exit(2)
print(cur)
PY
}

# A profile path must stay inside the project home, the same bound
# tools/project-profile.mjs enforces with isBoundPath().
in_root() {
  case "$1" in
    /*|*..*|"") return 1 ;;
    *) return 0 ;;
  esac
}

receipt_field() { # receipt_field <receipt.json> <key> -> value; rc 3 absent, rc 2 unreadable
  "${PY}" - "$1" "$2" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        doc = json.load(fh)
except FileNotFoundError:
    sys.exit(3)
except Exception:
    sys.exit(2)
value = doc.get(sys.argv[2]) if isinstance(doc, dict) else None
if not isinstance(value, str) or not value.strip():
    sys.exit(2)
print(value)
PY
}

write_receipt() { # write_receipt <path> <root> <remote|""> <branch> <head> <source> [reason]
  "${PY}" - "$@" <<'PY'
import datetime, json, os, sys, tempfile
path, root, remote, branch, head, source = sys.argv[1:7]
reason = sys.argv[7] if len(sys.argv) > 7 else ""
doc = {
    "repoRoot": root,
    "remote": remote or None,
    "branch": branch,
    "head": head,
    "provedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": source,
}
if reason:
    doc["reason"] = reason
directory = os.path.dirname(path) or "."
os.makedirs(directory, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=directory, prefix=".repo-anchor.")
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
print(path)
PY
}

# THE REPO REGISTRY: a project may have more than one repository. <workdir>/repos.json
# (workdir = CONTROL/, or <state dir>/spec-protocol/ on a profiled project, the same
# folder `project-profile.mjs workdir` names) is {"repos": [...]} of
# {"name","root","trunk","remote"}; remote is a remote name (or URL), null when
# local-only. Readers also accept a bare array. tools/merge-train.sh runs one train
# per entry, tools/release.sh mints per entry. Upserted by name, written atomically.
write_registry() { # write_registry <name> <root> <trunk> <local-only:0|1>
  local reg="${STATE_DIR%/}/repos.json"
  (( IS_PROFILED == 0 )) || reg="${STATE_DIR%/}/spec-protocol/repos.json"
  "${PY}" - "${reg}" "$@" <<'PY'
import json, os, sys, tempfile
path, name, root, trunk, local = sys.argv[1:6]
try:
    doc = json.load(open(path, encoding="utf-8"))
except FileNotFoundError:
    doc = {"repos": []}
repos = doc.get("repos", []) if isinstance(doc, dict) else doc
entry = {"name": name, "root": os.path.abspath(root), "trunk": trunk, "remote": None if local == "1" else "origin"}
repos = [r for r in repos if r.get("name") != name] + [entry]
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".repos.")
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump({"repos": repos}, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PY
}

same_path() { "${PY}" -c 'import os,sys;sys.exit(os.path.realpath(sys.argv[1]) != os.path.realpath(sys.argv[2]))' "$1" "$2"; }

# --- where the receipt lives -------------------------------------------------
# Legacy: <home>/CONTROL/repo-anchor.json.
# Profiled: beside the profile's own canonical state file, because a packet owns
# its state directory and never gets a CONTROL/ folder. There the receipt IS the
# record.
# Sets RECEIPT_PATH, STATE_DIR, IS_PROFILED.
resolve_statedir() { # resolve_statedir <home>
  local home="$1" profile state rel rc
  profile="${home%/}/.spec-protocol.json"
  IS_PROFILED=0
  if [[ -f "${profile}" ]]; then
    IS_PROFILED=1
    state="$(profile_field "${profile}" "documents.state")"; rc=$?
    if (( rc == 2 )); then
      undetermined "profile ${profile} could not be parsed as JSON — documents.state is where a profiled receipt lives, and it is not guessed"
    fi
    if (( rc != 0 )) || ! in_root "${state}"; then
      undetermined "profile ${profile} carries no in-root documents.state — tools/project-profile.mjs requires one, so this profile is malformed and nothing is claimed about its repository"
    fi
    STATE_DIR="${home%/}/$(dirname "${state}")"
  else
    STATE_DIR="${home%/}/CONTROL"
  fi
  RECEIPT_PATH="${STATE_DIR%/}/repo-anchor.json"
}

# --- where the working copy lives --------------------------------------------
# Profiled: the project home itself (a packet's own state machine roots git
# there), or documents.repo when the profile names one.
# Legacy: <home>/repos/<slug>/ — references/documents.md:63.
resolve_root() { # resolve_root <home> <slug-or-empty>
  local home="$1" slug="$2" profile repo rc
  profile="${home%/}/.spec-protocol.json"
  if (( IS_PROFILED == 1 )); then
    repo="$(profile_field "${profile}" "documents.repo")"; rc=$?
    if (( rc == 0 )) && in_root "${repo}"; then
      ROOT="${home%/}/${repo%/}"
    else
      ROOT="${home%/}"
    fi
    SLUG="${slug:-$(slugify "$(basename "${home%/}")")}"
  else
    SLUG="${slug:-$(slugify "$(basename "${home%/}")")}"
    [[ -n "${SLUG}" ]] || undetermined "the project home '${home}' produced an empty slug — pass --slug <name>"
    ROOT="${home%/}/repos/${SLUG}"
  fi
}

# --- the read-only check the hook calls --------------------------------------
# Sets CHECK_STATUS to ok | absent | mismatch | unreadable and CHECK_DETAIL.
# It NEVER touches the network: the receipt is a file and `git remote get-url`
# is a config read.
check_receipt() { # check_receipt <receipt-path>
  local receipt="$1" want root live rc
  CHECK_DETAIL=""
  CHECK_LOCAL=0
  CHECK_REMOTE=""
  if [[ ! -e "${receipt}" ]]; then
    CHECK_STATUS="absent"
    CHECK_DETAIL="no receipt at ${receipt}"
    return 0
  fi
  if [[ "$(receipt_field "${receipt}" "source" 2>/dev/null)" == "local-only" ]]; then
    root="$(receipt_field "${receipt}" "repoRoot")" \
      && "${GIT}" -C "${root}" rev-parse --verify HEAD >/dev/null 2>&1 || {
      CHECK_STATUS="unreadable"
      CHECK_DETAIL="local-only receipt ${receipt} names repoRoot '${root:-}' but git rev-parse HEAD failed there"
      return 0
    }
    CHECK_STATUS="ok"; CHECK_LOCAL=1
    CHECK_DETAIL="${root} -> local-only (not yet online)"
    return 0
  fi
  want="$(receipt_field "${receipt}" "remote")"; rc=$?
  if (( rc != 0 )); then
    CHECK_STATUS="unreadable"
    CHECK_DETAIL="receipt ${receipt} exists but its remote field could not be read (rc=${rc})"
    return 0
  fi
  root="$(receipt_field "${receipt}" "repoRoot")"; rc=$?
  if (( rc != 0 )); then
    CHECK_STATUS="unreadable"
    CHECK_DETAIL="receipt ${receipt} exists but its repoRoot field could not be read (rc=${rc})"
    return 0
  fi
  live="$("${GIT}" -C "${root}" remote get-url origin 2>/dev/null)"; rc=$?
  if (( rc != 0 )); then
    CHECK_STATUS="mismatch"
    CHECK_DETAIL="git -C ${root} remote get-url origin returned rc=${rc}: the receipt names a remote that this working copy no longer has"
    return 0
  fi
  if [[ "$(redact "${live}")" != "$(redact "${want}")" ]]; then
    CHECK_STATUS="mismatch"
    CHECK_DETAIL="origin is $(redact "${live}") but the receipt proved $(redact "${want}")"
    return 0
  fi
  CHECK_STATUS="ok"
  CHECK_REMOTE="$(redact "${want}")"
  CHECK_DETAIL="${root} -> ${CHECK_REMOTE}"
  return 0
}

# owner/repo of a GitHub remote URL (https, ssh, scp-style); empty otherwise.
github_slug() {
  local s
  s="$(printf '%s' "$1" | sed -n -E 's#^(https?://|ssh://)?([^@/]*@)?github\.com[:/]([^/]+/[^/]+)/?$#\3#p')"
  printf '%s' "${s%.git}"
}

# The operator's owner: the environment first, else one KEY=value line of the
# operator.env file. Parsed, never sourced. Empty when neither sets it.
OWNER_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env"
operator_env_value() { # operator_env_value <KEY> -> the last KEY=value in OWNER_FILE, or empty
  local v=""
  if [[ -r "${OWNER_FILE}" ]]; then
    v="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*//p" "${OWNER_FILE}" | tail -n 1 | tr -d '\r')"
    v="${v%%[[:space:]]*}"; v="${v#[\"\']}"; v="${v%[\"\']}"
  fi
  printf '%s' "${v}"
}
operator_owner() {
  local v
  v="${SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER:-}"
  [[ -n "${v}" ]] || v="$(operator_env_value SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER)"
  [[ -z "${v}" || "${v}" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] \
    || undetermined "SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER='${v}' (environment or ${OWNER_FILE}) is not a GitHub owner name — a set value that cannot be used is never ignored"
  printf '%s' "${v}"
}

# --- gh, run for its RETURN CODE only ----------------------------------------
# Its stdout/stderr prints the logged-in account and is captured and discarded.
GH_RC=""
GH_BIN=""
gh_authenticated() {
  local gh rc
  gh="$(command -v "${GH_CMD}" 2>/dev/null || true)"
  if [[ -z "${gh}" ]]; then
    GH_RC="127"   # a shell abort on an unresolvable name, NEVER a fact about the login
    return 1
  fi
  "${gh}" auth status >/dev/null 2>&1
  rc=$?
  GH_RC="${rc}"
  GH_BIN="${gh}"
  return "${rc}"
}

# gh_create <owner-or-empty> [token] [exact] — `gh repo create [<owner>/]<slug> --private`,
# then <slug>-2 .. <slug>-5 when that fails (a taken name is the usual cause).
# "exact" (a profile's repo.createPrivate) tries that one name only.
# The token, when given, reaches ONLY that gh child as GH_TOKEN (exported inside
# the command substitution's subshell, never on an argv, never printed).
# Sets CREATED (1/0), url, and reason (the last failure, redacted).
gh_create() {
  local owner="$1" tok="${2:-}" n name out rc suffixes=("" -2 -3 -4 -5)
  [[ "${3:-}" != "exact" ]] || suffixes=("")
  CREATED=0
  for n in "${suffixes[@]}"; do
    name="${SLUG}${n}"
    [[ -z "${owner}" ]] || name="${owner}/${name}"
    out="$( [[ -z "${tok}" ]] || export GH_TOKEN="${tok}"
            GIT_TERMINAL_PROMPT=0 "${GH_BIN}" repo create "${name}" --private --source "${ROOT}" --remote origin --push 2>&1 )"; rc=$?
    url="$("${GIT}" -C "${ROOT}" remote get-url origin 2>/dev/null)"
    if (( rc == 0 )) && [[ -n "${url}" ]]; then
      CREATED=1
      [[ -z "${n}" ]] || printf 'REPO-ANCHOR | %s was not available on GitHub; created %s instead\n' "${SLUG}" "${name}"
      return 0
    fi
    # A half-made attempt (created, push failed) leaves origin behind; drop it so
    # the next name can be tried and a local-only receipt stays honest.
    [[ -z "${url}" ]] || "${GIT}" -C "${ROOT}" remote remove origin >/dev/null 2>&1
    url=""
    reason="gh repo create ${name} --private returned rc=${rc}: $(redact "$(printf '%s' "${out}" | tail -n 2 | tr '\n' ' ')")"
  done
  [[ "${3:-}" == "exact" ]] || reason="${reason} (tried ${SLUG} and ${SLUG}-2 .. ${SLUG}-5)"
  return 1
}

#------------------------------------------------------------------------------
# Argument parsing
#------------------------------------------------------------------------------
HOME_DIR=""
OPT_SLUG=""
OPT_REMOTE=""
OPT_OPERATOR_REMOTE=""
MODE="run"

while (( $# > 0 )); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --selftest) MODE="selftest"; shift ;;
    --check) MODE="check"; shift ;;
    --slug) shift; OPT_SLUG="${1:-}"; [[ -n "${OPT_SLUG}" ]] || undetermined "--slug needs a value"; shift ;;
    --remote) shift; OPT_REMOTE="${1:-}"; [[ -n "${OPT_REMOTE}" ]] || undetermined "--remote needs a value"; shift ;;
    --operator-remote) shift; OPT_OPERATOR_REMOTE="${1:-}"; [[ -n "${OPT_OPERATOR_REMOTE}" ]] || undetermined "--operator-remote needs a value"; shift ;;
    -*) undetermined "unknown option '$1'. Run repo-anchor.sh --help" ;;
    *) [[ -z "${HOME_DIR}" ]] || undetermined "more than one project home given ('${HOME_DIR}' and '$1')"; HOME_DIR="$1"; shift ;;
  esac
done

#------------------------------------------------------------------------------
# The run
#------------------------------------------------------------------------------
run_check() {
  local home="$1"
  [[ -n "${home}" ]] || undetermined "no project home given. Usage: repo-anchor.sh <project-home> --check"
  [[ -d "${home}" ]] || undetermined "project home does not exist: ${home}"
  resolve_statedir "${home}"
  check_receipt "${RECEIPT_PATH}"
  case "${CHECK_STATUS}" in
    ok)
      local slug gh out rc vis
      slug="$(github_slug "${CHECK_REMOTE}")"
      if (( CHECK_LOCAL == 0 )) && [[ -n "${slug}" ]]; then
        gh="$(command -v "${GH_CMD}" 2>/dev/null || true)"
        [[ -n "${gh}" ]] || undetermined "the remote is GitHub (${slug}) but '${GH_CMD}' does not resolve, so its visibility is UNDETERMINED — never a pass"
        out="$("${gh}" repo view "${slug}" --json visibility --jq .visibility 2>&1)"; rc=$?
        vis="$(printf '%s' "${out}" | tr -d '[:space:]')"
        (( rc == 0 )) && [[ -n "${vis}" ]] \
          || undetermined "gh repo view ${slug} --json visibility returned rc=${rc}: $(redact "$(printf '%s' "${out}" | tail -n 2 | tr '\n' ' ')") — visibility UNDETERMINED, never a pass"
        if [[ "${vis}" != "PRIVATE" ]]; then
          printf 'REPO-ANCHOR NOT PRIVATE | %s is %s on GitHub, not PRIVATE — fix: gh repo edit %s --visibility private --accept-visibility-change-consequences\n' "${slug}" "${vis}" "${slug}"
          exit 3
        fi
        CHECK_DETAIL="${CHECK_DETAIL} (PRIVATE)"
      fi
      printf 'REPO-ANCHOR OK | %s\n' "${CHECK_DETAIL}"
      exit 0 ;;
    absent)
      printf 'REPO-ANCHOR NOT ANCHORED | %s — run  repo-anchor.sh %s  first\n' "${CHECK_DETAIL}" "${home}"
      exit 3 ;;
    mismatch)
      printf 'REPO-ANCHOR NOT ANCHORED | %s — the receipt no longer describes this working copy; re-run repo-anchor.sh\n' "${CHECK_DETAIL}"
      exit 3 ;;
    *)
      undetermined "${CHECK_DETAIL}" ;;
  esac
}

run_anchor() {
  local home="$1" rc branch url head out receipt_written

  [[ -n "${home}" ]] || undetermined "no project home given. Usage: repo-anchor.sh <project-home>"
  [[ -d "${home}" ]] || undetermined "project home does not exist: ${home}"

  resolve_statedir "${home}"
  resolve_root "${home}" "${OPT_SLUG}"

  # The receipt describes the project's FIRST repository. Another repo root (a second
  # --slug) is anchored into the registry only and leaves that receipt as it is.
  local primary=1 rroot
  rroot="$(receipt_field "${RECEIPT_PATH}" "repoRoot" 2>/dev/null)" && ! same_path "${rroot}" "${ROOT}" && primary=0

  # Already anchored? Then this is a no-op, not a second anchoring.
  check_receipt "${RECEIPT_PATH}"
  if (( primary == 1 )) && [[ "${CHECK_STATUS}" == "ok" ]] && (( CHECK_LOCAL == 0 )); then
    write_registry "${SLUG}" "${ROOT}" "$(receipt_field "${RECEIPT_PATH}" branch 2>/dev/null || echo main)" 0 \
      || undetermined "the repo registry beside ${RECEIPT_PATH} could not be written"
    printf 'REPO-ANCHOR ALREADY ANCHORED | %s | receipt=%s\n' "${CHECK_DETAIL}" "${RECEIPT_PATH}"
    exit 3
  fi

  mkdir -p "${ROOT}" 2>/dev/null \
    || undetermined "could not create the repository root ${ROOT}"

  # --- 1. the repository ----------------------------------------------------
  if ! "${GIT}" -C "${ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    if ! "${GIT}" init -b main "${ROOT}" >/dev/null 2>&1; then
      # git < 2.28 has no `init -b`; the same result, one step later.
      "${GIT}" init "${ROOT}" >/dev/null 2>&1 \
        || undetermined "git init failed in ${ROOT} — the repository was not created, so nothing is claimed about it"
      "${GIT}" -C "${ROOT}" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
    fi
    printf 'REPO-ANCHOR | created a git repository at %s\n' "${ROOT}"
  fi

  branch="$("${GIT}" -C "${ROOT}" symbolic-ref --short HEAD 2>/dev/null)"
  [[ -n "${branch}" ]] || branch="main"
  if [[ "${branch}" != "main" ]]; then
    # An existing repository's default branch is REPORTED, never renamed.
    printf 'REPO-ANCHOR | this repository already lives on branch %s, not main — reported, not changed\n' "${branch}"
  fi

  # --- 2. the first commit (never a rewrite of existing history) ------------
  if ! "${GIT}" -C "${ROOT}" rev-parse --verify HEAD >/dev/null 2>&1; then
    local name email empty
    name="$("${GIT}" -C "${ROOT}" config user.name 2>/dev/null)"
    email="$("${GIT}" -C "${ROOT}" config user.email 2>/dev/null)"
    [[ -n "${name}" ]] || name="spec-protocol"
    [[ -n "${email}" ]] || email="spec-protocol@localhost"
    "${GIT}" -C "${ROOT}" add -A >/dev/null 2>&1
    empty=""
    [[ -n "$("${GIT}" -C "${ROOT}" ls-files --cached 2>/dev/null | head -n 1)" ]] || empty="--allow-empty"
    "${GIT}" -C "${ROOT}" \
      -c "user.name=${name}" -c "user.email=${email}" -c commit.gpgsign=false \
      commit ${empty} -q -m "repo-anchor: initial commit (spec-protocol)" >/dev/null 2>&1 \
      || undetermined "git commit failed in ${ROOT} (author ${name} <${email}>) — the repository exists with no commit, which is not an anchor"
  fi

  # --- 3. the remote --------------------------------------------------------
  local source="" added owner reason=""
  added=0
  url="$("${GIT}" -C "${ROOT}" remote get-url origin 2>/dev/null)"
  if [[ -n "${url}" ]]; then
    source="existing"
  elif [[ -n "${OPT_REMOTE}" ]]; then
    "${GIT}" -C "${ROOT}" remote add origin "${OPT_REMOTE}" >/dev/null 2>&1 \
      || undetermined "git remote add origin failed in ${ROOT} for the --remote value"
    url="${OPT_REMOTE}"; source="--remote"; added=1
  elif (( IS_PROFILED == 1 )); then
    # A profiled project gets a GitHub repository ONLY when its profile names one.
    local profile="${home%/}/.spec-protocol.json" p_remote p_create prc crc
    p_remote="$(profile_field "${profile}" "repo.remote")"; prc=$?
    p_create="$(profile_field "${profile}" "repo.createPrivate")"; crc=$?
    (( prc != 2 && crc != 2 )) \
      || undetermined "profile ${profile} carries a repo.remote or repo.createPrivate that is not a non-empty string — tools/project-profile.mjs refuses that profile too"
    if (( prc == 0 )); then
      "${GIT}" -C "${ROOT}" remote add origin "${p_remote}" >/dev/null 2>&1 \
        || undetermined "git remote add origin failed in ${ROOT} for the profile's repo.remote"
      url="${p_remote}"; source="profile-remote"; added=1
    elif (( crc == 0 )); then
      [[ "${p_create}" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$ ]] \
        || undetermined "profile repo.createPrivate='${p_create}' is not <owner>/<name>"
      if gh_authenticated; then
        SLUG="${p_create#*/}"
        if gh_create "${p_create%%/*}" "" exact; then source="profile-create"; added=1; fi
      else
        reason="the profile's repo.createPrivate=${p_create} needs a logged-in gh, and ${GH_CMD} auth status returned rc=${GH_RC}"
      fi
    else
      reason="the profile names no repo.remote or repo.createPrivate, so no GitHub repository is created for it"
    fi
  elif gh_authenticated; then
    # The client's OWN account: gh's default owner is whoever is logged in
    # (SKILL.md section 6, minute one). The token is never interpolated into a
    # URL, and gh's own output is discarded except for its return code.
    # Every create failing (name taken x5, network) is local-only, never a stop.
    if gh_create "${REPO_ANCHOR_GH_OWNER:-}"; then
      source="client-gh"; added=1
    fi
  elif [[ -n "${OPT_OPERATOR_REMOTE}" ]]; then
    "${GIT}" -C "${ROOT}" remote add origin "${OPT_OPERATOR_REMOTE}" >/dev/null 2>&1 \
      || undetermined "git remote add origin failed in ${ROOT} for the --operator-remote value"
    url="${OPT_OPERATOR_REMOTE}"; source="operator-remote"; added=1
    printf 'REPO-ANCHOR | GITHUB: operator-provided remote (client declined own account) — references/pipeline.md:782, a DEFAULT and never a stop\n'
  else
    # The client declined: the operator's own owner, else local-only. Never a stop.
    owner="$(operator_owner)" || exit 2
    if [[ -n "${owner}" && -n "${GH_BIN}" ]]; then
      # The client is not logged in, so the operator's token (never printed,
      # never on an argv) authenticates this one create and nothing else.
      if gh_create "${owner}" "$(operator_env_value SPEC_PROTOCOL_OPERATOR_GH_TOKEN)"; then
        source="operator-owner"; added=1
      fi
    elif [[ -n "${owner}" ]]; then
      reason="operator owner ${owner} is set but '${GH_CMD}' does not resolve"
    else
      reason="SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER is set in neither the environment nor ${OWNER_FILE}"
    fi
  fi
  if [[ -z "${source}" ]]; then
    url=""; source="local-only"; LOCAL_REASON="${reason}"
    printf 'REPO-ANCHOR LOCAL-ONLY | no remote for %s — origin: none; %s auth status: rc=%s; --remote/--operator-remote: not given; %s. The work is saved on this computer and is NOT YET ONLINE.\n' \
      "${ROOT}" "${GH_CMD}" "${GH_RC}" "${reason}"
  fi

  # A remote WE added is pushed so the branch exists to prove. A remote that was
  # already there is never pushed to: it is not ours to change.
  if (( added == 1 )) && [[ "${source}" != "client-gh" && "${source}" != "operator-owner" && "${source}" != "profile-create" ]]; then
    "${GIT}" -C "${ROOT}" push -u origin "${branch}" >/dev/null 2>&1 || true
  fi

  # --- 4. the proof (local-only has no remote to prove) ---------------------
  rc=0
  [[ "${source}" == "local-only" ]] || { "${GIT}" -C "${ROOT}" ls-remote --exit-code origin "refs/heads/${branch}" >/dev/null 2>&1; rc=$?; }
  (( rc == 0 )) || undetermined "git -C ${ROOT} ls-remote --exit-code origin refs/heads/${branch} returned rc=${rc} (remote=$(redact "${url}"), source=${source}) — a FAILED PROOF is never a claim that the repository is fine"

  head="$("${GIT}" -C "${ROOT}" rev-parse HEAD 2>/dev/null)"
  [[ -n "${head}" ]] || undetermined "git -C ${ROOT} rev-parse HEAD produced nothing after a proven push"

  # --- 5. the receipt (and, on a legacy project, the ledger line) -----------
  local remote_word="OK"
  [[ "${source}" != "local-only" ]] || remote_word="NONE (local-only: not yet online)"
  if (( primary == 1 )); then
    receipt_written="$(write_receipt "${RECEIPT_PATH}" "${ROOT}" "$(redact "${url}")" "${branch}" "${head}" "${source}" "${LOCAL_REASON:-}")" \
      || undetermined "the receipt could not be written to ${RECEIPT_PATH} — an unrecorded anchor is not an anchor"
  else
    receipt_written="${RECEIPT_PATH} (kept: it describes the first repository ${rroot}; this one is in the registry)"
  fi
  write_registry "${SLUG}" "${ROOT}" "${branch}" "$([[ "${source}" == "local-only" ]] && echo 1 || echo 0)" \
    || undetermined "the repo registry beside ${RECEIPT_PATH} could not be written — an unrecorded anchor is not an anchor"

  if (( IS_PROFILED == 0 )); then
    [[ -x "${LEDGER_SH}" ]] \
      || undetermined "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every legacy project write goes through it, so an unlogged anchor is refused rather than written unlocked"
    out="$("${LEDGER_SH}" "${home}" "CONTROL/LEDGER.md" \
      "REPO-ANCHOR: root=${ROOT} remote=${remote_word} branch=${branch} source=${source}" 2>&1)"; rc=$?
    (( rc == 0 )) || undetermined "ledger.sh failed (rc=${rc}) writing CONTROL/LEDGER.md: ${out}"
  fi

  printf 'REPO-ANCHOR ANCHORED | root=%s | remote=%s | branch=%s | head=%s | source=%s | receipt=%s\n' \
    "${ROOT}" "$(redact "${url:-none (not yet online)}")" "${branch}" "${head}" "${source}" "${receipt_written}"
  exit 0
}

#------------------------------------------------------------------------------
# The selftest — the instrument proven before any verdict is believed.
# Everything happens inside one mktemp -d against a STUB gh. NO repository is
# ever created on any real GitHub account.
#------------------------------------------------------------------------------
FAILS=0
report() { # report <n> <name> <ok:0|1> <detail>
  if [ "$3" = "1" ]; then printf 'PASS %-3s %-30s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-3s %-30s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

# No output this script produces may ever look like a credential.
assert_no_token() { # assert_no_token <n> <name> <text>
  local hit
  hit="$(printf '%s' "$3" | grep -E -o 'gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|://[^/[:space:]]*:[^/[:space:]]*@' | head -n 1)"
  if [ -z "${hit}" ]; then report "$1" "$2" 1 "no token-looking string in the output"
  else report "$1" "$2" 0 "output carried a credential-shaped string"; fi
}

selftest() {
  local T stub bare_dir out rc

  T="$(mktemp -d "${TMPDIR:-/tmp}/repo-anchor-selftest.XXXXXX")" \
    || { printf 'repo-anchor.sh selftest: could not create a sandbox\n' >&2; return 1; }
  bare_dir="${T}/bares"
  mkdir -p "${bare_dir}" "${T}/bin"

  # THE STUB gh. `auth status` answers STUB_GH_AUTH_RC. `repo create` does with
  # a local bare repository exactly what the real one does with a remote, so
  # `git ls-remote` is a REAL proof and not a mock of one.
  stub="${T}/bin/gh"
  cat > "${stub}" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
case "${1:-}" in
  auth)
    # The real one prints the logged-in account here. Nothing may rely on it.
    echo "github.com: logged in to account stub-client (keyring)"
    exit "${STUB_GH_AUTH_RC:-0}" ;;
  repo)
    if [ "${2:-}" = "view" ]; then echo "${STUB_GH_VISIBILITY:-PRIVATE}"; exit 0; fi
    [ "${2:-}" = "create" ] || exit 64
    name="${3:-}"; src=""; i=0
    for a in "$@"; do
      i=$(( i + 1 ))
      if [ "$a" = "--source" ]; then eval "src=\${$(( i + 1 ))}"; fi
    done
    [ -n "$name" ] && [ -n "$src" ] || exit 64
    # Like the real one: logged out and no GH_TOKEN -> no create at all.
    if [ "${STUB_GH_AUTH_RC:-0}" != "0" ] && [ -z "${GH_TOKEN:-}" ]; then
      echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4
    fi
    slug="${name##*/}"
    bare="${STUB_GH_BARE_DIR:?}/${slug}.git"
    if [ -e "$bare" ]; then
      echo "GraphQL: Name already exists on this account (createRepository)" >&2; exit 1
    fi
    echo "$name" >> "${STUB_GH_BARE_DIR:?}/created.log"
    [ -z "${GH_TOKEN:-}" ] || echo "$name" >> "${STUB_GH_BARE_DIR:?}/token-used.log"
    git init --bare "$bare" >/dev/null 2>&1 || exit 1
    git -C "$src" remote add origin "$bare" >/dev/null 2>&1 || exit 1
    br="$(git -C "$src" symbolic-ref --short HEAD 2>/dev/null || echo main)"
    git -C "$src" push -u origin "$br" >/dev/null 2>&1 || exit 1
    echo "https://github.com/stub-client/${slug}"
    exit 0 ;;
esac
exit 64
STUB
  chmod +x "${stub}"
  export STUB_GH_BARE_DIR="${bare_dir}"
  # Never read the operator's real owner: a sandbox config dir and no env value.
  export CLAUDE_CONFIG_DIR="${T}/cfg"
  unset SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER REPO_ANCHOR_GH_OWNER STUB_GH_VISIBILITY

  anchor() { # anchor <env-assignments-as-prefix...> -- runs this script
    REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "$@" 2>&1
  }

  # --- 1. a legacy project, fresh folder -----------------------------------
  local legacy
  legacy="${T}/legacy"
  mkdir -p "${legacy}"
  printf 'hello\n' > "${legacy}/README.md"
  out="$(anchor "${legacy}")"; rc=$?
  report 1 "legacy-anchored" \
    "$([ "${rc}" = "0" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0) anchoring a fresh legacy folder through the stub gh$([ "${rc}" = "0" ] || printf ' -- %s' "$(printf '%s' "${out}" | tail -n 2 | tr '\n' ' ')")"

  local receipt
  receipt="${legacy}/CONTROL/repo-anchor.json"
  report 2 "legacy-receipt-written" \
    "$([ -f "${receipt}" ] && echo 1 || echo 0)" \
    "the receipt exists at ${receipt}: $([ -f "${receipt}" ] && echo yes || echo NO)"

  report 3 "legacy-root-is-repos-slug" \
    "$([ -d "${legacy}/repos/legacy/.git" ] && echo 1 || echo 0)" \
    "the working copy is at <home>/repos/<slug>/ (references/documents.md:63): $([ -d "${legacy}/repos/legacy/.git" ] && echo yes || echo NO)"

  local ledger_hit
  ledger_hit="$(grep -c 'REPO-ANCHOR: root=.* remote=OK branch=main source=client-gh' "${legacy}/CONTROL/LEDGER.md" 2>/dev/null || true)"
  report 4 "legacy-ledger-line" \
    "$([ "${ledger_hit:-0}" -ge 1 ] 2>/dev/null && echo 1 || echo 0)" \
    "CONTROL/LEDGER.md carries the REPO-ANCHOR line through tools/ledger.sh: ${ledger_hit:-0} match(es)"

  out="$(anchor "${legacy}" --check)"; rc=$?
  report 5 "legacy-check-ok" \
    "$([ "${rc}" = "0" ] && echo 1 || echo 0)" \
    "--check on the anchored project -> rc=${rc} (want 0), reading only the receipt and git config"

  # --- 2. running it again is a no-op, not a second anchoring --------------
  out="$(anchor "${legacy}")"; rc=$?
  report 6 "second-run-already-anchored" \
    "$([ "${rc}" = "3" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 3) on the SAME project: ALREADY ANCHORED, nothing re-created"

  # --- 2b. the repo registry: a second --slug is a second repo, the receipt stays the first's
  out="$(anchor "${legacy}" --slug api)"; rc=$?
  local regok
  regok="$("${PY}" -c 'import json,os,sys
d={r["name"]:r for r in json.load(open(sys.argv[1]))["repos"]}
print(int(set(d)=={"legacy","api"} and d["legacy"]["remote"]=="origin" and d["legacy"]["trunk"]=="main"
  and os.path.realpath(d["api"]["root"])==os.path.realpath(sys.argv[2]+"/repos/api")))' "${legacy}/CONTROL/repos.json" "${legacy}" 2>/dev/null)"
  report 22 "registry-two-repos" \
    "$([ "${rc}" = "0" ] && [ "${regok}" = "1" ] && [ "$(receipt_field "${legacy}/CONTROL/repo-anchor.json" repoRoot)" = "${legacy}/repos/legacy" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0); CONTROL/repos.json lists legacy (origin, main) and api; repo-anchor.json still names the first repo: ${regok:-0}"

  # --- 3. a profiled project -----------------------------------------------
  local profiled
  profiled="${T}/profiled"
  mkdir -p "${profiled}/state"
  cat > "${profiled}/.spec-protocol.json" <<'JSON'
{
  "schema": "spec-protocol.project-profile/v1",
  "documents": {
    "spec": "SPEC.md", "protocol": "PROTOCOL.md", "state": "state/build-state.json",
    "ledger": "LEDGER.md", "todo": "TODO.md", "checklist": "CHECKLIST.md", "qc": "QC.md"
  },
  "policy": {
    "maxActiveWorkflows": 10, "maxAgentsPerWorkflow": 10, "maxWorkingAgents": 100,
    "maxBuilderSubmissions": 4, "maxQCVerdicts": 4,
    "builderRoute": "opus-chain", "qcRoute": "sonnet-chain"
  },
  "targets": ["desktop"],
  "commands": {
    "validate": ["node", "scripts/state.mjs", "validate"],
    "dispatch": ["node", "scripts/state.mjs", "dispatch-check"],
    "release": ["node", "scripts/state.mjs", "release-check"]
  }
}
JSON
  printf '{}\n' > "${profiled}/state/build-state.json"
  out="$(anchor "${profiled}")"; rc=$?
  report 7 "profiled-anchored-at-home" \
    "$([ "${rc}" = "0" ] && [ -d "${profiled}/.git" ] && [ "$(receipt_field "${profiled}/state/repo-anchor.json" source 2>/dev/null)" = "local-only" ] && grep -q '"reason": "the profile names no repo' "${profiled}/state/repo-anchor.json" && ! grep -q 'profiled' "${bare_dir}/created.log" && echo 1 || echo 0)" \
    "rc=${rc} (want 0), rooted at the project home, and with gh logged in but no repo.* in the profile: LOCAL-ONLY with the reason in the receipt, no gh repo create"

  report 8 "profiled-receipt-beside-state" \
    "$([ -f "${profiled}/state/repo-anchor.json" ] && echo 1 || echo 0)" \
    "the receipt sits beside documents.state at state/repo-anchor.json: $([ -f "${profiled}/state/repo-anchor.json" ] && echo yes || echo NO)"

  report 9 "profiled-no-control-created" \
    "$([ -e "${profiled}/CONTROL" ] && echo 0 || echo 1)" \
    "no CONTROL/ directory was created in a profiled project (a profile never gets a CONTROL/ folder): $([ -e "${profiled}/CONTROL" ] && echo NO -- one was created || echo yes)"

  local preg
  preg="$("${PY}" -c 'import json,sys;r=json.load(open(sys.argv[1]))["repos"];print(int(len(r)==1 and r[0]["remote"] is None and r[0]["trunk"]=="main"))' "${profiled}/state/spec-protocol/repos.json" 2>/dev/null)"
  report 23 "registry-profiled-workdir" \
    "$([ "${preg}" = "1" ] && echo 1 || echo 0)" \
    "the profiled registry is at <state dir>/spec-protocol/repos.json with one local-only entry (remote null): ${preg:-0}"

  # --- 4. gh not authenticated, no fallback, no operator owner -> local-only -
  # (#6: this used to be exit 4, which stopped every build a client declined.)
  local declined
  declined="${T}/declined"
  mkdir -p "${declined}"
  out="$(STUB_GH_AUTH_RC=1 REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${declined}" 2>&1)"; rc=$?
  local lo=0
  [ "$(receipt_field "${declined}/CONTROL/repo-anchor.json" source 2>/dev/null)" = "local-only" ] \
    && grep -q '"remote": null' "${declined}/CONTROL/repo-anchor.json" \
    && grep -q 'source=local-only' "${declined}/CONTROL/LEDGER.md" \
    && printf '%s' "${out}" | grep -q 'NOT YET ONLINE' \
    && "${SELF}" "${declined}" --check >/dev/null 2>&1 && lo=1
  report 10 "declined-local-only" \
    "$([ "${rc}" = "0" ] && [ "${lo}" = "1" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0) with gh auth rc 1 and no owner; receipt source=local-only remote=null, ledger line, 'not yet online', --check 0: $([ "${lo}" = "1" ] && echo yes || echo NO)"

  # --- 5. the operator-provided remote (the client declined) ---------------
  local opdir opbare
  opdir="${T}/operator"
  opbare="${bare_dir}/operator-fallback.git"
  mkdir -p "${opdir}"
  "${GIT}" init --bare "${opbare}" >/dev/null 2>&1
  out="$(STUB_GH_AUTH_RC=1 REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${opdir}" --operator-remote "${opbare}" 2>&1)"; rc=$?
  local opsource
  opsource="$(receipt_field "${opdir}/CONTROL/repo-anchor.json" "source" 2>/dev/null || true)"
  report 11 "operator-remote-anchored" \
    "$([ "${rc}" = "0" ] && [ "${opsource}" = "operator-remote" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0) with gh unauthenticated and --operator-remote given; receipt source=${opsource:-<none>} (want operator-remote)"

  # --- 6. THE DISCRIMINATING CONTROL ---------------------------------------
  # The same anchored project, one thing changed: origin now points somewhere
  # else. --check must say NOT ANCHORED. Without this leg, a --check that
  # only tested for the FILE would score every case above.
  "${GIT}" -C "${legacy}/repos/legacy" remote set-url origin "${bare_dir}/somewhere-else.git" >/dev/null 2>&1
  out="$(anchor "${legacy}" --check)"; rc=$?
  report 12 "check-catches-moved-origin" \
    "$([ "${rc}" = "3" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 3) once origin no longer matches the receipt -- a receipt that is merely PRESENT proves nothing"

  # --- 7. --check on a project that was never anchored ---------------------
  local never
  never="${T}/never"
  mkdir -p "${never}"
  out="$(anchor "${never}" --check)"; rc=$?
  report 13 "check-no-receipt-is-3" \
    "$([ "${rc}" = "3" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 3) on a project with no receipt at all"

  # --- 8. no credential ever reaches the output ----------------------------
  local all_out
  all_out="$(anchor "${legacy}" --check 2>&1; anchor "${profiled}" --check 2>&1; \
             STUB_GH_AUTH_RC=1 REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${declined}" 2>&1)"
  assert_no_token 14 "no-credential-in-output" "${all_out}"

  # --- 9. no repository was created anywhere but the sandbox ---------------
  report 15 "sandbox-only" \
    "$([ -d "${bare_dir}" ] && echo 1 || echo 0)" \
    "every 'remote' in this run is a local bare repository under ${bare_dir} -- the stub gh never touches github.com"

  # --- 10. #6: the client declined, the operator's owner is in operator.env --
  local opown
  opown="${T}/opown"
  mkdir -p "${opown}" "${T}/cfg/spec-protocol"
  # C2: the stub refuses a logged-out create, as the real gh does. Owner but no
  # operator token -> local-only (the control); then the token -> operator-owner.
  local tok="ghp_stubOperatorToken0000"
  printf '# operator\nSPEC_PROTOCOL_OPERATOR_REMOTE_OWNER="stub-operator"\n' > "${T}/cfg/spec-protocol/operator.env"
  STUB_GH_AUTH_RC=1 REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${opown}" >/dev/null 2>&1; local rcnotok=$?
  local srcnotok
  srcnotok="$(receipt_field "${opown}/CONTROL/repo-anchor.json" source 2>/dev/null)"
  printf 'SPEC_PROTOCOL_OPERATOR_GH_TOKEN=%s\n' "${tok}" >> "${T}/cfg/spec-protocol/operator.env"
  out="$(STUB_GH_AUTH_RC=1 REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${opown}" 2>&1)"; rc=$?
  rm -f "${T}/cfg/spec-protocol/operator.env"
  report 16 "operator-owner-from-file" \
    "$([ "${rcnotok}" = "0" ] && [ "${srcnotok}" = "local-only" ] && [ "${rc}" = "0" ] && grep -qx 'stub-operator/opown' "${bare_dir}/token-used.log" && [ "$(receipt_field "${opown}/CONTROL/repo-anchor.json" source 2>/dev/null)" = "operator-owner" ] && echo 1 || echo 0)" \
    "no token: rc=${rcnotok} source=${srcnotok:-<none>} (want 0 local-only); token: rc=${rc} (want 0), gh got GH_TOKEN for stub-operator/opown, receipt source operator-owner"
  report 18 "operator-token-never-leaks" \
    "$(printf '%s' "${out}" | grep -q "${tok}" || grep -rq "${tok}" "${opown}/CONTROL" "${opown}/repos/opown/.git/config" || echo 1)" \
    "the operator token is absent from the output, the receipt, the ledger and the git config"

  # --- 12. C1: the name is taken -> <slug>-2; all five taken -> local-only ---
  local taken full
  taken="${T}/taken"; full="${T}/full"
  mkdir -p "${taken}" "${full}"
  "${GIT}" init -q --bare "${bare_dir}/taken.git"
  for n in "" -2 -3 -4 -5; do "${GIT}" init -q --bare "${bare_dir}/full${n}.git"; done
  out="$(anchor "${taken}")"; rc=$?
  report 19 "name-taken-retries-slug-2" \
    "$([ "${rc}" = "0" ] && grep -qx 'taken-2' "${bare_dir}/created.log" && [ "$(receipt_field "${taken}/CONTROL/repo-anchor.json" source 2>/dev/null)" = "client-gh" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0); taken exists so gh repo create got taken-2 and the receipt source is client-gh"
  out="$(anchor "${full}")"; rc=$?
  report 20 "all-names-taken-local-only" \
    "$([ "${rc}" = "0" ] && [ "$(receipt_field "${full}/CONTROL/repo-anchor.json" source 2>/dev/null)" = "local-only" ] && printf '%s' "${out}" | grep -q 'full-5' && echo 1 || echo 0)" \
    "rc=${rc} (want 0, never 2 with no receipt); five taken names -> local-only receipt naming the last try"

  # --- 13. C2: a profile that NAMES repo.createPrivate gets exactly that repo --
  local prof2
  prof2="${T}/prof2"
  mkdir -p "${prof2}/state"
  sed 's#"targets": \["desktop"\],#"targets": ["desktop"], "repo": {"createPrivate": "acme/my-project"},#' \
    "${profiled}/.spec-protocol.json" > "${prof2}/.spec-protocol.json"
  printf '{}\n' > "${prof2}/state/build-state.json"
  out="$(anchor "${prof2}")"; rc=$?
  report 21 "profile-createprivate-exact" \
    "$([ "${rc}" = "0" ] && [ "$(tail -n 1 "${bare_dir}/created.log")" = "acme/my-project" ] && [ "$(receipt_field "${prof2}/state/repo-anchor.json" source 2>/dev/null)" = "profile-create" ] && echo 1 || echo 0)" \
    "rc=${rc} (want 0); gh repo create got exactly acme/my-project --private and the receipt source is profile-create"

  # --- 11. #49: --check fails a GitHub remote that is not PRIVATE ----------
  local pub
  pub="${T}/pub"
  mkdir -p "${pub}/repos/pub"
  "${GIT}" init -q "${pub}/repos/pub"
  "${GIT}" -C "${pub}/repos/pub" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x
  "${GIT}" -C "${pub}/repos/pub" remote add origin https://github.com/stub-client/pub.git
  write_receipt "${pub}/CONTROL/repo-anchor.json" "${pub}/repos/pub" https://github.com/stub-client/pub.git main x existing >/dev/null
  local rcpriv rcpub
  STUB_GH_VISIBILITY=PRIVATE REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${pub}" --check >/dev/null 2>&1; rcpriv=$?
  out="$(STUB_GH_VISIBILITY=PUBLIC REPO_ANCHOR_GH_CMD="${stub}" "${SELF}" "${pub}" --check 2>&1)"; rcpub=$?
  report 17 "check-refuses-public-repo" \
    "$([ "${rcpriv}" = "0" ] && [ "${rcpub}" = "3" ] && printf '%s' "${out}" | grep -q 'NOT PRIVATE' && echo 1 || echo 0)" \
    "PRIVATE -> rc=${rcpriv} (want 0); PUBLIC -> rc=${rcpub} (want 3, NOT PRIVATE named)"

  printf '\n'
  if [ "${FAILS}" = "0" ]; then
    printf 'repo-anchor.sh selftest: ALL PASS (23 checks, every fixture inside %s)\n' "${T}"
    return 0
  fi
  printf 'repo-anchor.sh selftest: %s FAILED — this is a BROKEN INSTRUMENT; do not treat its verdicts as proof\n' "${FAILS}"
  return 1
}

case "${MODE}" in
  selftest) selftest; exit $? ;;
  check) run_check "${HOME_DIR}" ;;
  *) run_anchor "${HOME_DIR}" ;;
esac
