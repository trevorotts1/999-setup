#!/usr/bin/env bash
# setup-kie-live-adapter.sh — installer step that collects THIS CLIENT'S OWN KIE
# key, stores it in the env block of every Claude config root on the machine,
# proves the key with one read-only credits call, and only then switches skill
# 74 out of shadow mode. KIE gap fix item (c).
#
# Key sources, in order (never an operator key, never a value hard-coded here):
#   1. KIE_API_KEY already present in the caller's environment (the client's own).
#   2. the client's own API document: --api-docs PATH, else $API_DOCS_PATH, else
#      ~/Documents/API docs.md, else ./API docs.md (line `KIE_API_KEY=...`).
#   3. ask the client — a hidden prompt on a terminal (skipped by --non-interactive).
#
# Output contract: never the value. Status lines only —
#   `KIE key: SET` / `KIE key: NOT SET`, `KIE credits: <balance>` /
#   `KIE credits: CHECK FAILED` / `KIE credits: NOT CHECKED`, plus one mode-file
#   line per config root. Nothing else prints the key, and the key is written to
#   no file except the settings.json env block of each config root.
#
# Writes (settings-writer pattern: back up, edit through a 600 temp file, re-lock):
#   - <root>/settings.json  env.KIE_API_KEY, mode 600, backup taken BEFORE the
#     value is inserted (settings.json.bak-kie-* therefore never carries it)
#   - <root>/kie-live-adapter-mode.conf  `active` only after a passing credits
#     call; otherwise left at the shadow default (absent stays absent, an
#     existing `active` is demoted to `shadow`)
#
# Config roots: $HOME/.claude (when the directory exists), $HOME/.claude-nine
# (when claude-nine is installed), and $CLAUDE_CONFIG_DIR when it is set — each
# only when its directory exists.
#
# Amendment U2-a..U2-e (golden-rule exception, scope exactly one line):
#   U2-a  only env.KIE_API_KEY is ever written; no ANTHROPIC_* key is written,
#         and a stored value never starts with "Bearer " (one leading
#         "Bearer " token is stripped from whatever the client pasted).
#   U2-b  before writing, any env.ANTHROPIC_BASE_URL (and an
#         env.ANTHROPIC_AUTH_TOKEN beside it) whose base URL contains
#         api.kie.ai is REPORTED and never edited and never deleted.
#   U2-c  any kie-models or kie-chat-agents folder under ~/.claude/skills,
#         ~/.claude-nine/skills or ~/.agents/skills is REPORTED and never
#         removed.
#   U2-d  a failed credits read prints the cause in plain words:
#         code 401 = key wrong, expired or rejected; check kie.ai/api-key
#         code 402 = not enough credits; top up at kie.ai/pricing
#   Declined fallback: --decline-settings-write writes nothing, prints the
#         single line the client pastes into the env block themselves (with a
#         placeholder — never the value) and leaves skill 74 in shadow mode.
#
# Approval: writing env.KIE_API_KEY into settings.json is a golden-rule
# exception, approved by Trevor by name 2026-10-09 ("OK YES", scope exactly
# this one line, mode 600, SET/NOT SET only) and tracked in pull request #170.
# A real-machine run depends on that by-name word holding; nothing here assumes
# consent beyond it.
#
# Exit codes: 0 = the step reached a decision (SET+pass, SET+fail, or NOT SET —
# the mode file carries the outcome), 1 = settings could not be written.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

API_DOCS="${API_DOCS_PATH:-}"
NON_INTERACTIVE=0
DECLINE=0
ADAPTER_OVERRIDE="${KIE_LIVE_ADAPTER_PY:-}"

