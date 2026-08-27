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
#   mode=adhoc    RELEASE posture (QFIX-adhoc 2026-08-23, operator decision):
#                 codesign --force --options runtime --entitlements <plist>
#                 -s - (ad-hoc identity). Hardened runtime + entitlement
#                 baseline applied. Gatekeeper cannot accept an ad-hoc
#                 signature so spctl is NOT a gate; clients bypass it once at
#                 first launch. codesign --verify is the fail-closed gate.
#   mode=unsigned no signing pass at all (local test artifact only).
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

# Ad-hoc/unsigned modes are local smoke only: they must never reach a
# distribution path (QC-FIX WS-23 2026-08-21 -- an ad-hoc/unsigned dmg would
# look like a release).
#
# This check used to live further down, AFTER `rm -rf "$APP"` and after the
# tree had been copied into dist/. It reads nothing but $1 and $2, so running
# it late bought nothing and cost this: an invocation rejected for its
# arguments still destroyed and half-rebuilt dist/ on its way out, leaving
# files stamped newer than the built binary. The stale-tree guard below then
# refused the NEXT, correct invocation -- blaming the source tree for
# wreckage this script had just made. Argument validation belongs before any
# filesystem work.
if [[ "$MODE" != "prod" && "$WANT_DMG" == "dmg" ]]; then
  echo "build-macos-bundle: dmg requires mode=prod (adhoc/unsigned are local smoke only, never distribution artifacts)" >&2
  exit 1
fi

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

# --- refuse to package an app that cannot HEAR ---------------------------
# Voice input on macOS is not downloaded by the installer the way it is on
# Windows: the engine ships inside the .app. Those bytes are gitignored and
# staged by scripts/relocate-whisper-macos.mjs, so on any machine where that
# has not run the tree simply has no engine -- and nothing noticed. The
# inventory generator records "absent" and exits 0, this script had no speech
# check at all, and the DMG built, signed, notarized and installed perfectly.
# The first symptom was a user pressing HOLD TO TALK.
#
# Same lesson as the stale-tree guard below: a build that ships something
# broken must fail at the build, not at the user.
if ! node "scripts/assert-speech-engine-macos.mjs" \
     --bundle "$BUNDLE_ROOT/$APP_NAME.app"; then
  echo "build-macos-bundle: refusing to package — macOS voice input would ship broken" >&2
  exit 1
fi

# --- refuse to package a STALE tree --------------------------------------
# This script does not build. It packages and signs whatever is already on
# disk, and it exited 0 when that tree was older than the source -- so a
# "fix" was once packaged, signed, installed and reported as shipped while
# containing none of the fixes. It was caught only because the resulting
# SHA was byte-identical to the build it was supposed to replace. Nothing
# in the script noticed, because from its point of view everything worked.
#
# The guard is a timestamp comparison, not a hash: the question is not
# "does the bundle differ" but "was it built AFTER the sources it claims to
# contain". Set CANDICE_ALLOW_STALE_BUNDLE=1 to package deliberately (a
# re-sign of an unchanged tree is a legitimate thing to want); it prints
# what it is overriding, so the choice cannot be silent.
BUILT_APP="$BUNDLE_ROOT/$APP_NAME.app"
BUILT_BINARY="$BUILT_APP/Contents/MacOS/candice-companion"
NEWER_SOURCE=""
while IFS= read -r candidate; do
  if [[ -n "$candidate" && "$candidate" -nt "$BUILT_BINARY" ]]; then
    NEWER_SOURCE="$candidate"
    break
  fi
# dist/ is NOT in this list. It is this script's own output -- the question
# the guard asks is "was the bundle built after the SOURCES it claims to
# contain", and a file this script itself copied into dist/ is not a source.
# Including it meant every packaging run seeded the next one's tripwire, and
# a run that died partway through left dist/ newer than the binary with
# nothing to rebuild that would clear it.
done < <(find src src-tauri/src src-tauri/speech \
  -type f \( -name '*.ts' -o -name '*.rs' -o -name '*.js' -o -name '*.css' -o -name '*.html' \) \
  -newer "$BUILT_BINARY" 2>/dev/null)

