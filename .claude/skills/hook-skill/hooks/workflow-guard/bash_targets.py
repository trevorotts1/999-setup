"""Target-aware Bash write check for the workflow guard.

find_hit(cmd, cwd, gov, env) returns (label, why) when some simple command in `cmd` WRITES, MOVES OUT or DELETES a path that
`gov(real_path_lowercase, destructive)` calls governed, else None. A command is judged by the TARGET of each mutating verb, never
by "a governed path is named somewhere and some write word is too":
  cp/rsync/ditto/install/ln -> destination; mv -> sources and destination; rm/rmdir/truncate/touch/tee/sed -i/perl -i/chmod -> file
  operands; redirects -> their target; find -> only -delete / -exec rm; sqlite3 -> unless -readonly; tar/unzip -> extraction dir;
  python/node/ruby/perl code (-c, heredoc, here-string, script file) -> the literal target of a mutation call (python is parsed with ast,
  constants propagate through simple assignments, sys.argv and env values the command itself supplies).
A target that is NOT a literal (computed, unset variable, exec/base64 built at run time) is never guessed at: it is let through, and the
guard's tamper snapshot (guard.py) catches the result. Pure stdlib, no I/O besides reading script files named in the command."""
import ast, base64, binascii, fnmatch, glob, os, re, shlex

