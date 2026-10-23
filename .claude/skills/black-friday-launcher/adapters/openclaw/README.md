# Skill 83 (Black Friday Launcher) - OpenClaw experience

How the client is asked, and told, when Skill 83 (Black Friday Launcher) runs in OpenClaw (chat, including Telegram). Code: `<REPO_ROOT>/shared-utils/signature_launch/experience/`.

## Asking (one short chat message at a time)

1. Detect: `python3 <REPO_ROOT>/shared-utils/signature_launch/experience/harness_profile.py --harness openclaw`.
2. Say the introduction first, then the opening choice, as ONE message: `python3 <REPO_ROOT>/shared-utils/signature_launch/experience/guided_experience.py --what opening` prints the introduction, the computed length estimate, and *"What is the best way for me to help you with your launch?"* with A (recommend a plan for me), B (guide me through each decision) and C (I already have a plan).
3. Ask ONE question, the next one that actually applies: `python3 <REPO_ROOT>/shared-utils/signature_launch/experience/render_question.py --answers-file <answers.json> --harness openclaw`. It selects through the shared intake engine, so a conditional question whose condition is false is never offered and a confirmed answer is never asked twice, and prints one short numbered message. `"done": true` means the interview has everything it needs.
4. Say ONE message in this session's own reply. Wait for the client's reply. Do not send the next question until they answer, and never send several questions at once.
5. Read the reply with `parse_reply` in `render_question.py`: a number picks that choice, any other text is their own answer, and "help", "not sure", "I don't know", "show me an example" or "help me answer" starts the coaching path. Never treat silence or "skip" on a must-answer question as an answer.
6. Record the answer into the answers file with the intake engine, in `its intake`. If the session restarts, run step 3 again: confirmed answers are skipped, the rest are asked. Send `guided_experience.py --what progress` when the client asks how far along they are.

## When the client does not know

They pick "I'm not sure, help me", or type "I don't know", "not sure", "show me an example" or "help me answer". Every one of those is a HELP REQUEST, never a recorded answer:

1. **Show an example** from the question's own nested `help.examples`.
2. **Explain it** in the words of the question's `help.explain`.
3. **Recommend using what is known** from the answers already recorded.

For colours the engine also offers three concrete ways: read them from the logo file, read them from the website (a plain web fetch of the page and its stylesheet; no browser of any kind), or pick one of three palettes, each with plain-English reasons. A second "I don't know" on a question that has a safe default applies it, flagged "to confirm"; a question with no safe default stays in the interview and is named plainly, because the build waits for it.

## Progress and delivery

- While pages build, send one short message per FINISHED page: `python3 <REPO_ROOT>/shared-utils/signature_launch/experience/progress_report.py --rows-file <rows.json> --harness openclaw --announced <keys already sent>`. Keep the printed `announced` keys so no page is announced twice. No walls of text.
- At the end, send `python3 <REPO_ROOT>/shared-utils/signature_launch/experience/delivery_report.py --rows-file <rows.json> --answers-file <answers.json> --ledger-file <ledger.json> --harness openclaw` as plain lines (no tables).

## Speed

Pages are built in parallel lanes by the launch dispatcher, not by chat. Never start a second run to go faster.

## Where the answers live

One answers file per run (the shared client-intake answers file, written by `shared-utils/client_intake/`). Every question, in every harness, comes from the same question bank and lands in the same answers file, so a run started in one harness can be resumed in another. Anything we had to default or suggest is listed under `to_confirm` and is reported at delivery with a one-line way to change it.

## Never

- Never guess a skills path. Use the install root you verified, or ask. This tree is the **999 distribution**: skills live under `<REPO_ROOT>/.claude/skills/` here and at the repository root in the onboarding repository. The code resolves both; a hand-written path resolves neither reliably.
- Never default price, offer name and claims, representation, community or bonus truth, entitlement, paid-render approval, the launch timing, the sender name or the reply address. These pause the build until the client answers.
- Never treat "I don't know" as an answer, and never skip past it: it opens coaching.
- Never promise sales figures, and never present a recommendation as an approval.
- Never show the client a schema name, an id, a hash or a provider route: translate it or leave it out.
- Never diagnose the client, and never turn the conversation into therapy. This is a planner.

The adapter changes HOW the client is asked and told, never WHAT the gates enforce.