usage() {
  cat <<'EOF'
usage: setup-kie-live-adapter.sh [--api-docs PATH] [--adapter PATH] [--non-interactive] [--decline-settings-write]

  --api-docs PATH          client's own API document to read KIE_API_KEY from
  --adapter PATH           kie_live_adapter.py to use for the credits read
  --non-interactive        never prompt; NOT SET when no key can be found
  --decline-settings-write write nothing; print the single paste line for the
                           client and leave skill 74 in shadow mode
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --api-docs) [ $# -ge 2 ] || { echo "setup-kie-live-adapter: --api-docs needs a path" >&2; exit 1; }; API_DOCS="$2"; shift 2 ;;
    --api-docs=*) API_DOCS="${1#*=}"; shift ;;
    --adapter) [ $# -ge 2 ] || { echo "setup-kie-live-adapter: --adapter needs a path" >&2; exit 1; }; ADAPTER_OVERRIDE="$2"; shift 2 ;;
    --adapter=*) ADAPTER_OVERRIDE="${1#*=}"; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --decline-settings-write) DECLINE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "setup-kie-live-adapter: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------- config roots
roots=()
add_root() {
  local d="${1%/}" r
  [ -n "$d" ] || return 0
  [ -d "$d" ] || return 0
  for r in ${roots[@]+"${roots[@]}"}; do
    [ "$r" = "$d" ] && return 0
  done
  roots+=("$d")
}
add_root "$HOME/.claude"
add_root "$HOME/.claude-nine"
add_root "${CLAUDE_CONFIG_DIR:-}"

# ------------------------------------------------------------------ collect key
key=""
key_source=""
placeholder="replace_with_real_key"

trim() { # trailing CR/whitespace only; a key never starts or ends with space
  printf '%s' "$1" | tr -d '\r' | sed -e 's/[[:space:]]*$//'
}

if [ -n "${KIE_API_KEY:-}" ]; then
  key="$(trim "$KIE_API_KEY")"
  case "$key" in ""|"$placeholder") key="" ;; *) key_source="environment" ;; esac
fi

if [ -z "$key" ]; then
  docs="$API_DOCS"
  if [ -z "$docs" ]; then
    for c in "$HOME/Documents/API docs.md" "./API docs.md"; do
      if [ -f "$c" ]; then docs="$c"; break; fi
    done
  fi
  if [ -n "$docs" ] && [ -f "$docs" ]; then
    raw="$(sed -n 's/^KIE_API_KEY[[:space:]]*=[[:space:]]*//p' "$docs" | head -n 1 || true)"
    raw="$(trim "$raw")"
    case "$raw" in ""|"$placeholder") ;; *) key="$raw"; key_source="api-document" ;; esac
  fi
fi

if [ -z "$key" ] && [ "$NON_INTERACTIVE" -eq 0 ] && [ -t 0 ]; then
  printf 'Paste your own KIE_API_KEY (input is hidden and never echoed): ' >&2
  asked=""
  if IFS= read -r asked; then :; else asked=""; fi
  printf '\n' >&2
  asked="$(trim "$asked")"
  case "$asked" in ""|"$placeholder") ;; *) key="$asked"; key_source="prompt" ;; esac
fi

