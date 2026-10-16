# Mac Recipe: Firebase Token Auto-Re-Grab

## When this runs
When `caf doctor` reports the Firebase refresh token is expired or missing AND the operator
has a logged-in Chrome profile on this Mac from a previous onboarding session.

## What it does
Reads `stsTokenManager.refreshToken` from the client's LOCAL logged-in Chrome profile,
exchanges it for a fresh access token, and updates the secrets file. Logs each occurrence
to the owner's configured notification channel (surfaced in the session output). Nothing is silent.

## Steps

```bash
#!/usr/bin/env bash
# Firebase token auto-re-grab recipe (Mac only — Chrome profile on local machine)
set -euo pipefail

SECRETS="${SECRETS_ENV:?SECRETS_ENV must name this install's secrets env file}"

# 1. Locate the GHL Chrome profile (adjust profile name if needed)
GHL_CHROME_PROFILE="$HOME/Library/Application Support/Google/Chrome/Default"
GHL_STORAGE_FILE="$GHL_CHROME_PROFILE/Local Storage/leveldb"

# 2. Extract the refresh token from Chrome's local storage (requires the profile to be unlocked)
#    The token lives under the GHL app origin in Chrome's IndexedDB / LevelDB.
#    Use a Python LevelDB reader or chrome-cookie-import — exact path varies by Chrome version.
#    The token key is: stsTokenManager.refreshToken
REFRESH_TOKEN=$(python3 "$MASTER_FILES_DIR/44-convert-and-flow-operator/tools/engine/helpers/extract_chrome_token.py" \
  --profile "$GHL_CHROME_PROFILE" 2>/dev/null || echo "")

if [ -z "$REFRESH_TOKEN" ]; then
  # Auto-grab failed — fall back to owner nudge
  echo "OWNER NUDGE (deliver through the client's configured channel): Convert and Flow Firebase token needs a manual re-grab." \
    2>/dev/null || true
  exit 1
fi

# 3. Update secrets file
sed -i.bak "s|^GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN=.*|GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN=${REFRESH_TOKEN}|" "$SECRETS" || \
  echo "GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN=${REFRESH_TOKEN}" >> "$SECRETS"

# 4. No separate wiring step in this harness: the secrets env file IS the
#    wiring (the caf wrapper sources $SECRETS_ENV). To also refresh the live
#    session environment, run: bash tools/engine/wire-ghl-env.sh --write
#    (On the OpenClaw side this step wrote openclaw.json env.vars; that
#    config does not exist in this harness.)

# 5. Notify owner (binding transparency requirement)
  echo "OWNER NOTICE (deliver through the client's configured channel): Convert and Flow token refreshed from local Chrome profile; token updated in secrets file. ($(date '+%Y-%m-%d %H:%M %Z'))" \
  2>/dev/null || true

echo "STATUS: Firebase token auto-re-grab complete"
```

## VPS fallback
On a container install, this recipe does NOT run (no Chrome profile in the
container). The agent surfaces a nudge for delivery through the client's
configured channel instead: "I need you to grab the Convert and Flow token to
build workflows directly."
