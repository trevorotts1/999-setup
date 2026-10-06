// tools/windows-parity/src/engine.mjs — shared deterministic engine
// WS-27. Cross-platform reimplementation of the Spec Protocol deterministic
// tool semantics (capacity resolution, provenance marks, version compare,
// answers parsing) with IDENTICAL input/output schemas and exit-code
// semantics to the Bash tools. Zero dependencies; Node >= 18.
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IS_WINDOWS, probeCores } from './platform.mjs';
// The width instrument and the ONE cap formula live in the spec-protocol skill (capacity_probe.py via width.mjs); this tool carries no copy.
import { measureRamGb, measureCapacity, clientCapOf } from '../../../.claude/skills/spec-protocol/scripts/common/width.mjs';

export const WORKFLOW_CEILING = 50;
export const UNDETERMINED_CAP = 4;   // conservative floor, used (and named on the card) only when no cap could be measured
export const SESSION_AGENT_BUDGET = 1000;
export const GAUNTLET_EXPECTED = 52;
export const GAUNTLET_SOFT_LOW = 75;
export const GAUNTLET_SOFT_HIGH = 125;
export const GAUNTLET_REVIEW = 150;
export const GAUNTLET_HARD_STOP = 200;
export const REPAIR_WAVE_CAP = 12;

export function isVersion(v) {
  if (typeof v !== 'string' || v === '') return false;
  if (!/^[0-9.]+$/.test(v)) return false;
  if (v.startsWith('.') || v.endsWith('.')) return false;
  if (v.includes('..')) return false;
  return v.length <= 32;
}

// a > b when return > 0; a < b when return < 0; equal 0. Mirrors the Bash
// newer_than comparison including 10# base-10 (no octal traps).
export function compareVersions(a, b) {
  const A = a.split('.').map((p) => parseInt(p, 10) || 0);
  const B = b.split('.').map((p) => parseInt(p, 10) || 0);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const ai = A[i] || 0;
    const bi = B[i] || 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

export function isNewer(a, b) {
  if (!isVersion(a) || !isVersion(b)) return false;
  return compareVersions(a, b) > 0;
}

// provenance_mark: identical semantics to capacity-resolver.sh's Bash
// function. Unrecognised kind -> ASSUMED mark. Missing -> [ASSUMED no-source-given].
export function provenanceMark(raw) {
  if (raw === undefined || raw === null || raw === '') return '[ASSUMED no-source-given]';
  const idx = raw.indexOf(':');
  const kind = idx === -1 ? raw : raw.slice(0, idx);
  const detail = idx === -1 ? '' : raw.slice(idx + 1);
  const lower = kind.toLowerCase();
  const known = ['measured', 'researched', 'recalled-confirmed', 'recalled-unconfirmed', 'default-confirmed', 'assumed', 'undetermined'];
  if (!known.includes(lower)) return `[ASSUMED unrecognised-source-kind(${kind}) — sized conservatively]`;
  const upper = lower.toUpperCase();
  return detail ? `[${upper} ${detail}]` : `[${upper}]`;
}

// ---------------------------------------------------------------------------
// CAPACITY RESOLUTION — same math, same card fields as capacity-resolver.sh
// ---------------------------------------------------------------------------
export function parseAnswers(text) {
  const answers = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k) answers[k] = v;
  }
  return answers;
}

