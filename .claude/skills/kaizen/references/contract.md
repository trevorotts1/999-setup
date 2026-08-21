# Kaizen Contract — generation, approval, versioning

## Required fields

- Contract version
- Loop ID
- Friendly Loop name
- Date created
- Target type
- Target name
- Target locators
- User's stated improvement direction
- What the target is supposed to do (purpose, who it serves, the invariant
  golden rule 1 protects — captured in the interview's Target question)
- Open-discovery clause (always present — see onboarding.md §Better)
- Scope per cycle
- Permission/action mode
- Explicit approval boundaries
- Proof strategy
- Requested interval (asked last in the interview — after target, location,
  direction, scope, permission, and proof are known)
- Chosen scheduling mechanism
- Model/logical lane preference
- Memory location
- GitHub backup status
- What happens on failed tests
- What happens on critical findings
- What happens when user action is required
- Pause/stop behavior
- User approval timestamp

## Format

Use `templates/KAIZEN_CONTRACT.template.md`. Fill every field. Plain language,
about fifth- to seventh-grade reading level.

## Approval flow

1. Present the Contract.
2. Ask: "This is your Kaizen Contract. Do you approve it?"
3. On approval: record the approval timestamp in the Contract and in
   `STATE.json`, then activate (first cycle starts immediately unless the
   user explicitly says to wait — see pdca-cycle.md §first cycle).
4. On change request: revise the Contract, **increment the contract version**,
   ask again. Never activate without approval.
5. Do NOT activate recurring work before approval — no scheduler, no
   LaunchAgent, no `/loop` arm, no Routine.

## Boundaries written into every Contract

Stop-for-approval list (see SKILL.md §5 and pdca-cycle.md §safety):

- merge to `main`/default/protected branch;
- production deploy;
- destructive database migration;
- delete production data;
- rotate production credentials;
- change payment processor;
- live Stripe product/price/webhook changes;
- send real customer emails/messages;
- change broad access-control policy;
- remove a core integration;
- irreversible infrastructure action;
- costly external purchase/service action;
- legal/compliance decision requiring owner judgment.

Human wording for the Contract (adapted):

> Where I stop:
> - I do not merge to the main branch without your okay.
> - I do not deploy to production without your okay.
> - I do not make live payment, destructive database, or major permission
>   changes without your okay.

## Editing an existing Contract

`/kaizen contract [loop]` shows the Contract. If the user wants a change:

1. Create a NEW contract version (increment `contract_version`).
2. Keep a copy of the previous approved version (append `.v<N>-<date>.bak`
   style or keep history in the Contract file).
3. Ask for approval again.
4. Update `STATE.json` only after approval.