MAX_DEPTH = 4
SCRIPT_MAX = 262144
KEYWORDS = {'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'time', 'command', 'builtin', 'exec', 'nohup', 'sudo', 'done', 'fi', 'esac', 'in', 'function', 'coproc'}
INTERP = re.compile(r'^(?:python(?:\d+(?:\.\d+)*)?|pypy3?|node|nodejs|ruby|perl)$')
SHELLS = {'bash', 'sh', 'zsh', 'dash', 'ksh'}
D = ''   # a literal dollar (single-quoted or escaped)
DYN = ''  # a command substitution / unresolvable expansion
STAFFING_OK = ('start', 'status', 'retire', 'add-plan', 'from-census', '--selftest')


# ------------------------------------------------------------------ shell lexer
class _Cmd:
    __slots__ = ('words', 'redirs', 'heredocs', 'herestr', 'assigns')

    def __init__(s):
        s.words, s.redirs, s.heredocs, s.herestr, s.assigns = [], [], [], [], {}


def _match_paren(s, i):
    """s[i] is the char after '$(' ; index of the matching ')' (quote aware, nested), or len(s)."""
    depth, q = 1, None
    while i < len(s):
        c = s[i]
        if q:
            if c == '\\' and q == '"':
                i += 1
            elif c == q:
                q = None
        elif c in '\'"':
            q = c
        elif c == '\\':
            i += 1
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(s)


def lex(src):
    """-> (commands, substitutions): commands is a list of _Cmd; substitutions is a list of shell texts found inside $(..), `..`, <(..)."""
    cmds, subs = [], []
    n, i = len(src), 0
    cur = _Cmd()
    buf, has, quoted = [], False, False
    redir = None            # 'w' | 'r' | 'here' | 'herestr'  : what the NEXT word is
    hd_pending = []         # (cmd, delimiter, strip_tabs)

    def word_done():
        nonlocal buf, has, quoted, redir
        if not has:
            return
        w = ''.join(buf)
        buf, has, quoted = [], False, False
        if redir == 'w':
            cur.redirs.append(w)
        elif redir == 'here':
            hd_pending.append((cur, w, hd_strip[0]))
        elif redir == 'herestr':
            cur.herestr.append(w)
        elif redir == 'r':
            pass
        else:
            cur.words.append(w)
        redir = None

    hd_strip = [False]

    def end_cmd():
        nonlocal cur
        word_done()
        if cur.words or cur.redirs or cur.heredocs or cur.herestr or cur.assigns:
            cmds.append(cur)
        cur = _Cmd()

    while i < n:
        c = src[i]
        if c == '\\':
            if i + 1 < n:
                if src[i + 1] == '\n':
                    i += 2
                    continue
                buf.append(D if src[i + 1] == '$' else src[i + 1]); has = True; quoted = True
                i += 2
                continue
            i += 1
            continue
        if c == "'":
            j = src.find("'", i + 1)
            j = n if j < 0 else j
            buf.append(src[i + 1:j].replace('$', D)); has = True; quoted = True
            i = j + 1
            continue
        if c == '"':
            has = True; quoted = True
            i += 1
            while i < n and src[i] != '"':
                d = src[i]
                if d == '\\' and i + 1 < n:
                    nx = src[i + 1]
                    buf.append(D if nx == '$' else (nx if nx in '"\\`' else '\\' + nx))
                    i += 2
                    continue
                if d == '$' and src[i + 1:i + 2] == '(':
                    j = _match_paren(src, i + 2)
                    subs.append(src[i + 2:j]); buf.append(DYN)
                    i = j + 1
                    continue
                if d == '`':
                    j = src.find('`', i + 1)
                    j = n if j < 0 else j
                    subs.append(src[i + 1:j]); buf.append(DYN)
                    i = j + 1
                    continue
                buf.append(d)
                i += 1
            i += 1
            continue
        if c == '$' and src[i + 1:i + 2] == '(':
            j = _match_paren(src, i + 2)
            subs.append(src[i + 2:j]); buf.append(DYN); has = True
            i = j + 1
            continue
        if c == '`':
            j = src.find('`', i + 1)
            j = n if j < 0 else j
            subs.append(src[i + 1:j]); buf.append(DYN); has = True
            i = j + 1
            continue
        if c in '<>' and src[i + 1:i + 2] == '(':
            j = _match_paren(src, i + 2)
            subs.append(src[i + 2:j]); buf.append(DYN); has = True
            i = j + 1
            continue
        if c == '#' and not has:
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if c in ' \t\r':
            word_done()
            i += 1
            continue
        if c == '\n':
            end_cmd()
            i += 1
            while hd_pending:
                owner, delim, strip = hd_pending.pop(0)
                d = delim.replace(D, '$')
                body = []
                while i < n:
                    j = src.find('\n', i)
                    line = src[i:] if j < 0 else src[i:j]
                    i = n if j < 0 else j + 1
                    if (line.lstrip('\t') if strip else line) == d:
                        break
                    body.append(line)
                owner.heredocs.append('\n'.join(body))
            continue
        if c in ';()' or (c == '|' ) or (c == '&' and src[i + 1:i + 2] != '>'):
            if c == '&' and i + 1 < n and src[i + 1] == '&':
                i += 1
            elif c == '|' and i + 1 < n and src[i + 1] in '|&':
                i += 1
            end_cmd()
            i += 1
            continue
        if c == '&' and src[i + 1:i + 2] == '>':  # &> and &>>
            word_done()
            i += 2
            if src[i:i + 1] == '>':
                i += 1
            redir = 'w'
            continue
        if c in '<>':
            if has and not quoted and ''.join(buf).isdigit():
                buf, has = [], False  # a file-descriptor prefix: 2>file
            else:
                word_done()
            op = c
            i += 1
            if c == '>' and src[i:i + 1] in ('>', '|'):
                i += 1
            elif c == '<' and src[i:i + 1] == '<':
                i += 1
                if src[i:i + 1] == '<':
                    i += 1
                    redir = 'herestr'
                    continue
                hd_strip[0] = src[i:i + 1] == '-'
                if hd_strip[0]:
                    i += 1
                redir = 'here'
                continue
            elif src[i:i + 1] == '&':
                m = re.compile(r'&(\d+|-)').match(src, i)
                if m:
                    i = m.end()
                    continue  # fd duplication: no file
                i += 1
            elif c == '<' and src[i:i + 1] == '>':
                i += 1
                op = '<>'
            redir = 'r' if op == '<' else 'w'
            continue
        buf.append(c); has = True
        i += 1
    end_cmd()
    for owner, delim, strip in hd_pending:  # heredoc whose body never started (no newline after): empty
        owner.heredocs.append('')
    # prefix assignments / keywords
    for k in cmds:
        _normalise(k)
    return cmds, subs


def _normalise(k):
    """Strip leading keywords/wrappers and NAME=value prefixes off k.words (prefix assignments go to k.assigns)."""
    w = k.words
    while w:
        if w[0] == 'env':
            w.pop(0)
            while w and (w[0].startswith('-') or re.match(r'^[A-Za-z_]\w*=', w[0])):
                x = w.pop(0)
                if '=' in x and not x.startswith('-'):
                    k.assigns[x.split('=', 1)[0]] = x.split('=', 1)[1]
        elif w[0] in ('nice', 'ionice', 'timeout', 'stdbuf'):
            w.pop(0)
            while w and (w[0].startswith('-') or re.fullmatch(r'[\d.]+[smhd]?', w[0])):
                w.pop(0)
        elif w[0] in KEYWORDS:
            w.pop(0)
        else:
            m = re.match(r'^([A-Za-z_]\w*)=(.*)$', w[0], re.S)
            if not m:
                break
            k.assigns[m.group(1)] = m.group(2)
            w.pop(0)


# ------------------------------------------------------------------ expansion
class Ctx:
    def __init__(s, cwd, gov, env, depth=0, holder=None):
        s.cwd, s.gov, s.env, s.depth = cwd, gov, dict(env or {}), depth
        s.aliases = {}   # a link this command creates: real(link) -> real(target); a later write through the link is a write to the target
        s.vars = {}      # shell variables the command assigned: name -> [values] | None (unknown)
        s._h = holder if holder is not None else [None]   # the first hit, shared with every child context

    hit = property(lambda s: s._h[0], lambda s, v: s._h.__setitem__(0, v))

    def child(s, cwd=None):
        c = Ctx(cwd or s.cwd, s.gov, s.env, s.depth + 1, s._h)
        c.vars = dict(s.vars)
        c.aliases = dict(s.aliases)
        return c


def _lookup(ctx, name):
    if name in ctx.vars:
        return ctx.vars[name]
    if name == 'HOME':
        return [os.path.expanduser('~')]
    if name == 'PWD':
        return [ctx.cwd]
    v = ctx.env.get(name)
    return [v] if isinstance(v, str) else None


_VAR = re.compile(r'\$(?:\{([A-Za-z_]\w*)(?:[:#%/^,@!+-][^}]*)?\}|([A-Za-z_]\w*))')


def expand(tok, ctx):
    """A word -> list of candidate strings, or None when it is not a literal (command substitution, unset variable)."""
    if DYN in tok:
        return None
    outs = [tok]
    pos = 0
    while True:
        m = None
        for cand in outs[:1]:
            m = _VAR.search(cand)
        if not m:
            break
        vals = _lookup(ctx, m.group(1) or m.group(2))
        if not vals:
            return None
        new = []
        for cand in outs:
            mm = _VAR.search(cand)
            if not mm:
                new.append(cand)
                continue
            for v in vals:
                new.append(cand[:mm.start()] + v.replace('$', D) + cand[mm.end():])
        outs = new[:24]
        pos += 1
        if pos > 12:
            return None
    res = []
    for o in outs:
        if o.startswith('~'):
            o = os.path.expanduser(o)
        res.append(o.replace(D, '$'))
    return res


def _globs(cands):
    out = []
    for c in cands:
        if any(ch in c for ch in '*?['):
            try:
                m = glob.glob(c)[:200]
            except Exception:
                m = []
            out += m or [c]
        else:
            out.append(c)
    return out


def _real(p, cwd):
    try:
        return os.path.realpath(os.path.join(cwd, os.path.expanduser(p))).lower()
    except (OSError, ValueError):
        return None


def _gov(ctx, p, destructive=False):
    if not isinstance(p, str) or not p:
        return None
    rp = _real(p, ctx.cwd)
    return ctx.gov(ctx.aliases.get(rp, rp), destructive) if rp else None


def _flag(ctx, label_kind, cands, destructive=False, why=''):
    for p in _globs(cands or []):
        g = _gov(ctx, p, destructive)
        if g and ctx.hit is None:
            ctx.hit = (g, '%s %s' % (why or label_kind, p))
    return ctx.hit is not None


# ------------------------------------------------------------------ operands
_OPT_ARG = {
    'cp': {'-t', '--target-directory', '-S', '--suffix'}, 'mv': {'-t', '--target-directory', '-S', '--suffix'},
    'install': {'-m', '--mode', '-o', '--owner', '-g', '--group', '-t', '--target-directory', '-S', '--suffix', '-B'},
    'ln': {'-t', '--target-directory', '-S', '--suffix'},
    'rsync': {'-e', '--rsh', '-f', '--filter', '--exclude', '--exclude-from', '--include', '--include-from', '--files-from', '--log-file', '-B', '--timeout', '--chmod', '--chown', '--link-dest', '--backup-dir', '--partial-dir', '-T', '--temp-dir', '--compare-dest', '--copy-dest', '--port', '--bwlimit', '--max-size', '--min-size', '--suffix', '--rsync-path'},
    'ditto': {'--arch'}, 'touch': {'-t', '-d', '-r', '--date', '--reference'}, 'truncate': {'-s', '-r', '--size', '--reference'},
    'rm': set(), 'rmdir': set(), 'tee': set(), 'chmod': {'--reference'}, 'chown': {'--reference'}, 'sed': {'-e', '-f', '--expression', '--file', '-l', '--line-length'},
    'patch': {'-p', '-d', '-i', '-o', '-r', '-F', '-B', '-V'},
}


def _operands(words, takes=()):
    """(operands, option-values) of a simple command's argument words: options dropped, `--` ends options."""
    ops, vals, i, end = [], {}, 0, False
    while i < len(words):
        w = words[i]
        if not end and w == '--':
            end = True
        elif not end and w.startswith('-') and len(w) > 1:
            if '=' in w and w.startswith('--'):
                vals.setdefault(w.split('=', 1)[0], []).append(w.split('=', 1)[1])
            elif w in takes and i + 1 < len(words):
                vals.setdefault(w, []).append(words[i + 1]); i += 1
            elif len(w) > 2 and not w.startswith('--') and w[:2] in takes:
                vals.setdefault(w[:2], []).append(w[2:])
        else:
            ops.append(w)
        i += 1
    return ops, vals


def _expand_all(ws, ctx):
    out = []
    for w in ws:
        e = expand(w, ctx)
        out.append(e)
    return out


def _pick(lst):
    return lst[0] if lst else None


def _walk(top, cap=3000):
    out = []
    for root, dirs, files in os.walk(top):
        for n in dirs + files:
            out.append(os.path.relpath(os.path.join(root, n), top))
            if len(out) >= cap:
                return out
    return out


def _dest_effective(dest_cands, src_words, ctx):
    """Every path a copy/move of src_words to dest can create or overwrite: dest, dest/basename(src) when dest is a directory,
    and (a source directory) each entry below it, merged straight into dest for `src/` or a new dest, else under dest/basename."""
    out = []
    for d in dest_cands:
        out.append(d)
        dest_is_dir = d.endswith('/') or os.path.isdir(os.path.join(ctx.cwd, os.path.expanduser(d)))
        for sw in src_words:
            for x in expand(sw, ctx) or []:
                b = os.path.basename(x.rstrip('/'))
                xf = os.path.join(ctx.cwd, os.path.expanduser(x))
                if os.path.isdir(xf):
                    base = d if (x.endswith('/') or not dest_is_dir) else os.path.join(d, b)
                    out.append(base)
                    out += [os.path.join(base, r) for r in _walk(xf)]
                elif dest_is_dir and b:
                    out.append(os.path.join(d, b))
    return out


# ------------------------------------------------------------------ shell command judgement
def _run_shell(src, ctx):
    if ctx.depth > MAX_DEPTH or ctx.hit:
        return
    try:
        cmds, subs = lex(src)
    except Exception:
        return
    for s in subs:
        _run_shell(s, ctx.child())
        if ctx.hit:
            return
    _b64_shell(src, ctx)
    for k in cmds:
        _judge(k, ctx)
        if ctx.hit:
            return


def _b64_shell(src, ctx):
    if 'base64' not in src.lower() and 'b64' not in src.lower():
        return
    for t in re.findall(r'[A-Za-z0-9+/=]{24,}', src):
        txt = _b64_text(t)
        if txt:
            _run_code(txt, ctx.child(), None)
            if not ctx.hit:
                _run_shell(txt, ctx.child())
            if ctx.hit:
                return


def _b64_text(t):
    try:
        raw = base64.b64decode(t + '=' * (-len(t) % 4), validate=False)
        txt = raw.decode('utf-8')
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    return txt if txt.isprintable() or '\n' in txt else None


def _judge(k, ctx):
    if not k.words:  # a bare NAME=value persists; a prefix assignment only reaches the command it prefixes (env_prefix below)
        for key, vals in k.assigns.items():
            ctx.vars[key] = expand(vals, ctx)
    for r in k.redirs:
        c = expand(r, ctx)
        if c:
            if _flag(ctx, 'redirect', c, False, 'redirect into'):
                return
    if not k.words:
        return
    name = os.path.basename(k.words[0])
    args = k.words[1:]
    env_prefix = {}
    for key, v in k.assigns.items():
        e = expand(v, ctx)
        if e:
            env_prefix[key] = e[0]
    if name == 'cd' or name == 'pushd':
        if args:
            e = expand(args[0], ctx)
            if e and e[0] not in ('-',):
                ctx.cwd = os.path.realpath(os.path.join(ctx.cwd, os.path.expanduser(e[0])))
        return
    if name in ('export', 'declare', 'typeset', 'local', 'readonly'):
        for a in args:
            m = re.match(r'^([A-Za-z_]\w*)=(.*)$', a, re.S)
            if m:
                e = expand(m.group(2), ctx)
                ctx.vars[m.group(1)] = e
                if e:
                    ctx.env[m.group(1)] = e[0]
        return
    if name == 'for' and len(args) >= 2 and args[1] == 'in':
        vals = []
        for a in args[2:]:
            e = expand(a, ctx)
            if e is None:
                vals = None
                break
            vals += _globs(e)
        ctx.vars[args[0]] = vals
        return
    if name == 'read':
        for a in args:
            if not a.startswith('-'):
                ctx.vars[a] = None
        return
    if name in ('eval',):
        e = [expand(a, ctx) for a in args]
        if all(x for x in e):
            _run_shell(' '.join(x[0] for x in e), ctx.child())
        return
    if name in ('source', '.'):
        if args:
            _script_file(args[0], ctx, 'sh')
        return
    if name in SHELLS or name in ('env',):
        _shell_invocation(k, name, args, ctx)
        return
    if INTERP.match(name):
        _interpreter(k, name, args, ctx, env_prefix)
        return
    if name == 'staffing.py':
        _staffing(args, ctx)
        return
    h = _HANDLERS.get(name)
    if h:
        h(k, args, ctx)
    elif name == 'git':
        _git(k, args, ctx)
    elif name in ('curl', 'wget'):
        _download(args, ctx)


def _shell_invocation(k, name, args, ctx):
    i = 0
    while i < len(args) and args[i].startswith('-') and args[i] != '--':
        if args[i] == '-c' or (len(args[i]) > 2 and args[i].startswith('-') and args[i].endswith('c') and not args[i].startswith('--')):
            if i + 1 < len(args):
                e = expand(args[i + 1], ctx)
                for x in e or []:
                    _run_shell(x, ctx.child())
            return
        if args[i] in ('-o', '-O'):
            i += 1
        i += 1
    if i < len(args):
        _script_file(args[i], ctx, 'sh')
    elif k.heredocs or k.herestr:
        for t in k.heredocs + k.herestr:
            _run_shell(t, ctx.child())


def _script_file(path, ctx, kind):
    e = expand(path, ctx)
    for p in e or []:
        rp = os.path.realpath(os.path.join(ctx.cwd, os.path.expanduser(p)))
        if os.path.abspath(rp).startswith(os.path.join(os.path.expanduser('~'), '.claude', 'hooks') + os.sep) or ctx.depth > MAX_DEPTH:
            continue
        txt = _read_script(rp)
        if txt is None:
            continue
        if kind == 'sh':
            _run_shell(txt, ctx.child(os.path.dirname(rp)))
        if ctx.hit:
            return


def _read_script(rp):
    try:
        if os.path.isfile(rp) and os.path.getsize(rp) <= SCRIPT_MAX:
            with open(rp, encoding='utf-8', errors='replace') as f:
                return f.read()
    except OSError:
        pass
    return None


# ---- per-verb handlers: each is (cmd, args, ctx) and calls _flag
def _h_copylike(k, args, ctx, move=False, install=False, merge=False):
    name = os.path.basename(k.words[0])
    takes = _OPT_ARG.get(name, set())
    ops, vals = _operands(args, takes)
    tdir = (vals.get('-t') or vals.get('--target-directory') or [None])[-1]
    if install and any(a == '-d' or a == '--directory' for a in args):
        for w in ops:
            _flag(ctx, name, expand(w, ctx), False, name + ' -d')
        return
    if tdir is not None:
        dest_w, srcs = [tdir], ops
    elif len(ops) >= 2:
        dest_w, srcs = [ops[-1]], ops[:-1]
    else:
        return
    if name == 'rsync' and any(a.startswith('--remove-source') or a == '--delete' for a in args):
        for s in srcs:
            _flag(ctx, name, expand(s, ctx), True, 'rsync --remove-source-files from')
    if move:
        for s in srcs:
            if _flag(ctx, name, expand(s, ctx), True, 'mv from'):
                return
    for dw in dest_w:
        dc = expand(dw, ctx)
        if not dc:
            continue
        if _flag(ctx, name, _dest_effective(dc, srcs, ctx), False, name + ' to'):
            return


def _h_cp(k, args, ctx): _h_copylike(k, args, ctx)
def _h_mv(k, args, ctx): _h_copylike(k, args, ctx, move=True)
def _h_install(k, args, ctx): _h_copylike(k, args, ctx, install=True)


def _h_ln(k, args, ctx):
    ops, vals = _operands(args, _OPT_ARG['ln'])
    tdir = (vals.get('-t') or vals.get('--target-directory') or [None])[-1]
    if tdir:
        _flag(ctx, 'ln', _dest_effective(expand(tdir, ctx) or [], ops, ctx), False, 'ln into')
    elif len(ops) >= 2:
        _flag(ctx, 'ln', _dest_effective(expand(ops[-1], ctx) or [], ops[:-1], ctx), False, 'ln to')
        for d_ in expand(ops[-1], ctx) or []:
            for s_ in expand(ops[0], ctx) or []:
                rd, rs = _real(d_, ctx.cwd), _real(s_, ctx.cwd)
                if rd and rs:
                    ctx.aliases[rd] = rs
    elif len(ops) == 1:
        for x in expand(ops[0], ctx) or []:
            _flag(ctx, 'ln', [os.path.basename(x.rstrip('/'))], False, 'ln link named')


def _h_destroy(k, args, ctx):
    ops, _ = _operands(args, _OPT_ARG.get(os.path.basename(k.words[0]), set()))
    for w in ops:
        if _flag(ctx, 'rm', expand(w, ctx), True, os.path.basename(k.words[0]) + ' of'):
            return


def _h_write_ops(k, args, ctx):  # truncate touch tee shred
    ops, _ = _operands(args, _OPT_ARG.get(os.path.basename(k.words[0]), set()))
    for w in ops:
        if _flag(ctx, 'write', expand(w, ctx), False, os.path.basename(k.words[0]) + ' on'):
            return


def _h_chmod(k, args, ctx):
    ops, _ = _operands(args, _OPT_ARG.get('chmod', set()))
    for w in ops[1:]:
        if _flag(ctx, 'write', expand(w, ctx), False, os.path.basename(k.words[0]) + ' on'):
            return


def _h_dd(k, args, ctx):
    for a in args:
        if a.startswith('of='):
            _flag(ctx, 'dd', expand(a[3:], ctx), False, 'dd of=')


_INPLACE = re.compile(r'^-[a-zA-Z]*i[^\s=]*$|^--in-place(?:=.*)?$')


def _h_sed(k, args, ctx):
    if not any(_INPLACE.match(a) for a in args):
        return
    ops, vals = _operands(args, _OPT_ARG['sed'])
    ops = [o for o in ops if o]
    has_script = any(a in ('-e', '-f', '--expression', '--file') or a.startswith('--expression') for a in args)
    files = ops if has_script else ops[1:]
    for w in files:
        if w and _flag(ctx, 'sed -i', expand(w, ctx), False, 'sed -i on'):
            return


def _h_find(k, args, ctx):
    starts = []
    for a in args:
        if a.startswith('-') and a not in ('-H', '-L', '-P', '-E', '-X', '-x', '-s', '-d') or a in ('(', '!', ')'):
            break
        if a in ('-H', '-L', '-P', '-E', '-X', '-x', '-s', '-d'):
            continue
        starts.append(a)
    names = [args[i + 1] for i, a in enumerate(args) if a in ('-name', '-iname') and i + 1 < len(args)]
    deleting = '-delete' in args
    for i, a in enumerate(args):
        if a in ('-exec', '-execdir', '-ok') and i + 1 < len(args) and os.path.basename(args[i + 1]) in ('rm', 'rmdir', 'unlink', 'shred', 'truncate', 'mv'):
            deleting = True
    if deleting:  # what find removes is decided by its filters: judge the entries it would match (a bounded walk), not the start directory
        for w in starts:
            for top in expand(w, ctx) or []:
                full = os.path.join(ctx.cwd, os.path.expanduser(top))
                if not os.path.exists(full):
                    continue
                cands = [full]
                n = 0
                for root, dirs, files in os.walk(full):
                    for nm in dirs + files:
                        if not names or any(fnmatch.fnmatch(nm.lower(), p.lower()) for p in names):
                            cands.append(os.path.join(root, nm))
                        n += 1
                    if n > 6000:
                        break
                if names:
                    cands = cands[1:]
                for c in cands:
                    g = _gov(ctx, c, False)
                    if g and ctx.hit is None:
                        ctx.hit = (g, 'find -delete/-exec removes ' + c)
                        return
    for i, a in enumerate(args):
        if a in ('-fprint', '-fprint0', '-fprintf', '-fls') and i + 1 < len(args):
            if _flag(ctx, 'find', expand(args[i + 1], ctx), False, 'find ' + a):
                return


def _h_sqlite3(k, args, ctx):
    ro = any(a in ('-readonly', '--readonly') for a in args)
    if ro:
        return
    ops = [a for a in args if not a.startswith('-')]
    if ops:
        for p in expand(ops[0], ctx) or []:
            q = p
            if q.startswith('file:'):
                q = q[5:].split('?')[0]
                if 'mode=ro' in p or 'immutable=1' in p:
                    continue
            if _flag(ctx, 'sqlite3', [q], False, 'sqlite3 (not -readonly) on'):
                return
    for a in [x for x in args if not x.startswith('-') and x != (ops[0] if ops else None)]:  # SQL / dot-commands naming a governed path (ATTACH, .restore)
        for e in expand(a, ctx) or []:
            for t in re.findall(r"""[^\s'"`,;()<>|&=]+""", e):
                if ('/' in t or t.startswith('~')) and _gov(ctx, t, False):
                    ctx.hit = ctx.hit or (_gov(ctx, t, False), 'sqlite3 statement names ' + t)
                    return


def _h_tar(k, args, ctx):
    opts = [a for a in args if a.startswith('-') and not a.startswith('--')]
    first = args[0] if args else ''
    extract = any('x' in o[1:] for o in opts[:3]) or any(a in ('--extract', '--get') for a in args) or (first and not first.startswith('-') and 'x' in first and re.fullmatch(r'[A-Za-z]+', first))
    if not extract:
        return
    d = None
    for i, a in enumerate(args):
        if a in ('-C', '--directory') and i + 1 < len(args):
            d = args[i + 1]
        elif a.startswith('--directory='):
            d = a.split('=', 1)[1]
    _flag(ctx, 'tar', expand(d, ctx) if d else [ctx.cwd], False, 'tar x into')


def _h_unzip(k, args, ctx):
    d = None
    for i, a in enumerate(args):
        if a == '-d' and i + 1 < len(args):
            d = args[i + 1]
    if '-l' in args or '-t' in args or '-p' in args or '-v' in args:
        return
    _flag(ctx, 'unzip', expand(d, ctx) if d else [ctx.cwd], False, 'unzip into')


def _h_patch(k, args, ctx):
    ops, _ = _operands(args, _OPT_ARG['patch'])
    for w in ops:
        _flag(ctx, 'patch', expand(w, ctx), False, 'patch of')


def _download(args, ctx):
    for i, a in enumerate(args):
        if a in ('-o', '-O', '--output', '--output-document') and i + 1 < len(args):
            _flag(ctx, 'download', expand(args[i + 1], ctx), False, 'download to')


def _git(k, args, ctx):
    i, cwd = 0, ctx.cwd
    while i < len(args) and args[i].startswith('-'):
        if args[i] == '-C' and i + 1 < len(args):
            e = expand(args[i + 1], ctx)
            if e:
                cwd = os.path.realpath(os.path.join(ctx.cwd, os.path.expanduser(e[0])))
            i += 1
        elif args[i] in ('-c', '--git-dir', '--work-tree') and i + 1 < len(args):
            i += 1
        i += 1
    if i >= len(args):
        return
    sub, rest = args[i], args[i + 1:]
    sub_ctx = ctx
    if cwd != ctx.cwd:
        sub_ctx = ctx.child(cwd)
    if sub in ('checkout', 'restore', 'switch'):
        ops = [a for a in rest if not a.startswith('-')]
        for w in ops:
            if _flag(sub_ctx, 'git', expand(w, sub_ctx), False, 'git %s of' % sub):
                break
    elif sub in ('rm', 'mv'):
        ops = [a for a in rest if not a.startswith('-')]
        for w in ops:
            if _flag(sub_ctx, 'git', expand(w, sub_ctx), True, 'git %s of' % sub):
                break
    ctx.hit = ctx.hit or sub_ctx.hit


def _staffing(args, ctx):
    verb = next((a for a in args if not a.startswith('-') or a == '--selftest'), None)
    if verb not in STAFFING_OK:
        ctx.hit = ('staffing', 'staffing.py %s (only start|status|retire|add-plan|from-census are allowed to a governed session)' % (verb or '<none>'))
    elif verb == 'from-census':  # read the census, write only --out: --out must not be governed material
        for i, w in enumerate(args[:-1]):
            if w == '--out' and _flag(ctx, 'staffing', expand(args[i + 1], ctx), False, 'staffing.py from-census --out'):
                return


_HANDLERS = {'cp': _h_cp, 'mv': _h_mv, 'install': _h_install, 'rsync': _h_cp, 'ditto': _h_cp, 'ln': _h_ln, 'rm': _h_destroy, 'rmdir': _h_destroy,
             'unlink': _h_destroy, 'shred': _h_destroy, 'truncate': _h_write_ops, 'touch': _h_write_ops, 'tee': _h_write_ops, 'chmod': _h_chmod,
             'chown': _h_chmod, 'chgrp': _h_chmod, 'chflags': _h_chmod, 'dd': _h_dd, 'sed': _h_sed, 'find': _h_find, 'sqlite3': _h_sqlite3,
             'tar': _h_tar, 'unzip': _h_unzip, 'patch': _h_patch}


# ------------------------------------------------------------------ interpreters
def _interpreter(k, name, args, ctx, env_prefix):
    kind = 'py' if name.startswith(('python', 'pypy')) else 'js' if name.startswith('node') else 'rb' if name == 'ruby' else 'pl'
    code, script, rest, inplace, stdin_dash, module = [], None, [], False, False, False
    i = 0
    while i < len(args):
        a = args[i]
        if script is not None or stdin_dash or module:
            rest.append(a); i += 1; continue
        if a == '--':
            i += 1
            continue
        if a == '-':
            stdin_dash = True; i += 1; continue
        if kind == 'py' and a == '-m':
            module = True; i += 2 if i + 1 < len(args) else 1; rest = args[i:]; break
        if kind == 'py' and (a == '-c' or (a.startswith('-') and not a.startswith('--') and a.endswith('c') and len(a) <= 4 and a[1:-1].isalpha())):
            if i + 1 < len(args):
                code.append(('code', args[i + 1])); rest = args[i + 2:]
            break
        if kind == 'py' and a in ('-W', '-X', '-Q', '-Wd'):
            i += 2; continue
        if kind == 'js' and a in ('-e', '--eval', '-p', '--print', '-pe'):
            if i + 1 < len(args):
                code.append(('code', args[i + 1]))
            i += 2; continue
        if kind == 'js' and a in ('-r', '--require', '--import', '--loader'):
            i += 2; continue
        if kind in ('rb', 'pl') and re.fullmatch(r'-[A-Za-z0-9]*[eE]', a):
            if i + 1 < len(args):
                code.append(('code', args[i + 1]))
            if 'i' in a[1:-1]:
                inplace = True
            i += 2; continue
        if kind in ('rb', 'pl') and re.match(r'^-[A-Za-z0-9]*i', a):
            inplace = True; i += 1; continue
        if a.startswith('-'):
            i += 1; continue
        script = a; rest = args[i + 1:]
        break
    if module:
        return
    if code and script is not None:  # -e CODE file...: the first operand is a data file, not a script
        rest, script = [script] + rest, None
    if kind in ('rb', 'pl') and inplace:
        for w in rest:
            if w and _flag(ctx, 'in-place', expand(w, ctx), False, '%s -i on' % name):
                return
    # staffing.py as the script: judged by verb
    if script is not None:
        sc = expand(script, ctx) or []
        if any(os.path.basename(x) == 'staffing.py' for x in sc):
            _staffing(rest, ctx)
            return
    argv0 = '-c' if code else (script or '-')
    argv = [argv0]
    for w in rest:
        e = expand(w, ctx)
        argv.append(e[0] if e else None)
    pyctx = ctx.child()
    pyctx.env.update(env_prefix)
    texts = []
    if code:
        texts += [t for _, t in code if True]
        # code strings are words, expanded like any word
        texts = [x for t in texts for x in (expand(t, ctx) or [])]
    elif script is not None:
        e = expand(script, ctx) or []
        for p in e:
            rp = os.path.realpath(os.path.join(ctx.cwd, os.path.expanduser(p)))
            if os.path.abspath(rp).startswith(os.path.join(os.path.expanduser('~'), '.claude', 'hooks') + os.sep):
                continue
            t = _read_script(rp)
            if t is not None:
                texts.append(t)
                pyctx.cwd = ctx.cwd
    else:
        texts += k.heredocs + [h for h in k.herestr]
        texts = [x.replace(D, '$') for x in texts]
    for t in texts:
        _run_code(t, pyctx, argv if kind == 'py' else None, kind)
        if pyctx.hit:
            ctx.hit = pyctx.hit
            return


def _run_code(text, ctx, argv, kind='py'):
    if ctx.depth > MAX_DEPTH or ctx.hit:
        return
    if kind == 'py':
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError, MemoryError, RecursionError):
            tree = None
        if tree is not None:
            _PyScan(tree, ctx, argv).run()
            return
    _rx_code(text, ctx)


