# Client intake: one question bank, one answers file

Skill 49 (launch mode and legacy mode), Skill 71 and Skill 83 all ask the client the same questions from one bank and
write the answers to one file. Where the client answers (claude-nine, Claude Code or OpenClaw) changes only how a
question is shown, never which question is asked or where the answer goes.

| Piece | File |
|---|---|
| Question bank | `shared-utils/client_intake/question-bank.json` |
| Engine: `next`, `record`, `resolve_unknown`, `check`, `finalize` | `shared-utils/client_intake/engine.py` |
| Colour help: logo, website, three palettes, safe default | `shared-utils/client_intake/palette_help.py`, `palette-defaults.json` |
| Answers file contract (C1) | `shared-utils/client_intake/answers.schema.json` |
| Two worked examples | `shared-utils/client_intake/fixtures/answers.elevation.json`, `answers.7fig.json` |
| Introduction, estimate, progress, plan review | `shared-utils/signature_launch/experience/guided_experience.py` |

**The bank holds 55 questions, and nobody is asked 55 of them.** The number that applies to a run is computed from
that run's own mode and answers; the client is told the computed number and nothing else. This file never states a
question count, because a stored count goes stale the moment the bank changes.

## Who is on the other side

The client is an entrepreneur, not a software engineer and not a marketing expert. They must feel heard, understand
why each decision matters, and never meet a schema name, an id, a hash or a provider route. Marketing words are
translated: a "bump" is "a small optional extra at checkout", a "downsell" is "a smaller version for someone who says
no", "long-form" is "the longer, more detailed page". This is a planner, never a therapist: no diagnosis, no
psychological labels, no therapy framing.

## What a client experiences

One short question at a time, in plain English, with a one-line reason ("why we ask"), at most three choices, and
always a fourth way out: **I'm not sure, help me**.

The opening question is always the same: *"What is the best way for me to help you with your launch?"*, with three
answers:

| Letter | Choice | What it does |
|---|---|---|
| A | Recommend a plan for me | Uses what is known, asks only what is missing, then the client reviews the plan |
| B | Guide me through each decision | Explains the options in plain words and helps the client choose |
| C | I already have a plan | Helps act on it and flags anything important that may have been missed |

The client can change the preference at any time; it is a recorded answer, not a contract.

**A recommendation is a proposal.** It is never a silent decision and never approval to spend. Only an explicit plan
approval approves the plan, and paid pictures need their own separate approval.

## Coaching: "I don't know" is a request for help

Every question offers three ways out, named in plain words:

1. **Show me an example.** The bank's `help.examples` are shown as they are written.
2. **Help me answer.** The bank's `help.explain` is said in plain language.
3. **Recommend using what is already known.** A suggestion from the answers already recorded, or a plain statement of
   what still has to come from the client.

`"I don't know"`, `"not sure"`, `"help me"` and their equivalents start this path. They are **never** recorded as a
substantive answer and the flow never skips past them. On a never-default question a repeat request is told plainly
that the build waits for that answer, by name; the question stays in the interview rather than disappearing.

## Colours

The client sends colour codes or names, or says "help me". When two or more colours come without roles, the engine
asks exactly: *"Which of these is your MAIN color: the one people think of first when they think of your brand?
(#0A7E8C, #E76F51)"*. It then asks for the second colour and the accent only when there is a real choice left, asks
what the background should be, and picks a readable text colour itself by contrast. If the client labels roles in one
message ("primary #0A7E8C, background white"), nothing more is asked. Colours can also be read from the logo file or
the website (a plain HTTP fetch, no browser of any kind).

## Offers are built one at a time

The client is never asked for a table. They describe one offer in their own words; the engine reads it back and asks
whether a second package would help, and why. A package is only added when the client names it, and an upgrade, a
smaller version or an add-on is only ever proposed from something the client already described. There is no automatic
upsell and no invented package.

## The eight launch-operation decisions

These are **conditional topics**, not a mandatory interrogation. They apply to a launch or Black Friday run and never
to a legacy run, and a question whose condition is false is never asked and never counted.

| Topic id | What it decides |
|---|---|
| `timing` | When doors open and close, and when the messages go out (never defaulted; no deadline is invented) |
| `channels` | Email only, or email and text |
| `conversation_ai` | Whether an automatic reply bot is built (optional; nothing is built when it is not asked for) |
| `access_delivery` | Whether a log-in or access link has to be delivered after purchase |
| `payment_plans` | Paid in full, or installments (which turns on the failed-payment follow-up) |
| `sender_name` | The From name on emails and texts (never defaulted; never a name the client does not own) |
| `reply_email` | The real mailbox replies reach (never defaulted) |
| `texting_readiness` | Whether carrier approval is in place; until it is, every text stays a draft |

Black Friday is the same foundation plus five seasonal decisions, asked individually and only in `bf` mode:
`promo_dates`, `promo_offer`, `promo_limits`, `promo_audience`, `promo_followup`. There is no invented urgency and no
invented scarcity: a limit is written only when the client states a true one.

## Progress, length and resume

- **Length** is computed: *"Expect about N short questions, depending on what we already know (M apply to your launch
  in total)."* Nothing is hardcoded and no stored count is ever read.
- **Progress** covers the applicable questions only: `"7 of 32 answered (22%). Next: your offer and what it costs."`
- **A changed estimate is explained**: the line names the old number, the new number and why it moved.
- **Pause and resume** read the answers file: a confirmed answer is never asked again. A defaulted answer is flagged
  `to confirm` and is listed at delivery with a one-line way to change it.

## Never defaulted

These stay blocked, by name, until the client answers: price (a suggested price is a proposal until approved), offer
name and claims (description, audience, result, problems, what the buyer gets, story), who appears in images,
packages or levels, funnel shape, the launch timing, the sender name and reply address, community link and bonus truth
gate, entitlement, paid-render approval, plan approval. `check()` names each one in `blocking`.

## How each skill reads the answers file

- Skill 49 launch mode: `python3 scripts/launch_intake.py --session S --answers-file A [--brand-file B]` fills the session;
  a question already answered is never asked again; a default or suggestion enters as `recommended_unapproved`.
  The eight launch-operation answers travel as typed ledger entries with their provenance
  (`engine.launch_answers`), so a text answer is never read as a yes.
- Skill 49 legacy mode: `engine.to_sf_brief_answers(doc)` yields the `q1`..`q18` keys the `prove_sf_intake.py` gate reads.
- Skill 71: `python3 scripts/write_intake.py RUN --answers-file A` fills owner, image cap, page version, design style and
  image engine, writes the client brand file (`scripts/brand_colors.py record-answers`) and records `to_confirm`.
- Skill 83: `brand_ref` is the path of the brand file the answers produced and `brand_hash` its sha256 (the same two values
  `launch_intake.ingest_answers` records).

## Question id map

Every legacy and launch question id maps to one canonical id through `legacy_ids` in the bank. Older answers files are
still read: `engine.LAUNCH_TOPIC_ALIASES` accepts `launch_calendar`, `reply_to_email` and `a2p_ready` as the earlier
spellings of `timing`, `reply_email` and `texting_readiness`. A test fails if a question in `sf-intake-questions.json`
or `launch-questions.json`, or a field required by the launch record, Skill 83 intake or Skill 71 `write_intake.py`, has
no question and no stated system reason.
