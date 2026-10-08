#!/usr/bin/env bash
# qc-no-local-asr.sh -- F17 scan rule. Exit 2 if any file imports a local ASR stack
# it must not. Banned everywhere: the OpenAI whisper stack (import whisper / openai_whisper).
# faster_whisper is permitted ONLY in core/audio_c3/lyric_timing.py (the one transcription
# module); any other importer, and any importer in a run folder, fails.
#   DRAMA75_CORE      core dir to scan (default: <this dir>/core)
#   DRAMA75_RUN_DIRS  colon-separated run folders to scan (default: none)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="${DRAMA75_CORE:-$HERE/core}"
RUNS="${DRAMA75_RUN_DIRS:-}"
BAN='^[[:space:]]*(import|from)[[:space:]]+(whisper|openai_whisper|faster_whisper)([[:space:].]|$)'
bad=0
scan() {  # scan <dir> <allowed-relative-path-or-empty>
  [ -d "$1" ] || return 0
  while IFS= read -r f; do
    rel="${f#"$1"/}"
    [ -n "$2" ] && [ "$rel" = "$2" ] && continue
    echo "NO-LOCAL-ASR: banned whisper import in $f" >&2
    bad=1
  done < <(grep -rlE --include='*.py' "$BAN" "$1" 2>/dev/null)
}
scan "$CORE" "audio_c3/lyric_timing.py"
IFS=: read -r -a dirs <<< "$RUNS"
for d in ${dirs[@]+"${dirs[@]}"}; do scan "$d" ""; done
[ "$bad" -eq 0 ] || exit 2
echo "qc-no-local-asr: clean"
