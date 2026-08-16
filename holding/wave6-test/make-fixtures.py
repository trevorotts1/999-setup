#!/usr/bin/env python3
"""WF-4C slice 6 fixtures: boss-cron --check ledger scenarios for the Issue 15 wave lock."""
import os

os.makedirs("fixtures", exist_ok=True)
os.makedirs("controls", exist_ok=True)

BASE = """# FIX-LEDGER — 999 master fix execution

CREATED: 2026-08-16

## LOCKED WAVE TABLE (PART 2 — immutable count 6)

| Wave | Issues | Workflows | Dependencies |
|---|---|---|---|
| WAVE 1 | 1, 2 | WF-1A; WF-1B | None |
| WAVE 2 | 3, 4, 5, 11, 12 | WF-2A..2E | Wave 1 |
| WAVE 3 | 6, 7, 8, 9, 10 | WF-3A..3E | Wave 2 |
| WAVE 4 | 13, 14, 15, 17, 18 | WF-4A..4E | Waves 1-3 |
| WAVE 5 | 16, 19, batch merge | WF-5A; WF-5B; WF-5C | Waves 1-4 |
| WAVE 6 | 20 | WF-6A | Wave 5 |

## WAVE 1
- `WAVE 1 DISPATCH 2026-08-16T09:05Z: full PART 2 scripted width — WF-1A + WF-1B. Census before dispatch: 0 live agents.`
- `WAVE 1 CLOSED 2026-08-16T14:00Z`
## WAVE 2
- `WAVE 2 DISPATCH 2026-08-16T14:02Z: full PART 2 scripted width — WF-2A..WF-2E. Census before dispatch: 0 live agents.`
- `WAVE 2 CLOSED 2026-08-16T17:05Z`
## WAVE 3
- `WAVE 3 DISPATCH 2026-08-16T17:07Z: full PART 2 scripted width — WF-3A..WF-3E. Census before dispatch: 0 live agents.`
- `WAVE 3 CLOSED 2026-08-16T20:12Z`
## WAVE 4
- `WAVE 4 DISPATCH 2026-08-16T20:12Z: full PART 2 scripted width — WF-4A..WF-4E (Issues 13, 14, 15, 17, 18). Census before dispatch: 0 live agents.`
## WAVE 5
- `BOSSCYCLE-CLEAN 2026-08-16T20:35:01Z: checks=caps,census,width,wavelock,locktable,claims,beat,stop,scope,kill (baseline)`
"""

# Scenario 1 — CLEAN: waves 0-6 locked, no wave 7 anywhere, clean cycle baseline.
s1 = BASE
open("fixtures/s1-clean.md", "w").write(s1)

# Scenario 2 — UNDOCUMENTED WAVE 6: dispatch + section heading, no NEW-WAVE-6 line.
s2 = BASE + """## WAVE 6
- `WAVE 6 DISPATCH 2026-08-16T21:00Z: WF-6A status-line config. Census before dispatch: 0 live agents.`
- `WAVE 6 CLOSED 2026-08-16T21:30Z`
"""
open("fixtures/s2-undoc-wave6.md", "w").write(s2)

# Scenario 3 — DOCUMENTED WAVE 6: NEW-WAVE-6 dependency line present (growth-only path).
s3 = BASE + """## WAVE 6
- `NEW-WAVE-6 2026-08-16T21:00Z: wave 6 opened on documented dependency — Wave 5's batch merge output (WF-5C) is what WF-6A consumes.`
- `WAVE 6 DISPATCH 2026-08-16T21:00Z: WF-6A status-line config. Census before dispatch: 0 live agents.`
"""
open("fixtures/s3-doc-wave6.md", "w").write(s3)

# Scenario 4 — PROSE CITATION ONLY: "WAVE 7" appears inside a VIOLATION-STOP finding
# (evidence, not an opening) — must NOT be flagged.
s4 = BASE + """- `VIOLATION-STOP 2026-08-16T21:05Z: wave 7 in ledger not in locked table and no NEW-WAVE-7 dependency line: - \`WAVE 7 DISPATCH ...\` — conductor MUST TaskStop the named workstream and re-dispatch from its last clean checkpoint`
"""
open("fixtures/s4-prose-wave7.md", "w").write(s4)

# Controls — known-good/known-bad controls per PART 5.
ctrl_ok = s3  # same as documented-wave-6 scenario: expect exit 0
open("controls/ctrl-known-clean.md", "w").write(ctrl_ok)
ctrl_bad = s2  # same as undocumented: expect exit 2
open("controls/ctrl-known-bad.md", "w").write(ctrl_bad)

print("fixtures written:", os.listdir("fixtures"))
