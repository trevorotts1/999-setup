#!/usr/bin/env python3
"""Front-door skill doc test — amendment U4-a through U4-g (KIE-U4).

Runs the required checks against `.claude/skills/kie/SKILL.md`:

  U4-a  Sources line points at kie-official-agent-docs-digest.md and
        kie-common-rules.md (both under 07-kie-setup/references/)
  U4-b  key rules: KIE_API_KEY, SET or NOT SET only, never paste the key in
        chat, reset a leak at kie.ai/api-key
  U4-c  model names only from skill 74 discover or skills 66/67/68, never
        from memory; Bearer-only authentication; check the code inside the
        reply; save results at once (14 days results, 24 hours uploads);
        20 new jobs per 10 seconds per key with the 429 did-not-run
        resubmit-never-drop rule
  U4-d  shadow-vs-active rule for kie-live-adapter-mode.conf, flipped only
        by a passing credits check; skill 74 the only paid transport
        (nothing calls api.kie.ai directly; credits and model lists go
        through skill 74)
  U4-e  plain-English troubleshooting table: 401, key missing, task failed
        = kie.ai/logs, 402 = kie.ai/pricing, link expired
  U4-f  Never list: no `npx skills add https://kie.ai`, no KIE MCP, no
        direct curl to api.kie.ai from a session, never point Claude Code
        or claude-nine at api.kie.ai/anthropic (9Router / chat-billing /
        settings-file override), never write a translation proxy

Plus the acceptance checks: the front door names helpers 66, 67, 68, 46 and
74 as the only paid transport, states the rate limit with the never-drop
wording, names KIE_API_KEY as the client's own key, carries the mode file
with its credits gate, points at the rules file, carries the Anthropic base
URL warning, and both drama-factory adapter READMEs no longer claim a single
shared root.

(U4-g) Negative control: every required element is deleted from an in-memory
copy of the document and the same check must then report it missing — a
check that cannot fail is not a check. The adapter-claim check gets the same
treatment: an old single-root claim injected into a clean README must trip.

stdlib only, no framework, no network, no skips.
Run: python3 .claude/skills/kie/tests/test_front_door_docs.py
"""
import re
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]
DOC = SKILL / "SKILL.md"
ADAPTERS = [
    REPO / ".claude" / "skills" / "drama-song-ad-factory" / "adapters"
    / "claude-code" / "README.md",
    REPO / ".claude" / "skills" / "drama-song-ad-factory" / "adapters"
    / "claude-nine" / "README.md",
]

FAILS = []


