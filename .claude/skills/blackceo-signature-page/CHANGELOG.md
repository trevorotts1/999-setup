# CHANGELOG

## 1.0.2 - 2026-10-01

Compatibility, safety and documentation fixes found by the Opus review of the landing-page
skill window plus the full page test. No methodology, writing, visual, QC, threshold or
production-order change.

1. `SKILL.md` intake: paid providers (Kie, Agnes, GHL, Vercel) use ONLY the client's own keys from that client's own `secrets.env` — never an operator's or another client's key; if a key is absent, the stage is marked BLOCKED. The same intake list now asks for a per-job image cap (count) — a cap, never an approval gate.
2. Large references note in `SKILL.md`: the style libraries are large — run the copy and image stages in separate sessions or subagents, and grep a style library by Style-ID (`VDL-nnn` photographic, `CIS-nn` cinematic, `ART-nn` visual artist) instead of reading it whole.
3. Adapter READMEs (`adapters/claude-code/README.md`, `adapters/claude-nine/README.md`, `adapters/codex/README.md`): Windows command line using `py scripts/...`, and the Pillow prerequisite noted where the PDF review test is documented.
4. `references/`: five dead links to the removed "Image Prompt Creation Guide v1" (`SOP-v1.md` x3, `Standard-v6.md`, `Long-Form-v6.md`) re-pointed to the v5 image guide; the image guide now states that when the onboarding repository is absent, the rules in that guide apply and nothing is fetched; `SOP-v1.md` GHL test-form step now requires a named test contact the owner approved for testing and never fires a live client automation.
5. Script fixes: `scripts/install_local.py` continues past a Codex-root conflict and creates absent roots instead of returning early on the first one; `scripts/validate_state.py` no longer crashes on a non-object stage; `scripts/validate_image_manifest.py` no longer crashes on an unhashable id and no longer false-fails authoring dialects against map-dialect schema; `scripts/validate_prompt.py` no longer false-fails on the ordinary English word "placeholder" (the bracketed marker and the bare `PLACEHOLDER` token still fail).
6. 999-setup installers: `setup-macos.sh` and `setup-windows.ps1` install Pillow the safe way (`python3 -m pip install --user Pillow` on macOS CLT python, `py -m pip install Pillow` on Windows) and link the bundled skills into `~/.codex/skills` and `~/.agents/skills` when `~/.codex` exists. `--break-system-packages` is never used.

The page-test artifact also carries the wireframe Section 3 overlap fix (the image frame no longer covers the text and CTA in `desktop-part-B.png`).

## 1.0.1 - 2026-10-01

Two compatibility fixes. No methodology, writing, visual, QC, threshold or production-order change.

1. `python` -> `python3` in `adapters/claude-code/README.md`, `adapters/claude-nine/README.md`, `adapters/codex/README.md`, and `references/runtime-adapters.md`. On macOS only `python3` exists; the documented `python` commands fail with exit 127.
2. `scripts/install_local.py` now knows both Codex skills roots. `DEFAULT_ROOTS["codex"]` was `~/.agents/skills` only; it is now `~/.agents/skills` and `~/.codex/skills`, and the installer links into every root listed.

## 1.0.0 - initial

First packaged release of the BlackCEO Signature Page skill.
