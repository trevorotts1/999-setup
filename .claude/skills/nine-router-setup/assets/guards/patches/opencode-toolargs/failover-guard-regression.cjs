#!/usr/bin/env node
// Failover guard for 9Router combos (module 18910 export Pr, chunk 8910.js). Offline: drives the REAL
// combo loop with fake single-model handlers. Client replies are built by the router's real
// OPENAI_RESPONSES->CLAUDE translator, so the "broken" reply is byte-for-byte the shape Claude Code got
// (tool_use with input {}). Exit 0 = all pass, 1 = a scenario failed, 2 = bundle not loadable.
'use strict';
const path=require('path');
process.env.NINEROUTER_FG_KEEPALIVE_MS='50';
const AUDIT=path.join(require('os').tmpdir(),'fg-regression-'+process.pid+'.log'); process.env.NINEROUTER_FG_LOG=AUDIT;
const {req}=require(path.join(__dirname,'regression.cjs'));
let Pr,P; try{ Pr=req(18910).Pr; P=req(88499); if(typeof Pr!=='function') throw 0; }
catch(e){ console.error('FATAL: combo module 18910.Pr not loadable', e&&e.message); process.exit(2); }

const TOOLS=[{name:'Bash',description:'run',input_schema:{type:'object',properties:{command:{type:'string'}},required:['command']}}];
const ARGS='{"command":"echo hello"}';
const it=(x={})=>({id:'fc_1',type:'function_call',call_id:'call_1',name:'Bash',arguments:'',...x});
function claudeSSE(args){ const st=P.Ws('openai-responses'),out=[];
  const ev=[{type:'response.output_item.added',item:it()}];
  if(args) ev.push({type:'response.function_call_arguments.delta',item_id:'fc_1',delta:args});
  ev.push({type:'response.output_item.done',item:it(args?{arguments:args}:{})},{type:'response.completed',response:{}},null);
  for(const e of ev){ const r=P.Y8('openai-responses','claude',e,st); if(r) out.push(...(Array.isArray(r)?r:[r])); }
  return out.map(o=>`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`).join(''); }
const openaiSSE=args=>`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'Bash',arguments:''}}]}}]})}\n\n`+
  (args?`data: ${JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:args}}]}}]})}\n\n`:'')+
  `data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`;
const claudeJSON=args=>JSON.stringify({type:'message',role:'assistant',content:[{type:'tool_use',id:'t1',name:'Bash',input:args?JSON.parse(args):{}}],stop_reason:'tool_use'});
const sse=(t,ms=0)=>new Response(new ReadableStream({async start(c){ if(ms) await new Promise(r=>setTimeout(r,ms)); c.enqueue(new TextEncoder().encode(t)); c.close(); }}),{status:200,headers:{'Content-Type':'text/event-stream'}});
const json=t=>new Response(t,{status:200,headers:{'Content-Type':'application/json'}});
const err=()=>new Response(JSON.stringify({error:{message:'upstream down'}}),{status:500,headers:{'Content-Type':'application/json'}});

// What the client ends up with: every tool call's parsed input, in any of the three wire formats.
function inputs(text){ const r=[];
  try{ const j=JSON.parse(text); for(const b of j.content||[]) if(b.type==='tool_use') r.push(b.input); return r; }catch{}
  const cl={},oa={};
  for(const ev of text.split('\n\n')){ const d=ev.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join(''); if(!d||d==='[DONE]') continue;
    const e=JSON.parse(d);
    if(e.type==='content_block_start'&&e.content_block.type==='tool_use') cl[e.index]={init:e.content_block.input,j:''};
    if(e.type==='content_block_delta'&&e.delta.type==='input_json_delta') cl[e.index].j+=e.delta.partial_json;
    for(const tc of (e.choices&&e.choices[0].delta.tool_calls)||[]) oa[tc.index]=(oa[tc.index]||'')+(tc.function.arguments||''); }
  for(const c of Object.values(cl)) r.push(c.j?JSON.parse(c.j):c.init);
  for(const a of Object.values(oa)) r.push(a?JSON.parse(a):{});
  return r; }
