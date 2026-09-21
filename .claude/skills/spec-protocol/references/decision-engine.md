# The Decision Engine — small typed judgements, and what happens without one

This file OWNS every use of a System One decision model in this skill: how it is resolved,
how it is proven, the exact question shape and confidence threshold for each call site, and
**the named fallback each site uses when there is no engine at all.** No other file decides
when to call it, and no other file may add a call site without adding its fallback here.

**⛔ THE RUN NEVER DEPENDS ON IT.** A client with no key gets the same finished product by
the same route. Every site below degrades to exactly the behaviour this skill had before the
engine existed. An engine that is ABSENT, UNDETERMINED, slow, or wrong is never a blocker,
never a question put to the client twice, and never a reason to pause a build.

---

## 1. What it is, and what it is not

Jev (TypeSafe AI) is a **System One** model: it takes program state plus typed questions and
returns typed answers with calibrated probabilities. Three primitives, nothing else:

| Type | Returns | Used here for |
|---|---|---|
| `choice` | one key from a criteria map (≤255), plus per-option probabilities and a confidence | which of six things is being built; triage routing |
| `score` | a level from an ordered list, plus confidence | how much a repair round improved; ten-category conversion |
| `noul` | a probability 0–1 | every yes/no judgement below |

**It cannot** write text, write code, explain its reasoning, or read an image. Its output
modality is `decisions`. Measured: ~250–350ms per call, $0.042 per million input tokens,
output free, **32,000-token context**. That context is small — a state payload is a summary
or a slice, never a whole specification.

**Accuracy is modest and the confidence is the point.** TypeSafe's own four-workflow benchmark
sits near 68%, and their evals compare against other models' probabilities rather than human
ground truth. What is dependable is CALIBRATION: low scores really are unlikely, high scores
really are likely. Every site below therefore uses a THRESHOLD, and the uncertain band always
falls through to the behaviour that existed before. **"Zero hallucinations" means the answer
always matches the schema — it does not mean the answer is right.**

## 2. Resolution ladder — `tools/jev-check.sh`, step 2.7

First hit wins, and a direct key ALWAYS beats a broker:

1. **`JEV_TYPESAFE_API_KEY`** → `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`
2. **`OPENROUTER_API_KEY`** → `POST https://openrouter.ai/api/v1/systemone`, model `typesafe/jev-1.13`
3. **Neither** → ABSENT. A fact, not a failure.

Keys are resolved BY NAME from the environment and from the credential files the script names,
**parsed, never sourced**, and no value is ever echoed, logged, written to a receipt, or placed
on a command line (`references/environment-sweep.md`).

**⛔ `GET /api/v1/models` DOES NOT LIST JEV, AND THAT PROVES NOTHING.** That listing covers
models whose output is TEXT; Jev's output modality is `decisions`. An absence there is an
artefact of the instrument, not a fact about the account. Reachability is decided by a REAL
CALL and by nothing else. Chat-completions SDKs do not work with it; never send it to
`/chat/completions`.

Exit codes: `0` PRESENT and proven by a real typed answer · `1` ABSENT, no key found, sources
named · `2` UNDETERMINED, a key exists but the call did not complete. **A key that exists but
could not be tested is never reported ABSENT, and a check that did not reach its source never
exits 0.** HTTP 402 on the OpenRouter path means the key works and the account needs credit —
that is UNDETERMINED with its reason named, never ABSENT.

Record one line through the run's own ledger:
`DECISION-ENGINE: verdict=<PRESENT|ABSENT|UNDETERMINED> source=<direct|openrouter|none> model=<id> latency_ms=<n>`

## 3. What the client hears — once, or never

**PRESENT.** Nothing. Not a sentence, not a mention. It is a setup outcome, and setup outcomes
are never put to the client (`references/audience.md` §7). The ledger line is the record.

**UNDETERMINED.** Nothing to the client. One ledger line, and the run proceeds as ABSENT.

**ABSENT.** Exactly one plain sentence, spoken INSIDE the opening turn as part of the script —
after the greeting and immediately BEFORE its last line, which is the idea question. Never as a
turn of its own and never after the question, because the opening ends ON the question
(SKILL.md section 3). It is a money-and-accounts matter, which is the client's alone, so it is
a real offer and not a setup report:

> Before we get started — there's a small decision engine I use to make quick judgement calls,
> and it makes the whole build a little sharper. It's called Jev. You can add a few dollars of
> credit to an OpenRouter account if you already have one, or go straight to typesafe.ai.
> Either is fine, and if you'd rather skip it I'll carry on without it — nothing here depends
> on it.

`tools/jev-check.sh --say` prints it verbatim. **Send them to `typesafe.ai`, never to
`jev.ai`** — that domain is a parked listing and is not the product. On a yes, file the key
with `tools/place-key.sh` and re-run the check. On a no, or on any failure, record
`DECISION-ENGINE: declined` as a DEFAULT and **never raise it again** (Law 46). It is not
counted as an interview question (`references/interview.md` §6, rule 8).

## 4. The call sites

Every row: the question, the threshold, and what happens with no engine.

### 4.1 Build-target classification — `choice`

**Only when no target is declared.** A profile's `targets` array already decides the taxonomy
(SKILL.md section 3); when one exists, the engine is NOT consulted. This site is for a fresh
project with nothing but the client's own words.

State: their description verbatim, PLUS every other piece of evidence the run already holds —
the brief, the packet documents, the folder contents. Criteria: the six taxonomy values with
the one-line meaning each.

