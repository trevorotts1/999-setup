# Claude Code adapter

Hooks register in `~/.claude/settings.json`.

```bash
bash scripts/macos/install.sh [--with-ask-before-backup] [--with-question-gate] [--dry-run]
```

Windows: `.\scripts\windows\Install-HookSkill.ps1` (add `-DryRun` first). Needs Python 3.8+; Node.js 18+ is optional (workflow validation).

Restart Claude Code afterwards, then test: `bash tests/run-all.sh`. Windows note: the PowerShell installer was not run on a live Windows machine in this release; run it with `-DryRun` first and report any failure.
