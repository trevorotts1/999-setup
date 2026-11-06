# 85 — Android SMS System

Answers myCRMSIM (CRM SIM) support questions from its offline documentation set — Android gateway install, SIM assignment, SMS/WhatsApp/iMessage/RCS, CRM integrations and troubleshooting.

Serves **claude-nine** (Claude Code routed through 9Router) and plain **Claude Code**. Optional: install it only on boxes that answer myCRMSIM questions.

The documentation set is **not vendored** — fetch it per box to `~/Downloads/openclaw-master-files/mycrmsim/` (156 articles plus `00-INDEX.md`), then point `ASMS_DOCS_DIR` at it. Image link lines in the articles are expected to dangle; images are not shipped.

Discovery runs through the Claude Code skills path, so link this directory into `~/.claude/skills/`:

```
ln -sfn ~/999-setup/85-android-sms-system ~/.claude/skills/85-android-sms-system
```

Verify with `./qc-android-sms-system.sh`.
