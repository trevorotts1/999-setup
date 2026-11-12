#!/usr/bin/env python3
"""Full-read guard: Claude Code hook (PreToolUse, PostToolUse, SessionStart, PreCompact). Fails open.

Blocks Grep, partial Read and shell partial reads (grep, head, tail, sed -n, awk, ...) of instruction files of
skills and SOPs, and blocks acting on a skill (running its scripts, editing its folder) before its instruction
files and its direct dependencies were read in full in this session. Points to `read-skill <name>`.
A block repeated for the identical call 3 times is allowed and logged, so a session is never frozen.
Modes: FRG_MODE or <config>/hooks/full-read-guard.json {"mode": "off|audit|enforce"}; default enforce.
"""
import hashlib, json, os, re, shlex, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frg_core as C  # noqa: E402

READ_SKILL = ("python " + os.path.join(C.HERE, "read_skill.py")) if os.name == "nt" else shlex.quote(os.path.join(C.HERE, "read-skill"))
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                              "permissionDecisionReason": reason}}))


def how(skill):
    return "Run: %s %s" % (READ_SKILL, skill if skill != "?" else "<skill name>")


def decide(d, sess, entries):
    """-> (rule, reason) to block, or None to allow."""
    tool, ti, cwd = d.get("tool_name", ""), d.get("tool_input") or {}, d.get("cwd") or os.getcwd()
    if tool == "Read":
        info = C.classify(C._expand(ti.get("file_path") or "", cwd), entries)
        if info and info["cls"] == "instruction" and (ti.get("offset") or ti.get("limit")):
            return ("R2-partial-read", "Full-read guard: %s (%s) is an instruction file and must be read whole. Read it "
                    "again without offset or limit. If it is too large for one Read, %s (it prints every part)."
                    % (info["rel"], info["skill"], how(info["skill"])))
        return None
    if tool == "Grep":
        hits = C.grep_tool_hits(ti, cwd, entries)
        if hits:
            i = hits[0]
            return ("R1-grep", "Full-read guard: searching instruction files of %s is blocked; read them whole. %s. "
                    "Files the manifest lists as lookup (scripts, data, tests, catalogs) may still be searched; "
                    "narrow the search to those with glob or path." % (i["skill"], how(i["skill"])))
        return None
    if tool == "Bash":
        r = C.analyze_bash(ti.get("command") or "", cwd, entries)
        if r["partial"]:
            verb, i = r["partial"][0]
            return ("R1-shell-partial", "Full-read guard: '%s' on an instruction file (%s, %s) reads only part of it. "
                    "Read the whole file (cat it, or the Read tool with no offset or limit). %s. Lookup files may be "
                    "searched." % (verb, i["skill"], i["rel"], how(i["skill"])))
        for sk, rd in r["touch"].items():
            gap = C.receipt_gap(sk, rd, sess, entries)
            if gap:
                return ("R3-act-before-read", "Full-read guard: before running or changing anything in skill '%s', read "
                        "it and its direct dependencies in full (%d file(s) not read yet, e.g. %s). %s"
                        % (sk, len(gap), os.path.basename(gap[0]), how(sk)))
        return None
    if tool in EDIT_TOOLS:
        p = C._expand(ti.get("file_path") or ti.get("notebook_path") or "", cwd)
        info = C.classify(p, entries)
        if info and info["skill"] != C.SOPS:
            gap = C.receipt_gap(info["skill"], info["real_dir"], sess, entries)
            if gap:
                return ("R3-act-before-read", "Full-read guard: before changing a file in skill '%s', read it and its direct "
                        "dependencies in full (%d file(s) not read yet). %s" % (info["skill"], len(gap), how(info["skill"])))
    return None


def pre(d):
    sid = d.get("session_id") or "nosession"
    m = C.mode()
    if m == "off":
        return
    entries = C.skill_entries()
    if not entries:
        return
    sess = C.load_session(sid)
    tool, ti = d.get("tool_name", ""), d.get("tool_input") or {}
    if tool == "Skill":  # the harness loads SKILL.md in full: record it and mark the skill in use
        name = str(ti.get("skill") or ti.get("name") or "").split(":")[-1]
        f = C.find_skill(name, entries)
        if f:
            if f[0] not in sess["inuse"]:
                sess["inuse"].append(f[0])
            md = os.path.join(f[1], "SKILL.md")
            if os.path.isfile(md):
                sess["read"][os.path.realpath(md)] = C.sha256_file(md)
            C.save_session(sid, sess)
        return
    hit = decide(d, sess, entries)
    if not hit:
        return
    rule, reason = hit
    key = hashlib.sha256((tool + json.dumps(ti, sort_keys=True, default=str)).encode()).hexdigest()[:16]
    n = int(sess["blocks"].get(key, 0))
    if m == "audit":
        C.log("audit would-block %s %s" % (rule, tool))
        return
    if n >= C.LOOP_LIMIT:
        C.log("loop-breaker allowed %s %s after %d blocks" % (rule, tool, n))
        return
    sess["blocks"][key] = n + 1
    C.save_session(sid, sess)
    C.log("block %s %s (%d/%d)" % (rule, tool, n + 1, C.LOOP_LIMIT))
    out("deny", reason + (" [block %d of %d; the same call is allowed after %d]" % (n + 1, C.LOOP_LIMIT, C.LOOP_LIMIT)))


def post(d):
    sid = d.get("session_id") or "nosession"
    if C.mode() == "off":
        return
    entries = C.skill_entries()
    if not entries:
        return
    tool, ti = d.get("tool_name", ""), d.get("tool_input") or {}
    sess = C.load_session(sid)
    dirty = False
    if tool == "Read" and not (ti.get("offset") or ti.get("limit")):
        p = C._expand(ti.get("file_path") or "", d.get("cwd") or os.getcwd())
        info = C.classify(p, entries)
        if info and os.path.isfile(p):
            sess["read"][os.path.realpath(p)] = C.sha256_file(p)
            dirty = True
    elif tool == "Bash":
        text = json.dumps(d.get("tool_response", ""), default=str)
        for plan, i, n in re.findall(r"FRG-RECEIPT ([0-9a-f]{16}) (\d+)/(\d+)", text):
            got = set(sess["parts"].get(plan, []))
            got.add(int(i))
            sess["parts"][plan] = sorted(got)
            if len(got) >= int(n):
                try:
                    with open(C.plan_path(plan), encoding="utf-8") as f:
                        files = json.load(f).get("files", {})
                except (OSError, ValueError):
                    files = {}
                for p, h in files.items():
                    sess["read"][os.path.realpath(p)] = h
            dirty = True
    if dirty:
        C.save_session(sid, sess)


def main():
    try:
        d = json.load(sys.stdin)
        ev = d.get("hook_event_name", "")
        if ev == "PreToolUse":
            pre(d)
        elif ev == "PostToolUse":
            post(d)
        elif ev == "PreCompact" or (ev == "SessionStart" and d.get("source") in ("compact", "clear")):
            C.reset_session(d.get("session_id") or "nosession")
    except Exception as e:  # fail open, always
        try:
            C.log("fail-open %s: %s" % (type(e).__name__, e))
        except Exception:
            pass
    sys.exit(0)


if __name__ == "__main__":
    main()
