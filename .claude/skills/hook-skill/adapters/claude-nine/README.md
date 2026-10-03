# claude-nine adapter

`claude-nine` reuses the same Claude config root as plain `claude`, so hooks installed under `~/.claude/hooks/` are shared.

The installer also registers the same entries in `~/.claude-nine/settings.json` when the folder `~/.claude-nine/` exists (appending only; existing entries are untouched). If `~/.claude-nine/settings.json` is a symlink to the same file as `~/.claude/settings.json`, it is detected and written once.

```bash
bash scripts/macos/install.sh [--with-ask-before-backup] [--with-question-gate] [--dry-run]
```

Workflow model names are never baked in: the workflow generator takes `--builder` and `--reviewer` (defaults `opus`, `sonnet`) so a router-mapped model name can be passed per run.

Restart `claude-nine` afterwards. Uninstall: `bash scripts/macos/uninstall.sh` (restores both settings files).
