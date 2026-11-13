#!/usr/bin/env python3
"""read-skill <skill|number|universal-sops/file.md> [--part N] [--list]

Prints the whole skill (every instruction file) and the whole of each skill/SOP it directly depends on (one level),
in a fixed order, each file preceded by a header with byte count and sha256. Long output is split into parts that fit
one tool result; every part ends with a receipt line (FRG-RECEIPT <plan> <part>/<total>). The guard counts the skill
as read only when every part was delivered. Lookup files are listed, not printed.
"""
import hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frg_core as C  # noqa: E402

BUDGET = int(os.environ.get("FRG_PART_CHARS") or 20000)  # the Bash tool truncates near 30000 characters


def build(files):
    """-> (text, {path: sha}). Header + exact file text per file."""
    chunks, shas = [], {}
    for p in files:
        raw = open(p, "rb").read()
        sha = hashlib.sha256(raw).hexdigest()
        shas[p] = sha
        txt = raw.decode("utf-8", errors="replace")
        if not txt.endswith("\n"):
            txt += "\n"
        chunks.append("===== FILE %s | %d bytes | sha256 %s =====\n%s===== END FILE %s =====\n" % (p, len(raw), sha[:16], txt, os.path.basename(p)))
    return "".join(chunks), shas


def split(text, budget):
    parts, cur, size = [], [], 0
    for ln in text.splitlines(keepends=True):
        while len(ln) > budget:  # one very long line: split it, never truncate
            if cur:
                parts.append("".join(cur)); cur, size = [], 0
            parts.append(ln[:budget]); ln = ln[budget:]
        if size + len(ln) > budget and cur:
            parts.append("".join(cur)); cur, size = [], 0
        cur.append(ln); size += len(ln)
    if cur:
        parts.append("".join(cur))
    return parts or [""]


def names():
    seen = []
    for sid, lex, real in C.skill_entries():
        if sid not in seen:
            seen.append(sid)
    return seen


def open_summary(sid, real):
    """Read-on-open folders: not printed here, but any file opened there must be read whole."""
    out = {}
    for d, dirs, files in os.walk(real):
        dirs[:] = sorted(x for x in dirs if x not in C.SKIP_DIRS)
        for f in files:
            rel = os.path.relpath(os.path.join(d, f), real).replace(os.sep, "/")
            if "/" in rel and C.classify_rel(sid, rel) == "open":
                out[rel.split("/")[0] + "/"] = out.get(rel.split("/")[0] + "/", 0) + 1
    return sorted("%s (%d files)" % kv for kv in out.items())


def lookup_summary(real):
    dirs = set()
    try:
        for n in sorted(os.listdir(real)):
            p = os.path.join(real, n)
            if os.path.isdir(p) and n not in C.SKIP_DIRS:
                dirs.add(n + "/")
    except OSError:
        pass
    return sorted(dirs)


def main(argv):
    args, part, i = [], 1, 0
    while i < len(argv):
        if argv[i] == "--part":
            try:
                part = int(argv[i + 1])
            except (ValueError, IndexError):
                print("read-skill: --part needs a number", file=sys.stderr); return 64
            i += 2
            continue
        if not argv[i].startswith("--"):
            args.append(argv[i])
        i += 1
    if not args:
        print("usage: read-skill <skill name | number | universal-sops/file.md> [--part N]\nskills: " + ", ".join(names()))
        return 64
    entries = C.skill_entries()
    t = C.resolve_target(args[0], entries)
    if not t:
        print("read-skill: no skill or SOP named '%s'. Valid skills: %s" % (args[0], ", ".join(names())), file=sys.stderr)
        return 2
    notes = []
    if t[0] == "file":
        files = [t[2]]
    else:
        files, missing = C.closure(t[1], t[2], entries)
        if missing:
            notes.append("dependencies not installed on this machine (nothing to read): " + ", ".join(missing))
    text, shas = build(files)
    parts = split(text, BUDGET)
    n = len(parts)
    plan = hashlib.sha256(json.dumps([sorted(shas.items()), BUDGET], sort_keys=True).encode()).hexdigest()[:16]
    try:
        os.makedirs(os.path.dirname(C.plan_path(plan)), exist_ok=True)
        with open(C.plan_path(plan), "w", encoding="utf-8") as f:
            json.dump({"skill": t[1], "files": shas, "parts": n}, f)
    except OSError:
        notes.append("receipts cannot be stored here (state folder not writable); the guard will not count this read")
    if part < 1 or part > n:
        print("read-skill: part %d does not exist (1..%d)" % (part, n), file=sys.stderr); return 64
    print("FULL-READ-GUARD %s: %d file(s), part %d of %d" % (args[0], len(files), part, n))
    if part == 1:
        print("Files in order: " + "; ".join(files))
        if t[0] == "skill":
            oo = open_summary(t[1], t[2])
            if oo:
                print("READ-ON-OPEN (not required up front; open the one you need with read-skill <path> or the Read tool, whole): " + " ".join(oo))
            lk = lookup_summary(t[2])
            if lk:
                print("Folders not required reading (searchable, may be read in part): " + " ".join(lk))
        for x in notes:
            print("NOTE: " + x)
    print("----- BEGIN PART %d/%d -----" % (part, n))
    sys.stdout.write(parts[part - 1])
    print("----- END PART %d/%d -----" % (part, n))
    if part < n:
        print("%d more part(s) remain. Next: %s %s --part %d" % (n - part, os.path.join(C.HERE, "read-skill"), args[0], part + 1))
    else:
        print("That was the last part (%d of %d)." % (n, n))
    print("FRG-RECEIPT %s %d/%d" % (plan, part, n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
