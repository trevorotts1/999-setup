# Operator Amendment — Candice Welcome at Skill Start

**Date:** 2026-08-25  
**Authority:** operator direction in the Candice Companion work session  
**Applies to:** the user-facing setup-check surface in Master Spec section 3 and
the first-run sequence in section 4.  
**Does not replace:** the historical, verbatim `MASTER-SPEC-2026-08-21.md`.

## Decision

When a supported slash command starts, Candice must appear immediately (before
the complete Spec Protocol preflight) and present this welcome as a caption:

> Hi, I'm Candice. I'm here to help you build the app, the software, or the
> thing you've always dreamed about. Think of me as your fairy godmother: you
> make a wish, and I help make it real. I'm getting everything ready for us
> now.

Voice may render the same welcome when voice output is enabled.  The caption is
required even when voice is disabled.

## Interpretation and boundaries

- This replaces only the older *user-facing setup-check wording* in Master Spec
  section 3.  It does **not** defer appearance until preflight is complete.
- The welcome is presentation only.  It is not a governed question, does not
  collect an answer, and does not change Spec Protocol question order, question
  count, session state, privacy rules, or completion criteria.
- Preflight remains authoritative for setup health.  Candice may say she is
  getting ready, but she does not decide whether setup passes.
- After preflight, the normal first-run name question and all existing protocol
  behavior continue unchanged.
- If Candice cannot launch, the terminal skill must continue with its existing
  text fallback; this amendment does not weaken that degradation rule.

## Implementation record

- `68a14be` — cold launch is self-contained and makes the native window visible
  for wake/bridge startup.
- `6d2cb72` — installs the welcome copy and documents its presentation-only
  status in the Spec Protocol skill/reference and acceptance fixtures.
- The installed macOS app was rebuilt and ad-hoc signed after `6d2cb72`.

This is an approved product-behavior change, not an independent QC PASS.  The
remaining FIX-019 packaged terminal-to-Candice-to-answer acceptance matrix and
all other open control-pack gates remain required.