export function resolveCapacity(answers, opts = {}) {
  // opts.coresOverride — test/golden override; null means measure.
  // opts.suppliedCores — answers.CORES equivalent.
  const now = opts.nowIso || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const errors = [];

  const harness = answers.HARNESS ?? '';
  if (harness !== 'claude-nine' && harness !== 'regular') {
    return { error: `HARNESS must be claude-nine or regular (got: ${harness})`, exit: 2, lines: [] };
  }
  const project = answers.PROJECT || '<project>';
  let mode = answers.MODE || 'single';
  if (mode !== 'team' && mode !== 'single') {
    return { error: `MODE must be team or single (got: ${mode})`, exit: 2, lines: [] };
  }
  let commanders = mode === 'team' ? Number(answers.COMMANDERS || 4) : 0;
  if (!Number.isInteger(commanders) || commanders < 0) {
    return { error: `COMMANDERS must be a whole number (got: ${answers.COMMANDERS})`, exit: 2, lines: [] };
  }
  const builderProvider = answers.BUILDER_PROVIDER || 'anthropic';
  let launcher = answers.LAUNCHER || (harness === 'regular' ? 'claude' : 'claude-nine');
  let reservePct = answers.RESERVE_PCT === undefined || answers.RESERVE_PCT === '' ? 25 : Number(answers.RESERVE_PCT);
  if (!Number.isInteger(reservePct) || reservePct < 0 || reservePct > 100) {
    return { error: `RESERVE_PCT must be a whole number 0–100 (got: ${answers.RESERVE_PCT})`, exit: 2, lines: [] };
  }

  // AXIS 1: WIDTH — cores and RAM, MEASURED, never declared (S1)
  // A SUPPLIED CORES / RAM_GB that is not a positive whole number is an ERROR (exit 3,
  // never a fallback measurement) — identical to the Bash tool.
  const coresSupplied = answers.CORES !== undefined && answers.CORES !== '';
  let cores = null, coresSource, coresInstrument = '';
  if (coresSupplied) {
    cores = Number(answers.CORES);
    coresSource = 'SUPPLIED';
    if (!Number.isInteger(cores) || cores < 1) {
      return { error: `ERROR: CORES must be a positive whole number (got: ${answers.CORES}) — cores UNDETERMINED, ask the operator and rerun`, exit: 3, lines: [] };
    }
  } else {
    const measured = (opts.cores !== undefined && opts.cores !== null)
      ? { cores: opts.cores, instrument: 'test-fixture' }
      : probeCores();
    if (measured.cores === null || measured.cores === undefined || !Number.isInteger(measured.cores) || measured.cores < 1) {
      coresSource = 'UNMEASURABLE';
      coresInstrument = 'none (sysctl and nproc both unavailable)';
    } else {
      cores = measured.cores; coresInstrument = measured.instrument; coresSource = 'MEASURED';
    }
  }
  const ramSupplied = answers.RAM_GB !== undefined && answers.RAM_GB !== '';
  let ramGb = null, ramSource, ramInstrument = '';
  if (ramSupplied) {
    ramGb = Number(answers.RAM_GB);
    ramSource = 'SUPPLIED';
    if (!Number.isInteger(ramGb) || ramGb < 1) {
      return { error: `ERROR: RAM_GB must be a positive whole number of GB (got: ${answers.RAM_GB})`, exit: 3, lines: [] };
    }
  } else {
    const m = (opts.ramGb !== undefined && opts.ramGb !== null) ? { gb: opts.ramGb, instrument: 'test-fixture' } : measureRamGb();
    if (m && Number.isInteger(m.gb) && m.gb >= 1) { ramGb = m.gb; ramInstrument = m.instrument; ramSource = 'MEASURED'; }
    else { ramSource = 'UNMEASURABLE'; ramInstrument = 'none (hw.memsize and /proc/meminfo both unavailable)'; }
  }

  // THE WIDTH RULE: clientCap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores)),
  // computed by capacity_probe.py (container limits beat host totals) and by nothing in this file.
  let clientCap = null, capDetail = '', capUndetermined = false;
  if (coresSource === 'MEASURED' && ramSource === 'MEASURED' && opts.cores == null && opts.ramGb == null) {
    const m = measureCapacity();
    if (m) { clientCap = m.cap; capDetail = `effective ${m.ramGb} GB, ${m.cores} cores via ${m.source} (container limits beat host totals)`; }
  } else if (cores !== null && ramGb !== null) {
    clientCap = clientCapOf(ramGb, cores); capDetail = 'formula applied to the supplied cores/RAM';
  }
  if (!Number.isInteger(clientCap)) {
    clientCap = UNDETERMINED_CAP;
    capDetail = `UNDETERMINED: cores/RAM/capacity_probe.py unavailable (needs python3 3.8+); the conservative floor ${UNDETERMINED_CAP} is used and the run keeps going`;
    capUndetermined = true;
  }
  const perWorkflow = clientCap;
  const harnessMax = WORKFLOW_CEILING * perWorkflow;

  // AXIS 3: POLICY — provider ceilings (canon numbers, verbatim)
  let providerCeiling = 0, providerUsable = 0, providerLabel = '', providerApplies = 0, providerNote = '';
  let requestBudget = 'not window-metered — governed by rate-limit responses; on 429/limit → park-and-resume (Loop 6), never retry-hammer';
  let burnGovernor = '';
  switch (builderProvider) {
    case 'anthropic':
      providerLabel = 'Anthropic subscription (window-metered, opaque — the runtime rate-limit response is the meter)';
      burnGovernor = 'subscription; watch for 429/limit responses; commanders counted at full session rate (pessimistic shared bucket)';
      break;
    case 'deepseek-direct': {
      const tier = answers.DEEPSEEK_TIER || 'flash';
      if (tier !== 'flash' && tier !== 'pro') {
        return { error: `ERROR: DEEPSEEK_TIER must be flash or pro (got: ${tier})`, exit: 2, lines: [] };
      }
      if (tier === 'flash') {
        providerCeiling = 2500;
        providerLabel = 'DeepSeek v4 Flash, direct (9Router) — 2,500 concurrent subagents';
      } else {
        providerCeiling = 500;
        providerLabel = 'DeepSeek v4 Pro, direct (9Router) — 500 concurrent subagents';
      }
      providerUsable = providerCeiling - Math.floor((providerCeiling * reservePct) / 100);
      providerApplies = 1;
      burnGovernor = 'pay-per-token — pre-run balance check + a rough estimate, stated plainly as a rough estimate, not a final number';
      break;
    }
    case 'deepseek-ollama':
      providerCeiling = 10;
      providerUsable = 8;
      providerLabel = 'DeepSeek via Ollama Cloud — NEVER the builder (behind version)';
      providerNote = 'DeepSeek via Ollama Cloud is never the builder — it is behind version. Re-ask the provider question.';
      providerApplies = 1;
      burnGovernor = 'subscription slots; hold the reserve';
      break;
    case 'ollama-cloud': {
      const plan = answers.OLLAMA_PLAN;
      if (plan === '20') {
        providerCeiling = 3; providerUsable = 2;
        providerLabel = 'Ollama Cloud $20 plan — 3 concurrent, USE 2';
        providerNote = 'Two concurrent slots. Builder and critic SHARE them: allocate 1+1 or time-slice, and show the allocation. A 24-unit build is ≥12 sequential rounds per stage — say so up front.';
      } else if (plan === '100') {
        providerCeiling = 10; providerUsable = 8;
        providerLabel = 'Ollama Cloud $100 plan — 10 concurrent, USE 8';
      } else {
        return { error: `ERROR: OLLAMA_PLAN must be 20 or 100 (got: ${plan})`, exit: 2, lines: [] };
      }
      providerApplies = 1;
      burnGovernor = 'fixed concurrency slots; the reserve is never spent';
      break;
    }
    case 'agnes': {
      providerCeiling = 1; providerUsable = 1;
      const plan = answers.AGNES_PLAN;
      if (plan === 'free') {
        providerLabel = 'Agnes AI, free — 20 requests/minute (VERIFY-LIVE)';
        requestBudget = '15 requests/min (20/min ceiling − 25% reserve)';
      } else if (plan === '40') {
        providerLabel = 'Agnes AI, $40/year plan — 1,500 requests / 5 hours (VERIFY-LIVE)';
        requestBudget = '1,125 requests / 5h (1,500 − 25%) = 3.75/min sustained; at ~25 API requests per agent-task → 45 Agnes agent-tasks per 5-hour window (state the assumption, measure it over the first 5 tasks, re-derive)';
      } else if (plan === '100') {
        providerLabel = 'Agnes AI, $100/year plan — 7,500 requests / 5 hours (VERIFY-LIVE)';
        requestBudget = '5,625 requests / 5h (7,500 − 25%) = 18.75/min sustained';
      } else {
        return { error: `ERROR: AGNES_PLAN must be free, 40 or 100 (got: ${plan})`, exit: 2, lines: [] };
      }
      providerNote = 'Agnes is request-rate limited, not concurrency limited. It carries LOW-FREQUENCY roles (blind critic verdicts, ~1–2 per unit) — never the builder swarm. WEB-RESEARCH agnes-ai.com\'s current rate rules FIRST; these figures are the FALLBACK, and the ledger records which source was used.';
      burnGovernor = 'count requests per 5-hour window; when projected window spend > budget, throttle in order: raise interval → drop planner frequency → drop tier';
      providerApplies = 1;
      break;
    }
    case 'openrouter':
      providerCeiling = 8; providerUsable = 8;
      providerLabel = 'OpenRouter — fallback role only; detect key, research current limits (VERIFY-LIVE)';
      providerNote = 'OpenRouter is cost-metered — estimate the token burn and warn plainly if the account may run low. Recommend DeepSeek direct.';
      burnGovernor = 'cost-metered — burn-rate warn';
      providerApplies = 1;
      break;
    default:
      return { error: `ERROR: BUILDER_PROVIDER must be anthropic|deepseek-direct|deepseek-ollama|ollama-cloud|agnes|openrouter (got: ${builderProvider})`, exit: 2, lines: [] };
  }

  // THE RECONCILIATION RULE: the smaller of the harness (50 x clientCap) and the provider ceiling minus
  // its reserve; there is NO policy wave cap on any path.
  let governing = harnessMax;
  let governSrc = 'harness';
  if (providerApplies === 1 && providerUsable < governing) { governing = providerUsable; governSrc = 'provider ceiling − reserve'; }
  let providerFigureNote = '';
  if (governing < perWorkflow) {
    providerFigureNote = ` [provider figure ${governing} recorded; a workflow is never narrower than min(clientCap, its units)]`;
    governing = perWorkflow; governSrc = `one workflow of ${perWorkflow}`;
  }

  let persistent = 0, width = governing, teamRefused = 0;
  if (mode === 'team') {
    persistent = commanders + 1;
    if (persistent >= governing) {
      teamRefused = 1; persistent = 0; width = governing;
    } else {
      width = governing - persistent;
      if (width < perWorkflow) { width = perWorkflow; governing = width + persistent; }
    }
  }

  let workflows = Math.max(1, Math.ceil(width / perWorkflow));
  if (workflows > WORKFLOW_CEILING) workflows = WORKFLOW_CEILING;
  const agentsPerWf = perWorkflow;   // the cap; a plan row runs min(clientCap, its units)

  let throttle = answers.THROTTLE || (builderProvider === 'deepseek-direct' ? 'full' : 'gentle');

  const ramMark = ramSource === 'MEASURED' ? `[MEASURED ${ramInstrument} ${now}]`
    : ramSource === 'UNMEASURABLE' ? `[UNDETERMINED ${ramInstrument}]` : provenanceMark(answers.RAM_GB_SOURCE);
  const coresMark = coresSource === 'MEASURED' ? `[MEASURED ${coresInstrument} ${now}]`
    : coresSource === 'UNMEASURABLE' ? `[UNDETERMINED ${coresInstrument}]` : provenanceMark(answers.CORES_SOURCE);
  const capMark = capUndetermined ? `[UNDETERMINED no cap could be measured — conservative floor ${UNDETERMINED_CAP} ${now}]`
    : (coresSource === 'MEASURED' && ramSource === 'MEASURED') ? `[MEASURED capacity_probe.py ${coresInstrument}+${ramInstrument} ${now}]`
    : `[DERIVED cores=${coresSource} ram=${ramSource} ${now}]`;
  const reserveMark = provenanceMark(answers.RESERVE_PCT_SOURCE);
  const planMark = provenanceMark(answers.OLLAMA_PLAN_SOURCE || answers.AGNES_PLAN_SOURCE || answers.DEEPSEEK_TIER_SOURCE || '');
  const fpLine = answers.CONFIG_FP
    ? `Config fingerprint: ${answers.CONFIG_FP}  (comparator only — launcher, resolved seat map, provider-key presence set; names and model ids, NEVER values)`
    : 'Config fingerprint: UNDETERMINED (not supplied — compute it per capacity.md section 13.4 step 3; a resume compares worlds against it, and a missing one fails toward ASKING)';

  const roleOrUnresolved = (v) => (v ? v : 'UNRESOLVED(resolve from live config)');

  const lines = [];
  lines.push(`# CAPACITY LEDGER — ${project} — ${now}`);
  lines.push(`Launcher: ${launcher}      Harness mode: ${harness}`);
  lines.push(fpLine);
  lines.push(`Cores: ${cores ?? 'UNDETERMINED'} (${coresSource}) · RAM: ${ramGb ?? 'UNDETERMINED'} GB (${ramSource})`);
  lines.push(`clientCap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores)) = ${clientCap}   ${capMark}`);
  lines.push(`  ${capDetail}`);
  lines.push(`  inputs: cores ${coresMark}; ram ${ramMark}`);
  lines.push('  MEASURED on this machine by tools/hooks/capacity_probe.py — never declared, never asked, never an environment read');
  lines.push(`  (no measurable cap → clientCap is the conservative floor ${UNDETERMINED_CAP}, marked UNDETERMINED, and the run keeps going)`);
  lines.push(`  per-workflow concurrency = agent_count = min(clientCap, the workflow's units) = ${clientCap} at most`);
  lines.push('Context ceiling (session): per resolved model — see ROLE RESOLUTION (claude-codex on `cx/` = ~372K real, NOT the profile\'s 900K)');
  lines.push('ROLE RESOLUTION (three hops: doctrine role → configured alias → resolved model; RECORD it, never reroute):');
  lines.push('  orchestrator=lead seat');
  lines.push(`  builder=${roleOrUnresolved(answers.ROLE_BUILDER)}`);
  lines.push(`  researcher=${roleOrUnresolved(answers.ROLE_RESEARCHER)}`);
  lines.push(`  visual-verifier=${roleOrUnresolved(answers.ROLE_VISUAL)}`);
  lines.push(`  technical-judge=${roleOrUnresolved(answers.ROLE_TECHNICAL)}`);
  lines.push(`  security-judge=${roleOrUnresolved(answers.ROLE_SECURITY)}`);
  lines.push(`  release-judge=${roleOrUnresolved(answers.ROLE_RELEASE)}`);
  lines.push(`Ceilings: ${providerLabel} | no policy wave cap on any path   ${planMark}`);
  lines.push(`Reserve applied: ${reservePct}%${providerApplies === 1 ? ` → provider usable ${providerUsable} of ${providerCeiling}` : ' (no numeric provider ceiling to reserve against)'}   ${reserveMark}`);
  lines.push(`Governing number: harness ${WORKFLOW_CEILING}×${perWorkflow}=${harnessMax} | provider ${providerApplies === 1 ? providerUsable : 'n/a (subscription-metered — the burn governor is the only limiter)'} → GOVERNS: ${governing} (${governSrc})${providerFigureNote}`);
  if (mode === 'team') {
    if (teamRefused === 1) {
      lines.push(`AGENT TEAM: mode=team REFUSED BY ARITHMETIC — lead+${commanders} commanders = ${commanders + 1} persistent slots > governing number ${governing}.`);
      lines.push('  The when-to-use gate answers SINGLE-SESSION and says so plainly. The commander');
      lines.push('  stations collapse onto the lead and the same canonical loop runs single-session.');
    } else {
      lines.push(`AGENT TEAM: mode=team (probe + consent required before any spawn — feature-not-enabled is a SILENT NO-OP)`);
      lines.push(`  commanders=${commanders} → persistent slots = lead+${commanders} = ${persistent} → ${width} remain for workflow width`);
      lines.push('  Commanders are NOT agent executions against the 52/150/200 gauntlet budget, but their');
      lines.push('  burn IS budgeted (full session rate, pessimistic shared bucket) and their liveness IS');
      lines.push('  part of the reconciler\'s state-delta fingerprint. Teammates do NOT survive /resume —');
      lines.push('  the resumed lead re-spawns them from disk (references/resume.md step 8.5).');
    }
  } else {
    lines.push('AGENT TEAM: mode=single — no persistent commanders; the commander stations collapse onto the lead.');
  }
  lines.push(`WAVE SIZE: ${width}${mode === 'team' && teamRefused === 0 ? ` (workflow width) + ${persistent} persistent = ${governing}` : ''}    WORKFLOW COUNT: ${workflows}    AGENTS PER WORKFLOW: ≤${agentsPerWf} (= clientCap ${clientCap})`);
  lines.push(`DISPATCH SHAPE (S2 — the six gauntlet workflows, \`references/gauntlet.md\` §13):`);
  lines.push('  every slice of a workflow is passed to a SINGLE pipeline() call; the harness runs');
  lines.push(`  clientCap (${clientCap}) of them at once and queues the rest as a rolling window.`);
  lines.push("  Never split a workflow's slices into sequential batches by hand.");
  lines.push(`  Worked example: 16 builder slices at clientCap ${clientCap} → ONE pipeline() call of 16 items,`);
  lines.push(`  ${clientCap} live and ${Math.max(16 - clientCap, 0)} queued, each queued item starting the instant a slot frees.`);
  lines.push('  THE BAR NEVER SHRINKS WITH THE MACHINE — ONLY THE WIDTH DOES.');
  lines.push('AGENT BUDGET DECLARATION (all eight §17 quantities):');
  lines.push(`  1. number of workflows: ${workflows}`);
  lines.push(`  2. agents per workflow: ≤${agentsPerWf}`);
  lines.push(`  3. maximum concurrency: ${governing} (${governSrc})`);
  lines.push('  4. model role per workflow: from ROLE RESOLUTION above — by role and alias, resolved model cited');
  lines.push(`  5. expected total agent executions: ${GAUNTLET_EXPECTED} for the initial gauntlet run (8+16+16+8+4), scaled to this task graph`);
  lines.push(`  6. selective-repair formula: N = failed workstreams, one repairer each, ≤${REPAIR_WAVE_CAP}/wave`);
  lines.push(`  7. soft budget: ${GAUNTLET_SOFT_LOW}–${GAUNTLET_SOFT_HIGH} scaled to this project's task graph; at ${GAUNTLET_REVIEW} analyze whether measurable progress is still occurring`);
  lines.push(`  8. hard safety cap: ${GAUNTLET_HARD_STOP} executions → HARD STOP, preserve the best stable build, produce a blocker report (run_status=STOPPED_CAP)`);
  lines.push(`Session agent budget (AXIS 2 — the OPERATOR's policy, a LIFETIME COUNT, never a width`);
  lines.push('  and never a platform fact): ' + SESSION_AGENT_BUDGET + ' per session,');
  lines.push('  tracked as a DECREMENTING budget in project_state.json (agents.session_budget_remaining).');
  lines.push("  Every workflow's declared AGENT COUNT plus the repair formula must SUM against it BEFORE");
  lines.push('  dispatch. Commander sessions are separate processes — whether they draw from the same');
  lines.push(`  ${SESSION_AGENT_BUDGET} is UNDETERMINED; budget pessimistically as if they do until probed.`);
  lines.push(`Request budget per 5h window: ${requestBudget}`);
  lines.push(`Burn governor: ${burnGovernor}`);
  lines.push(`Throttle: ${throttle}`);
  lines.push('Fallback: builder/QC/merger/critic each fall back one tier — never onto the tier that produced the work being judged.');
  lines.push('SEAT lines: the conductor completes one SEAT line per seat in CAPACITY-LEDGER.md');
  lines.push('  (capacity.md section 4 template, procedure in section 11) — dispatched id, resolved');
  lines.push('  model, lane=<alias|direct|combo(members…)>, provider node, ceiling CLASS and figure,');
  lines.push('  which burn meter it feeds, headroom floor, independence proof. This script records');
  lines.push('  what it is handed; it never resolves a seat and never selects one.');
  lines.push('Provenance: every value-bearing line above carries a bracketed mark. Any line whose');
  lines.push('  mark reads ASSUMED with no source was handed to this script without its');
  lines.push('  `<KEY>_SOURCE` line and MUST be sized conservatively (capacity.md section 13.2).');
  lines.push('REVISIONS (append-only; the card above is never edited in place):');
  lines.push('  (none yet — a mid-run change appends: <ISO8601> | REVISION | field=<name> | old→new |');
  lines.push('   trigger=<measured|429-cluster|balance-check|tripwire|resume-remeasure> | source-mark=<new mark>)');
  if (providerNote) lines.push(`NOTE: ${providerNote}`);
  lines.push('');
  lines.push('STAFFING RULE (owner contract 2026-10-06): a workflow runs agent_count = min(clientCap, its units)');
  lines.push("agents, clientCap being this box's measured per-workflow cap above (1..10), and up to 50");
  lines.push('workflows run concurrently (at most 500 agents). The plan file');
  lines.push('(references/swarm-plan.md) states both numbers and the hooks enforce them. Provider figures');
  lines.push('are recorded on this card; they never narrow a workflow. Only the measured clientCap (this box\'s');
  lines.push('RAM, cores and container limits) sets how many agents a workflow runs at once. Each agent owns one');
  lines.push('unit: a unit has a concrete output path, an acceptance criterion and a verdict file.');
  lines.push('');
  lines.push('A workflow whose dependency is not yet met is held by not launching it. Every workflow that');
  lines.push('is ready launches now, up to max_active_workflows.');
  return { exit: 0, lines, error: null };
}
