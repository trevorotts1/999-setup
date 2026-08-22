# Candice Visual Parity Checklist

Status: **REQUIRED QC TEMPLATE — NO REVIEW HAS PASSED**  
Canonical source: `assets/candice/asset-manifest.json`  
Finalization gate: a signed, dated `CANDICE-VISUAL-PARITY-REVIEW` pack whose
captures and asset hashes satisfy every required row.

## Review-pack rules

For every state, provide a side-by-side pair: **left** is the cited operator
original and **right** is a capture from the actual release-candidate runtime.
Record the runtime build/commit, OS/display scale, asset ID/hash, derivative
hash if any, and reviewer/operator decision. A missing capture, uncertain
identity, or one failed binary row is a FAIL. “Same vibe” is not evidence.

## Required state evidence

| State to capture | Canonical source candidate(s) and SHA-256 | Required binary decisions |
|---|---|---|
| Idle / neutral | `01-fullbody-idle` — `a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02`; `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2` | face parity; hair parity; silhouette/body parity; blue/violet palette parity; alpha/no-box parity; overall likeness |
| Greeting | `02-gesture-welcome` — `60f652b0ee82ca19a8dfbfe7d8740dfc9673c4f8f9d783c4fe0371412069efa5` | face parity; hair parity; gesture parity; silhouette/body parity; palette; alpha/no-box; overall likeness |
| Listening | operator-approved source must be selected from `10-presenting-portrait-a` — `71fb00e5875285ef0c1753f94846596dd40e3f3f3ce48ce5e246cda80b55b6cb`, `12-presenting-fullbody-a` — `d8e06375a8bb46adc836b6333abd5d045f9cdf67127eb9954c2605be07bdce61`, `13-multipose-sheet` — `feecbb315903fa017ed6fc8dea4f10d45ca0835d533974185068cf59bb01db13`, `14-presenting-twohands` — `febcb3aa558299e40b85618f0682672de1d8a9edbe6f33b3fe7df2e37a3dee06`, `15-presenting-standing-a` — `8cb8a8898438849f57a60fb73080f0fcc00e2095636aa3d84132a68279efc33f`, or `16-presenting-standing-b` — `ef19b6cf9a1259f5aba672fafe20ec573be25f1e9e2baab2c9c9420ea50216a3` | selected source approved; face; hair; gesture meaning; silhouette; palette; alpha/no-box; overall likeness |
| Speaking | `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2`; `04-mouth-slight-open` — `e311fb3d13e99a20203612f3d4785b2f58da5688628df8aaabb15702073f93aa`; `05-mouth-medium-open` — `ac52f72aa66cf95c36dc7706e4006421e24b1d14a7fdcdda66f32354d493bc46`; `06-mouth-wide-open` — `9f4c28e095e5df0b833f18e941a89de6bf733fb7f8b8359f99cbac6f1653b388` | face alignment; mouth change credibility; no frame pop; hair; palette; alpha/no-box; overall likeness |
| Thinking / processing | one operator-selected second-batch source from the Listening row, with its listed SHA-256 | selected source approved; state reads as thinking; face; hair; body; palette; alpha/no-box; overall likeness |
| Small progress companion | `03-mouth-neutral-closed` — `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2`, optionally `09-eye-open` — `223a45d9af8107f46d698d3a2b9b630d08351b0ff33bfd2fd400e38bb952ae36` | same Candice at small scale; face recognizable; no opaque circle/box; palette; readable without aliasing; overall likeness |
| Expressive / gesture | `07-mouth-smile-closed` — `cb4e740ba3401c2ecaae23a6cb2bdde4947f11ac6164653faea15941df6ef1a2`; `08-mouth-smile-open` — `c47646fd71a4138c51ec9212c69bc9f51aab2c4fa27a18cc382c42ae010bfa6e`; or approved second-batch source | selected source approved; expression/gesture fits state; identity; palette; alpha/no-box; overall likeness |

## Global binary release checks

- [ ] Every runtime capture names an existing canonical asset ID and matching
      SHA-256; every derivative names its immutable parent ID/hash.
- [ ] No placeholder, generic sci-fi woman, or experimental-KIE image appears
      in the release bundle or capture.
- [ ] Face, hair, body silhouette/proportions, and Black female identity track
      the reference for every required state.
- [ ] Blue/violet holographic treatment tracks the reference without invented
      grading that obscures identity.
- [ ] Native source alpha is preserved; light and dark desktop captures show
      clean edges and no rectangular application box.
- [ ] Runtime captures have no material cropping, aliasing, flicker, or broken
      transition artifact.
- [ ] Placement remains readable and does not materially obstruct terminal work.
- [ ] Constrained-mode capture preserves Candice's identity; it does not swap
      in a different avatar.
- [ ] Operator has signed the selected second-batch role assignments,
      derivatives, and review verdict.

## Verdict

Current verdict: **NOT REVIEWED / NOT APPROVED**.

BAR-10 can become PASS only when every applicable binary row passes and the
operator approval record names the reviewed runtime build. Any missing or FAIL
row keeps BAR-10 and release authority blocked.

