#!/usr/bin/env node
// Tool-call argument survival through 9Router's OPENAI_RESPONSES -> OPENAI stream translator
// (module 4845 export v, chunk 8499). Offline: drives the REAL module with synthetic upstream
// event sequences covering every place a Responses-API stream can carry function arguments.
// Exit 0 = all pass, 1 = a scenario lost arguments, 2 = bundle not loadable.
'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const ROOT=process.argv[2]||path.join(os.homedir(),'.npm-global/lib/node_modules/9router');
const chunkDir=path.join(ROOT,'app/.next-cli-build/server/chunks');
const factories={};
for(const f of fs.readdirSync(chunkDir).sort()){ if(!f.endsWith('.js'))continue;
  let m; try{m=require(path.join(chunkDir,f));}catch(e){continue;}
  if(m&&m.modules) for(const id of Object.keys(m.modules)) if(!(id in factories)) factories[id]=m.modules[id]; }
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(e.name.endsWith('.js'))o.push(p);}return o;}
const serverDir=path.join(ROOT,'app/.next-cli-build/server'); const extRe=/(\d+):a=>\{a\.exports=require\("([^"]+)"\)\}/g;
for(const p of walk(serverDir)){ if(p.startsWith(chunkDir))continue; let s; try{s=fs.readFileSync(p,'utf8');}catch(e){continue;}
  let m; extRe.lastIndex=0; while((m=extRe.exec(s))){const id=m[1],spec=m[2]; if(!(id in factories)) factories[id]=(mod)=>{mod.exports=require(spec);};} }
const cache={};
function req(id){id=String(id); if(cache[id])return cache[id].exports; const f=factories[id];
  if(!f){const mod={exports:new Proxy({},{get:()=>{throw new Error('unresolved '+id)}})};cache[id]=mod;return mod.exports;}
  const mod={exports:{}};cache[id]=mod;f(mod,mod.exports,req);return mod.exports;}
req.d=(e,d)=>{for(const k in d)Object.defineProperty(e,k,{enumerable:true,configurable:true,get:d[k]})};
req.r=e=>Object.defineProperty(e,'__esModule',{value:true});req.o=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
req.n=m=>{const g=m&&m.__esModule?()=>m.default:()=>m;req.d(g,{a:g});return g};req.g=globalThis;
if(require.main!==module){ module.exports={req}; return; }
let T; try{ T=req(4845).v; if(typeof T!=='function') throw 0; }catch(e){ console.error('FATAL: translator 4845.v not found', e && e.stack ? e.stack.split('\n').slice(0,4).join(' | ') : e); process.exit(2); }
const ARGS='{"command":"echo hello"}';
const item=(extra={})=>({id:'fc_1',type:'function_call',call_id:'call_1',name:'Bash',...extra});
const S={
 'deltas (normal)':[{type:'response.output_item.added',item:item({arguments:''})},
   {type:'response.function_call_arguments.delta',item_id:'fc_1',delta:'{"command":'},{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:'"echo hello"}'},
   {type:'response.output_item.done',item:item({arguments:ARGS})},{type:'response.completed',response:{usage:{input_tokens:5,output_tokens:9}}}],
 'only output_item.done':[{type:'response.output_item.added',item:item({arguments:''})},{type:'response.output_item.done',item:item({arguments:ARGS})},{type:'response.completed',response:{}}],
 'only arguments.done':[{type:'response.output_item.added',item:item({arguments:''})},{type:'response.function_call_arguments.done',item_id:'fc_1',arguments:ARGS},{type:'response.output_item.done',item:item()},{type:'response.completed',response:{}}],
 'only in added item':[{type:'response.output_item.added',item:item({arguments:ARGS})},{type:'response.output_item.done',item:item()},{type:'response.completed',response:{}}],
 'only in completed output':[{type:'response.output_item.added',item:item({arguments:''})},{type:'response.output_item.done',item:item()},{type:'response.completed',response:{output:[item({arguments:ARGS})]}}],
 'deltas + arguments.done (no doubling)':[{type:'response.output_item.added',item:item({arguments:''})},{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:ARGS},{type:'response.function_call_arguments.done',item_id:'fc_1',arguments:ARGS},{type:'response.output_item.done',item:item({arguments:ARGS})},{type:'response.completed',response:{output:[item({arguments:ARGS})]}}],
 'deltas before added':[{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:ARGS},{type:'response.output_item.added',item:item({arguments:''})},{type:'response.output_item.done',item:item({arguments:ARGS})},{type:'response.completed',response:{}}],
};
// Reassemble exactly like an OpenAI chat-completions consumer: a tool call exists once it has
// an id/name at an index; arguments are concatenated per index, but only fragments arriving
// AFTER the call exists count (a consumer cannot attach args to an index it has not opened).
function run(evts){ const st={}; const out=[];
  for(const e of evts){ let r=T(e,st); if(r) (Array.isArray(r)?r:[r]).forEach(c=>out.push(c)); }
  let r=T(null,st); if(r) (Array.isArray(r)?r:[r]).forEach(c=>out.push(c));
  const calls={}; let finish=null;
  for(const c of out){ const ch=(c.choices||[])[0]||{}; if(ch.finish_reason) finish=ch.finish_reason;
    for(const tc of ((ch.delta||{}).tool_calls||[])){ const i=tc.index;
      if(tc.id||(tc.function&&tc.function.name)) calls[i]=calls[i]||{name:tc.function&&tc.function.name,args:''};
      if(calls[i]&&tc.function&&tc.function.arguments) calls[i].args+=tc.function.arguments; } }
  return {calls:Object.values(calls),finish}; }
