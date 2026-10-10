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
# Exit codes: 0 = the step reached a decision (SET+pass, SET+fail, or NOT SET —
# the mode file carries the outcome), 1 = settings could not be written.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

API_DOCS="${API_DOCS_PATH:-}"
NON_INTERACTIVE=0
ADAPTER_OVERRIDE="${KIE_LIVE_ADAPTER_PY:-}"

usage() {
  cat <<'EOF'
usage: setup-kie-live-adapter.sh [--api-docs PATH] [--adapter PATH] [--non-interactive]

  --api-docs PATH   client's own API document to read KIE_API_KEY from
  --adapter PATH    kie_live_adapter.py to use for the credits read
  --non-interactive never prompt; NOT SET when no key can be found
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --api-docs) [ $# -ge 2 ] || { echo "setup-kie-live-adapter: --api-docs needs a path" >&2; exit 1; }; API_DOCS="$2"; shift 2 ;;
    --api-docs=*) API_DOCS="${1#*=}"; shift ;;
    --adapter) [ $# -ge 2 ] || { echo "setup-kie-live-adapter: --adapter needs a path" >&2; exit 1; }; ADAPTER_OVERRIDE="$2"; shift 2 ;;
    --adapter=*) ADAPTER_OVERRIDE="${1#*=}"; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
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

if [ -n "$key" ]; then
  echo "KIE key: SET"
else
  echo "KIE key: NOT SET"
fi

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

if [ -n "$key" ]; then
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
if [ -z "$key" ]; then
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
  rm -f "$out" "$err"
  if [ -n "$balance" ]; then
    echo "KIE credits: $balance"
    credits_ok=1
  else
    echo "KIE credits: CHECK FAILED"
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
