# WF-1B F-3 verification evidence

File: `/Users/blackceomacmini/work-999-setup-fix/WF-1B/.claude/skills/nine-router-setup/scripts/setup-macos.sh`
Branch: `fix/2-verification`

## Fix

One line changed — line 715. Raw backticks around `123456` inside the unquoted
`cat <<REPORT` heredoc (line 672) escaped with backslash-backtick pairs, exactly
like line 670.

## Diff

```
  @@ -712,7 +712,7 @@ $AGENT_TEAMS_REPORT
  -Dashboard: $DASHBOARD_URL - open this in your browser to manage providers and models. The password is the default `123456`; change it yourself in the dashboard when you are ready.
  +Dashboard: $DASHBOARD_URL - open this in your browser to manage providers and models. The password is the default \`123456\`; change it yourself in the dashboard when you are ready.
   
   Launch routed Claude Code with: claude-nine
   (claude-codex is the same session pinned to a Codex model — add a cx/ provider first.)
```

git diff stat: `1 file changed, 1 insertion(+), 1 deletion(-)` — nothing else.

## Verification

1. `bash -n setup-macos.sh` → exit 0 (SYNTAX_OK).
2. Line 670 untouched — byte dump (`od -c`) shows `\`123456\`` with
   backslash-backtick pairs, identical to original.
3. Line 715 byte dump (`od -c`) now shows `\`123456\``.
4. Same-instrument heredoc simulation — real block extracted from the file
   (lines 672–721) run through `bash`:

   Fixed (post-fix, from file):
   ```
   Dashboard:  - open this in your browser to manage providers and models. The password is the default `123456`; change it yourself in the dashboard when you are ready.
   ```
   stderr: empty

   Control (same block, raw backticks restored):
   ```
   Dashboard:  - open this in your browser to manage providers and models. The password is the default ; change it yourself in the dashboard when you are ready.
   ```
   stderr: `/tmp/heredoc-control.sh: line 1: 123456: command not found`

Control reproduces the reported defect; fixed form renders literal
backtick-123456-backtick. Fix confirmed.
