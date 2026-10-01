# CHANGELOG

## 1.0.1 - 2026-10-01

Two compatibility fixes. No methodology, writing, visual, QC, threshold or production-order change.

1. `python` -> `python3` in `adapters/claude-code/README.md`, `adapters/claude-nine/README.md`, `adapters/codex/README.md`, and `references/runtime-adapters.md`. On macOS only `python3` exists; the documented `python` commands fail with exit 127.
2. `scripts/install_local.py` now knows both Codex skills roots. `DEFAULT_ROOTS["codex"]` was `~/.agents/skills` only; it is now `~/.agents/skills` and `~/.codex/skills`, and the installer links into every root listed.

## 1.0.0 - initial

First packaged release of the BlackCEO Signature Page skill.
