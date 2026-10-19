# Skill 71 image and video generation route (KIE, claude-nine edition)

This is the 999 edition's rewrite of the generation route (adapter
class, Item 28). The onboarding edition routes policy to Skill 66/67
and transport to Skill 74 in the OpenClaw skills tree. Nothing in
this harness may borrow from that tree, so every reference below
resolves inside this repo: the native `kie` skill (a front door at
`.claude/skills/kie/`), its vendored helpers under
`installer-registration/helpers/` (66-kie-image, 67-kie-video,
68-kie-audio, 46-kie-callback-relay, 07-kie-setup,
74-kie-live-adapter), and this skill's own vendored modules. The
step-zero capability audit (S8) verified the native system against
the route's checklist before this rewrite was written; the two gaps
it proved are named in section 2 with the module that fills them.

## 1. Policy: which model (the native kie policy helpers)

Model policy is the native kie skill's: 66-kie-image for images,
67-kie-video for video, 07-kie-setup's common rules for both. The law
Skill 71's gate enforces (latest-family lookup, alias normalization,
cap status, the N43 ratio rules, the separate GPT Image 2 and 2.5
payload rules, the visual QC retry ladder, the offline models.json
default, the stated createTask rate limit) is copied into this skill
as data in `references/kie-policy-999.json`, generated from the
onboarding gate's constants by the Item 27 sync. Read the generated
file in this skill; never reach across repos for it.

Model choice follows the standing rule: the client selects their
model, or their configured default applies (in this harness, the
install's 9Router configuration); recommendations may be offered
with reasons. Where the onboarding law says a department pin, this
harness's receipts say a user pin; the gate maps the value at
validation time and the stored receipt keeps `user-pin`.

## 2. Transport: how (the native adapter, plus two audited gaps)

Transport is the native adapter, 74-kie-live-adapter
(`installer-registration/helpers/74-kie-live-adapter/scripts/kie_live_adapter.py`):
validate, preflight at price x 1.30, prompt-budget check, submit,
wait, save immediately. Its mode system (off, shadow, active) is its
own; the receipts this skill writes name the adapter `kie` and carry
no adapter_mode, and the gate's claude-nine alias accepts exactly
that shape.

The audit proved two pieces absent from the native system, and only
those two are supplied by this skill, in `scripts/kie_transport.py`:

1. **The credits pair.** The adapter reads credits singly (its
   `credits` command, the preflight balance read); nothing pairs a
   before read with an after read around a dispatch. kie_transport.py
   reads credits immediately before dispatch and immediately after
   completion and records both figures per task.
2. **The per-task receipt files.** The adapter writes receipt lines
   only for drift events. kie_transport.py writes the per-task files
   the gate reads, at `private/receipts/kie74/<task_id>.json`,
   carrying task_id, model_id, model_source, requested ratio,
   generated ratio measured from the saved file, preflight_ok, and
   budget_exit.

Save naming (Update Plan Item 26, proposal P6, ruled 2026-10-15): the
saved file carries the delivered name, the two-digit `Image-NN.png`
derived from the item's three-digit internal ID (`IMG-001` saves as
`Image-01.png`, `IMG-012` as `Image-12.png`, `IMG-123` as
`Image-123.png`; the derivation of record is `delivered_filename` in
`scripts/validate_image_manifest.py`). Never save under the internal ID
(`IMG-001.png`) or the three-digit form (`Image-001.png`): the saved
file, the receipt's `file` (for example
`"image-generation-qc/Image-01.png"`), and the delivered file are one
name, and the gate matches that name to the internal ID by its trailing
number.

Hand-rolled KIE calls are forbidden in this harness exactly as in
the onboarding one: a generation with no adapter task id and no
receipt file cannot close the stage.

The prompt enforcer is this repo's own `shared-utils/kie_prompt_enforcer.py`
at the repo root (vendored byte-identical from the onboarding repo,
Item 28 Row 1; the nested copy under installer-registration/helpers
is the installer's own and is byte-identical today, verified at
audit time by git blob sha). The vendored enforcer's adapter hunt is
an environment decision of this install: it searches
KIE_LIVE_ADAPTER_PATH first, then the skills roots; setting
KIE_LIVE_ADAPTER_PATH to an empty string disables the adapter, which
makes budget answers UNKNOWN rather than unavailable; callers that
must distinguish the two call the enforcer's `check`, never
`budget_for` alone.

## 3. Receipt (stage `image-generation-qc`)

The stage receipt's transport block names `skill: "kie"` and
`policy: "kie"` on a claude-nine run (intake records
`runtime: "claude-nine"`, written when write_intake.py is run with
`--runtime claude-nine`), one task entry per generated file, each
with file, task_id, model_id, model_source (one of latest-family,
explicit-request, user-pin, legacy-ratio-route), requested_ratio,
generated_ratio, preflight_ok true, and budget_exit 0. The cost block
names provider `kie` with the credits_before and credits_after
figures kie_transport.py recorded. A run whose intake declares any
other runtime does not get the alias: on the OpenClaw side the same
receipt is refused, by design.

## 4. Video

Video routes to the native `motion-video-plus` skill (Item 28
Row 4's MAP disposition), with 67-kie-video as its policy helper.

## 5. Agnes

When the client explicitly selects Agnes, `scripts/agnes_route.py`
in this skill is the route (submit, poll, save, cost over the
synchronous Agnes image endpoint). With `--runtime claude-nine` (the
flag every run in this edition passes), intake refuses the selection in
writing when AGNES_AI_API_KEY is not configured in the environment.
Receipts name the route honestly: transport skill `63-agnes-image`
(the gate's route name), adapter `agnes`, receipt files under
`private/receipts/agnes/`.
