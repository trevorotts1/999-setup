import json, hashlib

with open("/Users/barret/.openclaw/openclaw.json") as f:
    data = json.load(f)

vals = []
try:
    envvars = data.get("env", {}).get("vars", {})
    for k, v in envvars.items():
        if isinstance(v, str) and ("SECRET" in k.upper() or "TOKEN" in k.upper() or "KEY" in k.upper() or "PASSWORD" in k.upper()):
            vals.append((k, v))
except Exception as e:
    print("ERR", e)

for k, v in vals:
    print(k, "len", len(v), "hash", hashlib.sha256(v.encode()).hexdigest()[:8])
