#!/usr/bin/env python3
"""PreToolUse: in question mode, ask the user before any action tool. Read-only things pass. Fails open."""
import json, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
SIMPLE = set("""ls cat head tail grep rg du df wc stat file ps pgrep lsof date echo printf which cd pwd true sort uniq cut tr
jq basename dirname uname whoami test [ realpath""".split())
WRITE_PY = re.compile(r"open\([^)]*['\"][wax+]b?['\"]|write_text|write_bytes|os\.(remove|unlink|rename|system|popen)|unlink|rmtree|shutil\.|subprocess|\.write\(|touch\(|mkdir", re.S)
READ_VERBS = {"list", "get", "read", "search", "query", "view", "describe", "fetch"}
OSA_BAD =re.compile(r"keystroke|key code|do script|click|delete|make new|set |quit|close|activate|launch|run script|do shell", re.I)
OSA_OK = re.compile(r"get contents|get name|tty of", re.I)


def split_cmds(s):
    """Quote-aware split on ; && || | newline. Returns None if unsafe constructs (subst, redirect to file)."""
    out, cur, q, i = [], "", None, 0
    while i < len(s):
        c = s[i]
        if q:
            cur += c
            if c == q:
                q = None
            elif c == "\\" and q == '"' and i + 1 < len(s):
                i += 1; cur += s[i]
            i += 1
            continue
        if c in "'\"":
            q = c; cur += c
        elif c == "`" or s.startswith("$(", i) or s.startswith("<(", i):
            return None
        elif c == ">":
            if re.match(r">\s*&\d|>\s*/dev/null|>&", s[i:]) or (cur.endswith(("2", "1")) and re.match(r">\s*(&\d|/dev/null)", s[i:])):
                cur += c
            else:
                return None
        elif c in ";|&\n":
            if c == "&" and not s.startswith("&&", i):
                if cur.endswith((">", "2>")) or s[i - 1:i] == ">":
                    cur += c; i += 1; continue
                return None  # background
            out.append(cur); cur = ""
            if s.startswith(("&&", "||"), i):
                i += 1
        else:
            cur += c
        i += 1
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def toks(c):
    import shlex
    return shlex.split(c)


def ro_cmd(c, depth=0):
    t = toks(c)
    while t and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t[0]):
        t.pop(0)
    if not t:
        return True
    n, a = t[0], t[1:]
    j = " ".join(t)
    if n in SIMPLE:
        return True
    if n == "find":
        return not any(x in ("-delete", "-exec", "-execdir", "-ok", "-fprint", "-fls") for x in a)
    if n == "command":
        return a[:1] == ["-v"]
    if n == "git":
        sub = [x for x in a if not x.startswith("-")][:1]
        if not sub:
            return False
        s = sub[0]
        if s in ("status", "log", "show", "diff", "ls-remote", "describe", "ls-files", "rev-parse", "blame"):
            return True
        if s == "branch":
            return not any(x in a for x in ("-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--set-upstream-to", "-u"))
        if s == "remote":
            rest = a[a.index("remote") + 1:]
            return not rest or rest[0] in ("-v", "show", "get-url")
        return False
    if n == "gh":
        if a[:2] in (["pr", "list"], ["pr", "view"], ["release", "list"], ["release", "view"], ["run", "list"], ["run", "view"]):
            return True
        if a[:1] == ["api"]:
            r = a[1:]
            for k, x in enumerate(r):
                if x in ("-f", "-F", "--field", "--raw-field", "--input") or x.startswith(("-f", "-F")) and len(x) > 2 and x[1] in "fF":
                    return False
                if x in ("-X", "--method") and k + 1 < len(r) and r[k + 1].upper() != "GET":
                    return False
                if x.startswith("--method=") and x.split("=", 1)[1].upper() != "GET":
                    return False
            return True
        return False
    if n == "sqlite3":
        return "-readonly" in a
    if n in ("python3", "python"):
        if "-c" in a:
            code = a[a.index("-c") + 1] if a.index("-c") + 1 < len(a) else ""
        elif a[:1] == ["-"]:
            return False  # stdin code unseen here (heredoc) -> ask
        else:
            return False
        return not WRITE_PY.search(code)
    if n == "curl":
        for k, x in enumerate(a):
            if x in ("-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form", "-T", "--upload-file", "-O", "--remote-name") or x.startswith(("--data", "-d")) and x != "-d" and x[:2] == "-d":
                return False
            if x in ("-X", "--request") and k + 1 < len(a) and a[k + 1].upper() != "GET":
                return False
            if x in ("-o", "--output") and k + 1 < len(a) and a[k + 1] != "/dev/null":
                return False
        return True
    if n == "osascript":
        return bool(OSA_OK.search(j)) and not OSA_BAD.search(j)
    if n == "tmutil":
        return a[:1] == ["listlocalsnapshots"]
    if n == "pm2":
        return a[:1] and a[0] in ("list", "ls", "status", "jlist", "prettylist")
    if n == "ssh" and depth < 2:
        optarg = set("-b -c -D -E -e -F -I -i -J -L -l -m -O -o -p -Q -R -S -W -w".split())
        k, host = 0, None
        while k < len(a):
            if a[k].startswith("-"):
                k += 2 if a[k] in optarg else 1
            else:
                host = a[k]; k += 1; break
        rest = " ".join(a[k:])
        return bool(host and rest) and ro_all(rest, depth + 1)
    return False


def ro_all(cmd, depth=0):
    parts = split_cmds(cmd)
    if not parts:
        return False
    return all(ro_cmd(p, depth) for p in parts)


def summary(tool, ti):
    s = ti.get("command") or ti.get("file_path") or ti.get("description") or ti.get("prompt") or ti.get("subject") or ""
    s = " ".join(str(s).split())[:100]
    return tool + (": " + s if s else "")


def main():
    try:
        d = json.load(sys.stdin)
        if d.get("permission_mode") == "bypassPermissions":
            sys.exit(0)  # yolo mode = approved, never ask
        sid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(d.get("session_id") or "nosession"))
        p = os.path.join(D, "state", sid + ".json")
        if not os.path.exists(p) or json.load(open(p)).get("mode") != "question":
            sys.exit(0)
        tool, ti = d.get("tool_name", ""), d.get("tool_input") or {}
        if tool == "Bash":
            try:
                if ro_all(ti.get("command", "")):
                    sys.exit(0)
            except Exception:
                pass
        elif tool.startswith("mcp__"):
            if any(str(ti.get(k, "")).lower() in READ_VERBS for k in ("action", "mode", "operation")):
                sys.exit(0)
            if re.search(r"get|list|read|search|query|fetch|describe|view", tool.split("__", 2)[-1], re.I):
                sys.exit(0)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
            "permissionDecisionReason": "The user asked a question, not for action. Get their permission before doing this (Hook Skill: question-gate): " + summary(tool, ti)}}))
    except SystemExit:
        raise
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
