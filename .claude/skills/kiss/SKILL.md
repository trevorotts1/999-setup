---
name: kiss
description: "One-message double answer. Put /kiss at the START of a message, followed by a question or statement — it answers THAT message twice: first in bro style (friendly, casual), then in plain short form (brief, direct). Use /kiss when you want every answer to land simply: friendly first, ultra-short second."
license: MIT
---

# /kiss — answer twice: friendly, then short

The user typed `/kiss` at the START of their message, followed by a question or statement.
Your job: answer THAT SAME message twice, in two labeled parts.

**It controls the answer to this message only.** Not the previous answer (that is /bro) and
not future answers (that is /eli5's persistent mode). Nothing stays switched on afterwards.

## The two parts, in this order

1. **The friendly version** — answer the question in /bro's style: like explaining it to a
   smart friend over a beer, casual and direct. Simpler, not necessarily shorter. Light bro
   flavor ("basically...", "ok so..."). Flatten structure — no headers or ceremony, tables
   become plain sentences. Every fact, path, command, filename, number, URL, name and
   decision kept EXACTLY.

2. **The short version** — the same answer in plain language, with no analogies unless the
   concept is genuinely non-obvious. Cut filler, pleasantries, hedging, intros and
   transitions. Lead with the answer. Write plain full short sentences — no fragments, no
   arrow or equals symbols, no dropped articles, and every acronym spelled out in full.
   Brief.

Label the two parts plainly: write **"The friendly version"** before the first and
**"The short version"** before the second. Nothing before or after them.

## Rules

- Unlike /bro, /kiss ANSWERS a new question and MAY use tools to get the answer — the style
  rules apply only to how the final answer is written.
- Code blocks, exact error messages and commands stay verbatim in both parts. Technical
  terms stay.
- Safety warnings and irreversible-action confirmations are stated plainly and fully in
  both parts, overriding the short version's style for those.
- Use names, never pronouns, for people.
- Same language as the question. English stays English; PT-BR stays PT-BR; and so on.
- If `/kiss` arrives alone with nothing after it, ask in one line what to break down.

## Example

`/kiss why is my JWT auth failing on the API?`

The friendly version: basically the API is checking the token's expiry against the wrong
clock — a JWT `exp` field is in seconds, but the code compares it to `Date.now()`, which is
milliseconds, so every token looks already expired the moment it arrives. Divide by 1000
and the check works.

The short version: `Date.now()` gives milliseconds, but a JSON Web Token's `exp` field is
in seconds. The code compares the two values directly. Divide the milliseconds by 1000.