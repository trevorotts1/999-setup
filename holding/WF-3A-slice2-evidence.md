# WF-3A slice 2 evidence — DESIGN-BRIEF step: researched site-type design brief content

Issue 6 FIX step 1 (999-master-fix-spec-20260815.md lines 103-145), slice 2 of WF-3A.
Branch: fix/6-design-brief in clone /Users/blackceomacmini/work-999-setup-fix/WF-3A.
Prior slices on this branch: b880837 (7-stage funnel process, FIX step 3), 0fad934 (MOBBIN-CHECK, FIX step 1). Slice 2 adds the researched per-site-type content that makes the brief non-vague.

## What changed

1. `references/funnel-architecture.md` §15 — replaced the bare "Dispatch reader agents" placeholder with three researched per-site-type blocks (A: dentist/medical brochure, B: coaching/service funnel, C: SaaS landing), each covering hero structure, layout systems, typography scale, color systems, conversion patterns, mobile behavior, accessibility (WCAG AA contrast, focus order, alt text) — plus a "The brief itself" section enumerating the four mandatory contents of the written brief (site-type patterns with sources; the named copy-bar example page per Law 48; design tokens for STAGE-SCAFFOLDING; the DESIGN-BRIEF ledger line citing sources).
2. `references/interview.md` DESIGN-BRIEF gate — item 1 now names the per-site-type researched defaults in funnel-architecture.md §15 as the source, with every claim cited.

## Research performed (the reader-agent pass, per spec FIX step 1 "dispatch reader agents")

- goodui.org (fetched 2026-08-16): one-column layout, visual hierarchy, fewer borders, benefit buttons, more contrast, attention grabs, keeping focus, fewest form fields, fewer options, recommending a plan, friendly comparisons, distinct clickable styles, icon labels, sticky bottom CTA on mobile (Test #665), fewer form fields, social proof, repetition, reassurances.
- blog.hubspot.com landing-page best practices (fetched 2026-08-16): benefit-first headline, sub-headline = who it's for, outcome-focused hero image, CTA above fold, no nav menu, no footer links, one path, name+email only at top of funnel, "Get the guide" beats "Learn more", pain-point headlines, click-trigger microcopy, 5-second skim test, thank-you page as second conversion, personalized CTAs +202%, mobile >50% traffic optimize there first, no autoplay video (GameBoost), real-device testing.
- Mobbin MCP screen search (configured-check research, 2026-08-16): dentist/practice family — Fresha, Heidi, Care.com (web); SaaS family — StackAI, Langdock, Laravel Cloud, Airtable, Customer.io (web). Named, credited inspiration per MOBBIN-CHECK usage rules.
- Existing repo research reused with citation: funnel-architecture.md §2 (2026-08-10 pass): one CTA per page 13.5% vs 10.5% at 5+ CTAs (Unbounce); §4 benchmarks.

## Design decisions

- The researched defaults are the named baseline the live reader agents confirm/correct at run time — the dispatch instruction remains (one reader per site type, cheap tier, source-URL beside every claim, references/research.md Step 1), and the content prevents a vague "make it look good" brief.
- WCAG figures (4.5:1 body, 3:1 large text and UI components) carry the standing freshness rule from §14: re-verify against current WCAG understanding documents at run time.
- Mobbin screens cited by name and URL only where Mobbin is configured; referral-link website is the browser reference when not (per MOBBIN-CHECK rules in §15).
- No new document created — the brief rides in document 1's conventions per Law 39 (already stated in §15, now with enumerated required contents).

## FIX step 1 coverage check (spec lines 103-145)

- [x] DESIGN-BRIEF step after RESEARCH-READY gate, before any page build (prior slices + §15 header)
- [x] MOBBIN-CHECK numbered 1-4 with ledger vocabulary (prior slice 0fad934)
- [x] Never change 9Router settings; PRIMARY use case claude-nine (prior slice 0fad934)
- [x] Dispatch reader agents per site type, cited sources (this slice — content + dispatch instruction)
- [x] Cover hero structure, layout, typography, color, conversion, mobile, accessibility (this slice — blocks A/B/C)
- [x] Brief as named section of master spec conventions, Law 39 closed list (this slice — "The brief itself" enumeration)
- [x] DESIGN-BRIEF: <sources> ledger line (gate in interview.md + §15)

## Commit

To be committed as one unit citing WAVE 3 REDISPATCH, per the ledger contract.
