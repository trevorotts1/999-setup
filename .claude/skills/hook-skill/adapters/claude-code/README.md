# Claude Code adapter

Hooks register in `~/.claude/settings.json`.

```bash
bash scripts/macos/install.sh [--with-ask-before-backup] [--with-question-gate] [--dry-run]
```

Windows: `.\scripts\windows\Install-HookSkill.ps1` (add `-DryRun` first). Needs Python 3.8+; Node.js 18+ is optional (workflow validation).

Restart Claude Code afterwards, then test: `bash tests/run-all.sh`. Windows note: the PowerShell installer was not run on a live Windows machine in this release; run it with `-DryRun` first and report any failure.

The `full-read-guard` component (default on) blocks partial reads of skill and SOP instruction files and points to `read-skill <name>`, which prints the skill and its direct dependencies in full. `--no-full-read-guard` leaves it out; `FRG_MODE=off` disables it at run time.