const logs=[]; const log={info:(t,m)=>logs.push('I '+m),warn:(t,m)=>logs.push('W '+m)};
// Real chain member strings: the guard resolves each with the router's own provider resolver.
// called[] reports positions m0, m1, ... so assertions read the same whatever the chain.
const OC='oc/muse-spark-1.3-contributor-free(xhigh)',OCZ='ocz/muse-spark-1.3-contributor',OR='openrouter/meta/muse-spark-1.3-contributor(xhigh)',CL='claude/claude-opus-5(high)',NV='nvidia/moonshotai/kimi-k3';
async function run(body,replies,names=[OC,OR,NV]){ const called=[]; logs.length=0;
  const models=names.slice(0,replies.length);
  const res=await Pr({body,models,handleSingleModel:async(b,m)=>{const i=models.indexOf(m); called.push('m'+i); return replies[i]();},log,comboName:'t',comboStrategy:'fallback'});
  const text=await res.text(); return {res,text,called,inp:inputs(text)}; }
const withTools={model:'t',stream:true,tools:TOOLS,messages:[{role:'user',content:'Use the Bash tool to run: echo hello'}]};
const good=a=>a.length===1&&a[0]&&a[0].command==='echo hello';
let fail=0; const check=(name,ok,detail)=>{ if(!ok) fail++; console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(66)+' '+detail); };

