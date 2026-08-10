# Changelog

## [1.1.0] — 2026-08-10

### The fleet-fusion standard (the Spaulding spec, now the default for everyone)

- **DS Max = DeepSeek v4 FLASH + thinking MAX** (was Pro) — the operator's verified
  canary. Custom node on `https://api.deepseek.com`. Routes to **Opus**.
- **DS Light = DeepSeek v4 FLASH + thinking OFF** — custom node, routes to **Haiku**.
- **Sonnet → Agnes 2.5 Flash** (custom provider, the client's OWN Agnes key from their
  secrets env; never the operator's, never Pro Alpha).
- **Fusion combo `FusioN-smartest-agent`** — panels [DS Max Flash-max, GLM 5.2
  (Ollama Cloud), NVIDIA-free (OpenRouter)], judge **DeepSeek v4 Pro max**. Wired as
  **Fable** for every client.
- **NVIDIA-free custom provider** (`openrouter-nvidia-free`) — built from the client's
  OWN OpenRouter key (all secrets envs checked). If the key is absent, the setup still
  proceeds and **requests the key** rather than silently skipping.
- **Missing-key behavior** — if a client's Agnes/OpenRouter/Ollama key is not in their
  secrets env, the setup wires everything it can and tells the user plainly which key
  is needed to continue. Never uses the operator's keys.

### Critical fixes

- **Skill install root fixed** — `setup-macos.sh` now installs skills into
  `~/.claude-nine/skills/` (the config root `claude-nine` actually reads via
  `CLAUDE_CONFIG_DIR`), NOT `~/.claude/skills/` which is invisible to claude-nine
  sessions. This is the fix for `/spec-protocol` and `/nine-router-setup` not appearing.
  Root cause verified by three independent reviews (Opus, GLM 5.2, Kimi 2.6).
- **Spec-protocol updated** to the operator's latest live version (53,266 bytes).

## [1.0.0] — 2026-08-09

### Critical fixes

- **Dashboard password rotation** — setup now rotates the default `123456` password on
  first login (9Router forces `mustChangePassword`). The rotated password reaches the
  orchestrators via `report.dashboardPassword` (the single sanctioned exception to
  "never print keys"); both platform orchestrators consume it for subsequent API calls.
  Fixes the failure where every fresh install broke on password auth after setup.
- **DS Light / DS Max custom provider nodes** — two new DeepSeek custom nodes with
  deterministic thinking control: `ds-light/deepseek-v4-flash` (thinking OFF) and
  `ds-max/deepseek-v4-pro` (thinking MAX). Opus now routes to DS Max; Haiku routes to
  DS Light with an Agnes 2.5 Flash fallback (`blackceo-haiku-fallback` combo).
- **Ultracode / model-choice integrity** — spec-protocol now reads the router's actual
  wiring and reports it before the build; the Claude-Nine role table carries four roles
  (builder, QC/fixer, merger, comparative critic); thinking levels are **verified per
  route with real probes** (1500-token floor) and recorded in `report.thinkingVerified`.
- **Agnes AI roster** — both models (`agnes-2.5-flash`, `agnes-2.5-pro`) registered in
  the `kv` table; `defaultModel` set per connection. (`agnes-2.5-pro-alpha` was an
  unrequested addition and was removed.)
- **`resolvedRoutes` emitted** — the verified live routes reach the orchestrators, so
  completion reports never fall back to hardcoded defaults.

### Fixes found by the DeepSeek v4 Pro review pass

- **Password rotation mismatch** — orchestrators no longer regenerate a DIFFERENT random
  password than the one the configurator set; they consume `report.dashboardPassword`.
- **Stale `providers` array** — `refreshProviders()` re-fetches after every connection
  creation so `defaultModel` is applied to newly created connections, not silently skipped.
- **`haikuFallback` route** — emitted in `resolvedRoutes`, carried by the state writer.
- **Windows python path** — `resolvePython()` probes `python`/`py -3` on win32,
  `/usr/bin/python3`/`python3` on POSIX; `node:sqlite` preferred (Node 22.5+), loud
  warning if both backends missing — never silent.

### Spec-protocol backport

- **Block D** — four measuring-stick questions (D1 gold-standard bar, D2 as-good-as vs
  rulebook, D3 capture-tool download consent, D4 avoid-that list). Runs on BOTH harnesses;
  never collapses on small plans.
- **Law 50** — "the bar wins by default"; BLOCKED/INFEASIBLE/LIMIT REACHED/USER STOPPED
  are never relabeled PASS.
- **Capture-tooling preflight** — Playwright is the default capture tool, install-then-prove.
- **GATE 0** — two-way ultracode instructions (`/effort ultracode` session-wide, or
  `ultracode /spec-protocol` per message); "Nothing has run yet" reassurance.
- **4th role budget** — comparative critic counted in the 9.4 spend-per-window arithmetic.

### Launcher

- All four alias pins carry the production routes with `(max)` suffixes; Haiku fallback
  env var; port-liveness check with bounded retry; dup-fix guard auto-run on every start.

### Known residual risks (accepted, documented)

- Thinking verification probes confirm content returns but do not introspect whether
  thinking tokens were consumed on max lanes — a `(max)` suffix silently dropped would
  still report OK. Mitigation: `providerThinking` is also set per provider as belt-and-braces.
- Dashboard URL is reconstructed from the port with `127.0.0.1` — correct for the
  loopback-only default; a remote `NINEROUTER_BASE` would need the host preserved.