def check(name, ok, detail=""):
    print(f"{'ok' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def flat(text):
    return " ".join(text.split())


def norm(text):
    """README claim matching: markdown backticks stripped, case-insensitive."""
    return flat(text.replace("`", "")).casefold()


# (id, group, compiled pattern, human description)
# Patterns match against the whitespace-collapsed document.
REQUIRED = [
    # --- U4-a Sources ---------------------------------------------------
    ("U4-a-digest", "U4-a",
     re.compile(r"sources:.{0,400}07-kie-setup/references/kie-official-agent-docs-digest\.md",
                re.I | re.S),
     "Sources line points at 07-kie-setup/references/kie-official-agent-docs-digest.md"),
    ("U4-a-rules", "U4-a",
     re.compile(r"sources:.{0,400}07-kie-setup/references/kie-common-rules\.md",
                re.I | re.S),
     "Sources line points at 07-kie-setup/references/kie-common-rules.md"),
    # --- U4-b key rules -------------------------------------------------
    ("U4-b-name", "U4-b",
     re.compile(r"\bKIE_API_KEY\b"),
     "key variable KIE_API_KEY named"),
    ("U4-b-set", "U4-b",
     re.compile(r"set or not[\s-]set", re.I),
     "output is SET or NOT SET only"),
    ("U4-b-chat", "U4-b",
     re.compile(r"never paste the key in chat", re.I),
     "never paste the key in chat"),
    ("U4-b-reset", "U4-b",
     re.compile(r"reset it at[^.]{0,40}kie\.ai/api-key", re.I),
     "leaked key reset at kie.ai/api-key"),
    # --- U4-c reply / transport discipline ------------------------------
    ("U4-c-models", "U4-c",
     re.compile(r"model names come only from skill 74 `?discover`? or from skills 66, 67, 68\..{0,80}never from memory",
                re.I | re.S),
     "model names only from skill 74 discover or skills 66/67/68, never from memory"),
    ("U4-c-bearer", "U4-c",
     re.compile(r"bearer-only", re.I),
     "Bearer-only authentication"),
    ("U4-c-code", "U4-c",
     re.compile(r"check the code inside the reply", re.I),
     "check the code inside the reply"),
    ("U4-c-save", "U4-c",
     re.compile(r"save results at once", re.I),
     "save results at once"),
    ("U4-c-retention", "U4-c",
     re.compile(r"14 days.{0,200}24 hours|24 hours.{0,200}14 days", re.I | re.S),
     "retention: 14 days results, 24 hours uploads"),
    ("U4-c-rate", "U4-c",
     re.compile(r"20 new jobs per 10 seconds per key", re.I),
     "20 new jobs per 10 seconds per key"),
    ("U4-c-429", "U4-c",
     re.compile(r"429 means the job did not run", re.I),
     "429 means the job did not run"),
    ("U4-c-resubmit", "U4-c",
     re.compile(r"resubmit it later.{0,160}never drop it|resubmit.{0,160}never drop", re.I | re.S),
     "resubmit a 429 later and never drop it"),
    # --- U4-d shadow vs active -----------------------------------------
    ("U4-d-modefile", "U4-d",
     re.compile(r"kie-live-adapter-mode\.conf"),
     "shadow/active mode file kie-live-adapter-mode.conf"),
    ("U4-d-credits", "U4-d",
     re.compile(r"only when that\s+check passes does an operator write `?active", re.I | re.S),
     "mode flipped only by a passing credits check"),
    ("U4-d-only74", "U4-d",
     re.compile(r"skill 74 is the only paid transport", re.I),
     "skill 74 is the only paid transport"),
    ("U4-d-nodirect", "U4-d",
     re.compile(r"nothing calls `?api\.kie\.ai`? directly", re.I),
     "nothing calls api.kie.ai directly"),
    ("U4-d-creditroute", "U4-d",
     re.compile(r"credits check and the model list: those also go through\s+skill 74", re.I | re.S),
     "credits and model lists also go through skill 74"),
    # --- U4-e troubleshooting table ------------------------------------
    ("U4-e-401", "U4-e",
     re.compile(r"\|\s*401\s*\|[^|]*wrong, expired or rejected[^|]*\|[^|]*kie\.ai/api-key", re.I),
     "table: 401 = key wrong/expired/rejected -> kie.ai/api-key"),
    ("U4-e-keymissing", "U4-e",
     re.compile(r"\|\s*Key missing\s*\|", re.I),
     "table: key missing row"),
    ("U4-e-failed", "U4-e",
     re.compile(r"\|\s*Task failed\s*\|[^|]*\|[^|]*kie\.ai/logs", re.I),
     "table: task failed = kie.ai/logs"),
    ("U4-e-402", "U4-e",
     re.compile(r"\|\s*402\s*\|[^|]*credits[^|]*\|[^|]*kie\.ai/pricing", re.I),
     "table: 402 = not enough credits -> kie.ai/pricing"),
    ("U4-e-link", "U4-e",
     re.compile(r"\|\s*Link expired\s*\|", re.I),
     "table: link expired row"),
    # --- U4-f Never list ------------------------------------------------
    ("U4-f-npx", "U4-f",
     re.compile(r"never `?npx skills add https://kie\.ai", re.I),
     "Never: no npx skills add https://kie.ai"),
    ("U4-f-mcp", "U4-f",
     re.compile(r"never add a kie mcp server", re.I),
     "Never: no KIE MCP"),
    ("U4-f-curl", "U4-f",
     re.compile(r"never a direct `?curl`? to `?api\.kie\.ai`? from a session", re.I),
     "Never: no direct curl to api.kie.ai from a session"),
    ("U4-f-anthropic", "U4-f",
     re.compile(r"never point claude code or claude-nine at `?https://api\.kie\.ai/anthropic|never point claude code or claude-nine at `?api\.kie\.ai/anthropic", re.I),
     "Never: never point Claude Code or claude-nine at api.kie.ai/anthropic"),
    ("U4-f-router", "U4-f",
     re.compile(r"replace the\s+9router base url and break routing", re.I | re.S),
     "Anthropic warning: replaces the 9Router base URL and breaks routing"),
    ("U4-f-billing", "U4-f",
     re.compile(r"move chat billing to kie", re.I),
     "Anthropic warning: moves chat billing to KIE"),
    ("U4-f-settings", "U4-f",
     re.compile(r"settings-file value\s+overrides the launcher's router address", re.I | re.S),
     "Anthropic warning: a settings-file value overrides the launcher's router address"),
    ("U4-f-proxy", "U4-f",
     re.compile(r"never write a translation proxy", re.I),
     "Never: never write a translation proxy"),
    # --- base acceptance (item e) --------------------------------------
    ("e-img", "base",
     re.compile(r"\|\s*Image generation, image models\s*\|\s*`66-kie-image`", re.I),
     "names 66-kie-image for images"),
    ("e-vid", "base",
     re.compile(r"\|\s*Video generation, video models\s*\|\s*`67-kie-video`", re.I),
     "names 67-kie-video for video"),
    ("e-aud", "base",
     re.compile(r"\|\s*Audio and music generation\s*\|\s*`68-kie-audio`", re.I),
     "names 68-kie-audio for audio"),
    ("e-cb", "base",
     re.compile(r"\|\s*Job callbacks \(production polling\)\s*\|\s*`46-kie-callback-relay`", re.I),
     "names 46-kie-callback-relay for callbacks"),
    ("e-74", "base",
     re.compile(r"every paid kie call.{0,60}goes through skill 74", re.I | re.S),
     "all paid calls go through skill 74"),
    ("e-clientkey", "base",
     re.compile(r"client's own key, never an operator key", re.I),
     "KIE_API_KEY is the client's own key, never an operator key"),
    ("e-rulesfile", "base",
     re.compile(r"07-kie-setup/references/kie-common-rules\.md"),
     "points at 07-kie-setup/references/kie-common-rules.md"),
    ("e-promptbudget", "base",
     re.compile(r"prompt budget", re.I),
     "prompt budget rule present"),
]

# Old single-root claims that must be GONE from the adapter READMEs.
OLD_CLAIMS = [
    "claude-nine shares this root",
    "shares the same claude config root",
    "one shared root",
    "shared skills root",
    "never create a second skills root",
    "claude and claude-nine read the one shared root",
]
# New two-root claims that must be PRESENT in both adapter READMEs.
NEW_CLAIMS = [
    "two config roots",
    "sync-nine-skills.sh",
    "~/.claude/skills",
    "~/.claude-nine/skills",
    "install the skill once",
]


def missing_elements(text, elements=REQUIRED):
    flatdoc = flat(text)
    return [eid for eid, _grp, rx, _desc in elements if not rx.search(flatdoc)]


def old_claim_hits(text):
    body = norm(text)
    return [c for c in OLD_CLAIMS if norm(c) in body]


def missing_new_claims(text):
    body = norm(text)
    return [c for c in NEW_CLAIMS if norm(c) not in body]


def main():
    # --- the front-door document itself --------------------------------
    check("SKILL.md present at .claude/skills/kie/SKILL.md", DOC.is_file(), str(DOC))
    if not DOC.is_file():
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    doc = DOC.read_text(encoding="utf-8")

    for eid, grp, _rx, desc in REQUIRED:
        ok = eid not in missing_elements(doc)
        check(f"{grp}: {desc}", ok)

    # --- adapter READMEs: old single-root claim gone, two-root claim in --
    for readme in ADAPTERS:
        rel = readme.relative_to(REPO)
        check(f"{rel}: README present", readme.is_file(), str(readme))
        if not readme.is_file():
            continue
        body = readme.read_text(encoding="utf-8")
        hits = old_claim_hits(body)
        check(f"{rel}: no single-shared-root claim remains", not hits, f"hits={hits}")
        miss = missing_new_claims(body)
        check(f"{rel}: describes two config roots and the sync step", not miss,
              f"missing={miss}")

    # --- (U4-g) negative control: remove one required element each ------
    # Mutate the same flattened text the checks read, so a positive pass and
    # a negative trip are decided by one identical input shape.
    flatdoc = flat(doc)
    for eid, grp, rx, desc in REQUIRED:
        mutated = rx.sub("[removed-by-negative-control]", flatdoc)
        if mutated == flatdoc:
            check(f"negative control {eid}: element is actually removable", False,
                  "pattern never matched — control is vacuous")
            continue
        still = missing_elements(mutated)
        check(f"negative control {eid}: test trips when its element is removed",
              eid in still, f"missing={still}")

    # empty document must trip every element
    check("negative control: empty document trips every element",
          len(missing_elements("")) == len(REQUIRED),
          f"{len(missing_elements(''))}/{len(REQUIRED)}")

    # adapter claim check must trip on an injected old claim
    for readme in ADAPTERS:
        if not readme.is_file():
            continue
        rel = readme.relative_to(REPO)
        body = readme.read_text(encoding="utf-8")
        injected = body + "\nInstall once; claude-nine shares this root.\n"
        check(f"negative control {rel}: injected old claim is detected",
              bool(old_claim_hits(injected)), old_claim_hits(injected))
        stripped = "\n".join(
            ln for ln in body.splitlines() if "sync-nine-skills" not in ln)
        check(f"negative control {rel}: removing the sync claim is detected",
              "sync-nine-skills.sh" in missing_new_claims(stripped))

    if FAILS:
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    print(f"\nALL PASS ({len(REQUIRED)} doc elements, "
          f"{len(ADAPTERS)} adapter READMEs, negative controls green)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
