#!/usr/bin/env bash
# 02-create-knowledgebases.sh — Skill 38 / Step 9.22 (Typed Knowledge Bases, v5.6)
# Creates the four typed knowledge bases under <MASTER_FILES_DIR>/KnowledgeBases/.
# Bases: business, products, sales, conversations. Idempotent (does NOT overwrite existing).

set -euo pipefail
# The pointer file written by 01-locate-master-files-folder.sh contains a BARE PATH
# (one line: the master-files directory), NOT shell `KEY=value` assignments. It must be
# READ, never `source`d — `. <file>` tries to EXECUTE its contents, and when the path is
# a directory bash errors "Is a directory" (or runs the path as a command). Read it into
# MASTER_FILES_DIR with cat instead.
# Pointer binding (999 harness): SKILL38_MASTER_FILES_POINTER wins; the default
# pointer is the master-files-dir file inside this skill directory (the
# OpenClaw side kept it under ~/.openclaw, maintained by excluded host step 01).
MASTER_FILES_POINTER="${SKILL38_MASTER_FILES_POINTER:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/master-files-dir}"
if [ -z "${MASTER_FILES_DIR:-}" ] && [ -f "$MASTER_FILES_POINTER" ]; then
  MASTER_FILES_DIR="$(head -n1 "$MASTER_FILES_POINTER" | tr -d '\r')"
fi
: "${MASTER_FILES_DIR:?MASTER_FILES_DIR not set — set MASTER_FILES_DIR or write the pointer file (master-files-dir in this skill directory)}"

KB_ROOT="$MASTER_FILES_DIR/KnowledgeBases"
mkdir -p "$KB_ROOT"

for kb in business products sales conversations; do
  KB_DIR="$KB_ROOT/$kb"
  mkdir -p "$KB_DIR"
  if [ ! -f "$KB_DIR/registry.md" ]; then
    cat > "$KB_DIR/registry.md" <<MD
# $kb Knowledge Base — Registry

Per v5.14 playbook Step 9.22 (Typed Knowledge Bases, v5.6). This base
holds $kb-typed documents the agent retrieves from when answering. See
\`protocols/typed-knowledge-bases-protocol.md\` for the typing rules.

## Documents in this base

(none yet — populated by the operator or by skill 38 web-scraper)
MD
    echo "[skill 38] created $KB_DIR/registry.md"
  else
    echo "[skill 38] $kb registry already exists — preserved"
  fi
done

echo "[skill 38] 4 typed knowledge bases ready at $KB_ROOT"
