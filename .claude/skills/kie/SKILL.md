---
name: kie
description: >
  Front door for all KIE.ai work. Read this first, then route to the right
  helper skill: 66-kie-image for images, 67-kie-video for video, 68-kie-audio
  for audio and music, 46-kie-callback-relay for job callbacks, and
  74-kie-live-adapter as the ONLY paid transport. Carries the rate limit, the
  key rule, the shadow/active mode gate, the prompt budget rule, the
  troubleshooting table, the never list and the Anthropic base URL warning.
  Use whenever a job mentions KIE, KIE.ai, image, video or music generation
  on KIE, or the KIE_API_KEY.
---

# KIE front door

Routing page for a Claude Code or claude-nine session. Read it first, then
open the helper named for the job. One rule above all: **every paid KIE call
goes through skill 74 (`74-kie-live-adapter`). Nothing calls `api.kie.ai`
directly.** Skill 74 is the only paid transport; there is no second transport
and no private fallback.

**Sources:** `07-kie-setup/references/kie-official-agent-docs-digest.md`, and
`07-kie-setup/references/kie-common-rules.md` — the second one is the full
rules file this page summarises.

## Which helper does the job

| Job | Helper |
|---|---|
| Image generation, image models | `66-kie-image` |
| Video generation, video models | `67-kie-video` |
| Audio and music generation | `68-kie-audio` |
| Job callbacks (production polling) | `46-kie-callback-relay` |
| Every paid call — submit, poll, price, validate, credits, model list | `74-kie-live-adapter` (the ONLY paid transport) |

Skills 66, 67 and 68 own their model choice and prompts. Skill 46 receives
callbacks. Skill 74 does all paid mechanics: it alone holds the KIE client,
submits jobs, polls, downloads, reads credits and lists models. A skill that
needs generation resolves `kie_live_adapter.py` and runs skill 74 as one
subprocess; it never speaks HTTP to KIE itself.

## Key rules: KIE_API_KEY

- The key is the environment variable **`KIE_API_KEY`**. On a client box it is
  the client's own key, never an operator key.
- Report whether it is present as **SET or NOT SET** and nothing else.
- Never paste the key in chat, never print it, never log it, never echo it.
- If it leaks anywhere, reset it at **kie.ai/api-key** before anything else,
  then re-check presence.
- On 401 or 403, stop — do not retry past the documented attempt caps.

## Model names, authentication, replies

- Model names come only from skill 74 `discover` or from skills 66, 67, 68.
  **Never from memory**, never from a stale list, never invented.
- Authentication is **Bearer-only**: one `Authorization: Bearer <KIE_API_KEY>`
  header, nothing else.
- **Check the code inside the reply** — a KIE response carries a status code in
  its body; read it, do not infer success from HTTP 200 alone.
- **Save results at once.** KIE keeps results for **14 days** and uploads for
  **24 hours**, then they are gone; download to approved storage before the
  next step.

## Rate limit — 20 new jobs per 10 seconds per key, and never drop a 429

KIE allows **20 new jobs per 10 seconds per key** (20 new generation requests
per 10 seconds per KIE account, `createTask`). Pace batches to that budget.
A **429 means the job did not run**: the request was rejected, nothing was
queued, no credits were spent. **Resubmit it later, after the window — never
drop it, never treat it as done, never silently lose the job.**

## Shadow versus active: kie-live-adapter-mode.conf, flipped by the credits check

Skill 74 ships in **shadow** mode: diagnostics run, paid dispatch refuses.
The mode is one word in the file `kie-live-adapter-mode.conf` under
`$OC_CONFIG` (default `~/.openclaw`): `off`, `shadow` or `active`
(`KIE_LIVE_ADAPTER_MODE` overrides for one call). What flips it is the
**credits check**: skill 74 preflight reads the live balance
(`/api/v1/chat/credit`) and requires balance >= price x 1.30; only when that
check passes does an operator write `active` into the mode file. Insufficient
credits leaves shadow on and the job stops before dispatch. Never flip the
mode file around a failed credits check.

**Skill 74 is the only paid transport.** Nothing calls `api.kie.ai` directly —
and that includes the credits check and the model list: those also go through
skill 74, not through a hand-rolled request.

## Prompt budget

Descriptive prompt fields (image prompt, video prompt, music style or
description) are written to **95 to 100 percent of the model's maxLength**
(hard floor 80 percent — below it, reject and rewrite; hard ceiling 100
percent). The limit comes from
`python3 74-kie-live-adapter/scripts/kie_live_adapter.py prompt-budget --model <id>`,
never from memory. Verbatim fields (spoken or sung text, user lyrics) follow
their own content length and are exempt.

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| 401 | The key is wrong, expired or rejected | Check and reset the key at kie.ai/api-key |
| Key missing | `KIE_API_KEY` is NOT SET on this box | Set it for this client, then re-check presence — report SET or NOT SET |
| Task failed | KIE accepted the job and it then failed | Look at kie.ai/logs for that job id |
| 402 | Not enough credits | Top up at kie.ai/pricing, then re-run the credits check |
| Link expired | A result or upload link passed its window | Results last 14 days, uploads 24 hours — re-request the job; do not reuse the old link |

## Full rules

Everything above is the short form. The full rules — authority order,
endpoints, polling, retention, price authority, model-id discipline — live
in `07-kie-setup/references/kie-common-rules.md`, read after the Sources
digest `07-kie-setup/references/kie-official-agent-docs-digest.md`. If that
file and this page disagree, the rules file wins; fix this page.

## Never

- **Never `npx skills add https://kie.ai`.** Vendor skills are never
  installed, not by hand and not by script.
- **Never add a KIE MCP server**, and never register one in `.mcp.json`.
- **Never a direct `curl` to `api.kie.ai` from a session.** Every paid call
  goes through skill 74.
- **Never point Claude Code or claude-nine at `api.kie.ai/anthropic`.** On
  claude-nine it would replace the 9Router base URL and break routing; on
  plain Claude Code it would move chat billing to KIE. A settings-file value
  overrides the launcher's router address, so a leftover setting beats the
  launcher — check the settings file, do not assume the launcher won.
- **Never write a translation proxy.** No shim, no adapter of your own, no
  layer that converts one API shape into another.

Chat stays on its own provider; KIE is reached only through skill 74 for
media generation.
