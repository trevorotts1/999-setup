# Candice Runtime Asset Plan

Status: **IMPLEMENTATION PLAN — SEMANTIC ASSIGNMENTS APPROVAL PENDING**  
Canonical source: `apps/candice-companion/assets/candice/asset-manifest.json`  
Finalization gate: approved crop/derivative register plus passing visual and
animation parity review.

## Loading and memory policy

Keep only the active and next state decoded. The manifest and this plan may be
loaded as metadata; high-resolution PNG pixels are lazy-loaded. Sources remain
read-only. Build runtime derivatives only after the approval gate, and record
the derivative's source ID/hash, dimensions, encoder settings, and output hash.

| Residency class | Assets | Rule |
|---|---|---|
| Metadata only at startup | all 16 manifest entries | IDs, hashes, role/status only; decode no pixels. |
| Active + next | the currently displayed source/approved derivative and likely transition target | Evict on transition completion or memory pressure. |
| On demand | greeting, speaking variants, second-batch poses, source sheet regions | Decode only for a current interaction; never preload merely because available. |
| Never runtime-loaded as authority | `derived/experimental-kie/**` | Quarantined; must not enter production resolution. |

## Canonical asset register and disposition

| Asset ID | SHA-256 | Manifest role / semantic pose | Planned runtime disposition |
|---|---|---|---|
| `01-fullbody-idle` | `a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02` | `body/idle-standing`; standing idle | Candidate full-body idle. **APPROVAL PENDING** crop and derivative. |
| `02-gesture-welcome` | `60f652b0ee82ca19a8dfbfe7d8740dfc9673c4f8f9d783c4fe0371412069efa5` | `body/welcome-wave`; standing welcome wave | Candidate greeting. **APPROVAL PENDING**. |
| `03-mouth-neutral-closed` | `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2` | `face/mouth-neutral-closed`; neutral closed-mouth portrait | Candidate compact idle/neutral base. **APPROVAL PENDING** alignment. |
| `04-mouth-slight-open` | `e311fb3d13e99a20203612f3d4785b2f58da5688628df8aaabb15702073f93aa` | `face/mouth-slight-open`; slightly open portrait | Candidate speaking-small transition. **APPROVAL PENDING** registration test. |
| `05-mouth-medium-open` | `ac52f72aa66cf95c36dc7706e4006421e24b1d14a7fdcdda66f32354d493bc46` | `face/mouth-medium-open`; medium open portrait | Candidate speaking-medium. **APPROVAL PENDING** registration test. |
| `06-mouth-wide-open` | `9f4c28e095e5df0b833f18e941a89de6bf733fb7f8b8359f99cbac6f1653b388` | `face/mouth-wide-open`; wide open portrait | Candidate speaking-wide. **APPROVAL PENDING** registration test. |
| `07-mouth-smile-closed` | `cb4e740ba3401c2ecaae23a6cb2bdde4947f11ac6164653faea15941df6ef1a2` | `face/mouth-smile-closed`; smile closed portrait | Candidate warm/success expression. **APPROVAL PENDING**. |
| `08-mouth-smile-open` | `c47646fd71a4138c51ec9212c69bc9f51aab2c4fa27a18cc382c42ae010bfa6e` | `face/mouth-smile-open`; smile open portrait | Candidate speaking-smile/success expression. **APPROVAL PENDING**. |
| `09-eye-open` | `223a45d9af8107f46d698d3a2b9b630d08351b0ff33bfd2fd400e38bb952ae36` | `face/eye-open`; eyes-open portrait | Candidate eye-open reference; no automatic composite. **APPROVAL PENDING**. |
| `10-presenting-portrait-a` | `71fb00e5875285ef0c1753f94846596dd40e3f3f3ce48ce5e246cda80b55b6cb` | `pose/unresolved`; presenting portrait | No runtime mapping. **APPROVAL PENDING** semantic classification. |
| `11-eye-half-blink` | `ac492c82877a01bbf910f42f7c08fa2365c323f8014b662807b11569c76593a5` | `face/eye-half-blink`; wink or half-blink bust | Candidate blink/wink evidence; verify alpha anomaly on light/dark. **APPROVAL PENDING**. |
| `12-presenting-fullbody-a` | `d8e06375a8bb46adc836b6333abd5d045f9cdf67127eb9954c2605be07bdce61` | `pose/unresolved`; presenting full body | No runtime mapping. **APPROVAL PENDING** semantic classification. |
| `13-multipose-sheet` | `feecbb315903fa017ed6fc8dea4f10d45ca0835d533974185068cf59bb01db13` | `pose/unresolved`; multi-pose sprite sheet | Source sheet only; extract no regions until reviewed. **APPROVAL PENDING**. |
| `14-presenting-twohands` | `febcb3aa558299e40b85618f0682672de1d8a9edbe6f33b3fe7df2e37a3dee06` | `pose/unresolved`; two-hand presenting | No runtime mapping. **APPROVAL PENDING** semantic classification. |
| `15-presenting-standing-a` | `8cb8a8898438849f57a60fb73080f0fcc00e2095636aa3d84132a68279efc33f` | `pose/unresolved`; standing presenting | No runtime mapping. **APPROVAL PENDING** semantic classification. |
| `16-presenting-standing-b` | `ef19b6cf9a1259f5aba672fafe20ec573be25f1e9e2baab2c9c9420ea50216a3` | `pose/unresolved`; standing presenting | No runtime mapping. **APPROVAL PENDING** semantic classification. |

## State-to-source plan

The mappings below are implementation candidates, not approved runtime facts.
Only the manifest's existing `stateMap` is currently authoritative for source
lookup. Do not promote a candidate to `stateMap` or production bundle without
the finalization gate.

| Runtime state | Candidate source(s) | Preparation needed | Loading behavior |
|---|---|---|---|
| Full-body idle | `01-fullbody-idle` | approved fit/crop only | active/next |
| Greeting | `02-gesture-welcome` | approved fit/crop and entry transition | on demand |
| Compact neutral | `03-mouth-neutral-closed` | landmark-aligned compact crop | active/next |
| Speaking | `03-mouth-neutral-closed`, `04-mouth-slight-open`, `05-mouth-medium-open`, `06-mouth-wide-open` | measure face registration; use minimum mouth-region change/crossfade | active/next while TTS speaks |
| Warm confirmation | `07-mouth-smile-closed` or `08-mouth-smile-open` | operator selects expression use | on demand |
| Blink/personality | `09-eye-open`, `11-eye-half-blink` | alpha/registration study; no full-frame flicker | on demand |
| Listening/thinking/presenting | `10-presenting-portrait-a`, `12-presenting-fullbody-a`, `13-multipose-sheet`, `14-presenting-twohands`, `15-presenting-standing-a`, `16-presenting-standing-b` | individual visual inspection, approved semantic mapping, clean extraction if needed | on demand only |

## Build gates

1. Verify source ID/hash against the manifest before derivative work.
2. Record proposed crop bounds and a side-by-side source/derivative capture.
3. Test transparent edges on light and dark backgrounds; test source/derivative
   memory use and transition eviction.
4. Obtain operator approval for the mapping and look.
5. Add the approved derivative to a separate immutable derivative manifest.
6. Run visual and animation parity review before release.

No gate may be satisfied by an environment variable, editable status field, or
generic fallback character.

