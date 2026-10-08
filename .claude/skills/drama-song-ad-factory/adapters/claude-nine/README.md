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
   The user's own choice always wins: use the session's model or the aliases
   the user configured, never a model or agent this skill picked. Say loudly
   what is missing and let the user pick.
4. Orchestrate: Claude-Nine dispatches the build through workflows and
   subagents within the repository's staffing ceilings instead of performing
   the whole production personally. Every dispatched worker invokes the same
   control entrypoint; a worker's prompt cannot bypass a failed shared guard.
   The main window only orchestrates; all work runs in visible workflows and
   agents, and a broken one is reported at once, never allowed to fail silently.
5. Before any paid work: `intake` then `preflight` must exit 0 (or an
   understood `waiting`/`parked` that a human resolves). Read the envelope's
   `reason_code`; do not reinterpret prose around a nonzero exit.
6. Prove the environment once per install: run
   `python3 tests/test_cli_smoke.py` and
   `python3 tests/test_parity_layout.py`, then one `preflight` against the
   approved storage root, and record the envelopes as evidence.
7. Keep credentials out of this skill folder, and never print or log a
   credential value — preflight checks presence by name only (directive 5.3).
   Record compatibility-only changes; never overwrite an existing target.

## Stated prerequisite: Skill 74 (`74-kie-live-adapter`)

`scripts/core/kie_dispatch/` is home to this skill's only media dispatcher,
`kie_dispatch` (plan section 5.4). It carries no KIE client of its own: it
resolves `kie_live_adapter.py` and runs Skill 74 as a single subprocess.
**Skill 74 is a stated prerequisite of this skill and is not installed by
this skill folder**, so install it before dispatching any generation —
otherwise `kie_dispatch` stops with `adapter-not-found`, and there is
deliberately no private KIE fallback and no second transport. The install
goes into the one shared skills root, so plain `claude` sees it too; do not
give Claude-Nine its own copy.

Install steps (run from the `999-setup` repository root):

```bash
# 1. check the vendored helper against its pinned tree sha256
python3 installer-registration/helper-deps.py preflight

# 2. install it into the shared skills root: <config-root>/skills/74-kie-live-adapter
python3 installer-registration/helper-deps.py install

# 3. inside the installed skill folder: offline QC, then wire
cd <config-root>/skills/74-kie-live-adapter
bash qc-74-kie-live-adapter.sh    # no network, no key; must exit 0
bash wire.sh                      # idempotent; second run changes nothing

# 4. mode stays shadow until an operator activates it on purpose
bash scripts/live_smoke.sh        # free calls only; operator account
```

Also required: `python3` on PATH and `KIE_API_KEY` present by name (never
printed). `kie_dispatch` reads the adapter mode with Skill 74 `health` at
preflight; in shadow or off it stops before the approval card and tells the
client generation is not switched on for this box — orchestration must not
route around that stop. Set `KIE_LIVE_ADAPTER_PATH` only when the adapter
sits outside every location the dispatcher searches.