**⛔ A HIGH CONFIDENCE IS NOT A DECISION. THE CONFIRM SENTENCE IS MANDATORY AT EVERY
CONFIDENCE.** The engine's answer is a PROPOSAL for the "Did I get that right?" sentence and
nothing more. It never records `BUILD-TARGET:` on its own, at any score. The threshold governs
only whether the run ALSO offers the either/or: **below 0.85, ask the either/or as well**;
at or above it, the single confirm sentence stands on its own.

*Measured, on this exact skill, against the real case that caused the bug:*

| State given to the engine | Answer | Confidence |
|---|---|---|
| "…recreating the Higgsfield **app**…" alone | `MOBILE_APP` | **0.96 — confidently WRONG** |
| the same sentence + `targets:[desktop-macos-arm64, linux-vps-web]` | `MOBILE_AND_WEB` | 0.61 — wrong, and knew it |
| "a simple website for my landscaping business…" | `WEBSITE` | 1.00 — right |
| "runs on my Mac, edits video on my own hard drive, no internet" | `DESKTOP_SOFTWARE` | 1.00 — right |

Read row one carefully: **a threshold alone does not protect you.** The word "app" is ordinary
English for any program, the engine anchored on it, and it was 96% sure of the wrong answer —
above any sane auto-accept line. That is why the confirm sentence is unconditional and why the
state must carry every piece of evidence the run already has. A declared `targets` array
outranks the engine outright and stops it being called at all (SKILL.md section 3); starving
the state and then trusting a number is how this skill produced `MOBILE_APP` for a macOS
program in the first place.

**Without an engine:** classify as the skill does today, from the signals in section 3.

### 4.2 Speech check — `noul`

Before any client-facing message: *"does this sentence contain a word a non-technical adult of
sixty-five would have to ask the meaning of?"* Criteria name the banned list
(`references/audience.md` §2). **Rewrite at ≥ 0.60.**

**Without an engine:** `tools/speech-check.sh` and its word list, exactly as today.

### 4.3 Media spend guardrail — `noul`

Before any paid generation: *"is this generation about to cost materially more than the client
approved or would reasonably expect?"* State carries the approved figure, the estimate, the
shot count and the retry multiplier. **Stop and ask at ≥ 0.70.**

**Without an engine:** the arithmetic in `references/media-model-selection.md` §7–§8, which is
the authority either way. The engine is an early trigger, never the sum.

### 4.4 Dispatch risk gate — `noul`

Before a build workflow launches: *"does this launch look like it will do something outside its
declared boundary?"* **Refuse-and-review at ≥ 0.80.**

⛔ **ADVISORY ONLY.** `tools/dispatch-check.sh` and `tools/hooks/dispatch-gate.py` remain the
deciding instruments. The engine may add a refusal; it may NEVER convert one of their refusals
into a pass. A deterministic gate is never overridden by a probability.

**Without an engine:** the two gates alone, exactly as today.

### 4.5 Scope-fence drift triage — `noul`

*"Is this finding inside the agreed scope set?"* **Auto-accept in-scope at ≥ 0.90, auto-reject
at ≤ 0.10, everything between goes to a reviewer.** A rejection is logged as DRIFT the same way
it is today, so a wrong call is visible rather than silent.

**Without an engine:** every finding goes to the reviewer, as today.

### 4.6 Plateau detection — `score`

After each repair round: *"how much did this round close the named gap?"* on the ordered ladder
`["no measurable improvement", "slight improvement", "clear improvement", "gap closed"]`.
**Three consecutive rounds at the bottom level ends the unit honestly** through the plateau rule
(`references/gauntlet.md` §5) instead of grinding to the cap.

**Without an engine:** the plateau rule's existing judgement, as today.

### 4.7 Ten-category score conversion — `score` ×10

⛔ **THE ENGINE NEVER JUDGES THE WORK.** The independent judge on the QC route reads the
artifact, finds the defect, and writes the verdict WITH its quoted evidence. This site takes
**that written verdict as state** and returns the ten category levels, so a judge cannot return
prose where a number was required and leave a verdict UNVERIFIED.

The engine never sees the code, never sees the bar, and never decides PASS. The 8.5 floor, the
mandatory conjunction, the quoted evidence, the named bar with its fetch proof and the
builder-versus-judge seat difference are all unchanged and all still come from the judge
(`references/gauntlet.md`, `references/pipeline.md`). A QC RECORD whose score came from this
conversion names it: `score_source=decision-engine verdict_source=<judge seat>`.

**Without an engine:** the judge returns its own ten numbers, as today.

## 5. Where it is never used

- **Any blind visual comparison.** Text only — it cannot see a rendered page at any viewport.
- **The PASS verdict, the release council, and any gate of record.** ~68% accuracy with no
  evidence attached cannot license a client's work to ship.
- **The repair payload.** No explanations, ever: it can say a thing failed and never what to fix.
- **Any builder, fixer, or merge writer.** It cannot produce code.
- **Anything a deterministic instrument already decides.** A script that can prove a fact
  outranks a model that can only estimate one.

## 6. Operational limits, and what is not known

Measured here: 216ms via OpenRouter, 341ms direct, 32,000-token context, $0.042/MTok in,
output free, about $0.000013 per small call.

**NOT published by the vendor: rate limits, concurrency caps, and data-retention terms.** The
docs carry no limits page. Treat all three as UNDETERMINED, never as "unlimited": keep state
payloads small, never send a whole specification, and back off on any 429 rather than assuming
headroom. The service is early access, brokered or direct, with no self-hosted option — which
is exactly why every site above keeps its fallback.

**State leaves the machine.** Client material sent as state reaches a third party. Send the
smallest slice that answers the question, never credentials, and honour the same boundary the
rest of this skill honours.
