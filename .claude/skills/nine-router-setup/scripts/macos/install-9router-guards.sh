#!/usr/bin/env bash
# install-9router-guards.sh — deliver the 9Router bundle guards and (re)apply them.
#
# 9Router ships as a prebuilt Next bundle. The guards in ../../assets/guards fix defects in it
# (doubled tool-call JSON, DeepSeek effort mapping + parallel-tool 400, GLM 5.3 thinking, Ollama
# stream end, Anthropic keepalive, unscoped next-server kill, ...). Any `npm i -g 9router`
# replaces the bundle and silently reverts every one of them, so this script is the one command to
# run after setup AND after every 9Router upgrade.
#
# Usage: install-9router-guards.sh [--check] [--no-restart] [--root DIR]
#                                  [--upgrade [VERSION]] [guard-name ...]
#   (no guard names)  all guards, in the order they must run
#   --check           copy nothing, patch nothing: print what the bundle has and has not
#   --root DIR        9Router install dir (default: first of ~/.npm-global, /opt/homebrew, /usr/local,
#                     /usr/lib, ~/.local/share/999/npm). The five older guards search that same list.
#   --upgrade [VER]   npm-install 9router@VER (default latest) into the same prefix first, then re-apply
#   --no-restart      do not kickstart the launchd job after a change
#
# Exit 0 = every selected guard's patch is PROVEN present by content marker (not by exit code: a
# guard's --check exits 0 even when it would patch, and a guard that cannot find its anchor must
# never read as success). 1 = something is not applied. 2 = tooling/usage.
#
# Never touches keys, providers, combos, models or the database. Guards write a sibling
# `<file>.pre-*` / `.bak-*` copy of each file they change inside the 9Router install dir.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../assets/guards"
BIN_DIR="$HOME/.local/bin"
PATCH_DIR="$HOME/.9router/patches"
LABEL="com.blackceo.9router-localhost"
# Order matters: dupfix first, codex-terminal after it (it converts dupfix's flag), ollama-done
# before toolargs, ping last (it wraps the handler export).
ALL=(dupfix codex-terminal nextserver cachecontrol glm53-thinking deepseek-effort deepseek-openai-route \
     ollama-done opencode-poll opencode-toolargs ping-keepalive upstream-shape)

CHECK=0; RESTART=1; ROOT=""; UPGRADE=0; VER="latest"; SEL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --no-restart) RESTART=0 ;;
    --root) ROOT="${2:-}"; shift ;;
    --upgrade) UPGRADE=1; case "${2:-}" in ""|--*) ;; *) VER="$2"; shift ;; esac ;;
    -h|--help) sed -n 2,28p "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) SEL+=("$1") ;;
  esac; shift
done
[ ${#SEL[@]} -gt 0 ] || SEL=("${ALL[@]}")
for g in "${SEL[@]}"; do
  case " ${ALL[*]} " in *" $g "*) ;; *) echo "unknown guard: $g (known: ${ALL[*]})" >&2; exit 2 ;; esac
done
[ -d "$SRC" ] || { echo "guard assets not found at $SRC" >&2; exit 2; }

if [ -z "$ROOT" ]; then
  for d in "$HOME/.npm-global/lib/node_modules/9router" /opt/homebrew/lib/node_modules/9router \
           /usr/local/lib/node_modules/9router /usr/lib/node_modules/9router \
           "$HOME/.local/share/999/npm/lib/node_modules/9router"; do
    [ -f "$d/package.json" ] && { ROOT="$d"; break; }
  done
fi
[ -n "$ROOT" ] && [ -f "$ROOT/package.json" ] || { echo "no 9Router install found (use --root DIR)" >&2; exit 2; }
CHUNKS="$ROOT/app/.next-cli-build/server/chunks"

NODE=""; for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -n "$NODE" ] || { echo "no node binary resolvable" >&2; exit 2; }
NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM="$(command -v npm 2>/dev/null || true)"

if [ "$UPGRADE" = 1 ] && [ "$CHECK" = 0 ]; then
  [ -x "$NPM" ] || { echo "npm not found for --upgrade" >&2; exit 2; }
  PREFIX="$(cd "$ROOT/../.." && pwd)"
  echo "[guards] upgrading 9router@$VER in prefix $PREFIX"
  PATH="$(dirname "$NODE"):$PATH" "$NPM" install -g --prefix "$PREFIX" "9router@$VER" --no-audit --no-fund >&2 \
    || { echo "npm install failed; guards not touched" >&2; exit 2; }
fi
[ -d "$CHUNKS" ] || { echo "9Router chunks dir not found at $CHUNKS" >&2; exit 2; }
echo "[guards] 9Router $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1) at $ROOT"

