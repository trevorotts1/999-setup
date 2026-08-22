#!/usr/bin/env bash
# WS-23 — macOS release-bundle builder (unsigned, ad-hoc, or Developer ID).
#
# Owned lane: apps/candice-companion/scripts/package-macos/** (PROJECT-MANIFEST 9.2,
# WR-015 row, WS-23 glob).
#
# Produces a release .app (and optional .dmg) from a full `npm run tauri
# build` output, in one of three signing modes:
#
#   mode=prod     Developer ID Application identity from the login keychain
#                 (or APPLE_DEVELOPER_IDENTITY), hardened runtime on,
#                 entitlements applied. For notarization run
#                 scripts/package-macos/notarize.sh afterwards.
#   mode=adhoc    codesign --force --deep -s - (local smoke only; NOT a
#                 distribution artifact — Gatekeeper will reject it).
#   mode=unsigned no signing pass at all.
#
# Exit codes:
#   0  bundle built (+ signed when a mode was applied) and spctl --assess
#      --type execute passed, or the mode is unsigned/adhoc (assessment
#      deliberately not required; see below).
#   1  expected failure (missing app, signing failed, assessment failed
#      where required).
#   2  tooling error (missing tool, wrong OS, bad invocation).
#
# Gatekeeper doctrine (Master Spec 23): never disable Gatekeeper, never
# instruct weakening security. The .app is NEVER released unsigned — an
# unsigned or ad-hoc bundle is a local test artifact only, and this script
# refuses to copy it anywhere outside the build directory.

set -uo pipefail

# --- contract -----------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <mode: prod|adhoc|unsigned> [dmg]" >&2
  echo "  dmg        also build the .dmg (requires hdiutil)" >&2
  exit 2
fi

MODE="$1"
WANT_DMG="${2:-}"
APP_NAME="Candice Companion"
APP="dist/$APP_NAME.app"

case "$MODE" in
  prod|adhoc|unsigned) ;;
  *)
    echo "build-macos-bundle: unknown mode '$MODE' (prod|adhoc|unsigned)" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos-bundle: not a macOS host ($(uname -s)) — macOS bundling is not applicable here" >&2
  exit 2
fi
for tool in codesign spctl plutil; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "build-macos-bundle: required tool missing: $tool" >&2
    exit 2
  fi
done

# --- locate the Tauri bundle --------------------------------------------
# `npm run tauri build` emits `src-tauri/target/release/bundle/macos/<App>.app`.
# QC-FIX WS-23 2026-08-21: the app must exist AND contain the real Mach-O
# binary before any mode proceeds — the dir alone (or a partial bundle) is a
# legitimate failure surface (self-test test 4), never a silent "DONE".
BUNDLE_ROOT="src-tauri/target/release/bundle/macos"
if [[ ! -d "$BUNDLE_ROOT" ]]; then
  echo "build-macos-bundle: no Tauri bundle at $BUNDLE_ROOT" >&2
  echo "  run first: npm run tauri build" >&2
  exit 1
fi
if [[ ! -x "$BUNDLE_ROOT/$APP_NAME.app/Contents/MacOS/candice-companion" ]]; then
  echo "build-macos-bundle: Tauri bundle incomplete at $BUNDLE_ROOT/$APP_NAME.app (binary missing/not executable)" >&2
  echo "  run first: npm run tauri build" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p dist
cp -R "$BUNDLE_ROOT/$APP_NAME.app" "$APP"

# --- harden the app bundle (works for every mode) ------------------------
# Application is agent (A) by default; the JIT/HV deny rules are the standard
# hardened-runtime baseline and match the shell's no-embedded-JIT design.
ENTITLEMENTS="scripts/package-macos/entitlements.plist"
if [[ -f "$ENTITLEMENTS" ]]; then
  plutil -lint "$ENTITLEMENTS" >/dev/null 2>&1 || {
    echo "build-macos-bundle: entitlements file is not valid plist: $ENTITLEMENTS" >&2
    exit 2
  }
fi

BIN="$APP/Contents/MacOS/candice-companion"
if [[ ! -x "$BIN" ]]; then
  echo "build-macos-bundle: bundle binary missing/not executable: $BIN" >&2
  exit 1
