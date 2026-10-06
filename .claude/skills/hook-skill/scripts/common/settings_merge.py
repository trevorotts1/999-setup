#!/usr/bin/env python3
"""Register / unregister Hook Skill entries in a Claude Code settings.json. Stdlib only.

  settings_merge.py register   --settings FILE --python PY --hooks-dir DIR --components a,b,c [--dry-run]
  settings_merge.py unregister --settings FILE --hooks-dir DIR [--dry-run]
  settings_merge.py list       --settings FILE --hooks-dir DIR

Rules: existing hook entries are never edited or removed except our own; our entries are new groups
appended to the event's list; the file is written atomically and re-read as JSON before it replaces the
original, so a failed write leaves the original untouched. An unreadable/invalid settings file is never modified.
Our entries are recognised by the absolute script path inside the command, so un-registering removes only them.
"""
import argparse, json, os, shlex, subprocess, sys, tempfile

TOOLS_BIG = ("Bash|Write|Edit|MultiEdit|NotebookEdit|Agent|Task|Workflow|SendMessage|CronCreate|CronDelete|"
             "TaskStop|Artifact|ArtifactData|mcp__.*")
# component -> script (relative to hooks dir) and [(event, matcher or None, timeout, extra args)]
COMPONENTS = {
    "workflow-guard": ("workflow-guard/guard.py", [
        ("SessionStart", None, 120, "hook"),
        ("Stop", None, 120, "hook"),
        ("PreToolUse", "Workflow|Agent|Task|TaskOutput|Edit|Write|MultiEdit|NotebookEdit|Bash", 120, "hook"),
        ("UserPromptSubmit", None, 120, "hook"),
        ("PostToolUse", "Workflow|TaskStop|Agent|Task|TaskOutput", 120, "hook"),
        ("PostToolUseFailure", ".*", 120, "hook")]),
    "hygiene": ("hygiene/post_merge_hygiene.py", [("PostToolUse", "Bash", 30, "")]),
    "ask-before-backup": ("ask-before-backup/ask_before_backup.py", [
        ("PreToolUse", "Bash|Write|Edit|MultiEdit|NotebookEdit", 10, "")]),
    "question-gate": ("question-gate/gate_actions.py", [("PreToolUse", TOOLS_BIG, 10, "")]),
    "question-gate-classify": ("question-gate/classify_prompt.py", [("UserPromptSubmit", None, 10, "")]),
}
EXPAND = {"question-gate": ["question-gate", "question-gate-classify"]}


def quote(s):
    return subprocess.list2cmdline([s]) if os.name == "nt" else shlex.quote(s)


def script_path(hooks_dir, rel):
    return os.path.join(hooks_dir, *rel.split("/"))


def command(py, hooks_dir, rel, args):
    return " ".join([quote(py), quote(script_path(hooks_dir, rel))] + ([args] if args else []))


def load(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    if not raw.strip():
        return {}
    doc = json.loads(raw)  # raises on invalid JSON: caller aborts without touching the file
    if not isinstance(doc, dict):
        raise ValueError("settings root is not a JSON object")
    return doc


DRY = False


def save(path, doc):
    if DRY:
        return
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".settings-", suffix=".tmp", dir=os.path.dirname(os.path.abspath(path)))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        with open(tmp, encoding="utf-8") as f:
            json.load(f)  # validate before replacing
        if os.path.exists(path):
            try:
                os.chmod(tmp, os.stat(path).st_mode & 0o777)
            except OSError:
                pass
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def ours(cmd, hooks_dir):
    c = cmd.replace("'", "").replace('"', "")
    return any(script_path(hooks_dir, rel) in c for rel, _ in COMPONENTS.values())


def register(settings, py, hooks_dir, wanted):
    doc = load(settings)
    hooks = doc.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("settings.hooks is not an object")
    added = 0
    for comp in [c for w in wanted for c in EXPAND.get(w, [w])]:
        rel, entries = COMPONENTS[comp]
        for event, matcher, timeout, args in entries:
            groups = hooks.setdefault(event, [])
            if not isinstance(groups, list):
                raise ValueError("settings.hooks.%s is not a list" % event)
            cmd = command(py, hooks_dir, rel, args)
            if any(h.get("command") == cmd for g in groups if isinstance(g, dict) for h in g.get("hooks", []) if isinstance(h, dict)):
                continue  # already registered: idempotent
            group = {"hooks": [{"type": "command", "command": cmd, "timeout": timeout}]}
            if matcher:
                group = {"matcher": matcher, **group}
            groups.append(group)
            added += 1
    save(settings, doc)
    return added


def unregister(settings, hooks_dir):
    if not os.path.exists(settings):
        return 0
    doc = load(settings)
    hooks = doc.get("hooks")
    removed = 0
    if isinstance(hooks, dict):
        for event in list(hooks):
            groups = hooks[event]
            if not isinstance(groups, list):
                continue
            keep = []
            for g in groups:
                if isinstance(g, dict) and isinstance(g.get("hooks"), list):
                    mine = [h for h in g["hooks"] if isinstance(h, dict) and ours(str(h.get("command", "")), hooks_dir)]
                    if mine:
                        removed += len(mine)
                        rest = [h for h in g["hooks"] if h not in mine]
                        if rest:
                            keep.append({**g, "hooks": rest})
                        continue
                keep.append(g)
            if keep:
                hooks[event] = keep
            elif groups:  # we emptied it: drop the key we created
                del hooks[event]
        if not hooks:
            del doc["hooks"]
    if removed:
        save(settings, doc)
    return removed


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["register", "unregister", "list"])
    p.add_argument("--settings", required=True)
    p.add_argument("--hooks-dir", required=True)
    p.add_argument("--python")
    p.add_argument("--components", default="")
    p.add_argument("--dry-run", action="store_true", help="compute and report, write nothing")
    a = p.parse_args()
    global DRY
    DRY = a.dry_run
    try:
        if a.action == "register":
            wanted = [c for c in a.components.split(",") if c]
            bad = [c for c in wanted if c not in COMPONENTS or c == "question-gate-classify"]
            if bad or not a.python:
                p.error("need --python and known --components; bad: %s" % bad)
            print("registered %d hook entries in %s" % (register(a.settings, a.python, a.hooks_dir, wanted), a.settings))
        elif a.action == "unregister":
            print("removed %d hook entries from %s" % (unregister(a.settings, a.hooks_dir), a.settings))
        else:
            doc = load(a.settings)
            n = sum(1 for gs in (doc.get("hooks") or {}).values() if isinstance(gs, list) for g in gs if isinstance(g, dict)
                    for h in g.get("hooks", []) if isinstance(h, dict) and ours(str(h.get("command", "")), a.hooks_dir))
            print(n)
    except (ValueError, OSError) as e:
        print("settings_merge: %s: %s (file left untouched)" % (type(e).__name__, e), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
