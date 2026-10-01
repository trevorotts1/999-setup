# Claude Code Adapter

Evaluate the packaged skill against the current Claude Code runtime without redesigning the BlackCEO methodology.

1. Verify the current Claude Code skill-discovery mechanism in the local install.
2. If the normal local skills root is `~/.claude/skills`, use the safe installer:

```bash
python3 scripts/install_local.py --runtime claude-code --dry-run
python3 scripts/install_local.py --runtime claude-code
```

3. Confirm that the runtime discovers the skill and can load references/assets/scripts.
4. Run `python3 tests/test_scripts.py`.
5. Record any compatibility-only changes in the evaluation report.

Do not overwrite an existing target. Do not add credentials to the skill folder.