# (U2-a) a stored value never starts with "Bearer " — strip the leading token
# (case-insensitively) off whatever the client pasted, however many times.
while [[ "$key" == [Bb][Ee][Aa][Rr][Ee][Rr]\ * ]]; do
  key="$(trim "${key#[Bb][Ee][Aa][Rr][Ee][Rr] }")"
done
if [ -z "$key" ]; then
  key_source=""
fi

if [ -n "$key" ]; then
  echo "KIE key: SET"
else
  echo "KIE key: NOT SET"
fi

# ------------------------------------ (U2-b) report ANTHROPIC entries at api.kie.ai
# Report only: never edited, never deleted, and no value is ever printed for the
# token — only that it is there.
report_anthropic() { # $1 = config root
  [ -f "$1/settings.json" ] || return 0
  python3 - "$1/settings.json" <<'PY' || true
import json, sys
path = sys.argv[1]
try:
    with open(path) as fh:
        doc = json.load(fh)
except Exception:
    sys.exit(0)
env = doc.get("env") if isinstance(doc, dict) else None
if not isinstance(env, dict):
    sys.exit(0)
base = env.get("ANTHROPIC_BASE_URL")
if isinstance(base, str) and "api.kie.ai" in base:
    print("report: %s env.ANTHROPIC_BASE_URL points at api.kie.ai (%s) — left untouched, never edited, never deleted" % (path, base))
    if "ANTHROPIC_AUTH_TOKEN" in env:
        print("report: %s env.ANTHROPIC_AUTH_TOKEN present beside that base URL — value never printed, left untouched" % path)
PY
}

# ------------------------------------ (U2-c) report kie-models / kie-chat-agents
# Report only: never removed.
report_kie_folders() {
  local skills folder
  for skills in "$HOME/.claude/skills" "$HOME/.claude-nine/skills" "$HOME/.agents/skills"; do
    [ -d "$skills" ] || continue
    while IFS= read -r folder; do
      [ -n "$folder" ] || continue
      echo "report: $folder present — left untouched, never removed"
    done < <(find "$skills" -type d \( -name kie-models -o -name kie-chat-agents \) 2>/dev/null || true)
  done
}

for r in ${roots[@]+"${roots[@]}"}; do
  report_anthropic "$r"
done
report_kie_folders

# ------------------------------------------------- store it in every config root
write_settings() { # $1 = config root
  local root="$1" f="$1/settings.json"
  if ! KIE_API_KEY="$key" SETTINGS_FILE="$f" python3 - "$f" <<'PY'
import json, os, sys, time

path = os.environ["SETTINGS_FILE"]
key = os.environ.get("KIE_API_KEY", "")
if not key:
    sys.exit(1)

exists = os.path.isfile(path)
doc, raw = {}, None
if exists:
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        sys.stderr.write("setup-kie-live-adapter: %s is not valid JSON — left untouched\n" % path)
        sys.exit(3)
    if not isinstance(doc, dict):
        sys.stderr.write("setup-kie-live-adapter: %s is not a JSON object — left untouched\n" % path)
        sys.exit(3)

env = doc.get("env")
if env is None:
    env = {}
elif not isinstance(env, dict):
    sys.stderr.write("setup-kie-live-adapter: %s has a non-object env block — left untouched\n" % path)
    sys.exit(3)

if exists and env.get("KIE_API_KEY") == key:
    os.chmod(path, 0o600)
    print("settings: %s env.KIE_API_KEY already present (mode 600)" % path)
    sys.exit(0)

# Back up BEFORE the value is inserted, so the backup never carries the key.
if exists:
    bak = "%s.bak-kie-%d-%d" % (path, int(time.time()), os.getpid())
    fd = os.open(bak, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(raw)

doc["env"] = dict(env, KIE_API_KEY=key)
tmp = path + ".tmp-kie"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
os.replace(tmp, path)
os.chmod(path, 0o600)
print("settings: %s env.KIE_API_KEY written (mode 600)" % path)
PY
  then
    echo "setup-kie-live-adapter: could not write $f" >&2
    return 1
  fi
}

if [ "$DECLINE" -eq 1 ]; then
  # Declined fallback: write nothing, print the single line for the client to
  # paste themselves (a placeholder — never the value), skill 74 stays shadow.
  echo "settings write declined — no settings.json is touched; skill 74 stays in shadow mode"
  if [ -n "$key" ]; then
    if [ "${#roots[@]}" -eq 0 ]; then
      echo "settings: no Claude config root exists on this machine — nothing to paste into"
    fi
    for r in ${roots[@]+"${roots[@]}"}; do
      printf 'paste this single line into the "env" block of %s yourself, then run: chmod 600 %s\n' "$r/settings.json" "$r/settings.json"
      echo '    "KIE_API_KEY": "PASTE_YOUR_OWN_KEY"'
    done
  fi
elif [ -n "$key" ]; then
  if [ "${#roots[@]}" -eq 0 ]; then
    echo "settings: no Claude config root exists on this machine — nothing to store"
  fi
  for r in ${roots[@]+"${roots[@]}"}; do
    write_settings "$r"
  done
fi

# ------------------------------------------------------- one read-only credits call
adapter="$ADAPTER_OVERRIDE"
if [ -z "$adapter" ] || [ ! -f "$adapter" ]; then
  adapter=""
  for r in ${roots[@]+"${roots[@]}"}; do
    c="$r/skills/74-kie-live-adapter/scripts/kie_live_adapter.py"
    if [ -f "$c" ]; then adapter="$c"; break; fi
  done
fi
if [ -z "$adapter" ]; then
  c="$REPO_ROOT/installer-registration/helpers/74-kie-live-adapter/scripts/kie_live_adapter.py"
  [ -f "$c" ] && adapter="$c"
fi

credits_ok=0
if [ "$DECLINE" -eq 1 ]; then
  echo "KIE credits: NOT CHECKED (settings write declined)"
elif [ -z "$key" ]; then
  echo "KIE credits: NOT CHECKED (no key)"
elif [ -z "$adapter" ]; then
  echo "KIE credits: CHECK FAILED (kie_live_adapter.py not found)"
else
  out="$(mktemp "${TMPDIR:-/tmp}/kie-credits-out.XXXXXX")"
  err="$(mktemp "${TMPDIR:-/tmp}/kie-credits-err.XXXXXX")"
  rc=0
  # The key reaches the adapter through this child's environment only: never as
  # argv, never on stdout/stderr, never in a file.
  KIE_API_KEY="$key" python3 "$adapter" credits </dev/null >"$out" 2>"$err" || rc=$?
  balance=""
  if [ "$rc" -eq 0 ]; then
    balance="$(python3 - "$out" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1]) as fh:
        doc = json.load(fh)
except Exception:
    sys.exit(0)
data = doc.get("data") if isinstance(doc, dict) else None
if isinstance(data, dict) and data.get("credits") is not None:
    print(data["credits"])
PY
)"
  fi
  # (U2-d) cause of a failed read, in plain words for 401 / 402.
  cause=""
  if [ -z "$balance" ]; then
    cause="$(python3 - "$out" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1]) as fh:
        doc = json.load(fh)
except Exception:
    sys.exit(0)
err = doc.get("error") if isinstance(doc, dict) else None
code = err.get("code") if isinstance(err, dict) else None
if code is not None:
    print(code)
PY
)"
  fi
  rm -f "$out" "$err"
  if [ -n "$balance" ]; then
    echo "KIE credits: $balance"
    credits_ok=1
  else
    case "$cause" in
      401) echo "KIE credits: CHECK FAILED (key wrong, expired or rejected; check kie.ai/api-key)" ;;
      402) echo "KIE credits: CHECK FAILED (not enough credits; top up at kie.ai/pricing)" ;;
      *)   echo "KIE credits: CHECK FAILED" ;;
    esac
  fi
fi

# ------------------------------------------------------------------ mode files
write_mode() { # $1 = file, $2 = word
  local f="$1" w="$2" tmp
  tmp="$(mktemp "$f.XXXXXX")" || return 1
  chmod 600 "$tmp"
  printf '%s\n' "$w" >"$tmp"
  mv -f "$tmp" "$f"
}

for r in ${roots[@]+"${roots[@]}"}; do
  f="$r/kie-live-adapter-mode.conf"
  if [ "$credits_ok" -eq 1 ]; then
    write_mode "$f" active
    echo "kie-live-adapter-mode.conf: active ($f)"
    continue
  fi
  # Shadow stays in force: absent stays absent, an existing `active` is demoted.
  if [ -f "$f" ]; then
    current="$(head -n 1 "$f" 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
    if [ "$current" = "active" ]; then
      write_mode "$f" shadow
      echo "kie-live-adapter-mode.conf: shadow ($f)"
    else
      echo "kie-live-adapter-mode.conf: left at ${current:-empty} ($f)"
    fi
  else
    echo "kie-live-adapter-mode.conf: absent — shadow default ($f)"
  fi
done

exit 0
