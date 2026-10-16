#!/usr/bin/env bash
# 10-generate-capabilities-playbook.sh
#
# Reads the skill's templates/agent-capabilities-playbook-template.md,
# substitutes placeholders with values pulled from company-config.json and
# the harness bindings below, and writes the result to
# $MASTER_FILES_DIR/agent-capabilities-playbook.md.
#
# Substitution map (extend as needed):
#   <CLIENT_NAME>           ← $MASTER_FILES_DIR/company-config.json .name (else "this client")
#   <MODEL_TIER_REAL_TIME>  ← env SKILL38_MODEL_TIER_REAL_TIME (else the client-configured model)
#   <MODEL_TIER_ASYNC>      ← env SKILL38_MODEL_TIER_ASYNC (else "(same as real-time)")
#   <MODEL_TIER_BATCH>      ← env SKILL38_MODEL_TIER_BATCH (else "(same as real-time)")
#   <CHANNELS_ENABLED>      ← company-config.json .channels (comma-separated)
#   <INSTALL_TIMESTAMP>     ← date -u +%Y-%m-%dT%H:%M:%SZ
#
# Idempotent: if the output file already exists, it is backed up to
# <output>.bak.<ts> before being overwritten.

set -euo pipefail

# -----------------------------------------------------------------------------
# Locate skill folder (this script lives at <skill>/scripts/, template at <skill>/templates/)
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SKILL_DIR/templates/agent-capabilities-playbook-template.md"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "[10-generate-capabilities-playbook] template missing: $TEMPLATE" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Resolve MASTER_FILES_DIR
# -----------------------------------------------------------------------------
# Pointer binding (999 harness): SKILL38_MASTER_FILES_POINTER wins; the default
# pointer is the master-files-dir file inside this skill directory (the
# OpenClaw side kept it under ~/.openclaw, maintained by excluded host step 01).
POINTER_FILE="${SKILL38_MASTER_FILES_POINTER:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/master-files-dir}"
if [[ ! -f "$POINTER_FILE" ]]; then
  echo "[10-generate-capabilities-playbook] pointer file missing: $POINTER_FILE" >&2
  echo "[10-generate-capabilities-playbook] set MASTER_FILES_DIR or write the pointer file (master-files-dir in this skill directory)." >&2
  exit 1
fi
MASTER_FILES_DIR="$(cat "$POINTER_FILE")"
MASTER_FILES_DIR="${MASTER_FILES_DIR%$'\n'}"

OUTPUT="$MASTER_FILES_DIR/agent-capabilities-playbook.md"

# -----------------------------------------------------------------------------
# Resolve the harness configuration values
# -----------------------------------------------------------------------------
# 999 harness binding: there is no openclaw.json here. Model tiers are the
# client's configured models (model-selection doctrine: the client selects
# their model or their configured default applies); declare them via env
# SKILL38_MODEL_TIER_REAL_TIME / _ASYNC / _BATCH when the playbook needs the
# concrete values. Channels come from the client's own company-config.json.
COMPANY_CONFIG="$MASTER_FILES_DIR/company-config.json"

# -----------------------------------------------------------------------------
# Pull substitution values
# -----------------------------------------------------------------------------
get_json() {
  # $1 = file, $2 = jq filter, $3 = fallback
  local file="$1" filter="$2" fallback="${3:-}"
  if [[ -f "$file" ]] && command -v jq >/dev/null 2>&1; then
    local val
    val="$(jq -r "$filter // empty" "$file" 2>/dev/null || true)"
    if [[ -n "$val" && "$val" != "null" ]]; then
      printf '%s' "$val"
      return
    fi
  fi
  printf '%s' "$fallback"
}

CLIENT_NAME="$(get_json "$COMPANY_CONFIG" '.name' 'this client')"
MODEL_TIER_REAL_TIME="${SKILL38_MODEL_TIER_REAL_TIME:-the client-configured model}"
MODEL_TIER_ASYNC="${SKILL38_MODEL_TIER_ASYNC:-(same as real-time)}"
MODEL_TIER_BATCH="${SKILL38_MODEL_TIER_BATCH:-(same as real-time)}"

CHANNELS_ENABLED="$(get_json "$COMPANY_CONFIG" '(.channels // []) | if type=="array" then join(", ") else . end' 'unknown')"

INSTALL_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# -----------------------------------------------------------------------------
# Backup existing output if present
# -----------------------------------------------------------------------------
if [[ -f "$OUTPUT" ]]; then
  BAK="${OUTPUT}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$OUTPUT" "$BAK"
  echo "[10-generate-capabilities-playbook] existing file backed up → $BAK"
fi

# -----------------------------------------------------------------------------
# Render template (strip operator-header HTML comments, then substitute)
# -----------------------------------------------------------------------------
# Use awk to drop the leading 5-line operator header (lines starting with '<!--')
# plus the blank line that follows, then sed to substitute placeholders.
awk 'BEGIN{skipped=0} /^<!--/ && skipped<6 {skipped++; next} /^$/ && skipped>=1 && skipped<7 {skipped++; next} {print}' "$TEMPLATE" \
  | sed \
      -e "s|<CLIENT_NAME>|${CLIENT_NAME}|g" \
      -e "s|<MODEL_TIER_REAL_TIME>|${MODEL_TIER_REAL_TIME}|g" \
      -e "s|<MODEL_TIER_ASYNC>|${MODEL_TIER_ASYNC}|g" \
      -e "s|<MODEL_TIER_BATCH>|${MODEL_TIER_BATCH}|g" \
      -e "s|<CHANNELS_ENABLED>|${CHANNELS_ENABLED}|g" \
      -e "s|<INSTALL_TIMESTAMP>|${INSTALL_TIMESTAMP}|g" \
  > "$OUTPUT"

echo "[10-generate-capabilities-playbook] wrote → $OUTPUT"
echo "[10-generate-capabilities-playbook] substituted: CLIENT_NAME='$CLIENT_NAME' REAL_TIME='$MODEL_TIER_REAL_TIME' ASYNC='$MODEL_TIER_ASYNC' BATCH='$MODEL_TIER_BATCH' CHANNELS='$CHANNELS_ENABLED'"
