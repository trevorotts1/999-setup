#!/bin/bash
# Install Candice Companion with no Gatekeeper warning, no Apple Developer ID.
#
# WHY THIS WORKS
#
# The "Apple could not verify this app" wall is NOT triggered by an app being
# unsigned. It is triggered by the com.apple.quarantine extended attribute,
# and that attribute is written by whatever DOWNLOADS the file -- Safari,
# Chrome, Mail, Messages, AirDrop. It is not part of the app.
#
# Transports that do NOT set it: curl, scp/rsync, cp, and a USB drive. So an
# app delivered by any of those launches normally even when it is ad-hoc
# signed. Measured on the operator box: the running install carries zero
# extended attributes and has never shown a Gatekeeper prompt.
#
# This script therefore does two things: it moves the app with cp (no
# quarantine written), and it strips quarantine defensively in case the
# source itself arrived through a browser. Either alone is usually enough;
# both together mean the client never sees a warning regardless of how the
# bundle reached their machine.
#
# It does NOT disable Gatekeeper, and it must never be changed to. `spctl
# --master-disable` turns the protection off for every app on the machine,
# forever. Removing one attribute from one app the operator chose to install
# is a different act entirely, and is what the right-click-Open flow did for
# years before macOS 15 removed it.
#
# Usage:
#   ./install-candice-macos.sh                      # installs ./Candice Companion.app
#   ./install-candice-macos.sh /path/to/Candice\ Companion.app
#   ./install-candice-macos.sh https://host/candice.zip
#
set -uo pipefail

APP_NAME="Candice Companion.app"
# Overridable so the install can be exercised without touching /Applications.
DEST_DIR="${CANDICE_DEST_DIR:-/Applications}"
SOURCE="${1:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'install-candice: %s\n' "$*" >&2; exit 1; }

# ---- locate or fetch the bundle -----------------------------------------
WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

if [ -z "$SOURCE" ]; then
  if [ -d "./$APP_NAME" ]; then
    SOURCE="./$APP_NAME"
  else
    die "no app found here. Pass the path to $APP_NAME, or a download URL."
  fi
fi

case "$SOURCE" in
  http://*|https://*)
    command -v curl >/dev/null 2>&1 || die "curl is required to fetch $SOURCE"
    WORK="$(mktemp -d)"
    say "Downloading..."
    # curl does not write com.apple.quarantine. That is the point.
    curl -fsSL "$SOURCE" -o "$WORK/candice.zip" || die "download failed: $SOURCE"
    ditto -x -k "$WORK/candice.zip" "$WORK/extracted" || die "could not unpack the download"
    FOUND="$(find "$WORK/extracted" -maxdepth 3 -name "$APP_NAME" -type d | head -1)"
    [ -n "$FOUND" ] || die "no $APP_NAME inside the download"
    SOURCE="$FOUND"
    ;;
esac

[ -d "$SOURCE" ] || die "not an app bundle: $SOURCE"
[ -x "$SOURCE/Contents/MacOS/candice-companion" ] || die "incomplete bundle (no executable): $SOURCE"

# ---- install -------------------------------------------------------------
[ -w "$DEST_DIR" ] || die "cannot write to $DEST_DIR. Ask an admin user to run this."

TARGET="$DEST_DIR/$APP_NAME"
if [ -e "$TARGET" ]; then
  BACKUP="$DEST_DIR/$APP_NAME.previous-$(date +%Y%m%d-%H%M%S)"
  say "Keeping your previous version at: $(basename "$BACKUP")"
  mv "$TARGET" "$BACKUP" || die "could not move the existing app aside"
fi

say "Installing to $DEST_DIR..."
cp -R "$SOURCE" "$TARGET" || die "copy failed"

# ---- remove quarantine, if the source carried it -------------------------
# Recursive: the flag can sit on nested files, not just the bundle root.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null

REMAINING="$(xattr -r "$TARGET" 2>/dev/null | grep -c 'com.apple.quarantine' || true)"
if [ "${REMAINING:-0}" -ne 0 ]; then
  die "quarantine could not be removed ($REMAINING items). Do not launch; report this."
fi

# ---- verify the app is intact -------------------------------------------
# Stripping quarantine must not be confused with skipping verification. The
# signature still has to be valid: that is what proves the bundle was not
# altered in transit.
if ! codesign --verify --deep --strict "$TARGET" 2>/dev/null; then
  say ""
  say "WARNING: this copy of Candice failed its own signature check."
  say "It may have been damaged in transit. Do not use it; ask for a fresh copy."
  exit 1
fi

say ""
say "Done. Candice is in your Applications folder."
say "Open her the normal way -- you should not see any security warning."
say ""
say "If you ever want to remove her, drag her to the Trash."