fi

# Ad-hoc/unsigned modes are local smoke only: they must never be allowed to
# reach any distribution path (QC-FIX WS-23 2026-08-21: dmg rejected for
# non-prod modes — an ad-hoc/unsigned dmg would look like a release).
if [[ "$MODE" != "prod" && "$WANT_DMG" == "dmg" ]]; then
  echo "build-macos-bundle: dmg requires mode=prod (adhoc/unsigned are local smoke only, never distribution artifacts)" >&2
  exit 1
fi

case "$MODE" in
  prod)
    IDENTITY="${APPLE_DEVELOPER_IDENTITY:-}"
    if [[ -z "$IDENTITY" ]]; then
      IDENTITY=$(scripts/package-macos/signing-identity.sh 2>/dev/null | awk '{print $2}') || true
    fi
    if [[ -z "$IDENTITY" ]]; then
      echo "build-macos-bundle: prod mode but no Developer ID identity found (keychain empty or APPLE_DEVELOPER_IDENTITY unset)" >&2
      exit 1
    fi

    CODESIGN_ARGS=(--force --timestamp --options runtime)
    [[ -f "$ENTITLEMENTS" ]] && CODESIGN_ARGS+=(--entitlements "$ENTITLEMENTS")

    # Outer bundle, then nested helpers (if any), deepest first. Tauri 2
    # emits a flat .app on Apple Silicon, so the binary pass is the
    # substantive one; nested pass is a safety net for future helpers.
    codesign "${CODESIGN_ARGS[@]}" -s "$IDENTITY" "$BIN" || {
      echo "build-macos-bundle: codesign failed on $BIN" >&2
      exit 1
    }
    find "$APP/Contents" -type f -perm -111 -not -path "*/MacOS/*" -print0 \
      | while IFS= read -r -d '' f; do
          codesign "${CODESIGN_ARGS[@]}" -s "$IDENTITY" "$f" || {
            echo "build-macos-bundle: codesign failed on nested executable $f" >&2
            exit 1
          }
        done
    codesign "${CODESIGN_ARGS[@]}" -s "$IDENTITY" "$APP" || {
      echo "build-macos-bundle: codesign failed on $APP" >&2
      exit 1
    }

    codesign --verify --deep --strict --verbose=2 "$APP" || {
      echo "build-macos-bundle: codesign verify failed on $APP" >&2
      exit 1
    }
    # Gatekeeper acceptance check (spec 23): spctl is the same assessment
    # Gatekeeper performs on launch.
    spctl --assess --type execute --verbose=4 "$APP" || {
      echo "build-macos-bundle: spctl assessment FAILED — artifact is not Gatekeeper-accepted" >&2
      exit 1
    }
    echo "PROD-SIGNED $APP"
    ;;

  adhoc)
    # Local smoke only. Deliberately NOT Gatekeeper-accepted; never ship.
    codesign --force --deep -s - "$APP" || {
      echo "build-macos-bundle: ad-hoc codesign failed on $APP" >&2
      exit 1
    }
    codesign --verify --deep --strict "$APP" || {
      echo "build-macos-bundle: ad-hoc verify failed on $APP" >&2
      exit 1
    }
    echo "ADHOC-SIGNED $APP (local smoke only — NOT Gatekeeper-accepted, NOT a distribution artifact)"
    ;;

  unsigned)
    echo "UNSIGNED $APP (local test artifact only — NOT Gatekeeper-accepted, NOT a distribution artifact)"
    ;;
esac

# --- DMG (optional) -------------------------------------------------------
if [[ "$WANT_DMG" == "dmg" ]]; then
  if ! command -v hdiutil >/dev/null 2>&1; then
    echo "build-macos-bundle: hdiutil not found — dmg requested but unavailable" >&2
    exit 2
  fi
  DMG="dist/Candice-Companion.dmg"
  STAGE="dist/dmg-stage"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$DMG"
  hdiutil create -volname "Candice Companion" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null || {
    echo "build-macos-bundle: hdiutil create failed" >&2
    exit 1
  }
  rm -rf "$STAGE"
  echo "DMG $DMG"
fi

echo "DONE"
exit 0