fingerprint() { cat "$CHUNKS"/*.js "$ROOT/cli.js" 2>/dev/null | /usr/bin/shasum | cut -d' ' -f1; }

if [ "$CHECK" = 0 ]; then
  mkdir -p "$BIN_DIR" "$PATCH_DIR"
  for f in "$SRC"/9router-*.sh; do
    cmp -s "$f" "$BIN_DIR/$(basename "$f")" || cp "$f" "$BIN_DIR/$(basename "$f")"
    chmod 755 "$BIN_DIR/$(basename "$f")"
  done
  for d in "$SRC"/patches/*/; do
    n="$(basename "$d")"; mkdir -p "$PATCH_DIR/$n"
    for f in "$d"*; do cmp -s "$f" "$PATCH_DIR/$n/$(basename "$f")" || cp "$f" "$PATCH_DIR/$n/$(basename "$f")"; done
  done
  before="$(fingerprint)"
  for g in "${SEL[@]}"; do
    # Guards that take a root get it; the five older ones search the standard list (same order as above).
    out="$("$BIN_DIR/9router-$g-guard.sh" "$ROOT" 2>&1)"; rc=$?
    echo "[guards] $g: rc=$rc"
    [ "$rc" -eq 0 ] || printf '%s\n' "$out" | tail -5 | sed 's/^/    /'
  done
  after="$(fingerprint)"
  # node --check every file a guard may have touched, by absolute node path.
  bad=0
  for f in "$CHUNKS"/*.js "$ROOT/cli.js"; do "$NODE" --check "$f" >/dev/null 2>&1 || { echo "[guards] SYNTAX FAIL: $f"; bad=1; }; done
  [ "$bad" = 0 ] || { echo "[guards] a patched file does not parse; NOT restarting" >&2; exit 1; }
fi

# Proof by content. Marker -> file glob -> minimum occurrences, one row per patch.
CHUNKS="$CHUNKS" ROOT="$ROOT" SELECTED="${SEL[*]}" /usr/bin/python3 - <<'PY'
import glob, os, re, sys
chunks, root, sel = os.environ["CHUNKS"], os.environ["ROOT"], os.environ["SELECTED"].split()
C = lambda s: s  # readability
T = {  # guard -> [(label, marker, scope, min)]
 # codex-terminal rewrites dupfix's `!b.finishReason` flag to `!b.__cxTerm`; either spelling is the fix.
 "dupfix": [("translator idempotency", "re:finish_reason&&!b\\.(?:finishReason|__cxTerm)\\)", "chunks", 2)],
 "codex-terminal": [("codex terminal", "__cxTerm", "chunks", 1)],
 "nextserver": [("scoped kill", "__r9OwnNextServerPids", "cli", 2)],
 "cachecontrol": [("cache_control passthrough", "preserveCacheControl:!0/*cc-guard*/", "chunks", 1)],
 "glm53-thinking": [("GLM 5.3 behaviour", None, "regression", 1)],
 "deepseek-effort": [("DeepSeek effort tiers", '"low"===a||"minimal"===a?"low":"max"===a||"ultra"===a?"max":"high"', "chunks", 1)],
 "deepseek-openai-route": [("DeepSeek OpenAI route", "/*deepseek-openai-route-v1*/", "chunks", 1)],
 "ollama-done": [("Ollama [DONE] capture", 'let __done="data: [DONE]', "chunks", 1)],
 "opencode-poll": [("oc non-stream poll", 'status:"in_progress",usage:{...e},items:new Map,deltaText:""}', "chunks", 1)],
 "opencode-toolargs": [("toolargs recovery", "/*toolargs-recovery-v1*/", "chunks", 1),
                       ("failover guard", "/*failover-guard-v2*/", "chunks", 1),
                       ("ollama overload", "/*ollama-overload-guard-v1*/", "chunks", 1),
                       ("ollama nonstream claude", "/*ollama-nonstream-claude-v1*/", "chunks", 1),
                       ("ollama stream error", "/*ollama-stream-error-v1*/", "chunks", 1),
                       ("tool id sanitize", "/*tool-id-sanitize-v1*/", "chunks", 1)],
 "ping-keepalive": [("anthropic keepalive", "/*ping-keepalive-v3*/", "chunks", 1)],
 "upstream-shape": [("malformed upstream 502", "Malformed upstream completion", "chunks", 1)],
}
txt = {}
def text(scope):
    if scope not in txt:
        fs = sorted(glob.glob(os.path.join(chunks, "*.js"))) if scope == "chunks" else [os.path.join(root, "cli.js")]
        txt[scope] = "".join(open(f, encoding="utf-8", errors="replace").read() for f in fs)
    return txt[scope]
bad = 0
for g in sel:
    for label, marker, scope, mn in T[g]:
        if marker is None: continue
        n = len(re.findall(marker[3:], text(scope))) if marker.startswith("re:") else text(scope).count(marker)
        ok = n >= mn
        bad += not ok
        print(f"[guards] {'OK  ' if ok else 'MISSING'} {g}: {label} ({n} hit, need {mn})")
sys.exit(1 if bad else 0)
PY
rc=$?

if [ "$rc" = 0 ] && case " ${SEL[*]} " in *" glm53-thinking "*) true ;; *) false ;; esac; then
  if [ -f "$PATCH_DIR/glm-5.3-thinking/regression-v2.cjs" ] || [ "$CHECK" = 1 ]; then
    if [ "$CHECK" = 1 ]; then s="$SRC/patches/glm-5.3-thinking/regression-v2.cjs"; else s="$PATCH_DIR/glm-5.3-thinking/regression-v2.cjs"; fi
    if "$NODE" "$s" "$ROOT" >/dev/null 2>&1; then echo "[guards] OK   glm53-thinking: behavioural regression suite passes"
    else echo "[guards] MISSING glm53-thinking: behavioural regression suite FAILED"; rc=1; fi
  fi
fi

if [ "$CHECK" = 0 ] && [ "$rc" = 0 ] && [ "$RESTART" = 1 ] && [ "$before" != "$after" ] \
   && launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "[guards] bundle changed; restarting $LABEL"
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || echo "[guards] kickstart failed" >&2
fi
[ "$CHECK" = 0 ] && [ "$before" = "$after" ] && echo "[guards] bundle unchanged (already applied)"
exit "$rc"
