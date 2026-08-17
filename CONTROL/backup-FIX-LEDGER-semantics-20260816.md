# CONTROL backup-FIX-LEDGER-*.md semantics

Documented 2026-08-16 (review finding, MINOR, closed by documentation — no code change).

## Verdict

CONTROL/backup-FIX-LEDGER-*.md files are genuine **working-tree snapshots taken between
commits**, not copies of committed ledger blobs. They are expected NOT to be byte-identical
to any commit. Their mtime precedes the commit that landed the line they precede by seconds;
residual diffs are exclusively (a) boss-cron 5-minute BOSSCYCLE auto-append lines and (b) the
not-yet-written line each backup preceded. No fabrication.

## Verified matrix (2026-08-16, live commands on this repo)

All four backups vs every FIX-LEDGER.md blob reachable via
`git log --all --follow -- FIX-LEDGER.md` — 20 commits (16 main-line, 4 side-branch twins
69d2bd3/5b2ac91/21002db/bdd1875). Counts = content diff lines (`diff` `<`/`>` lines).

| Backup (sha256 prefix) | mtime | Byte-identical to blob? | Nearest commit(s), diff |
|---|---|---|---|
| backup-FIX-LEDGER-bossfix-20260816.md (6f223a6b) | 19:28:41 | No | c103295 / bdd1875 (same blob): 3 lines — commit has `RECONCILE 2026-08-16T22:05Z` wave-boundary line + expanded `WAVE 6 DISPATCH` width-justification text, backup has pre-edit DISPATCH line. Next nearest 10. |
| backup-FIX-LEDGER-wave6close-20260816.md (136c4751) | 19:41:31 | No | c103295 / bdd1875: 3 lines — exactly 3 BOSSCYCLE-CLEAN auto-lines (23:30:01Z/23:35:00Z/23:40:02Z) present in backup, absent from commit. Next nearest 4. |
| backup-FIX-LEDGER-wf1a-20260816.md (c65ad39d) | 19:48:15 | No | b995017 / 5b2ac91 (same blob): 1 line — the `WF-1A-VERIFIED 2026-08-16T23:58Z` line itself (in commit, absent from backup). |
| backup-FIX-LEDGER-wf5c-20260816.md (b83a5027) | 19:53:25 | **Yes** | Original file byte-identical to blob at cab8a1f / 69d2bd3 (twins, b83a5027). Working-tree copy was updated 2026-08-16 22:29:38 local by another process to the corrected 31-merge-count MERGED line — that version matches blob at e9a4c29 (1ab34d6e), a later main-line commit. Both versions match committed blobs. |

## Corroboration

- Backup mtimes precede matching commits by seconds: bossfix 19:28:41 → c103295 19:29:00;
  wave6close 19:41:31 → ac678f7 19:43:03; wf1a 19:48:15 → b995017 19:48:41.
- The 3 BOSSCYCLE timestamps match CONTROL/boss-cron.log lines 122-124 verbatim
  (`0 violation(s), 0 kill(s), ledger appended`).
- Imprecision in the original finding: it states "18 commits" in `git log --follow`;
  actual counts are 16 (main line) / 20 (all branches). Comparison here used all 20 blobs,
  a superset — no-match conclusion unaffected.
- Original finding also bundled the 3 BOSSCYCLE auto-lines into the bossfix diff and counted
  the wf1a diff as 2 lines; the actual split is bossfix = 3 lines (RECONCILE + DISPATCH
  expansion), wave6close = 3 BOSSCYCLE auto-lines, wf1a = 1 line (WF-1A-VERIFIED). Same
  interpretation either way: pre-edit working-tree snapshots.
