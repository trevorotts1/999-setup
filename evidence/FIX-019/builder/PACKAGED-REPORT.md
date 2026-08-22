# FIX-019 e2e-acceptance report

- Verdict: **BLOCKED**
- Generated: 2026-08-22T20:18:32.700Z
- Repository: 999-setup-audit
- Commit SHA: packaged-suite-run
- Run id: packaged-suite-blocked-1787429912700
- Launcher: node tests/e2e-acceptance/packaged/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| PACKAGED_AUTOMATED | yes | **BLOCKED** | 6 |

## Blocked details

- BLOCKED PACKAGED_AUTOMATED - typed-build-target
- BLOCKED PACKAGED_AUTOMATED - wrong-session
- BLOCKED PACKAGED_AUTOMATED - duplicate
- BLOCKED PACKAGED_AUTOMATED - fallback
- BLOCKED PACKAGED_AUTOMATED - restart
- BLOCKED PACKAGED_AUTOMATED - compact

## Leg details

### PACKAGED_AUTOMATED (BLOCKED)

- [BLOCKED] (required) typed-build-target — packaged-automated: typed-build-target — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) wrong-session — packaged-automated: wrong-session — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) duplicate — packaged-automated: duplicate — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) fallback — packaged-automated: fallback — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) restart — packaged-automated: restart — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) compact — packaged-automated: compact — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun

## Notes

Packaged suite environment gate closed: screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
