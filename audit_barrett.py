import sqlite3, hashlib, json, os, re, sys

def hp(v):
    return hashlib.sha256(v.encode("utf-8")).hexdigest()[:8] if isinstance(v, str) else None

KEYRE = re.compile(r"(api[_-]?key|token|secret|password|apikey|key)", re.I)

def is_keyish_str(v):
    return isinstance(v, str) and len(v) >= 12

def walk(obj, path, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}", out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{path}[{i}]", out)
    elif is_keyish_str(obj):
        p = path.lower()
        if KEYRE.search(p) or obj.startswith(("sk-", "sk_", "ak-")) or obj.startswith("AIza") or obj.startswith("AGNES"):
            out.append((path, hp(obj)))

out = []
db = os.path.expanduser("~/.9router/db/data.sqlite")
if os.path.exists(db):
    conn = sqlite3.connect(db)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    for t in tables:
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(%s)" % t).fetchall()]
            for row in conn.execute("SELECT rowid, * FROM %s" % t).fetchall():
                for c, v in zip(["rowid"] + cols, row):
                    if isinstance(v, str):
                        try:
                            walk(json.loads(v), "%s.%s" % (t, c), out)
                        except Exception:
                            if c.lower() in ("key", "token", "apikey", "api_key", "secret", "password", "data") and is_keyish_str(v):
                                out.append(("%s.%s" % (t, c), hp(v)))
        except Exception as e:
            print("ERR %s: %s" % (t, e), file=sys.stderr)

envs = [
    os.path.expanduser("~/.openclaw/secrets/.env"),
    os.path.expanduser("~/.openclaw/.env"),
    os.path.expanduser("~/.openclaw/service-env/ai.openclaw.gateway.env"),
    os.path.expanduser("~/.openclaw.freshinstall-20260618-102328/service-env/ai.openclaw.gateway.env"),
    os.path.expanduser("~/clawd/secrets/.env"),
    os.path.expanduser("~/projects/command-center/.env"),
    os.path.expanduser("~/migration-staging/clawd/secrets/.env"),
    os.path.expanduser("~/migration-staging/.openclaw/secrets/.env"),
    os.path.expanduser("~/migration-staging/.openclaw/service-env/ai.openclaw.gateway.env"),
    os.path.expanduser("~/.openclaw/config/ghl-mcp-pin.env"),
    os.path.expanduser("~/.openclaw/openmontage-runtime/OpenMontage/.env"),
    os.path.expanduser("~/mcp-servers/ghl-community-mcp/.env"),
]
ENVNAME = re.compile(r"(API|KEY|TOKEN|SECRET|PASSWORD|DEEPSEEK|ANTHROPIC|OPENAI|OPENROUTER|GEMINI|GOOGLE|AGNES|OLLAMA|CLAUDE|GATEWAY|JWT)", re.I)
for p in envs:
    if not os.path.exists(p):
        continue
    try:
        with open(p) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                if is_keyish_str(v) and ENVNAME.search(k):
                    out.append(("env:%s:%s" % (p, k), hp(v)))
    except Exception as e:
        print("ERR %s: %s" % (p, e), file=sys.stderr)

# gateway private files (client 9router material)
for f in ["~/.9router/gateway-key", "~/.9router/jwt-secret", "~/.9router/dashboard-password.private"]:
    p = os.path.expanduser(f)
    if os.path.exists(p):
        try:
            with open(p) as fh:
                v = fh.read().strip()
            if is_keyish_str(v):
                out.append(("file:%s" % p, hp(v)))
        except Exception as e:
            print("ERR %s: %s" % (p, e), file=sys.stderr)

seen = set()
for name, h in out:
    if (name, h) not in seen:
        seen.add((name, h))
        print("%s  %s" % (h, name))
