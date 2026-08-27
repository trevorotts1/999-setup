# CONTROL/dependency-exceptions.md — dependency exception registry (FIX-023)

This file is the single governing registry for every audit finding that is not
fixed immediately. No finding may be suppressed silently: every cargo-deny
license exception in `deny.toml`, every cargo-deny/RustSec advisory `ignore`,
and every `npm audit` exception (should the release authority ever accept one —
it currently accepts none) must be backed by a row in this registry. A
`deny.toml`/audit entry without a matching registry row is a release blocker,
not a pass.

Governed by this file (F23-06): `deny.toml` exceptions, RustSec advisory
suppression, npm audit findings left unresolved. The release authority
(`scripts/candice-release/status.mjs`, supplyChain gate) fails closed when the
registry contains any expired entry, any entry without a named approver, or
any entry whose category does not match its disposition rules.

## Registry schema

Each exception is one table row. Required columns:

| Column | Meaning | Rules |
|---|---|---|
| `id` | Exception ID | `EXC-<YYYY-MM-DD>-<NN>` — creation date, two-digit sequence; unique forever; never reused |
| `ecosystem` | Where the finding surfaced | `cargo-deny-license` \| `cargo-deny-advisory` \| `npm-audit` |
| `package` | Affected package | Exact crate or npm package name and version |
| `finding` | The finding text | License expression denied, or advisory ID (GHSA/RUSTSEC/CVE) |
| `severity` | Finding severity | `low` \| `moderate` \| `high` \| `critical` (npm scale) or cargo-deny class |
| `category` | Disposition class | `license-classification` (allow-list judgment, non-expiring) \| `temporary` (time-bounded) \| `permanent-ruling` (non-expiring, operator ruling required) |
| `risk-rationale` | Why this is acceptable | Must name the specific risk and why the mitigation bounds it |
| `mitigation` | What bounds the risk | Concrete, verifiable action; a vague promise is an unapproved row |
| `expires` | Expiry | ISO 8601 date for `temporary`; `never` for the other two categories |
| `approver` | Named approver | A real name; `UNSET` rows fail the release authority |
| `evidence` | Proof of review | Path to the builder/reviewer evidence record |

Rules:

1. **Time-bounded only.** `temporary` rows carry an expiry date. The release
   authority refuses release when any `temporary` row is expired; an expired
   row must be renewed (new review, new evidence) or the finding fixed.
2. **Named approver.** A row whose `approver` is empty or `UNSET` is
   unapproved and fails the release authority.
3. **No silent suppression.** Every exception row must be cross-referenced by
   the tool configuration it justifies (the `deny.toml` comment names the row
   ID; the row's `finding` names the tool). A one-sided entry is an incomplete
   exception and fails the release authority.
4. **Builder and reviewer both sign.** Per F23-06: "No exception may be
   recorded without the builder and reviewer both signing it in the evidence
   record." The `evidence` column must point at a record naming both.
5. **License allow-list additions are exceptions.** A license added to
   `[licenses.allow]` in `deny.toml` is a classification judgment and gets a
   `license-classification` row here. Removal of a license from the allow-list
   removes its row.

## Exceptions

| id | ecosystem | package | finding | severity | category | risk-rationale | mitigation | expires | approver | evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| EXC-2026-08-23-01 | cargo-deny-license | webpki-root-certs 1.0.9 (via rustls 0.23 -> tauri 2.11.5) | license `CDLA-Permissive-2.0` not in allow-list (live `cargo deny check` rc=4) | moderate | license-classification | CDLA applies to the bundled Mozilla root-CA certificate *data*, not code; the Permissive variant allows redistribution and commercial use with no copyleft or source-offer obligation. Same license class already judged acceptable for Apache-2.0/MIT data-bearing crates in this tree. | License allow-listed in `deny.toml` with in-file justification; live re-check exits 0; registry row cross-references the deny.toml comment | never | Trevor Otts (operator, release authority) | `CONTROL/crate-tree-ownership.md` amendment (2026-08-23); this file; H15-03 repair commit record |

## Prohibited dispositions

- `forbidden` redistribution ruling on any shipped component (release authority refuses).
- Any row whose `finding` is not reproducible from the tool that surfaces it.
- Any `npm audit` exception — the npm gate is `--audit-level=high` with zero
  allowed findings; no npm row may exist while a high/critical finding is open.
  If a row of this ecosystem appears, it must be accompanied by the CI gate
  change that makes the exception visible, and the release authority refuses
  until the finding is fixed or downgraded to a documented moderate-or-lower
  with operator sign-off.
