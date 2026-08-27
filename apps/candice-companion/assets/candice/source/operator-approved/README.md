# Operator-approved canonical originals

This directory is the sole canonical visual authority for Candice. Its sixteen
PNGs are byte-for-byte copies of the operator originals named and hashed in
`../../asset-manifest.json`. Never resize, crop, recompress, regenerate, or
write derived output here. Stable filenames are runtime identities; original
Downloads filenames exist only in manifest provenance.

The directory is policy-read-only. Changes require a new operator approval
record, a new SHA-256 inventory, and independent QC.

## Decision record — second-batch pose bindings (2026-08-25)

Runtime role assignment for the second-batch poses is no longer unresolved.
Four of them are now bound to gesture states in `../../asset-manifest.json`.

**Authority.** Operator-delegated. Asked to choose, Trevor delegated rather
than ruling: "WHAT THE FUCK ARE UWAITING ONME FOR", following his earlier
"isnt the images suppose to be animated? please fix thises thinkgs now". The
team lead then reviewed all six candidate images and made the selection. This
is a delegated operator decision recorded by the implementer, **not** a
self-approval by the implementing agent.

| gesture state | bound asset |
|---|---|
| `presenting` | `14-presenting-twohands` |
| `thinking` | `16-presenting-standing-b` |
| `listening` | `10-presenting-portrait-a` |
| `affirmative` | `12-presenting-fullbody-a` |

**Selection rationale.** 10, 12 and 15 are near-identical single-palm standing
poses. Only 14 (both hands open) and 16 (hand on hip) are visually distinct,
so they were given to the two states most worth telling apart.

**Deliberately still unbound.** `15-presenting-standing-a` — an idle alternate
nobody can distinguish from 10 or 12 is not worth a state.
`13-multipose-sheet` — an eight-pose contact sheet, not a runtime asset. It
visibly contains a hand-to-chin thinking pose and a thumbs-up affirmative that
read better than the two assigned above, but extracting them produces
derivatives, which FIX-002/FIX-004 require to be reconciled through documented
derivatives. That is separate governed work and was not done here.

**What actually changed, and what did not.** No image file, hash, dimension or
provenance record was touched; the sixteen SHA-256 values are byte-identical
before and after. The change is four `stateMap.body` keys plus four `role`
strings moving off `pose/unresolved`.

**The real finding.** The art had been operator-approved all along. The
binding was the missing piece: `resolveGestureEntry` requires
`role.startsWith('body/')`, so four approved assets sitting at
`pose/unresolved` silently resolved to null and the gesture stage mounted a
single distinct layer. Layer-swap animation was swapping one image for itself,
which is why the character read as a still image regardless of state.
