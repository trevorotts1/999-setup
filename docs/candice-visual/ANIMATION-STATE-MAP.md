# Candice Animation State Map

Status: **DESIGN MAP — RUNTIME STATE ASSIGNMENTS APPROVAL PENDING**  
Canonical source: `assets/candice/asset-manifest.json`  
Finalization gate: passing `CANDICE-ANIMATION-PARITY-REVIEW`, low-power
capture, and operator approval of each state/source/derivative mapping.

## State machine

`IDLE` is the safe visual fallback only after a release-authorized Candice
runtime asset exists. In the current repair state there is no approved runtime
mapping, so the application must fail closed rather than display a lookalike.

| State | Trigger | Candidate source(s) / SHA-256 | Animation rule | Low-power behavior |
|---|---|---|---|---|
| `IDLE` | app visible and no active interaction | `01-fullbody-idle` — `a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02`; compact candidate `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2` | subtle opacity/position micro-motion only after approval | static approved idle with transparency preserved; no alternate character |
| `GREETING` | first launch or explicit greeting | `02-gesture-welcome` — `60f652b0ee82ca19a8dfbfe7d8740dfc9673c4f8f9d783c4fe0371412069efa5` | one entry/wave sequence, then `IDLE` | show one static approved greeting frame, then idle |
| `LISTENING` | microphone/input capture active | **unresolved** second-batch source: `10-presenting-portrait-a` — `71fb00e5875285ef0c1753f94846596dd40e3f3f3ce48ce5e246cda80b55b6cb`, `12-presenting-fullbody-a` — `d8e06375a8bb46adc836b6333abd5d045f9cdf67127eb9954c2605be07bdce61`, `13-multipose-sheet` — `feecbb315903fa017ed6fc8dea4f10d45ca0835d533974185068cf59bb01db13`, `14-presenting-twohands` — `febcb3aa558299e40b85618f0682672de1d8a9edbe6f33b3fe7df2e37a3dee06`, `15-presenting-standing-a` — `8cb8a8898438849f57a60fb73080f0fcc00e2095636aa3d84132a68279efc33f`, `16-presenting-standing-b` — `ef19b6cf9a1259f5aba672fafe20ec573be25f1e9e2baab2c9c9420ea50216a3` | no mapping until operator selects an actually listening pose | retain prior approved idle; communicate state through non-character UI if needed |
| `SPEAKING` | TTS begins; ends after TTS drain | `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2`; `04-mouth-slight-open` — `e311fb3d13e99a20203612f3d4785b2f58da5688628df8aaabb15702073f93aa`; `05-mouth-medium-open` — `ac52f72aa66cf95c36dc7706e4006421e24b1d14a7fdcdda66f32354d493bc46`; `06-mouth-wide-open` — `9f4c28e095e5df0b833f18e941a89de6bf733fb7f8b8359f99cbac6f1653b388` | TTS timing chooses minimal mouth change; crossfade/region treatment only after alignment QA; never cycle randomly | reduce to a low-rate, approved neutral/open transition; do not play voice with frozen speaking capture |
| `THINKING_PROCESSING` | work starts; ends on result/error | unresolved second-batch source set listed for `LISTENING` | no mapping until semantic review confirms a thinking/focus pose | retain approved idle and lightweight non-character progress signal |
| `SUCCESS_CONFIRMATION` | a user-visible action succeeds | `07-mouth-smile-closed` — `cb4e740ba3401c2ecaae23a6cb2bdde4947f11ac6164653faea15941df6ef1a2`; `08-mouth-smile-open` — `c47646fd71a4138c51ec9212c69bc9f51aab2c4fa27a18cc382c42ae010bfa6e` | brief approved expression, then `IDLE` | static approved smile; no repeated celebratory loop |
| `PROGRESS_COMPANION_IDLE` | reduced companion displayed after interview | `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2`; possible eye reference `09-eye-open` — `223a45d9af8107f46d698d3a2b9b630d08351b0ff33bfd2fd400e38bb952ae36` | small organic character view; preserve alpha and identity | static approved compact crop, no opaque disk/window |
| `PROGRESS_COMPANION_ALERT` | optional actionable event | no source selected | state is disabled until operator approves a source/behavior | use non-character UI indication; never synthesize a different avatar |

## Transition and safety rules

1. Every transition must preserve transparent edges and avoid a visible
   rectangle, flash, crop jump, or identity-changing frame.
2. A transition may only use an approved source/derivative pair; unresolved
   states do not silently select a nearby-looking pose.
3. Audio and `SPEAKING` must be coupled: no voice with a frozen mouth animation
   and no unrelated mouth cycling after audio stops.
4. The active/next residency limit applies to all devices. On memory/CPU
   pressure, reduce frequency and effects before reducing identity or swapping
   art.
5. `13-multipose-sheet` — `feecbb315903fa017ed6fc8dea4f10d45ca0835d533974185068cf59bb01db13`
   may become a source for an extracted state only through the approval gate;
   it is not an atlas to animate directly.

## Review evidence per state

The animation review records: source ID/hash, derivative hash, trigger log,
runtime capture, frame transition capture, light/dark edge check, CPU/memory
measurement, low-power capture, reviewer verdict, and operator approval. A
missing record leaves the state disabled/unapproved.

