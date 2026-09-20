#!/usr/bin/env bash
# Proves canonical-state bootstrap, exact task-scoped delegation, and refusal.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/spec-profile.XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts"
printf '%s\n' '{"schema":"spec-protocol.project-profile/v1","documents":{"spec":"SPEC.md","protocol":"PROTOCOL.md","state":"state.json","ledger":"LEDGER.md","todo":"TODO.md","checklist":"CHECKLIST.md","qc":"QC.md"},"policy":{"maxActiveWorkflows":10,"maxAgentsPerWorkflow":10,"maxWorkingAgents":100,"maxBuilderSubmissions":4,"maxQCVerdicts":4,"builderRoute":"opus-chain","qcRoute":"sonnet-chain"},"targets":["desktop"],"commands":{"init":["node","scripts/state.mjs","init"],"validate":["node","scripts/state.mjs","validate"],"dispatch":["node","scripts/state.mjs","dispatch-check"],"release":["node","scripts/state.mjs","release-check"]}}' > "$T/.spec-protocol.json"
printf '%s\n' "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const [cmd,...args]=process.argv.slice(2);
if(cmd==='init'){if(existsSync('state.json'))process.exit(9);writeFileSync('state.json','{}');appendFileSync('init.log','init\\n');process.exit(0)}
if(cmd==='validate'){console.log(JSON.stringify({ok:true,bootstrapReady:true,dispatchReady:process.env.READY==='1',savedResumeAuthorized:process.env.RESUME==='1',stateRevision:3}));process.exit(0)}
if(cmd==='dispatch-check'){if(args.includes('--check')){console.log(JSON.stringify({ok:true,readOnly:true,args}));process.exit(0)}writeFileSync('received.json',JSON.stringify(args));console.log(JSON.stringify({ok:true,reserved:true,args}));process.exit(0)}
process.exit(2);" > "$T/scripts/state.mjs"

# Fresh root initializes once. Existing canonical state must skip init and only validate.
READY=0 node "$ROOT/project-profile.mjs" bootstrap "$T" >/dev/null
[[ -f "$T/state.json" && "$(wc -l < "$T/init.log" | tr -d ' ')" == 1 ]]
READY=0 node "$ROOT/project-profile.mjs" bootstrap "$T" >/dev/null
[[ "$(wc -l < "$T/init.log" | tr -d ' ')" == 1 ]]

# Runtime metadata is optional and packet-owned: neither Ponytail nor a router
# is a universal profile requirement.
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$T/.spec-protocol.json'));p.runtime={launcher:'fixture-launcher',projectRuntime:'custom'};fs.writeFileSync('$T/.spec-protocol.json',JSON.stringify(p));"
READY=0 node "$ROOT/project-profile.mjs" validate "$T" >/dev/null
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$T/.spec-protocol.json'));delete p.runtime;fs.writeFileSync('$T/.spec-protocol.json',JSON.stringify(p));"
READY=0 node "$ROOT/project-profile.mjs" validate "$T" >/dev/null

# A false global production bit must not prevent the packet checker from deciding
# this exact reserved bootstrap request. The adapter preserves the original argv.
READY=0 node "$ROOT/project-profile.mjs" dispatch "$T" 1 1 '[Opus x1] bootstrap canvas' --task W01-01 --role builder --native-workflow wf-canvas --reserve >/dev/null
[[ "$(node -e "const x=require('$T/received.json');process.stdout.write(x.join('|'))")" == '1|1|[Opus x1] bootstrap canvas|--task|W01-01|--role|builder|--native-workflow|wf-canvas|--reserve' ]]

# A hook-style --check is read-only and receives the same request identity.
before="$(shasum -a 256 "$T/received.json" | awk '{print $1}')"
READY=0 node "$ROOT/project-profile.mjs" dispatch "$T" 1 1 '[Opus x1] bootstrap canvas' --check --task W01-01 --role builder --native-workflow wf-canvas >/dev/null
after="$(shasum -a 256 "$T/received.json" | awk '{print $1}')"
[[ "$before" == "$after" ]]

# A production-ready request remains byte-for-byte delegated through the legacy wrapper.
READY=1 bash "$ROOT/dispatch-check.sh" "$T" 2 3 '[Opus x3] build tasks=W02-01' phase=build --task W02-01 --role builder --native-workflow wf-build >/dev/null
[[ "$(node -e "const x=require('$T/received.json');process.stdout.write(x.join('|'))")" == '2|3|[Opus x3] build tasks=W02-01|phase=build|--task|W02-01|--role|builder|--native-workflow|wf-build' ]]

# A saved-resume bypass is profile-bound and explicit; an ordinary profile does not get it.
if READY=0 RESUME=0 node "$ROOT/project-profile.mjs" resume-authorized "$T" >/dev/null 2>&1; then exit 1; fi
READY=0 RESUME=1 node "$ROOT/project-profile.mjs" resume-authorized "$T" >/dev/null

# Legacy observer helpers recognize a profile and fail before synthesizing
# CONTROL/tick state. Their declared profile observer is the only route.
if bash "$ROOT/watch-tick.sh" "$T" >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/anchor.sh" "$T" >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/state-check.sh" "$T" >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/ledger.sh" "$T" CONTROL/LEDGER.md 'legacy write must refuse' >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/seat-probe.sh" "$T" >/dev/null 2>&1; then exit 1; fi
if bash "$ROOT/gate0.sh" "$T" --check >/dev/null 2>&1; then exit 1; fi
[[ ! -d "$T/CONTROL" ]]

printf '%s\n' '{"schema":"wrong"}' > "$T/.spec-protocol.json"
if node "$ROOT/project-profile.mjs" dispatch "$T" 1 1 label >/dev/null 2>&1; then exit 1; fi
printf 'project-profile selftest: PASS (fresh/existing bootstrap, optional generic runtime without Ponytail, task-scoped dispatch, read-only check, resume binding, legacy helper refusal, malformed refusal)\n'
