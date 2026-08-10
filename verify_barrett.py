import hashlib

with open("/Users/barret/.openclaw/secrets/.env") as f:
    for line in f:
        line = line.strip()
        if line.startswith("FLEET_STANDING_GATE_SECRET="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            print("FLEET_STANDING_GATE_SECRET", hashlib.sha256(v.encode()).hexdigest()[:8])
        if line.startswith("RESCUE_RANGERS_WEBHOOK_SECRET="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            print("RESCUE_RANGERS_WEBHOOK_SECRET", hashlib.sha256(v.encode()).hexdigest()[:8])