if [[ -n "$NEWER_SOURCE" ]]; then
  if [[ "${CANDICE_ALLOW_STALE_BUNDLE:-0}" == "1" ]]; then
    echo "build-macos-bundle: WARNING - packaging a stale bundle on purpose" >&2
    echo "  newer than the built binary: $NEWER_SOURCE" >&2
  else
    echo "build-macos-bundle: REFUSING to package a stale bundle." >&2
    echo "  newer than the built binary: $NEWER_SOURCE" >&2
    echo "  built binary: $BUILT_BINARY" >&2
    echo "" >&2
    echo "  This script packages and signs; it does not build. Packaging now" >&2
    echo "  would ship an app that does not contain the change you just made." >&2
    echo "  run first: npm run tauri:build" >&2
    echo "  (or set CANDICE_ALLOW_STALE_BUNDLE=1 to re-sign the existing tree)" >&2
    exit 1
  fi
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

# (The dmg/mode compatibility check that used to sit here now runs with the
# other argument validation, before any filesystem work. See the top of the
# script -- the WS-23 rule it enforces is unchanged, only its position.)

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

    # codesign rewrote every Mach-O it just touched, so the speech manifest's
    # own-tree measurements now describe bytes that no longer exist. Correct
    # them BEFORE the outer bundle is signed, so the app signature covers the
    # corrected manifest. Pinned upstream hashes are never rewritten -- the
    # script fails instead. See scripts/restamp-speech-inventory.mjs.
    node "scripts/restamp-speech-inventory.mjs" --bundle "$APP" || {
      echo "build-macos-bundle: speech inventory restamp failed" >&2
      exit 1
    }
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
    # QFIX-adhoc 2026-08-23: ad-hoc is now the RELEASE posture (operator
    # decision — no Developer ID cert, no notarization; clients bypass
    # Gatekeeper once at first launch). Signed with hardened runtime and the
    # entitlement baseline so the artifact keeps the same runtime posture a
    # Developer ID build would have. spctl is deliberately NOT required here:
    # Gatekeeper can never accept an ad-hoc signature. The gate that remains
    # fail-closed is codesign --verify.
    ADHOC_ARGS=(--force --options runtime)
    [[ -f "$ENTITLEMENTS" ]] && ADHOC_ARGS+=(--entitlements "$ENTITLEMENTS")

    # Binary first, nested helpers (deepest-first safety net), then the outer
    # bundle — mirrors the prod pass so the layout stays identical.
    codesign "${ADHOC_ARGS[@]}" -s - "$BIN" || {
      echo "build-macos-bundle: ad-hoc codesign failed on $BIN" >&2
      exit 1
    }
    find "$APP/Contents" -type f -perm -111 -not -path "*/MacOS/*" -print0 \
      | while IFS= read -r -d '' f; do
          codesign "${ADHOC_ARGS[@]}" -s - "$f" || {
            echo "build-macos-bundle: ad-hoc codesign failed on nested executable $f" >&2
            exit 1
          }
        done

    # codesign rewrote every Mach-O it just touched, so the speech manifest's
    # own-tree measurements now describe bytes that no longer exist. Correct
    # them BEFORE the outer bundle is signed, so the app signature covers the
    # corrected manifest. Pinned upstream hashes are never rewritten -- the
    # script fails instead. See scripts/restamp-speech-inventory.mjs.
    node "scripts/restamp-speech-inventory.mjs" --bundle "$APP" || {
      echo "build-macos-bundle: speech inventory restamp failed" >&2
      exit 1
    }
    codesign "${ADHOC_ARGS[@]}" -s - "$APP" || {
      echo "build-macos-bundle: ad-hoc codesign failed on $APP" >&2
      exit 1
    }

    # THE gate under adhoc posture: signature must verify. Tampered or broken
    # artifacts still exit nonzero here.
    codesign --verify --deep --strict --verbose=2 "$APP" || {
      echo "build-macos-bundle: ad-hoc verify failed on $APP (tampered or broken signature)" >&2
      exit 1
    }
    echo "ADHOC-SIGNED $APP (release posture: ad-hoc per operator decision 2026-08-23 — valid ad-hoc signature required, Gatekeeper bypassed once by clients at first launch)"
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