const P=req(88499);
// End to end: upstream Responses events -> the router's real pipeline -> Claude wire (what Claude Code gets).
function runClaude(evts){ const st=P.Ws('openai-responses'); const out=[];
  for(const e of [...evts,null]){ const r=P.Y8('openai-responses','claude',e,st); if(r) out.push(...(Array.isArray(r)?r:[r])); }
  const tools={}; let stop=null;
  for(const ev of out){ const e=typeof ev==='string'?(()=>{try{return JSON.parse(ev.replace(/^data:\s*/,''))}catch{return {}}})():ev;
    if(e.type==='content_block_start'&&e.content_block&&e.content_block.type==='tool_use') tools[e.index]={name:e.content_block.name,json:''};
    if(e.type==='content_block_delta'&&e.delta&&e.delta.type==='input_json_delta'&&tools[e.index]) tools[e.index].json+=e.delta.partial_json||'';
    if(e.type==='message_delta'&&e.delta) stop=e.delta.stop_reason||stop; }
  return {tools:Object.values(tools),stop}; }
let fail=0;
for(const [name,evts] of Object.entries(S)){ const r=run(evts); const a=r.calls.map(c=>c.args);
  const ok=r.calls.length===1&&a[0]===ARGS; if(!ok)fail++;
  console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(26)+' calls='+r.calls.length+' args='+JSON.stringify(a)+' finish='+r.finish); }
{ // two calls in one reply: first via deltas, second only via arguments.done
  const A2='{"command":"ls"}'; const i2=(x={})=>({id:'fc_2',type:'function_call',call_id:'call_2',name:'Bash',...x});
  const ev=[{type:'response.output_item.added',item:item({arguments:''})},{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:ARGS},{type:'response.output_item.done',item:item({arguments:ARGS})},
    {type:'response.output_item.added',item:i2({arguments:''})},{type:'response.function_call_arguments.done',item_id:'fc_2',arguments:A2},{type:'response.output_item.done',item:i2()},{type:'response.completed',response:{}}];
  const r=runClaude(ev); const got=r.tools.map(t=>t.json); const ok=JSON.stringify(got)===JSON.stringify([ARGS,A2]); if(!ok)fail++;
  console.log((ok?'  PASS  ':'  FAIL  ')+'two calls, each keeps its own command  '+JSON.stringify(got)); }
console.log('--- end to end, Claude wire (what Claude Code receives):');
for(const [name,evts] of Object.entries(S)){ let r; try{ r=runClaude(evts); }catch(e){ console.log('  ERROR '+name+' '+e.message); fail++; continue; }
  let inp; try{ inp=r.tools[0]&&r.tools[0].json?JSON.parse(r.tools[0].json):{}; }catch(e){ inp='UNPARSEABLE '+r.tools[0].json; }
  const ok=r.tools.length===1&&inp&&inp.command==='echo hello'; if(!ok)fail++;
  console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(26)+' tool_use blocks='+r.tools.length+' input='+JSON.stringify(inp)+' stop_reason='+r.stop); }
console.log(fail?`${fail} scenario(s) LOSE the command`:'all scenarios keep the command'); process.exit(fail?1:0);
