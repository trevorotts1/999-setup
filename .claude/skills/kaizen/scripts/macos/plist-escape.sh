#!/bin/bash
# XML-escape helpers for plist values. Sourced, not executed.
# plist_escape escapes & < > " ' into their XML entities.

plist_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

# plist_escape_selftest: prints OK and returns 0 when escaping matches the
# expected entity output; prints FAIL and returns 1 otherwise.
plist_escape_selftest() {
  local input='& < > " '"'"
  local expected='&amp; &lt; &gt; &quot; &apos;'
  local actual
  actual="$(plist_escape "$input")"
  if [ "$actual" = "$expected" ]; then
    printf '%s\n' "OK: $actual"
    return 0
  fi
  printf '%s\n' "FAIL: expected [$expected], got [$actual]"
  return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  plist_escape_selftest
fi