_RX_CALL = re.compile(r'\b(?P<fn>writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rmdirSync|rm|renameSync|rename|copyFileSync|copyFile|cpSync|cp|truncateSync|truncate|createWriteStream|File\.write|File\.delete|File\.rename|File\.open|FileUtils\.\w+|open|unlink|rename|system|exec|execSync|spawnSync|spawn)\s*\(')
_RX_STR = re.compile(r"""(['"`])((?:\\.|(?!\1).)*)\1""", re.S)


def _rx_code(text, ctx):
    for m in _RX_CALL.finditer(text):
        j, depth, q = m.end(), 1, None
        while j < len(text) and depth:
            c = text[j]
            if q:
                if c == '\\':
                    j += 1
                elif c == q:
                    q = None
            elif c in '\'"`':
                q = c
            elif c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            j += 1
        seg = text[m.end():j - 1]
        lits = [x[1] for x in _RX_STR.findall(seg)]
        fn = m.group('fn')
        if fn in ('system', 'exec', 'execSync', 'spawnSync', 'spawn') and lits:
            _run_shell(' '.join(lits), ctx.child())
        elif fn in ('open', 'File.open'):
            if len(lits) >= 2 and re.search(r'[wa+]', lits[1]):
                _flag(ctx, 'code', [lits[0]], False, fn + ' write of')
        elif fn in ('copyFileSync', 'copyFile', 'cpSync', 'cp') or fn.startswith('FileUtils'):
            _flag(ctx, 'code', lits[1:], False, fn + ' to')
        elif fn in ('renameSync', 'rename', 'File.rename'):
            _flag(ctx, 'code', lits[:1], True, fn + ' from') or _flag(ctx, 'code', lits[1:2], False, fn + ' to')
        elif fn in ('unlinkSync', 'unlink', 'rmSync', 'rmdirSync', 'rm', 'File.delete'):
            _flag(ctx, 'code', lits[:1], True, fn + ' of')
        else:
            _flag(ctx, 'code', lits[:1], False, fn + ' on')
        if ctx.hit:
            return


