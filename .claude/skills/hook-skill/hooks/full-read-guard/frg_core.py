#!/usr/bin/env python3
"""Full-read guard core (stdlib only). Shared by frg_hook.py (the Claude Code hook) and read_skill.py.

Two classes of file inside a skill folder (or the universal-sops folder):
  instruction - must be read WHOLE (SKILL.md, SOPs, procedures, rules, ...). Partial reads are blocked.
  lookup      - may be searched or read in part (code, data, tests, templates, catalogs). Named by the central
                manifest (manifest.d/*.json) or by nature (anything that is not a markdown document).
The agent never decides what is lookup. Nothing is exempt by size.
"""
import fnmatch, glob as _glob, hashlib, json, os, re, shlex, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
INSTR_EXT = (".md", ".markdown", ".mdx")
# Always instruction, whatever any manifest says.
HARD_NAMES = {"skill.md", "instructions.md", "install.md", "qc.md", "core_updates.md", "readme.md"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__"}
SOPS = "universal-sops"
LOOP_LIMIT = 3  # the same call blocked this many times is then allowed (and logged)


def strip_num(name):
    return re.sub(r"^\d+-", "", name)


def state_dir():
    return os.environ.get("FRG_STATE_DIR") or os.path.join(HERE, "state")


def mode():
    m = (os.environ.get("FRG_MODE") or "").strip().lower()
    if not m:
        try:
            with open(os.path.join(os.path.dirname(HERE), "full-read-guard.json"), encoding="utf-8") as f:
                m = str(json.load(f).get("mode", "")).lower()
        except (OSError, ValueError, AttributeError):
            m = ""
    return m if m in ("off", "audit", "enforce") else "enforce"


def log(msg):
    try:
        os.makedirs(state_dir(), exist_ok=True)
        with open(os.path.join(state_dir(), "frg.log"), "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), msg))
    except OSError:
        pass


# ---------------------------------------------------------------- manifest
def glob_re(g):
    out, i = "", 0
    while i < len(g):
        c = g[i]
        if g.startswith("**/", i):
            out += "(?:.*/)?"; i += 3; continue
        if g.startswith("**", i):
            out += ".*"; i += 2; continue
        out += "[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c)
        i += 1
    return re.compile("^" + out + "$")


_MANIFEST = {}


def manifest_dir():
    return os.environ.get("FRG_MANIFEST_DIR") or os.path.join(HERE, "manifest.d")


def load_manifest(force=False):
    d = manifest_dir()
    if d in _MANIFEST and not force:
        return _MANIFEST[d]
    skills = {}
    for p in sorted(_glob.glob(os.path.join(d, "*.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, ValueError):
            continue
        for e in doc.get("skills", []):
            sid = strip_num(str(e.get("skill", "")))
            if not sid:
                continue
            cur = skills.setdefault(sid, {"depends_on": [], "lookup": [], "instruction": [], "external_lookup_roots": []})
            for k in cur:
                for v in e.get(k, []):
                    v = v if isinstance(v, str) else v.get("glob", "")
                    if v and v not in cur[k]:
                        cur[k].append(v)
    for e in skills.values():
        e["_lookup_re"] = [glob_re(g) for g in e["lookup"]]
        e["_instr_re"] = [glob_re(g) for g in e["instruction"]]
    _MANIFEST[d] = skills
    return skills


# ---------------------------------------------------------------- skills roots and classification
def skills_roots():
    env = os.environ.get("FRG_SKILLS_ROOTS")
    if env:
        return [r for r in env.split(os.pathsep) if r]
    home = os.path.expanduser("~")
    roots = []
    cfg = os.environ.get("CLAUDE_CONFIG_DIR")
    if cfg:
        roots.append(os.path.join(cfg, "skills"))
    roots += [os.path.join(home, ".claude", "skills"), os.path.join(home, ".claude-nine", "skills"),
              os.path.join(home, ".codex", "skills"), os.path.join(home, ".agents", "skills")]
    seen, out = set(), []
    for r in roots:
        k = os.path.realpath(r)
        if k not in seen and os.path.isdir(r):
            seen.add(k); out.append(r)
    return out


def skill_entries():
    """[(skill_id, lexical_dir, real_dir)] for every skill folder (has SKILL.md) plus universal-sops."""
    out = []
    for root in skills_roots():
        try:
            names = sorted(os.listdir(root))
        except OSError:
            continue
        for n in names:
            d = os.path.join(root, n)
            if not os.path.isdir(d):
                continue
            if n == SOPS or os.path.isfile(os.path.join(d, "SKILL.md")):
                out.append((SOPS if n == SOPS else strip_num(n), d, os.path.realpath(d)))
    return out


def _under(path, base):
    return path == base or path.startswith(base.rstrip(os.sep) + os.sep)


def locate(path, entries=None):
    """-> (skill_id, skill_real_dir, rel) when path is inside a skill folder, else None."""
    if not path:
        return None
    entries = skill_entries() if entries is None else entries
    ap = os.path.abspath(path)
    rp = os.path.realpath(path)
    for sid, lex, real in entries:
        if _under(rp, real):
            return sid, real, os.path.relpath(rp, real).replace(os.sep, "/")
        if _under(ap, os.path.abspath(lex)):
            return sid, real, os.path.relpath(ap, os.path.abspath(lex)).replace(os.sep, "/")
    return None


def classify_rel(sid, rel):
    """'instruction' or 'lookup' for a file at rel inside skill sid."""
    base = rel.rsplit("/", 1)[-1]
    low = base.lower()
    if low in HARD_NAMES and ("/" not in rel or low != "readme.md") or low.endswith("-full.md"):
        return "instruction"
    if any(p in SKIP_DIRS for p in rel.split("/")):
        return "lookup"
    if not low.endswith(INSTR_EXT):
        return "lookup"
    m = load_manifest().get(sid)
    if sid == SOPS:
        return "instruction" if not (m and any(r.match(rel) for r in m["_lookup_re"])) else "lookup"
    if m is None:
        return "instruction" if "/" not in rel else "lookup"
    if any(r.match(rel) for r in m["_instr_re"]):
        return "instruction"
    if any(r.match(rel) for r in m["_lookup_re"]):
        return "lookup"
    return "instruction"  # default until the manifest says otherwise: nothing is exempted by guess


def classify(path, entries=None):
    """-> dict(skill, real_dir, rel, cls, path) or None when the path is not inside a skill folder."""
    loc = locate(path, entries)
    if not loc:
        return None
    sid, real, rel = loc
    return {"skill": sid, "real_dir": real, "rel": rel, "path": os.path.join(real, rel), "cls": classify_rel(sid, rel)}


ORDER = ["skill.md", "instructions.md", None, "install.md", "qc.md", "core_updates.md", "readme.md"]


def _rank(rel):
    low = rel.lower()
    if "/" not in rel:
        if low in ORDER:
            return (ORDER.index(low), rel)
        if low.endswith("-full.md"):
            return (2, rel)
    return (9, rel)


def instruction_files(sid, real_dir):
    """Absolute paths of every instruction file of a skill, in the fixed reading order."""
    rels = []
    for d, dirs, files in os.walk(real_dir):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for f in files:
            rel = os.path.relpath(os.path.join(d, f), real_dir).replace(os.sep, "/")
            if classify_rel(sid, rel) == "instruction":
                rels.append(rel)
    rels.sort(key=_rank)
    return [os.path.join(real_dir, r) for r in rels]


def dir_has_instruction(info):
    """True when the directory described by info (a locate result for a folder) holds an instruction file below it."""
    base = os.path.join(info["real_dir"], info["rel"]) if info["rel"] != "." else info["real_dir"]
    for d, dirs, files in os.walk(base):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            rel = os.path.relpath(os.path.join(d, f), info["real_dir"]).replace(os.sep, "/")
            if classify_rel(info["skill"], rel) == "instruction":
                return True
    return False


def frontmatter_depends(skill_md):
    try:
        with open(skill_md, encoding="utf-8", errors="replace") as f:
            txt = f.read(20000)
    except OSError:
        return []
    m = re.match(r"^---\s*\n(.*?)\n---", txt, re.S)
    if not m:
        return []
    fm, out = m.group(1), []
    inline = re.search(r"^depends_on:\s*\[(.*?)\]\s*$", fm, re.M)
    if inline:
        out = [x.strip().strip("'\"") for x in inline.group(1).split(",") if x.strip()]
    else:
        blk = re.search(r"^depends_on:\s*\n((?:[ \t]+-.*\n?)+)", fm, re.M)
        if blk:
            out = [re.sub(r"^[ \t]+-\s*", "", ln).strip().strip("'\"") for ln in blk.group(1).splitlines()]
    return [x for x in out if x]


def find_skill(name, entries=None):
    entries = skill_entries() if entries is None else entries
    n = strip_num(name.strip().strip("/"))
    for sid, lex, real in entries:
        if sid == n or os.path.basename(lex) == name:
            return sid, real
    if re.fullmatch(r"\d+", name):
        for sid, lex, real in entries:
            if os.path.basename(lex).startswith(name + "-"):
                return sid, real
    return None


def resolve_target(target, entries=None):
    """read-skill argument -> ('skill', sid, real_dir) | ('file', sid, path) | None."""
    entries = skill_entries() if entries is None else entries
    if os.sep in target or target.startswith(SOPS):
        cands = [target, os.path.expanduser(target)]
        for root in skills_roots():
            cands.append(os.path.join(root, target))
        for c in cands:
            if os.path.isfile(c):
                loc = locate(c, entries)
                if loc:
                    return ("file", loc[0], os.path.join(loc[1], loc[2]))
            if os.path.isdir(c):
                loc = locate(c, entries)
                if loc and loc[2] == ".":
                    return ("skill", loc[0], loc[1])
    f = find_skill(target, entries)
    return ("skill", f[0], f[1]) if f else None


def closure(sid, real_dir, entries=None):
    """One level: the skill's own instruction files, then each direct dependency's. -> (files, missing_names)."""
    entries = skill_entries() if entries is None else entries
    files, missing = [], []
    for p in instruction_files(sid, real_dir):
        files.append(p)
    deps = list((load_manifest().get(sid) or {}).get("depends_on", []))
    for d in frontmatter_depends(os.path.join(real_dir, "SKILL.md")):
        if d not in deps:
            deps.append(d)
    for d in deps:
        if d.startswith(SOPS + "/") or d.endswith(".md") and "/" in d:
            t = resolve_target(d, entries)
            if t and t[0] == "file":
                if t[2] not in files:
                    files.append(t[2])
            else:
                missing.append(d)
            continue
        f = find_skill(d, entries)
        if not f:
            missing.append(d)
            continue
        for p in instruction_files(f[0], f[1]):
            if p not in files:
                files.append(p)
    return files, missing


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- session state
def _sess_path(sid):
    return os.path.join(state_dir(), "sessions", re.sub(r"[^A-Za-z0-9_.-]", "_", sid or "nosession") + ".json")


def load_session(sid):
    try:
        with open(_sess_path(sid), encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    except (OSError, ValueError):
        pass
    return {"read": {}, "inuse": [], "blocks": {}, "parts": {}}


def save_session(sid, d):
    p = _sess_path(sid)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = "%s.%d.tmp" % (p, os.getpid())
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, p)
    except OSError:
        pass


def reset_session(sid):
    d = load_session(sid)
    d["read"], d["inuse"], d["parts"] = {}, [], {}  # blocks stay: the loop breaker must survive a reset
    save_session(sid, d)


def plan_path(plan):
    return os.path.join(state_dir(), "plans", plan + ".json")


def missing_reads(sess, files):
    out = []
    for p in files:
        try:
            cur = sha256_file(p)
        except OSError:
            continue
        if sess["read"].get(os.path.realpath(p)) != cur:
            out.append(p)
    return out


def receipt_gap(sid, real_dir, sess, entries=None):
    files, _ = closure(sid, real_dir, entries)
    return missing_reads(sess, files)


# ---------------------------------------------------------------- shell parsing
PARTIAL = {"grep", "egrep", "fgrep", "rg", "ag", "ack", "head", "tail", "awk", "gawk", "mawk", "cut", "less", "more",
           "od", "xxd", "hexdump", "strings", "nl", "tac", "fold", "split", "csplit", "pr"}
READERS = {"cat", "bat", "less", "more", "tac", "nl"}
SAFE_VERBS = {"cat", "ls", "wc", "stat", "file", "sha256sum", "shasum", "md5", "md5sum", "test", "[", "cd", "pwd", "echo",
              "printf", "realpath", "readlink", "basename", "dirname", "tree", "find", "du", "diff", "cmp", "which",
              "type", "true", "false", "read-skill", "open", "git", "ln", "touch", "mkdir", "env", "export", "set",
              "unset", "sleep", "date", "whoami", "uname", "command", "wait", "exit", "pbcopy", "tee", "sort", "uniq"}
INTERP = {"python", "python3", "node", "ruby", "perl", "deno", "bun"}
WRAPPERS = {"sudo", "command", "time", "nohup", "nice", "exec", "env", "builtin", "xargs", "stdbuf", "caffeinate"}


def split_segments(cmd):
    """Split on ; && || | newline and subshell/backtick delimiters outside quotes. -> [(segment, piped_from_previous)]."""
    segs, cur, q, i, piped = [], [], None, 0, False
    n = len(cmd)

    def flush(p):
        s = "".join(cur).strip()
        cur.clear()
        if s:
            segs.append((s, p))
    nextpipe = False
    while i < n:
        c = cmd[i]
        if q:
            cur.append(c)
            if c == "\\" and q == '"' and i + 1 < n:
                cur.append(cmd[i + 1]); i += 2; continue
            if c == q:
                q = None
            i += 1; continue
        if c == "\\" and i + 1 < n:
            cur.append(c); cur.append(cmd[i + 1]); i += 2; continue
        if c in "'\"":
            q = c; cur.append(c); i += 1; continue
        two = cmd[i:i + 2]
        if two in ("&&", "||"):
            flush(nextpipe); nextpipe = False; i += 2; continue
        if c in ";\n`(){}":
            flush(nextpipe); nextpipe = False; i += 1 + (1 if two == "$(" else 0); continue
        if c == "$" and two == "$(":
            flush(nextpipe); nextpipe = False; i += 2; continue
        if c == "|":
            flush(nextpipe); nextpipe = True; i += 1; continue
        if c == "&":
            flush(nextpipe); nextpipe = False; i += 1; continue
        cur.append(c); i += 1
    flush(nextpipe)
    return segs


def _tokens(seg):
    try:
        return shlex.split(seg, posix=True)
    except ValueError:
        return seg.split()


def _expand(tok, cwd):
    t = os.path.expanduser(os.path.expandvars(tok))
    if not os.path.isabs(t):
        t = os.path.join(cwd, t)
    return os.path.normpath(t)


def _paths_of(tok, cwd):
    """Existing filesystem paths a token refers to (glob-expanded)."""
    if not tok or tok.startswith("-") and not tok.startswith("--include") and "=" not in tok:
        return []
    t = tok.split("=", 1)[1] if tok.startswith("--") and "=" in tok else tok
    p = _expand(t, cwd)
    if any(ch in p for ch in "*?["):
        return _glob.glob(p)[:200]
    return [p] if os.path.exists(p) else []


def _is_sed_partial(args):
    if any(re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", a) for a in args):
        return True
    return any(re.fullmatch(r"[0-9$]+(,[0-9$]+)?p", a.strip("'\"")) for a in args)


def _strip_redirs(args):
    """-> (args without redirection tokens, input-redirect targets)."""
    clean, redirs, skip = [], [], False
    for j, a in enumerate(args):
        if skip:
            skip = False
            continue
        if a in ("<", "<<<"):
            if j + 1 < len(args):
                redirs.append(args[j + 1])
                skip = True
            continue
        if a.startswith("<") and len(a) > 1 and not a.startswith("<<"):
            redirs.append(a[1:])
            continue
        if re.fullmatch(r"\d*>>?", a):
            skip = True
            continue
        if re.match(r"^\d*>>?\S", a) or re.fullmatch(r"\d*>&\d+", a):
            continue
        clean.append(a)
    return clean, redirs


def analyze_bash(cmd, cwd, entries):
    """-> dict(partial=[(verb, info)], touch={skill_id: real_dir}).
    partial: partial reads of in-scope instruction files. touch: skill folders a non-read-only command acts on."""
    res = {"partial": [], "touch": {}}
    cwd = cwd or os.getcwd()
    pipe_reads = False
    for seg, piped in split_segments(cmd):
        toks = _tokens(seg)
        while toks and (re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", toks[0]) or toks[0] in WRAPPERS):
            toks = toks[1:]
        if not toks:
            continue
        verb = os.path.basename(toks[0])
        if verb == "cd":
            if len(toks) > 1:
                cwd = _expand(toks[1], cwd)
            continue
        if not piped:
            pipe_reads = False
        args, redirs = _strip_redirs(toks[1:])
        infos = []   # (path, info) for every existing path argument inside a skill folder
        for a in args + redirs:
            for p in _paths_of(a, cwd):
                info = classify(p, entries)
                if info:
                    infos.append((p, info))
        files = [(p, i) for p, i in infos if os.path.isfile(p) and i["cls"] == "instruction"]
        dirs = [(p, i) for p, i in infos if os.path.isdir(p)]
        # interpreter one-liners that name an instruction file
        if verb in INTERP and any(a in ("-c", "-e", "-p") or a.startswith("-c") for a in args):
            for a in args:
                for m in re.finditer(r"[\w~$.\-]*/[\w./\-]+", a):
                    for p in _paths_of(m.group(0), cwd):
                        i = classify(p, entries)
                        if i and os.path.isfile(p) and i["cls"] == "instruction":
                            res["partial"].append((verb + " one-liner", i))
            continue
        partial = verb in PARTIAL or (verb == "sed" and _is_sed_partial(toks[1:]))
        if verb in READERS and files:
            pipe_reads = True
        if partial:
            for _, i in files:
                res["partial"].append((verb, i))
            if piped and pipe_reads and not files:
                res["partial"].append((verb, {"skill": "?", "rel": "(piped from an instruction file)", "path": "",
                                              "cls": "instruction", "real_dir": ""}))
            recursive = verb in ("rg", "ag", "ack") or any(
                re.fullmatch(r"-[A-Za-z]*[rR][A-Za-z]*", a) or a in ("--recursive", "--dereference-recursive") for a in toks[1:])
            if recursive:
                narrow = [a for a in toks[1:] if a.startswith(("--include", "--glob", "-g", "--type", "-t"))]
                md_ok = (not narrow) or any("md" in a for a in narrow)
                for _, i in dirs:
                    if md_ok and dir_has_instruction(i):
                        res["partial"].append((verb, i))
            continue
        if verb in SAFE_VERBS:
            continue
        for _, i in infos:
            res["touch"][i["skill"]] = i["real_dir"]
        if "/" in toks[0] and os.path.basename(toks[0]) != "read-skill":
            for p in _paths_of(toks[0], cwd):
                i = classify(p, entries)
                if i:
                    res["touch"][i["skill"]] = i["real_dir"]
    return res


def grep_tool_hits(ti, cwd, entries):
    """Grep tool input -> list of in-scope instruction targets the search could read (file or directory)."""
    path = ti.get("path") or cwd or os.getcwd()
    p = _expand(path, cwd or os.getcwd())
    info = classify(p, entries)
    if not info:
        return []
    if os.path.isfile(p):
        return [info] if info["cls"] == "instruction" else []
    g = (ti.get("glob") or "")
    ty = (ti.get("type") or "")
    if ty and ty not in ("md", "markdown"):
        return []
    if g and not any(x in g for x in ("md", "*", "{")) :
        return []
    if g and re.search(r"\.(py|js|ts|sh|json|ya?ml|html?|css|txt|csv|ps1|mjs)\b", g) and "md" not in g:
        return []
    return [info] if dir_has_instruction(info) else []
