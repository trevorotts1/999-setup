#!/usr/bin/env bash
# WS-23 — macOS notarization + staple (notarytool), credential-gated.
#
# Owned lane: apps/candice-companion/scripts/package-macos/** (PROJECT-MANIFEST 9.2,
# WR-015 row, WS-23 glob).
#
# Preconditions:
#   1. scripts/package-macos/build-macos-bundle.sh prod already produced a
#      Developer ID-signed, hardened-runtime .app at dist/Candice Companion.app
#   2. an Apple Developer notarization credential is available in exactly one
#      of these forms (checked in order, never printed, never echoed):
#        a) keychain profile:  --keychain-profile <name>
#        b) App Store Connect API key files: APPLE_API_KEY (path to .p8) +
#           APPLE_API_ISSUER (issuer id) + APPLE_API_KEY_ID (key id)
#        c) Apple ID: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
#
# Behavior (Master Spec 23: Gatekeeper never disabled):
#   - no credential -> exit 2 with the EXTERNAL-RELEASE-BLOCKER line; the
#     artifact is left as locally-signed and is never misrepresented as
#     notarized (spec 23 Windows clause applied to macOS by symmetry).
#   - credential present -> upload, poll, staple on success; exit 1 on
#     notary rejection with the full log tail.
#   - upload is the .dmg when present (single submission for the shipped
#     artifact), else the .app. The .app is always stapled when the DMG is
#     absent. (The DMG and the embedded .app cannot both be stapled without
#     two submissions; the shipped artifact is the one submitted.)
#
# Exit codes: 0 notarized+stapled, 1 notary rejected the artifact,
#             2 no credential / tooling / host error.

set -uo pipefail

APP="dist/Candice Companion.app"
DMG="dist/Candice-Companion.dmg"
SUBMIT=""
if [[ -f "$DMG" ]]; then
  SUBMIT="$DMG"
else
  SUBMIT="$APP"
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "notarize: not a macOS host ($(uname -s))" >&2
  exit 2
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "notarize: xcrun not found" >&2
  exit 2
fi
if ! xcrun --find notarytool >/dev/null 2>&1; then
  echo "notarize: notarytool not found — Xcode command-line tools too old" >&2
  exit 2
fi

# --- credential resolution -------------------------------------------------
AUTH=()
if [[ -n "${NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  AUTH=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE")
elif [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_ID:-}" ]]; then
  # QC-FIX WS-23 2026-08-21: notarytool's real API-key flags are
  # `--key <p8> --issuer <id> --key-id <id>` (verified via `xcrun notarytool
  # submit --help`). The invented `--apple-api-*` names would fail at submit.
  AUTH=(--key "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --key-id "$APPLE_API_KEY_ID")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "EXTERNAL-RELEASE-BLOCKER: no Apple notarization credential configured" >&2
  echo "  set one of: NOTARY_KEYCHAIN_PROFILE | APPLE_API_KEY+APPLE_API_ISSUER+APPLE_API_KEY_ID | APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD+APPLE_TEAM_ID" >&2
  echo "  release path: sign with Developer ID + notarize + verify Gatekeeper acceptance before distribution (Master Spec 23)." >&2
  echo "  Gatekeeper must never be disabled and customers must never be told to weaken security (Master Spec 23)." >&2
  exit 2
fi

if [[ ! -d "$APP" ]]; then
  echo "notarize: $APP missing — run scripts/package-macos/build-macos-bundle.sh prod first" >&2
  exit 1
fi

# --- submission ------------------------------------------------------------
# Bounded poll pattern (workflows.md §8): one upload, then short foreground
# polls; never a bare long foreground wait.
# QC-FIX WS-23 2026-08-21: notarytool's JSON output goes to stdout; the
# submit always returns 0 when it runs (Accepted/Invalid/Rejected all exit 0).
# Therefore rc alone is not an acceptance signal — the parsed `status` field
# is the authority. Real flag names verified against `notarytool submit --help`.
OUT=$(mktemp)
xcrun notarytool submit "$SUBMIT" "${AUTH[@]}" --wait --timeout 20m \
  --output-format json >"$OUT" 2>&1
RC=$?
if [[ $RC -ne 0 ]]; then
  echo "notarize: notarytool submit failed (rc=$RC):" >&2
  tail -c 2000 "$OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# notarytool always exits 0 after a completed submission attempt — Accepted,
# Invalid, and Rejected all land here with rc=0. The JSON `status` field is
# the only acceptance authority (verified against real notarytool behavior).
STATUS=$(python3 -c "import json,sys; d=json.load(open('$OUT')); print(d.get('status',''))" 2>/dev/null)
if [[ -z "$STATUS" ]]; then
  # Fall back to grepping the raw log if JSON parse failed.
  STATUS=$(grep -o '"status": *"[^"]*"' "$OUT" | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
fi
echo "notarize: submission status = ${STATUS:-unknown}"
if [[ "$STATUS" != "Accepted" ]]; then
  echo "notarize: artifact REJECTED:" >&2
  tail -c 3000 "$OUT" >&2
  rm -f "$OUT"
  exit 1
fi
rm -f "$OUT"

# --- staple ----------------------------------------------------------------
# Staple the .app. If the DMG was the submitted artifact, staple both the
# DMG and the embedded .app (stapling is per-file; notarytool accepts it).
STAPLE_OK=0
for target in "$APP" "$DMG"; do
  [[ -e "$target" ]] || continue
  if xcrun stapler staple "$target" >/dev/null 2>&1; then
    echo "STAPLED $target"
    STAPLE_OK=1
  else
    echo "notarize: stapler warning on $target (not fatal)" >&2
  fi
done
if [[ "$STAPLE_OK" -eq 0 ]]; then
  echo "notarize: no target stapled — ticket exists but not attached" >&2
  exit 1
fi

echo "NOTARIZED $SUBMIT"
exit 0