# ---- python AST scan
_UNCONDITIONAL = {'cmd_cancel', 'cmd_clear_tamper', 'clear_tamper'}
_DESTROY1 = {'os.remove', 'os.unlink', 'os.rmdir', 'os.removedirs', 'shutil.rmtree', 'os.truncate'}
_WRITE1 = {'os.chmod', 'os.chown', 'os.utime', 'os.lchown', 'os.chflags', 'os.mkdir', 'os.makedirs', 'os.mkfifo', 'os.mknod', 'shutil.make_archive'}
_MOVE2 = {'os.rename', 'os.replace', 'os.renames', 'shutil.move'}
_DST2 = {'os.link', 'os.symlink', 'shutil.copy', 'shutil.copy2', 'shutil.copyfile', 'shutil.copytree', 'shutil.copymode', 'shutil.copystat', 'shutil.unpack_archive'}
_OPENERS = {'open', 'io.open', 'builtins.open', 'codecs.open', 'gzip.open', 'bz2.open', 'lzma.open', 'zipfile.ZipFile', 'ZipFile', 'tarfile.open', 'tarfile.TarFile', 'TarFile', 'gzip.GzipFile', 'bz2.BZ2File'}
_SUBPROC = {'os.system', 'os.popen', 'subprocess.run', 'subprocess.call', 'subprocess.check_call', 'subprocess.check_output', 'subprocess.Popen', 'subprocess.getoutput', 'subprocess.getstatusoutput'}
_PATH_METHODS = {'write_text': 'w', 'write_bytes': 'w', 'unlink': 'd', 'rmdir': 'd', 'touch': 'w', 'chmod': 'w', 'symlink_to': 'w', 'hardlink_to': 'w', 'mkdir': 'w'}
_B64 = {'b64decode', 'urlsafe_b64decode', 'b32decode', 'a85decode', 'b85decode'}