(async()=>{
  let r=await run(withTools,[()=>sse(claudeSSE('')),()=>sse(claudeSSE(ARGS)),()=>sse(claudeSSE(ARGS))]);
  check('(a) opencode member, empty args -> next model serves the reply',good(r.inp)&&r.called.join()==='m0,m1','called='+r.called+' input='+JSON.stringify(r.inp));
  { let f=''; try{ f=require('fs').readFileSync(AUDIT,'utf8'); require('fs').unlinkSync(AUDIT); }catch{}
    check('guard trigger + serving model written to the audit log',f.includes('failover-guard: '+OC+' returned tool "Bash" with empty arguments, missing required command')&&f.includes('retry served by '+OR+' (not validated'),JSON.stringify(f.trim().split('\n').map(l=>l.slice(25)))); }

  r=await run(withTools,[()=>sse(claudeSSE('')),()=>sse(claudeSSE(ARGS))],[OCZ,OR]);
  check('(b) opencode-zen member, empty args -> next model serves',good(r.inp)&&r.called.join()==='m0,m1','called='+r.called+' input='+JSON.stringify(r.inp));

  for(const [label,first] of [['openrouter',OR],['claude',CL]]){
    // two chunks 300 ms apart: the first must reach the client before the second exists
    let t0; const slow=()=>{ t0=Date.now(); const [h,...rest]=claudeSSE('').split('\n\n'); return new Response(new ReadableStream({async start(c){ const e=new TextEncoder();
      c.enqueue(e.encode(h+'\n\n')); await new Promise(r=>setTimeout(r,300)); c.enqueue(e.encode(rest.join('\n\n'))); c.close(); }}),{status:200,headers:{'Content-Type':'text/event-stream'}}); };
    const called=[]; let orig; const res=await Pr({body:withTools,models:[first,OC],log,comboName:'t',comboStrategy:'fallback',
      handleSingleModel:async(b,m)=>{called.push(m===first?'m0':'m1'); return m===first?(orig=slow()):sse(claudeSSE(ARGS));}});
    const rd=res.body.getReader(); const c1=await rd.read(); const firstAt=Date.now()-t0; let text=new TextDecoder().decode(c1.value);
    for(;;){ const c=await rd.read(); if(c.done) break; text+=new TextDecoder().decode(c.value); }
    const inp=inputs(text);
    check(`(c) ${label} first member, empty args -> untouched, streams live`,res===orig&&called.join()==='m0'&&firstAt<150&&/message_start/.test(new TextDecoder().decode(c1.value))&&inp.length===1&&JSON.stringify(inp[0])==='{}','called='+called+' firstChunkMs='+firstAt+' sameResponse='+(res===orig)+' input='+JSON.stringify(inp));
  }

  r=await run(withTools,[()=>sse(claudeSSE('')),()=>sse(claudeSSE('')),()=>sse(claudeSSE(ARGS))],[OC,OR,NV]);
  check('opencode bad -> openrouter (non-opencode) passed through, no further walk',r.called.join()==='m0,m1'&&r.inp.length===1&&JSON.stringify(r.inp[0])==='{}','called='+r.called+' input='+JSON.stringify(r.inp));

  r=await run(withTools,[()=>sse(claudeSSE('')),()=>sse(claudeSSE('')),()=>sse(claudeSSE(ARGS))],[OC,OCZ,NV]);
  check('opencode bad -> opencode-zen bad -> third model serves',good(r.inp)&&r.called.join()==='m0,m1,m2','called='+r.called+' input='+JSON.stringify(r.inp));

  const g=claudeSSE(ARGS); r=await run(withTools,[()=>sse(g),()=>sse(g)]);
  check('valid first reply passes through byte-identical, still SSE',r.text.replace(/^:.*\n\n/gm,'')===g&&r.called.join()==='m0'&&/event-stream/.test(r.res.headers.get('content-type')),'called='+r.called);

  const noTools={...withTools,tools:undefined}; let first; r=await run(noTools,[()=>(first=sse(claudeSSE(''))),()=>sse(claudeSSE(ARGS))]);
  check('request without tools is untouched (same Response object)',r.res===first&&r.called.join()==='m0','called='+r.called);

  r=await run(withTools,[()=>sse(claudeSSE('')),()=>sse(claudeSSE(''))]);
  check('last model with empty args is returned as-is, no loop',r.called.join()==='m0,m1'&&r.inp.length===1&&JSON.stringify(r.inp[0])==='{}','called='+r.called+' input='+JSON.stringify(r.inp));

  r=await run(withTools,[()=>sse(claudeSSE('')),err]);
  check('later model errors -> original reply, never worse than before',r.called.join()==='m0,m1'&&r.inp.length===1&&r.res.status===200,'called='+r.called+' status='+r.res.status);

  r=await run({...withTools,stream:false},[()=>json(claudeJSON('')),()=>json(claudeJSON(ARGS))]);
  check('non-streaming JSON reply with empty args -> next model',good(r.inp)&&r.called.join()==='m0,m1','called='+r.called+' input='+JSON.stringify(r.inp));

  const oaBody={model:'t',stream:true,tools:[{type:'function',function:{name:'Bash',parameters:TOOLS[0].input_schema}}],messages:withTools.messages};
  r=await run(oaBody,[()=>sse(openaiSSE('')),()=>sse(openaiSSE(ARGS))]);
  check('OpenAI chat-completions client, empty args -> next model',good(r.inp)&&r.called.join()==='m0,m1','called='+r.called+' input='+JSON.stringify(r.inp));

  r=await run(withTools,[()=>sse(claudeSSE(ARGS),200),()=>sse(claudeSSE(ARGS))]);
  check('keepalive comments flow while the reply is buffered',/^: /m.test(r.text)&&good(r.inp),'keepalives='+(r.text.match(/^: /gm)||[]).length);

  { const called=[]; const res=await Pr({body:withTools,models:[OC,OR],log,comboName:'t',comboStrategy:'fallback',
      handleSingleModel:async(b,m)=>{const i=m===OC?'m0':'m1'; called.push(i); return i==='m0'?sse(claudeSSE(''),150):sse(claudeSSE(ARGS));}});
    await res.body.cancel(); await new Promise(r=>setTimeout(r,300));
    check('client disconnect while buffering -> next model is not called',called.join()==='m0','called='+called); }

  console.log(fail?`${fail} scenario(s) FAILED`:'all failover-guard scenarios pass'); process.exit(fail?1:0);
})().catch(e=>{ console.error('ERROR',e&&e.stack); process.exit(1); });
