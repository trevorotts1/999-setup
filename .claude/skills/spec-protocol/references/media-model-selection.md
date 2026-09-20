# Media Model Selection — how Candace chooses, and what the client hears

This file OWNS every image- and video-service recommendation this skill makes: how the choice
is reached, how the cost is estimated, and the exact words spoken to the client. No other file
recommends a media model, quotes a media price, or names a model to a client.

**THE MASTER RULE — Candace recommends; the client does not research AI models.** The client is
never shown a catalog, a model ID, an API name, a benchmark, a parameter table, or a
price-per-second figure, unless they explicitly ask for technical detail. Internally Candace may
compare five, ten or twenty candidates. The client sees ONE recommendation and, when the saving
is meaningful, ONE cheaper alternative.

**The division of authority.** The client chooses WHAT they want, HOW GOOD it needs to be, HOW
FAST they need it, and HOW MUCH they are comfortable spending. Candace chooses the provider, the
model, the technical settings, the resolution strategy, the generation workflow, and the
cost-efficient route — unless the client explicitly asks to make those choices themselves.

---

## 1. Never hard-code "latest"

AI media models change constantly. **Nothing written on this page is ever assumed to still be
the newest or the best.** Model families that MAY be relevant include — as examples, never as a
permanent whitelist:

- **Image:** the GPT Image family, image models available through Kie.ai, image generation
  included with an Agnes subscription, and other high-quality models in the client's connected
  services.
- **Video:** Veo, Wan, Seedance and Seedance Mini (or equivalent lower-cost models), Kling,
  MiniMax / Hailuo, Google video models, Agnes Video, and other current Kie.ai video models.

Before any recommendation that costs real money, **inspect the CURRENT catalog, capabilities and
pricing** from the sources the environment actually has: the Kie.ai model catalog, API or
documentation; current pricing pages; the Agnes catalog or account. Prefer live information over
any name or version number stored in this skill or recalled from training.

**When live information cannot be verified: do not invent it, do not present a remembered
version as current, and say plainly which parts are verified and which are a reasonable
default.** An unverifiable price is never quoted to a client (`SKILL.md` section 13; the
negative-result rule in `references/enforcement.md`).

## 2. What the client is assumed to have

- **A Kie.ai key** is the normal BlackCEO client setup — treat Kie.ai as an available provider.
- **An Agnes AI subscription** is common but NOT universal. Determine availability from the
  environment sweep (`references/environment-sweep.md`, keys by NAME only) or from context.
  Ask a simple account question only if it genuinely cannot be determined, and never ask for a
  key value in the conversation — `tools/place-key.sh` files it from the clipboard.

Where an included subscription allowance covers the job, spend it before spending cash — but
never sacrifice an important final deliverable to avoid a small incremental charge.

## 3. Still images — quality carries more weight than pennies

One image is a small budget decision next to minutes of generated video, so for stills quality
normally outweighs a small price difference. Determine, internally:

purpose · realism vs illustration · people and faces · text or lettering inside the image ·
product accuracy · brand consistency · reference-image or editing needs · aspect ratio ·
resolution · how many images · commercial use · providers available · incremental cost.

If Kie.ai carries the strongest appropriate CURRENT image model for the task, normally recommend
it; for many general-purpose high-quality jobs the current GPT Image-family member available
through Kie.ai may be a strong default. **Verify the catalog first — never pin a version here.**
Where Agnes offers an appropriate model inside the client's existing subscription, compare its
quality for THIS exact task, whether generation is already included, and the remaining allowance
if knowable, against Kie.ai's quality improvement, extra cost, and any capability Agnes lacks.
Then recommend, in the words `references/interview.md` §5 carries.

## 4. Video — never default to the newest or the most expensive

Video cost multiplies: clip length × number of clips × retries × resolution × audio × model.
Evaluate seven things for every significant video job.

1. **Quality** — premium commercial, hero website video and paid advertising sit at one end;
   social filler, backgrounds, rough concepts and internal demos at the other.
2. **Length** — seconds per generated shot, final length, expected number of shots, likely
   retries. **Never confuse final edited duration with generated duration:** a 60-second
   commercial usually needs substantially more than 60 seconds of generated footage.
3. **Cost** — cost per generation, cost per second, resolution and audio price deltas, likely
   retry cost. Estimate the TOTAL likely generation cost, not the vendor's smallest advertised
   price.
4. **Resolution** — decide whether the project genuinely needs a low-resolution preview, 720p,
   1080p or higher. Do not pay premium resolution prices unnecessarily.
5. **Audio** — dialogue, natural sound, music, or none. If sound is added separately, do not pay
   more for native audio generation unless it brings another real benefit.
6. **Control** — image-to-video, text-to-video, start/end frames, reference images, character
   consistency, motion and camera control, lip sync, first/last-frame control, editing
   flexibility. Weigh only what THIS project needs.