def _dn(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        b = _dn(node.value)
        return (b + '.' + node.attr) if b else node.attr
    return None


class _PyScan:
    def __init__(s, tree, ctx, argv):
        s.tree, s.ctx, s.argv = tree, ctx, argv or []
        s.env = {}

    # -- literal evaluation: a list of candidate strings or None
    def lit(s, n, depth=0):
        if depth > 8:
            return None
        L = lambda x: s.lit(x, depth + 1)
        if isinstance(n, ast.Constant):
            v = n.value
            if isinstance(v, str):
                return [v]
            if isinstance(v, bytes):
                try:
                    return [v.decode()]
                except UnicodeDecodeError:
                    return None
            return None
        if isinstance(n, ast.Name):
            return s.env.get(n.id)
        if isinstance(n, ast.JoinedStr):
            outs = ['']
            for p in n.values:
                x = L(p.value) if isinstance(p, ast.FormattedValue) else L(p)
                if not x:
                    return None
                outs = [a + b for a in outs for b in x][:16]
            return outs
        if isinstance(n, ast.BinOp):
            if isinstance(n.op, (ast.Add, ast.Div)):
                a, b = L(n.left), L(n.right)
                if a and b:
                    sep = '/' if isinstance(n.op, ast.Div) else ''
                    return [(x.rstrip('/') + sep + y.lstrip('/')) if sep else x + y for x in a for y in b][:16]
                return None
            if isinstance(n.op, ast.Mod):
                f = L(n.left)
                args = n.right.elts if isinstance(n.right, ast.Tuple) else [n.right]
                vs = [L(x) for x in args]
                if f and all(vs):
                    outs = []
                    for fm in f:
                        try:
                            outs.append(fm % tuple(v[0] for v in vs))
                        except (TypeError, ValueError):
                            return None
                    return outs
            return None
        if isinstance(n, ast.IfExp):
            a, b = L(n.body), L(n.orelse)
            return (a or []) + (b or []) if (a or b) and (a is not None and b is not None) else None
        if isinstance(n, ast.BoolOp):
            outs = []
            for v in n.values:
                x = L(v)
                if x is None:
                    return None
                outs += x
            return outs
        if isinstance(n, ast.Subscript):
            d = _dn(n.value)
            sl = n.slice
            if d == 'os.environ' and isinstance(sl, ast.Constant):
                v = s.ctx.env.get(sl.value)
                return [v] if isinstance(v, str) else None
            if d == 'sys.argv' and isinstance(sl, ast.Constant) and isinstance(sl.value, int):
                try:
                    v = s.argv[sl.value]
                except IndexError:
                    return None
                return [v] if isinstance(v, str) else None
            return None
        if isinstance(n, ast.Attribute):
            if n.attr in ('parent',):
                v = L(n.value)
                return [os.path.dirname(x.rstrip('/')) for x in v] if v else None
            if n.attr in ('name',):
                v = L(n.value)
                return [os.path.basename(x.rstrip('/')) for x in v] if v else None
            return None
        if isinstance(n, ast.Call):
            d = _dn(n.func) or ''
            tail = d.rsplit('.', 1)[-1]
            args = n.args
            if d in ('os.path.join',):
                parts = [L(a) for a in args]
                if parts and all(parts):
                    outs = ['']
                    for p in parts:
                        outs = [os.path.join(o, x) if o else x for o in outs for x in p][:16]
                    return outs
                return None
            if tail in ('Path', 'PurePath', 'PosixPath') or d in ('str', 'os.fspath', 'os.path.expanduser', 'os.path.abspath', 'os.path.realpath', 'os.path.normpath', 'os.path.expandvars'):
                parts = [L(a) for a in args]
                if parts and all(parts):
                    outs = ['']
                    for p in parts:
                        outs = [os.path.join(o, x) if o else x for o in outs for x in p][:16]
                    if d.endswith('expanduser'):
                        outs = [os.path.expanduser(o) for o in outs]
                    return outs
                return None
            if d in ('Path.home', 'pathlib.Path.home', 'os.path.expanduser'):
                return [os.path.expanduser('~')]
            if d in ('os.getcwd', 'Path.cwd', 'pathlib.Path.cwd'):
                return [s.ctx.cwd]
            if d in ('os.path.dirname',) and args:
                v = L(args[0]); return [os.path.dirname(x) for x in v] if v else None
            if d in ('os.path.basename',) and args:
                v = L(args[0]); return [os.path.basename(x) for x in v] if v else None
            if d in ('os.environ.get', 'os.getenv') and args:
                k = L(args[0])
                if k and isinstance(s.ctx.env.get(k[0]), str):
                    return [s.ctx.env[k[0]]]
                return L(args[1]) if len(args) > 1 else None
            if isinstance(n.func, ast.Attribute):
                a = n.func.attr
                if a in ('resolve', 'expanduser', 'absolute', 'as_posix', 'strip', 'rstrip', 'lstrip', 'lower'):
                    v = L(n.func.value)
                    if v and a == 'expanduser':
                        return [os.path.expanduser(x) for x in v]
                    return v if a in ('resolve', 'absolute', 'as_posix', 'expanduser') else None
                if a == 'joinpath':
                    base = L(n.func.value)
                    parts = [L(x) for x in args]
                    if base and all(parts):
                        outs = base
                        for p in parts:
                            outs = [os.path.join(o, x) for o in outs for x in p][:16]
                        return outs
                    return None
                if a == 'format' and isinstance(n.func.value, ast.Constant) and isinstance(n.func.value.value, str):
                    vs = [L(x) for x in args]
                    if all(vs):
                        try:
                            return [n.func.value.value.format(*[v[0] for v in vs])]
                        except (IndexError, KeyError, ValueError):
                            return None
                if a == 'decode' or a == 'encode':
                    return L(n.func.value)
            if tail in _B64 and args:
                v = L(args[0])
                if v:
                    t = _b64_text(v[0])
                    return [t] if t else None
            return None
        return None

    def collect_env(s):
        for _ in range(2):
            for n in ast.walk(s.tree):
                if isinstance(n, ast.Assign):
                    v = s.lit(n.value)
                    for t in n.targets:
                        if isinstance(t, ast.Name):
                            if v is not None:
                                s.env[t.id] = list(dict.fromkeys(s.env.get(t.id, []) + v))[:16] if t.id in s.env else v
                elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.value is not None:
                    v = s.lit(n.value)
                    if v is not None:
                        s.env[n.target.id] = v
                elif isinstance(n, ast.AugAssign) and isinstance(n.target, ast.Name) and isinstance(n.op, ast.Add):
                    v = s.lit(n.value)
                    if v is not None and n.target.id in s.env:
                        s.env[n.target.id] = [a + b for a in s.env[n.target.id] for b in v][:16]
                elif isinstance(n, ast.For) and isinstance(n.target, ast.Name) and isinstance(n.iter, (ast.List, ast.Tuple, ast.Set)):
                    vs = [s.lit(e) for e in n.iter.elts]
                    if vs and all(vs):
                        s.env[n.target.id] = [x for v in vs for x in v][:32]

    def flag(s, cands, destructive, why):
        for c in cands or []:
            g = _gov(s.ctx, c, destructive)
            if g and s.ctx.hit is None:
                s.ctx.hit = (g, '%s %s' % (why, c))

    def mode_write(s, n):
        if n is None:
            return False
        v = s.lit(n)
        if v is None:
            return True  # a mode that is not a literal: cannot be shown read-only
        return any(re.search(r'[wax+]', m.split(':')[0]) for m in v)

    def run(s):
        s.collect_env()
        for n in ast.walk(s.tree):
            if isinstance(n, ast.Call):
                s.call(n)
            if s.ctx.hit:
                return

    def call(s, n):
        d = _dn(n.func) or ''
        tail = d.rsplit('.', 1)[-1]
        a = n.args
        kw = {k.arg: k.value for k in n.keywords if k.arg}
        if tail in _UNCONDITIONAL:
            s.ctx.hit = ('staffing', 'operator-only staffing function ' + tail)
            return
        if d in _OPENERS or (tail == 'open' and d not in ('os.open', 'webbrowser.open')):
            if d in _OPENERS or isinstance(n.func, ast.Name):
                pn = a[0] if a else (kw.get('file') or kw.get('name') or kw.get('filename'))
                tgt = s.lit(pn) if pn is not None else None
                mode = a[1] if len(a) > 1 else kw.get('mode')
            else:  # <path-like>.open(mode)
                tgt = s.lit(n.func.value)
                mode = a[0] if a else kw.get('mode')
            if tgt and mode is not None and s.mode_write(mode):
                s.flag(tgt, False, d + ' for writing:')
            return
        if d == 'os.open' and a:
            txt = ast.dump(a[1]) if len(a) > 1 else ''
            if re.search(r'O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)', txt) or (len(a) > 1 and s.lit(a[1]) is None and not isinstance(a[1], ast.Attribute)):
                s.flag(s.lit(a[0]), False, 'os.open for writing:')
            return
        if d == 'sqlite3.connect' or tail == 'connect' and d.startswith('sqlite3'):
            if a:
                for p in s.lit(a[0]) or []:
                    if 'mode=ro' in p or 'immutable=1' in p:
                        continue
                    q = p[5:].split('?')[0] if p.startswith('file:') else p
                    s.flag([q], False, 'sqlite3.connect (not mode=ro) on')
            return
        if d in _DESTROY1 and a:
            s.flag(s.lit(a[0]), True, d + ' of')
        elif d in _WRITE1 and a:
            s.flag(s.lit(a[0]), False, d + ' on')
        elif d in _MOVE2 and a:
            s.flag(s.lit(a[0]), True, d + ' from')
            if len(a) > 1:
                s.flag(s.lit(a[1]), False, d + ' to')
        elif d in _DST2 and len(a) > 1:
            s.flag(s.lit(a[1]), False, d + ' to')
        elif d in _SUBPROC and a:
            s.subproc(a[0])
        elif tail in _B64 and a:
            v = s.lit(a[0])
            t = _b64_text(v[0]) if v else None
            if t:
                _run_code(t, s.ctx.child(), None)
                if not s.ctx.hit:
                    _run_shell(t, s.ctx.child())
        elif d in ('exec', 'eval') and a:
            v = s.lit(a[0])
            if v:
                for t in v:
                    _run_code(t, s.ctx.child(), s.argv)
        elif isinstance(n.func, ast.Attribute):
            m = n.func.attr
            if m in _PATH_METHODS:
                s.flag(s.lit(n.func.value), _PATH_METHODS[m] == 'd', 'Path.%s on' % m)
            elif m in ('rename', 'replace') and len(a) == 1 and not n.keywords:
                s.flag(s.lit(n.func.value), True, 'Path.%s from' % m)
                s.flag(s.lit(a[0]), False, 'Path.%s to' % m)
        if d == 'fileinput.input' and any(k.arg == 'inplace' for k in n.keywords):
            files = a[0] if a else kw.get('files')
            if files is not None:
                els = files.elts if isinstance(files, (ast.List, ast.Tuple)) else [files]
                for e in els:
                    s.flag(s.lit(e), False, 'fileinput inplace on')

    def subproc(s, arg):
        if isinstance(arg, (ast.List, ast.Tuple)):
            parts = [s.lit(e) for e in arg.elts]
            if parts and all(parts):
                _run_shell(' '.join(shlex.quote(p[0]) for p in parts), s.ctx.child())
            return
        v = s.lit(arg)
        for t in v or []:
            _run_shell(t, s.ctx.child())


def find_hit(cmd, cwd, gov, env=None):
    """(label, why) for the first governed write target in a shell command string, else None. Never raises."""
    try:
        ctx = Ctx(cwd, gov, env if env is not None else os.environ)
        _run_shell(cmd, ctx)
        return ctx.hit
    except RecursionError:
        return None
    except Exception:
        return None
