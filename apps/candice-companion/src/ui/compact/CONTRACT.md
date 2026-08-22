# WS-10 contract — compact progress-companion mode

Stable surface other lanes may consume. Changes to these signatures are
breaking changes; propose them via CROSS-LANE-FINDING to the WR-012/WS-10
owner before shipping a replacement.

## Module: `src/ui/compact/index.ts`

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `COMPACT_CONTRACT_VERSION` | `1` | Bump only on breaking surface changes. |
| `COMPACT_ROOT_CLASS` | `'candice-compact'` | Root class of the compact surface. |
| `COMPACT_EXPANDED_CLASS` | `'candice-compact-expanded'` | Toggled on the expanded interaction surface. |
| `COMPACT_REDUCED_MOTION_CLASS` | `'candice-reduced-motion'` | WS-14's class consumed (never defined) to drop the one-shot expand transition. |
| `COMPACT_VISUAL_MODES` | `['bubble', 'surface']` | `bubble` paints no background at all; `surface` is the small interaction layer. |
| `COMPACT_EXPAND_MS` | `180` | One-shot expand duration; no continuous animation exists in this lane (spec 19). |
| `COMPACT_STAGE_SLOT_ID` | `'candice-compact-stage-slot'` | Reserved slot where WR-013 mounts the final character image. |
| `COMPACT_STATUS_ATTR` | `'data-candice-compact-status'` | Root attribute set per real WS-08 status family. |
| `COMPACT_FAMILIES` | `['progress','recovering','idle','voice','text-fallback','other']` | Families the compact view recognizes. |
| `COMPACT_PROGRESS_STATUSES` | `['building','quality-checking','fixing','waiting-for-user','complete']` | Spec 16 progress family. |
| `BUSY_HINT_TEXT` | `'Claude is working. I will send that as soon as it is ready.'` | Spec 13.3 offline hint (exact string). |
| `COMPACT_STYLE_TEXT` | CSS | Style contract: CSS-variable references only, no hex/rgba/url/background declarations, one-shot transition, no loop. |

### Types

- `CompactStatusView` — `{family, label, busy, offline}` — display interpretation of a REAL WS-08 status. `busy: true` means the session is not at a safe input point (spec 13.3). Percentages are never present in this type — progress counts would have to come from real `detail` fields of real status events.
- `CompactSubmitEntry` — `{text, inputMode: 'typed'|'voice', submittedAt}` — user-authored input only.
- `CompactViewHandlers` — `{onTalkToggle(held), onSubmit(text), onExpandToggle(), onMuteToggle(), onReturnToClaude()}`.
- `CompactView` — `{el, isExpanded(), setExpanded(b), setStatus(view), setBusyHint(v, text), setPending(entries), destroy()}`.
- `CompactController` — `{handle(event), render(), pending(), isExpanded(), destroy()}`.
- `CompactTransport` — `{submit(entry)}` — the WS-03/WS-05 session adapter hands the controller submissions; this lane never injects into a terminal itself.
- `CompactControllerOptions` — `{machine, mount, transport, doc?}` — the document is injected (tests pass a `Document`-cast fake); the real document is resolved when `doc` is omitted.

### Functions

| Signature | Purpose |
|---|---|
| `compactStatusView(status: CandiceStatus): CompactStatusView` | Pure map of a real machine status to compact display. |
| `submissionMustWait(status): boolean` | Pure gate: session not at a safe input point (spec 13.3). |
| `class CompactSubmitQueue` | Single-flight per-session FIFO; `enqueue/peek/drain/pending/clear/size`. Never submits by itself. |
| `mountCompactStyle()` | Idempotent style injector (headless-safe). |
| `createCompactView(mount, handlers, doc?): CompactView` | DOM surface; `mount == null` (or no document) returns a no-op view (spec 20). |
| `createCompactController(options): CompactController` | Wires the real WS-08 machine to view + queue. |

## Runtime behavior contract

1. The compact surface never invents a status or a progress percentage:
   every `setStatus` call renders the RESULT of a WS-08 machine transition;
   the machine is the source of truth (spec 16).
2. The queue carries only the user's explicit typed/spoken input, in user
   order, and is drained FIFO only at a safe input point; the user always
   sees pending entries (`setPending`), never hidden prompts (spec 13.3).
3. The compact view holds no rectangular background behind the character
   (spec 11): root candidates reference existing WS-06 variables only; all
   colors are `var(...)` references, no baked hex/rgba/url.
4. Minimal animation (spec 19): one-shot expand transition only; the
   WS-14 reduced-motion class cancels it; no loop/keyframes in this lane.
5. Failures degrade to a no-op view, never a throw, never a stop of Claude
   (spec 20). No session/window identity resolution here — decoration only.
6. No artwork is loaded or named by this lane: final asset binding is
   WR-013's contract (source PNGs read-only, manifest 9.4 item 8).

## Environment

- Node-based tests run on the system Node test runner
  (`node --test apps/candice-companion/src/ui/compact/__tests__/compact.test.ts`),
  zero dependencies, following the WS-07/WS-08/WS-13 lane convention.
- The lane reads only the WS-08 machine instance and the mount element
  handed to it, plus the DOM it creates.
