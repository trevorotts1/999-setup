#!/usr/bin/env python3
"""PreToolUse hook: ask the user before any backup is created. Fails open."""
import json, re, sys

SAFE = {"ls", "du", "find", "grep", "rg", "cat", "head", "tail", "wc", "stat", "rm"}
CMD_PATTERNS = [
    (r"\.bak", ".bak"), (r"backup", "backup"), (r"\.orig", ".orig"),
    (r"tmutil\s+localsnapshot", "tmutil localsnapshot"),
    (r"git\s+stash", "git stash"), (r"pg_dump", "pg_dump"), (r"mysqldump", "mysqldump"),
]
COPY_TOOL = r"\b(cp|rsync|tar|zip|ditto)\b"
COPY_DEST = r"bak|backup|snapshot|rollback|pre-|before"
PATH_RE = r"bak|backup|\.orig|rollback"


def detect(tool, ti):
    if tool == "Bash":
        raw = ti.get("command") or ""
        if re.search(r"sqlite3\b.*\.backup", raw):
            return "sqlite3 .backup"
        # Words inside quotes are message text (e.g. "no backup"), not actions.
        cmd = re.sub(r"\"(?:\\.|[^\"\\])*\"|'[^']*'", '""', raw)
        segs = [s.strip() for s in re.split(r";|&&|\|\||\||\n", cmd) if s.strip()]
        if segs and all(s.split()[0] in SAFE for s in segs):
            return None
        for pat, name in CMD_PATTERNS:
            if re.search(pat, cmd, re.I):
                return f"Bash command contains '{name}'"
        if re.search(COPY_TOOL, cmd) and re.search(COPY_DEST, cmd, re.I):
            return "copy/archive command with backup-like destination"
        return None
    p = ti.get("file_path") or ti.get("notebook_path") or ""
    if re.search(PATH_RE, p, re.I):
        return f"{tool} targets backup-like path {p}"
    return None


try:
    d = json.load(sys.stdin)
    if d.get("permission_mode") == "bypassPermissions":
        sys.exit(0)  # yolo mode = approved, never ask
    why = detect(d.get("tool_name", ""), d.get("tool_input") or {})
    if why:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "ask",
            "permissionDecisionReason": f"Permission is required before any backup is created (Hook Skill: ask-before-backup): {why}"}}))
except Exception:
    pass  # fail open
sys.exit(0)
