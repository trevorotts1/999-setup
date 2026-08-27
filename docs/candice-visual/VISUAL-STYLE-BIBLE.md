# Candice Visual Style Bible

Status: **PLANNING AUTHORITY — IDENTITY DIRECTION APPROVAL PENDING**  
Canonical source: `assets/candice/asset-manifest.json`, contract
`candice-operator-originals-v1`  
Finalization gate: operator sign-off on the side-by-side visual review pack
defined in `VISUAL-PARITY-CHECKLIST.md`.

## Non-negotiable authority

The 16 operator originals, not generated lookalikes, are the only authority
for Candice's face, body, hair, blue/violet holographic language, translucent
edges, and gesture family. Each listed source has `approval:
operator-approved` in the manifest; that provenance approval is **not** an
approval of a runtime crop, derived asset, color treatment, or state mapping.

The quarantined `derived/experimental-kie/` set is never visual authority.
Do not substitute a generic hologram, alter Candice's ethnicity or facial
identity, change her hair silhouette, flatten her alpha to black, or place her
inside a visible rectangular application box.

## Reference anchors

| Intent | Canonical asset ID | SHA-256 | What may be learned from it |
|---|---|---|---|
| Full-body idle reference | `01-fullbody-idle` | `a32ed302820b7183ae26ac38693653175601a9304795ab39d01cdaa8251c9b02` | standing silhouette and holographic edge treatment |
| Greeting reference | `02-gesture-welcome` | `60f652b0ee82ca19a8dfbfe7d8740dfc9673c4f8f9d783c4fe0371412069efa5` | welcome/wave gesture family |
| Neutral face reference | `03-mouth-neutral-closed` | `18b58e9fc40f3b39ee61b1cb83ea3bba61aacdf3860fd377012a0f47dbab2bd2` | face, hair, neutral mouth, compact-companion identity |
| Speaking range reference | `04-mouth-slight-open` — `e311fb3d13e99a20203612f3d4785b2f58da5688628df8aaabb15702073f93aa`; `05-mouth-medium-open` — `ac52f72aa66cf95c36dc7706e4006421e24b1d14a7fdcdda66f32354d493bc46`; `06-mouth-wide-open` — `9f4c28e095e5df0b833f18e941a89de6bf733fb7f8b8359f99cbac6f1653b388` | supplied speaking-expression range only |
| Personality reference | `07-mouth-smile-closed` — `cb4e740ba3401c2ecaae23a6cb2bdde4947f11ac6164653faea15941df6ef1a2`; `08-mouth-smile-open` — `c47646fd71a4138c51ec9212c69bc9f51aab2c4fa27a18cc382c42ae010bfa6e`; `11-eye-half-blink` — `ac492c82877a01bbf910f42f7c08fa2365c323f8014b662807b11569c76593a5` | smile and blink/wink expression evidence |
| Second-batch pose authority | `10-presenting-portrait-a`–`16-presenting-standing-b` | see the complete canonical register in `RUNTIME-ASSET-PLAN.md` | source poses only; runtime semantic assignment remains pending |

## Visual rules

| Area | Preserve | Do not break |
|---|---|---|
| Face and identity | The supplied Black female character's face shape, eyes, nose, lips, skin treatment, and recognizable likeness. | Re-face, genericize, cosmetically redesign, or use another person/character. |
| Hair | The source hair silhouette, volume, parting, and style family. | Replace with a materially different silhouette or a stock hologram hairstyle. |
| Silhouette and proportions | The body silhouette and proportions visible in `01-fullbody-idle` and `02-gesture-welcome`. | Stretch, crop destructively, or use a mismatched body. |
| Hologram color | The blue/violet/translucent language visible in the original pixels. | Declare invented hex colors or grade the asset until that language is lost. |
| Glow | Subtle source-consistent glow that preserves face and edge detail. | Bloom that washes out identity, creates opaque halos, or obscures alpha edges. |
| Transparency | Native PNG alpha remains intact through source, derivative, composition, and capture. | Flatten against black/white, add an opaque backing plate, or show a rectangular window. |
| Gesture language | Source-consistent wave, presentation, listening, thinking, and confirmation behavior once individually approved. | Random gesture cycling or a gesture that contradicts the interaction state. |
| Small companion | A reduced view must still read as this Candice, not an unrelated orb/avatar. | Substitute a disconnected generic orb as the character identity. |

## Technical interpretation limits

Allowed preparation is limited to reversible, traceable runtime adaptation:
lossless/visually safe resizing, non-destructive cutouts, landmark alignment,
and minimal mouth-region treatment. Each derivative must point to its source
asset ID/hash and pass light- and dark-background edge tests. The source PNGs
are read-only and are never overwritten.

`13-multipose-sheet` is a source sheet, not an automatic runtime atlas. No
region of it becomes a state until extraction, crop bounds, alignment, and
operator approval are recorded.

## Approval record required before visual PASS

The operator must approve, in a dated review record:

1. the chosen full-body and compact-companion crops;
2. the allowed hologram grade/glow and background behavior;
3. each semantic assignment for the second-batch poses;
4. every derived asset and its source ID/hash; and
5. side-by-side runtime captures for all required states.

Until that record exists, this Style Bible is a constraint document only and
the visual domain remains **not ready for release**.
