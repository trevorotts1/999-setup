#!/usr/bin/env bash
# 07-stripe-setup-wizard.sh — Skill 38 / Step 9.27 (Stripe Integration, v5.10)
# OPERATOR OPT-IN. Wires Stripe API keys + webhooks. Idempotent.

set -euo pipefail
# Secrets binding (999 harness): the wizard writes into the install secrets
# env file, designated by $SECRETS_ENV (no OpenClaw default path exists here).
SECRETS_ENV="${SECRETS_ENV:-}"
: "${SECRETS_ENV:?SECRETS_ENV must name the install secrets env file to write into}"

echo "[skill 38] Stripe Integration setup wizard (Step 9.27)"
echo "  This is OPERATOR OPT-IN per v5.14. Skip if you do not use Stripe."

if grep -qE "^STRIPE_API_KEY=" "$SECRETS_ENV" 2>/dev/null; then
  echo "[skill 38] STRIPE_API_KEY already set in $SECRETS_ENV — preserving."
else
  read -r -p "Enter Stripe Secret Key (sk_live_... or sk_test_...) [skip]: " key
  if [ -n "${key:-}" ]; then
    mkdir -p "$(dirname "$SECRETS_ENV")"
    echo "STRIPE_API_KEY=$key" >> "$SECRETS_ENV"
    chmod 600 "$SECRETS_ENV"
    echo "[skill 38] Stripe key saved (mode 600)."
  else
    echo "[skill 38] Stripe setup skipped (no key entered)."
  fi
fi
echo "[skill 38] See protocols/stripe-integration-protocol.md for full v5.14 wiring."
