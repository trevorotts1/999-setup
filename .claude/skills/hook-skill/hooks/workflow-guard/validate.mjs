// Parse only. Never evaluate a submitted workflow or its prompts.
import {parse} from './vendor/acorn.mjs';
import fs from 'node:fs';
import os from 'node:os';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const errors=[];
// Enforced workflow naming: <program>-W<wave>-<phase>-<firstID>[..<lastID>]-<lanes>L
const NAME_RE=/^[a-z0-9]{2,12}-W[0-9]{1,2}-(build\+qc|build|qc|repair|merge|test)-[A-Z]{2,5}[0-9]{3,}(\.\.[A-Z]{2,5}[0-9]{3,})?-([0-9]{1,2})L$/;
const NAME_EXAMPLE='pres-W2-build+qc-SKR012..SKR019-8L';
try {
 // ROLLING WINDOW: the only concurrency limiter a script may carry. The caller (staffing.WINDOW_HELPER) supplies the
 // exact helper text with __N__ for the window size; a script containing it byte-for-byte has that block removed from
 // analysis (it needs a loop and mutation), every agent() must then be written wgSlot(() => agent(...)), and the peak
 // is capped at the window. Any other loop/mutation is still refused below.
 let WINDOW=null,helperSpan=null,scriptText=input.script;
 if(typeof input.windowHelper==='string'&&input.windowHelper.includes('__N__')){
  const re=new RegExp(input.windowHelper.split('__N__').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('(\\d+)'));
  const m=re.exec(scriptText);
  if(m&&Number(m[1])>=1){WINDOW=Number(m[1]);helperSpan=[m.index,m.index+m[0].length];scriptText=scriptText.replace(m[0],m[0].replace(/[^\n]/g,' '));}
 }
 // Hardened mode: a plan launch (guard cap / workflowId in args) or any script carrying the window helper.
 const strict=WINDOW!==null||process.env.WORKFLOW_GUARD_CAP!==undefined||(input.args&&typeof input.args==='object'&&input.args.workflowId!==undefined);
 if(WINDOW!==null){
  // The helper must be four whole TOP-LEVEL statements (not inside a comment, string, function or block), byte-identical.
  const top=parse(input.script,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}).body;
  const inside=top.filter(x=>x.start>=helperSpan[0]&&x.end<=helperSpan[1]);
  if(!inside.length||inside[0].start!==helperSpan[0]||inside[inside.length-1].end<helperSpan[1]-1||inside.length!==input.windowHelper.split('\n').filter(l=>/^(const|async function)/.test(l)).length)errors.push('The rolling-window helper must appear byte-identical as top-level statements (not inside a comment, string, function or block).');
 }
 const tree=parse(scriptText,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,locations:true});
 const env=new Map([['args',input.args]]), funcs=new Map();
 const children=n=>Object.values(n||{}).flatMap(v=>Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
 const walk=(n,f,parent=null)=>{if(!n?.type)return;f(n,parent);children(n).forEach(c=>walk(c,f,n));};
 const key=p=>p.computed?null:p.key?.name??p.key?.value;
 function literal(n,seen=new Set()) {
  if(!n)return undefined;
  if(n.type==='Literal')return n.value;
  if(n.type==='Identifier') {if(seen.has(n.name))return;const v=env.get(n.name);return v?.type?literal(v,new Set([...seen,n.name])):v;}
  if(n.type==='ArrayExpression'){const a=n.elements.map(x=>literal(x,seen));return a.some(x=>x===undefined)?undefined:a;}
  if(n.type==='ObjectExpression'){const o={};for(const p of n.properties){if(p.type!=='Property'||p.computed||p.method)return;const v=literal(p.value,seen);if(v===undefined)return;o[key(p)]=v;}return o;}
  if(n.type==='MemberExpression'){const o=literal(n.object,seen),k=n.computed?literal(n.property,seen):n.property.name;return o?.[k];}
 }
 for(const s of tree.body){const n=s.type==='ExportNamedDeclaration'?s.declaration:s;
  if(n?.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.type==='Identifier')env.set(d.id.name,d.init);
  if(n?.type==='FunctionDeclaration')funcs.set(n.id.name,n);
 }
 const metaNode=env.get('meta');
 const pure=n=>n && (n.type==='Literal'||n.type==='ArrayExpression'&&n.elements.every(pure)||n.type==='ObjectExpression'&&n.properties.every(p=>p.type==='Property'&&!p.computed&&!p.method&&pure(p.value)));
 const meta=literal(metaNode);
 if(!pure(metaNode)||!meta?.name||!meta?.description)errors.push('meta must be a pure literal with name and description.');
 const nameMatch=typeof meta?.name==='string'?NAME_RE.exec(meta.name):null;
 if(typeof meta?.name==='string'&&!nameMatch)errors.push(`meta.name ${JSON.stringify(meta.name)} does not match the required pattern ${NAME_RE.source} (example: ${NAME_EXAMPLE}). Regenerate with make-workflow.py --program <slug> --wave <n> --phase build+qc.`);
 const phases=meta?.phases?.map(p=>p.title)||[];
 if(!phases.length||phases.some(x=>typeof x!=='string'||!x.trim())||new Set(phases).size!==phases.length)errors.push('Declare unique nonempty meta.phases titles.');

 // HARDENING (2026-10-06): names the window helper owns, runtime-escape primitives, and args growth.
 const parents=new Map();walk(tree,(n,p)=>parents.set(n,p));
 const HELPER_NAMES=['wgSlot','wg','WG_WINDOW'];
 const idxNames=new Set();
 walk(tree,n=>{if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['map','filter','some','every','forEach'].includes(n.callee.property.name))for(const a of n.arguments)if(a.type==='ArrowFunctionExpression'&&a.params[1]?.type==='Identifier')idxNames.add(a.params[1].name);});
 let stageUses=0;
 const isId=(n,name)=>n?.type==='Identifier'&&n.name===name;
 walk(tree,(n,parent)=>{
  const t=n.type, L=n.loc?.start.line;
  // always-on escape hatches
  if(t==='ImportExpression')errors.push(`Line ${L}: dynamic import() is not allowed in workflow scripts.`);
  if(t==='Identifier'&&['Function','eval','globalThis','require'].includes(n.name)&&!(parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed)&&!(parent?.type==='Property'&&parent.key===n&&!parent.computed))errors.push(`Line ${L}: reference to ${n.name} is not allowed (dynamic code / global access).`);
  if(!strict)return;
  if(t==='ThisExpression')errors.push(`Line ${L}: 'this' is not allowed in a plan-mode script (global/this property writes).`);
  if(t==='UnaryExpression'&&n.operator==='delete')errors.push(`Line ${L}: delete is not allowed in a plan-mode script.`);
  if(t==='Identifier'&&['Reflect','Proxy','process','Atomics','WebAssembly','__proto__'].includes(n.name))errors.push(`Line ${L}: ${n.name} is not allowed in a plan-mode script.`);
  if(t==='Identifier'&&n.name==='Object'&&!(parent?.type==='MemberExpression'&&parent.object===n&&!parent.computed&&['keys','values','entries','fromEntries','freeze'].includes(parent.property.name)))errors.push(`Line ${L}: Object may only be used as Object.keys/values/entries/fromEntries/freeze in a plan-mode script (no Object.assign/defineProperty/defineProperties/setPrototypeOf or aliasing).`);
  if(t==='MemberExpression'&&!n.computed&&['constructor','prototype','__proto__','__defineGetter__','__defineSetter__','__lookupGetter__'].includes(n.property.name))errors.push(`Line ${L}: .${n.property.name} access is not allowed in a plan-mode script.`);
  if(t==='MemberExpression'&&n.computed&&!(n.property.type==='Literal'&&typeof n.property.value==='number')&&!(n.property.type==='Identifier'&&idxNames.has(n.property.name)))errors.push(`Line ${L}: computed member access is not allowed in a plan-mode script (use dotted names or numeric indexes).`);
  if(t==='Property'&&!n.computed&&['__proto__','constructor'].includes(key(n)))errors.push(`Line ${L}: ${key(n)} property is not allowed in a plan-mode script.`);
  // window helper names: reserved for the canonical helper block (already blanked out of this tree)
  if(t==='Identifier'&&HELPER_NAMES.includes(n.name)){
   const isCall=n.name==='wgSlot'&&WINDOW!==null&&parent?.type==='CallExpression'&&parent.callee===n&&parent.arguments.length===1&&parent.arguments[0].type==='ArrowFunctionExpression';
   if(!isCall)errors.push(`Line ${L}: '${n.name}' is reserved for the canonical rolling-window helper; it may only appear as wgSlot(() => agent(...)) calls (no rebinding, shadowing, parameters, properties, aliasing or references).`);
  }
  // args: only args.units (pipeline stage input / .length), args.attemptId, args.workflowId
  if(t==='Identifier'&&n.name==='args'&&!(parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed)&&!(parent?.type==='Property'&&parent.key===n&&!parent.computed&&!parent.shorthand)){
   const bad=why=>errors.push(`Line ${L}: in a plan-mode script args may only be used as args.units (the single pipeline stage's first argument, or .length), args.attemptId or args.workflowId; found ${why}.`);
   if(!(parent?.type==='MemberExpression'&&parent.object===n&&!parent.computed))return bad('a bare/aliased/destructured/rebound reference');
   const pn=parent.property.name;
   if(['attemptId','workflowId'].includes(pn)){if(parents.get(parent)?.type==='AssignmentExpression'&&parents.get(parent).left===parent)bad('a write');return;}
   if(pn!=='units')return bad('args.'+pn);
   const gp=parents.get(parent);
   if(gp?.type==='CallExpression'&&isId(gp.callee,'pipeline')&&gp.arguments[0]===parent){stageUses++;return;}
   if(gp?.type==='MemberExpression'&&gp.object===parent&&!gp.computed&&gp.property.name==='length')return;
   if(gp?.type==='MemberExpression'&&gp.object===parent&&!gp.computed)return bad('args.units.'+gp.property.name+' (a derived unit list: the stage must run args.units itself, never a filtered, sliced, mapped or copied list)');
   bad('args.units passed, aliased or modified outside the allowed forms');
  }
 });
 if(strict&&stageUses>1)errors.push('args.units may feed only the single pipeline stage.');
 const hasWorker=n=>{let yes=false;walk(n,x=>{if(x.type==='CallExpression'&&x.callee.name==='agent')yes=true;});return yes;};
 let agents=0;
 const windowed=new Set();
 if(WINDOW!==null)walk(tree,n=>{if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='wgSlot'&&n.arguments.length===1&&n.arguments[0].type==='ArrowFunctionExpression')windowed.add(n.arguments[0]);});
 walk(tree,(n,parent)=>{
  if(n.type==='Identifier'&&['agent','pipeline','parallel','workflow'].includes(n.name)&&!(parent?.type==='CallExpression'&&parent.callee===n))errors.push('Workflow primitives may only be called directly, not referenced/aliased as values.');
  if(['AssignmentExpression','UpdateExpression'].includes(n.type))errors.push('Mutable launch variables cannot be capacity-certified. Use immutable args and the generated template.');
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['push','unshift','splice'].includes(n.callee.property.name))errors.push('Do not mutate worker rosters after validation. Pass the complete ready roster in args.');
  if((n.type==='FunctionDeclaration'||n.type==='VariableDeclarator'&&n.init&&['ArrowFunctionExpression','FunctionExpression','ArrayExpression','ObjectExpression'].includes(n.init.type))&&hasWorker(n))errors.push('Keep worker callbacks inline in pipeline/parallel, not stored in reusable functions/arrays; otherwise fan-out cannot be bounded.');
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='parallel'&&!['ArrayExpression','CallExpression'].includes(n.arguments[0]?.type))errors.push('parallel requires an inline thunk array or a measurable .map expression.');
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['forEach','reduce','flatMap','from','apply','call','bind'].includes(n.callee.property.name)&&hasWorker(n))errors.push('Opaque callback fan-out cannot be bounded. Use pipeline(args.units, inline stages).');
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='agent'){
   agents++;
   if(WINDOW!==null&&!(parent?.type==='ArrowFunctionExpression'&&parent.params.length===0&&parent.body===n&&windowed.has(parent)))errors.push(`Line ${n.loc.start.line}: with a rolling window every agent() must be written wgSlot(() => agent(...)).`);const opt=n.arguments[1];
   if(opt?.type!=='ObjectExpression'||opt.properties.some(p=>p.type!=='Property'||p.computed)) {errors.push(`Line ${n.loc.start.line}: agent options must be an explicit object without spreads/computed keys.`);return;}
   const props=Object.fromEntries(opt.properties.map(p=>[key(p),p.value]));
   for(const k of ['model','phase'])if(typeof literal(props[k])!=='string'||!literal(props[k]).trim())errors.push(`Line ${n.loc.start.line}: explicit nonempty ${k} required.`);
   if(!phases.includes(literal(props.phase)))errors.push(`Line ${n.loc.start.line}: phase must match a declared meta.phases title exactly.`);
   if(!props.label||props.label.type==='Literal'&&(!props.label.value||typeof props.label.value!=='string'))errors.push(`Line ${n.loc.start.line}: visible nonempty label required.`);
  }
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='workflow')errors.push('Nested workflow() is not statically bounded. Launch a separate named root workflow; do not hide descendants.');
  if(['ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement'].includes(n.type))errors.push('Loops require a reviewed bound. Use the supplied pipeline template and JSON units instead.');
  if(n.type==='CallExpression'&&['eval','Function','setInterval','setTimeout'].includes(n.callee.name))errors.push('Dynamic execution or timers are unsupported in workflow scripts.');
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['Date.now','Math.random'].includes(`${n.callee.object.name}.${n.callee.property.name}`)||n.type==='NewExpression'&&n.callee.name==='Date'&&!n.arguments.length)errors.push('Nondeterministic clock/random use breaks replay; pass stamps in args.');
  if(n.type==='VariableDeclarator'&&n.init?.type==='Identifier'&&['agent','pipeline','parallel','workflow'].includes(n.init.name))errors.push('Do not alias workflow primitives; capacity analysis must see direct calls.');
 });
 // MODE 'peak' = max agents running at once (sequential awaited statements take the max);
 // MODE 'total' = every agent call ever made (runaway backstop).
 let MODE='peak';
 // A statement is settled when every agent promise it starts is awaited/returned inside it,
 // so the next statement cannot overlap it. An unawaited promise leaks past the statement.
 const settled=s=>{
  if(!s||!hasWorker(s))return true;
  switch(s.type){
   case 'ExpressionStatement':return s.expression.type==='AwaitExpression';
   case 'ReturnStatement':return true;
   case 'VariableDeclaration':return s.declarations.every(d=>!d.init||!hasWorker(d.init)||d.init.type==='AwaitExpression');
   case 'BlockStatement':return s.body.every(settled);
   case 'IfStatement':return !hasWorker(s.test)&&settled(s.consequent)&&settled(s.alternate);
   case 'TryStatement':return settled(s.block)&&settled(s.handler?.body)&&settled(s.finalizer);
   default:return false;
  }
 };
 function peak(n,stack=[]) {
  if(!n?.type)return 0;
  if(MODE==='peak'&&(n.type==='Program'||n.type==='BlockStatement')&&n.body.every(settled))return Math.max(0,...n.body.map(c=>peak(c,stack)));
  if(n.type==='CallExpression'){
   const c=n.callee;
   if(c.type==='Identifier'&&c.name==='agent')return 1;
   if(c.type==='Identifier'&&c.name==='pipeline'){
    const items=literal(n.arguments[0]);if(!Array.isArray(items))throw Error(typeof input.args === 'string' ? 'Workflow args is JSON encoded as text. Supply the actual JSON object, or regenerate a self-contained workflow with make-workflow.py.' : 'Cannot measure pipeline items: required unit data is missing or cannot be resolved. Legacy scripts using args.units need the entire launch JSON object. Regenerate with make-workflow.py for a self-contained scriptPath-only launch.');
    const stages=n.arguments.slice(1);
    if(stages.some(s=>!['ArrowFunctionExpression','FunctionExpression'].includes(s.type)))throw Error('Use explicit inline pipeline callbacks so agent capacity is verifiable.');
    const sp=stages.map(s=>peak(s.body,stack));return items.length*(MODE==='peak'?Math.max(0,...sp):sp.reduce((a,b)=>a+b,0));
   }
   if(c.type==='MemberExpression'&&c.property.name==='map'){
    if(!hasWorker(n))return 0;
    const items=literal(c.object);if(!Array.isArray(items))throw Error('Cannot measure map fan-out. Use a literal array or args.units.');
    return items.length*peak(n.arguments[0],stack);
   }
   if(c.type==='Identifier'&&funcs.has(c.name)){
    if(stack.includes(c.name))throw Error('Recursive spawning cannot be bounded.');
    return peak(funcs.get(c.name).body,[...stack,c.name]);
   }
  }
  if(n.type==='Identifier'&&funcs.has(n.name))throw Error('Indirect worker callbacks cannot be measured. Use explicit inline callbacks.');
  if(n.type==='FunctionDeclaration')return 0;
  // Conservative upper bound: sums concurrent expressions; sequential awaited statements and pipeline stages use max above.
  return children(n).reduce((sum,c)=>sum+peak(c,stack),0);
 }
 // No script-level clamp: a stage over N items counts N concurrent agents unless the rolling window caps it.
 const rawPeak=peak(tree);
 const bound=WINDOW!==null?Math.min(rawPeak,WINDOW):rawPeak;
 MODE='total';const totalCalls=peak(tree);MODE='peak';
 const TOTAL_CEILING=200;
 if(totalCalls>TOTAL_CEILING)errors.push(`Script makes ${totalCalls} agent calls in total, above the runaway backstop of ${TOTAL_CEILING}. Split into separate workflows.`);
 const envCap=Number.parseInt(process.env.WORKFLOW_GUARD_CAP??'',10);
 // Per-workflow cap: measured from the box (RAM, cores, Docker/Hostinger limits via capacity_probe.py), max 10, 10 on the
 // operator's Mac. The guard passes the computed cap (plan, limits.json, capacity probe) in WORKFLOW_GUARD_CAP.
 const cap=Number.isInteger(envCap)&&envCap>=1&&envCap<=10?envCap:10;
 // CONCURRENCY WINDOW (owner rule: fewer agents than units is a violation): the peak must EQUAL min(cap, units).
 // Units fit the cap -> the window helper is forbidden (the plain pipeline runs them all at once); more units than the
 // cap -> the window must be exactly the cap. Plan launches (args.units is a list) are held to peak === agent_count.
 if(WINDOW!==null&&rawPeak<=cap)errors.push(`The rolling window helper is forbidden when units (${rawPeak}) <= cap (${cap}): the plain pipeline already runs all ${rawPeak} at once; a window of ${WINDOW} would run fewer agents than units.`);
 if(WINDOW!==null&&rawPeak>cap&&WINDOW!==cap)errors.push(`The concurrency window must be exactly the cap ${cap} (min of cap and ${rawPeak} units), not ${WINDOW}.`);
 if(strict&&Array.isArray(input.args?.units)&&bound!==Math.min(cap,input.args.units.length))errors.push(`Computed peak ${bound} must equal agent_count ${Math.min(cap,input.args.units.length)} = min(cap ${cap}, ${input.args.units.length} units).`);
 if(nameMatch&&Number(nameMatch[3])!==bound)errors.push(`name claims ${Number(nameMatch[3])} lanes, script has ${bound}`);
 if(bound>cap)errors.push(`Computed upper bound ${bound} concurrent agents exceeds effective cap ${cap} (measured per-workflow cap, hard ceiling 10). Use make-workflow.py, which emits a rolling window of <=${cap}, or split into separate workflows.`);
 if(!agents)errors.push('No agent() calls: this is not a visible worker workflow.');
 // SCRATCH ISOLATION (owner rule): every lane of every
 // workflow is handed the SAME session scratchpad; sibling lanes writing a generic filename clobber each
 // other and read another box's results as their own. A multi-lane script must carry the per-lane rule
 // in its prompts (a private <scratchpad>/lanes/<unit>-<box>/ folder; box-side /tmp/<box>-<unit>- prefix).
 if(bound>1&&!(/SCRATCH ISOLATION/.test(input.script)&&/lanes\/(<WORKFLOW-NAME>\/)?<UNIT-ID>-<box-slug>\//.test(input.script)))errors.push('Multi-lane script lacks the SCRATCH ISOLATION rule in its agent prompts (private <scratchpad>/lanes/<UNIT-ID>-<box-slug>/ folder per lane, /tmp/<box-slug>-<UNIT-ID>- prefix on the box). Sibling lanes share one scratchpad and clobber each other; regenerate with the current generator.');
 const plan=literal(env.get('INPUT'))?.guard ?? input.args?.guard;
 const ready=plan?.readyUnits;
 const slots=plan?.providerSlots;
 if(ready!==undefined&&(!Number.isInteger(ready)||ready<0))errors.push('guard.readyUnits must be a nonnegative integer.');
 if(slots!==undefined&&(!Number.isInteger(slots)||slots<1))errors.push('guard.providerSlots must be a positive integer.');
 if(slots!==undefined&&bound>slots)errors.push('Workflow exceeds declared available provider slots.');
 if(ready!==undefined&&slots!==undefined&&bound<Math.min(ready,slots,cap)&&!plan?.dependencyReason)errors.push('Unused ready capacity: fill available lanes or give guard.dependencyReason explaining the dependency/resource constraint.');
 console.log(JSON.stringify({ok:!errors.length,errors:[...new Set(errors)],name:meta?.name,phases,agentCallSites:agents,conservativePeak:bound,totalCalls,cap}));
} catch(e){console.log(JSON.stringify({ok:false,errors:[...new Set([...errors,e.message])]}));}
