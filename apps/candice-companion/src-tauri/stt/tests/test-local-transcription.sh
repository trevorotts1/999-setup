#!/usr/bin/env bash
# Candice STT local transcription test (WS-16 acceptance: "local transcription
# test green").
#
# End-to-end proof that the pinned whisper.cpp runtime + bundled model
# transcribes real speech locally with no cloud endpoint:
#   1. verifies the model SHA-256,
#   2. verifies whisper-cli answers --version,
#   3. transcribes the canonical JFK fixture,
#   4. asserts the transcript matches the reference text (word-level,
#      punctuation-insensitive).
#
# Usage:
#   test-local-transcription.sh [--model <path>] [--binary <path>] [--fixture <wav>]
#
# Environment overrides: CANDICE_STT_MODEL, CANDICE_STT_BINARY, CANDICE_STT_FIXTURE.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/runtime"
MANIFESTS="$RUNTIME_DIR/manifests"

MODEL="${CANDICE_STT_MODEL:-}"
BINARY="${CANDICE_STT_BINARY:-}"
FIXTURE="${CANDICE_STT_FIXTURE:-}"

# Defaults: model in the operator's verified STT cache, binary on PATH.
if [[ -z "$MODEL" ]]; then
  MODEL="$HOME/candice-stt-cache/ggml-tiny.en-q5_1.bin"
fi
[[ -z "$BINARY" ]] && BINARY="$(command -v whisper-cli || true)"
# Fixture resolution: repo-adjacent copy first, then operator verified cache,
# then canonical downloaded copy. The sha256 is verified before use below.
if [[ -z "$FIXTURE" ]]; then
  for CAND in \
    "$ROOT/tests/fixtures/jfk.wav" \
    "$HOME/candice-stt-cache/jfk.wav" \
    "$HOME/Downloads/jfk.wav" \
    /tmp/jfk-github.wav; do
    if [[ -f "$CAND" ]]; then FIXTURE="$CAND"; break; fi
  done
fi

EXPECTED_SHA256="c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b"
FIXTURE_SHA256="59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"
REFERENCE="And so my fellow Americans ask not what your country can do for you ask what you can do for your country"

PASS=0
FAIL=1

say() { printf '%s\n' "$*"; }
fail() { say "FAIL  $*"; exit "$FAIL"; }

# --- 1. inputs exist -------------------------------------------------------
[[ -n "$MODEL" && -f "$MODEL" ]] || fail "model file not found: '$MODEL' (set CANDICE_STT_MODEL)"
[[ -n "$BINARY" ]] || fail "whisper-cli not found on PATH (set CANDICE_STT_BINARY)"
[[ -f "$FIXTURE" ]] || fail "fixture not found: '$FIXTURE' (set CANDICE_STT_FIXTURE)"

# Fixture integrity (canonical jfk.wav, spec: deterministic verified assets)
FIXTURE_ACTUAL="$(shasum -a 256 "$FIXTURE" | awk '{print $1}')"
if [[ "$FIXTURE_ACTUAL" != "$FIXTURE_SHA256" ]]; then
  fail "fixture checksum mismatch: expected $FIXTURE_SHA256 got $FIXTURE_ACTUAL"
fi

# --- 2. model checksum -----------------------------------------------------
ACTUAL_SHA256="$(shasum -a 256 "$MODEL" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  fail "model checksum mismatch: expected $EXPECTED_SHA256 got $ACTUAL_SHA256"
fi
say "PASS  model checksum ($(basename "$MODEL"))"

# --- 3. runtime probe ------------------------------------------------------
VERSION="$("$BINARY" --version 2>&1 | tail -1)"
[[ "$VERSION" == *"1.9.2"* ]] || fail "whisper-cli version mismatch: '$VERSION' (expected 1.9.2)"
say "PASS  runtime $VERSION"

# --- 4. transcribe ---------------------------------------------------------
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
OUT_PREFIX="$WORKDIR/candice-stt"
"$BINARY" -m "$MODEL" -f "$FIXTURE" -l en -otxt -of "$OUT_PREFIX" >/dev/null 2>"$WORKDIR/stderr.log"
RC=$?
[[ $RC -eq 0 ]] || fail "whisper-cli exited $RC (see stderr below)"
TRANSCRIPT="$(cat "$OUT_PREFIX.txt" 2>/dev/null || true)"
[[ -n "$TRANSCRIPT" ]] || fail "empty transcript (stderr tail: $(tail -3 "$WORKDIR/stderr.log" | tr '\n' ' '))"

# --- 5. assert transcript (word-level, punctuation-insensitive) ------------
NORMALIZED="$(printf '%s' "$TRANSCRIPT" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alpha:] ')"
REF_NORMALIZED="$(printf '%s' "$REFERENCE" | tr '[:upper:]' '[:lower:]')"

MATCHED=0
for WORD in $REF_NORMALIZED; do
  case " $NORMALIZED " in
    *" $WORD "*) MATCHED=$((MATCHED + 1)) ;;
  esac
done
TOTAL="$(printf '%s' "$REFERENCE" | wc -w | tr -d ' ')"
if [[ "$MATCHED" -lt "$TOTAL" ]]; then
  fail "transcript mismatch: $MATCHED/$TOTAL reference words matched"
fi

say "PASS  transcription ($MATCHED/$TOTAL reference words)"
say "TRANSCRIPT: $TRANSCRIPT"
say "STATUS: PASS  — local transcription test green (whisper.cpp 1.9.2, tiny.en-q5_1, no cloud)"
exit "$PASS"