7. **Speed** — matters when many clips or many iterations are required. Never trade major
   quality for a small speed gain unless speed is the stated priority.

### Agnes Video

When the client has Agnes and it includes video, treat it as an economic option worth
evaluating — but never choose it merely because it is cheaper. Good fits: drafts, prototypes,
social clips, idea testing, backgrounds, anywhere acceptable quality at low incremental cost
beats maximum cinematic quality. Premium Kie.ai video earns its cost on flagship advertising,
premium hero content, important client-facing cinematic sequences, difficult realism, complex
motion, and anywhere the quality difference is visible and commercially important.

### Cheap for testing, premium for final

Where it fits, generate rough versions on the included or cheaper service until the shot, prompt
and composition are approved, then generate the final important shot on the stronger model. This
routinely removes most of the wasted video spend.

## 5. The escalation ladder — one project may use several models

- **Level 1** — included or low-cost generation for exploration.
- **Level 2** — an affordable Kie.ai model for ordinary production shots.
- **Level 3** — a premium Kie.ai model ONLY for shots where the difference matters.

Twelve ordinary social clips on a cheap model plus two hero shots on a premium one beats putting
all fourteen through the premium model. Never force a whole project onto one expensive model
because a few scenes need it.

## 6. The decision score — weighted per project, never once and forever

Score candidates on: visual quality · realism · prompt adherence · motion quality · character
consistency · image-to-video quality · camera control · audio capability · duration limits ·
aspect ratios · resolution · generation speed · price per generation · price per second · likely
retry cost · existing subscription benefit.

**The weighting changes with the job:**

| Job | Weighting, highest first |
|---|---|
| Premium commercial | quality → control → consistency → cost → speed |
| Social content at scale | cost → speed → acceptable quality → maximum quality |
| Character-driven video | consistency → motion → quality → cost |
| Prototype | cost → speed → quality |

## 7. Estimating the real cost

```
generated_seconds = shots_needed × seconds_per_shot × retry_multiplier
estimated_cost    = generated_seconds × current effective cost per second
```

Adjust when a provider charges per generation rather than per second. **Never show this
arithmetic to an ordinary client.** Translate it: "I expect the video generation to cost around
$__ to $__." Use a range whenever the retry count is uncertain.

## 8. The cost guardrail — the client approves MONEY, never technology

Never let a small, simple-sounding request quietly become an expensive generation run. When the
estimated spend materially exceeds what the client has approved or would reasonably expect,
**stop before the expensive step** and say three things in plain words: what it will cost, why it
costs that, and the cheaper option you would recommend instead. This is not a technical question
and must never be phrased as one. The premium-engine spend gate stays a RUNTIME ask, one
generation at a time, at the moment the money would be spent
(`references/media-pipeline.md` §6b); never pre-collect a blanket yes.

## 9. Provider-first economics

1. Determine the required quality and capability.
2. Determine which available services meet it.
3. Prefer what the client already pays for, when it is good enough.
4. Compare the incremental cost.
5. Recommend the best VALUE for this particular job.

**VALUE is not "cheapest."** Value is the appropriate result without unnecessary spending.

## 10. The client-facing questions — all four are about the job, not the technology

> "What kind of video are we making — something polished like an advertisement, or something
> simpler for regular social media?"

> "About how long should the finished video be?"

> "Does the video need people talking, or will we add the voice and sound afterward?"

> "Is keeping the cost down important, or is getting the best-looking result the bigger
> priority?"

And when budget is a live concern:

> "Do you have a rough amount you'd like me to stay under for the video generation?"

**Never ask** "Do you want Veo, Kling, Seedance, Wan, or MiniMax?" — or any question that
requires knowing a model name, a resolution tier, or a price-per-second.

## 11. How the recommendation is spoken

**Never:** "Veo is $X/sec, Seedance is $Y/sec, Kling is $Z/sec. Choose one."

**Always:**

> "For this video, I recommend <service>. It gives us the quality we need for <reason>, and
> based on how much video we're making, I estimate the generation will cost around <estimate or
> range>.
>
> If you'd rather spend less, I can use <cheaper option>. It should still look good, but
> <one meaningful tradeoff>.
>
> Which would you prefer?"

And when the client has already asked Candace to make the decisions, state it rather than ask it:

> "For this project I recommend <service> because <reason>. It should keep us around <estimated
> cost>, so that's what I'm planning to use."

Then ask only if an approval is genuinely required — that is, only when real money is about to
be spent beyond what they already approved.

## 12. What this file never overrides

The honesty rules stand unchanged: no fabricated testimonials, customer quotes, logos,
copyrighted assets, personal photos, credentials, account access, or claims about the client's
company. No key value ever reaches the conversation. A declared, labelled media gap plus the
MEDIA-GAPS manifest is honest scaffolding; a stock image passed off as final art is a lie
(`references/media-pipeline.md`, `references/build.md` section 6).
