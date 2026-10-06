# Claude-Nine adapter

Claude-Nine shares the same Claude config root and personal skills as plain
`claude`, so one install of this skill is visible to both. This adapter is
about routing and orchestration guidance, not a duplicated skill. Do not
invent a Claude-Nine-only skills path and do not create a second
independently maintained copy of this skill.

1. Install the skill once into the shared skills root (the same root plain
   `claude` reads), via `CONTROL/bundled-skills.txt`. Never set a separate
   config directory for Claude-Nine.
2. Confirm the router itself is installed and healthy using the
   `nine-router-setup` skill. Routing is Claude-Nine's own law, not
   something this skill configures: this skill must never write a router
   base URL into global Claude settings or shell startup files.
3. Resolve model roles for agent work against the live rules of the current
   mode (router catalog / current router guidance), never against a hardcoded
   table in this skill. If a required role or model is absent from the live
   catalog, stop with a precise error naming the model and the catalog
   checked; never silently substitute.
4. Orchestrate: Claude-Nine dispatches the build through workflows and
   subagents within the repository's staffing ceilings instead of performing
   the whole production personally. Every dispatched worker invokes the same
   control entrypoint; a worker's prompt cannot bypass a failed shared guard.
5. Before any paid work: `intake` then `preflight` must exit 0 (or an
   understood `waiting`/`parked` that a human resolves). Read the envelope's
   `reason_code`; do not reinterpret prose around a nonzero exit.
6. Prove the environment once per install: run
   `python3 tests/test_cli_smoke.py` and
   `python3 tests/test_parity_layout.py`, then one `preflight` against the
   approved storage root, and record the envelopes as evidence.
7. Keep credentials out of this skill folder. Record compatibility-only
   changes; never overwrite an existing target.
