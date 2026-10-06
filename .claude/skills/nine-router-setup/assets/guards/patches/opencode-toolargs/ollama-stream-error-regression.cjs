#!/usr/bin/env node
// Ollama stream error (stream converter module 71857 i5, chunk 8895.js). Offline: pipes native Ollama NDJSON
// through the router's REAL stream converter, as the chat handler does, and reads what the client gets.
// A stream with a mid-stream {"error":...} line, or one that closes without done:true, must end in one error
// event in the client's format; finished Ollama streams and non-Ollama streams must be byte-identical to
// the unpatched converter (compared when a pristine 9router root is given as argv[3]).
// Exit 0 = all pass, 1 = a scenario failed, 2 = bundle not loadable.
'use strict';
const path=require('path'),os=require('os'),fs=require('fs');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'oe-data-'));   // never the live ~/.9router DB
const {req}=require(path.join(__dirname,'regression.cjs'));
let S,FMT; try{ S=req(71857).i5; FMT=req(14170).h; if(typeof S!=='function') throw 0; }
catch(e){ console.error('FATAL: stream converter 71857.i5 not loadable', e&&e.message); process.exit(2); }

const M='deepseek-v4.1-flash';
const THINK={model:M,message:{role:'assistant',content:'',thinking:'Let me think.'}};
const OK=[THINK,{model:M,message:{role:'assistant',content:'OK'}},{model:M,message:{role:'assistant',content:''},done:true,done_reason:'stop',prompt_eval_count:3,eval_count:2}];
const ERR=[THINK,THINK,{error:'Internal Server Error (ref: overload)'}];
const CUT=[THINK,THINK];
const enc=new TextEncoder();
// lines -> bytes; `tail` false leaves the last line without its newline (lands in the converter's flush)
const src=(chunks)=>new ReadableStream({start(c){for(const x of chunks)c.enqueue(enc.encode(x));c.close();}});
const nd=(lines,tail=true)=>lines.map(l=>JSON.stringify(l)).join('\n')+(tail?'\n':'');
const conv=async(text,client,prov='ollama',fmt=FMT.OLLAMA)=>(await new Response(src([text]).pipeThrough(S(fmt,client,prov,null,null,M,null,{messages:[]}))).text()).replace(/(chatcmpl-|msg_|resp_|"id":")\d+/g,'$1N').replace(/"created(_at)?":\d+/g,'"created$1":N').replace(/"sequence_number":\d+/g,'"sequence_number":N');
const events=t=>t.split('\n\n').filter(Boolean).map(b=>{const d=b.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('');try{return JSON.parse(d)}catch{return d}});
const last=t=>{const e=events(t);return e[e.length-1];};
let fail=0; const check=(name,ok,detail)=>{ if(!ok) fail++; console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(66)+' '+String(detail).slice(0,160)); };

(async()=>{
  if(process.argv[4]==='--dump'){ process.stdout.write('\n@@DUMP@@'+JSON.stringify(await dumpNow())); process.exit(0); }   // child: byte dump of this bundle
  const C=FMT.CLAUDE,O=FMT.OPENAI,R=FMT.OPENAI_RESPONSES;
  const isErr={
    [C]:(t,txt)=>{const e=last(t);return /\nevent: error\n/.test('\n'+t.split('\n\n').filter(Boolean).pop())&&e.type==='error'&&e.error.type==='api_error'&&e.error.message.includes(txt)&&!/message_stop/.test(t);},
    [O]:(t,txt)=>{const e=last(t);return !!(e&&e.error&&e.error.message.includes(txt))&&!/finish_reason":"(stop|length|tool_calls)/.test(t);},
    [R]:(t,txt)=>{const e=last(t);return e.type==='response.failed'&&e.response.status==='failed'&&e.response.error.message.includes(txt)&&!/response\.completed/.test(t);}};
  for(const cl of [C,O,R]){
    let t=await conv(nd(ERR),cl);
    check(`${cl}: mid-stream {"error"} line -> ${cl==='claude'?'event: error':cl==='openai'?'error chunk':'response.failed'} with Ollama text`,isErr[cl](t,'Ollama stream error: Internal Server Error (ref: overload)'),JSON.stringify(last(t)));
    t=await conv(nd(CUT),cl);
    check(`${cl}: stream closes without done:true -> error event`,isErr[cl](t,'ended before the reply finished'),JSON.stringify(last(t)));
    t=await conv(nd(ERR,false),cl);
    check(`${cl}: error line with no trailing newline (read in flush) -> error text kept`,isErr[cl](t,'Internal Server Error'),JSON.stringify(last(t)));
    t=await conv(nd(OK),cl);
    check(`${cl}: finished Ollama stream -> no error event`,!/event: error|response\.failed|"error":\{/.test(t)&&events(t).length>1,'events='+events(t).length);
    t=await conv(nd(OK,false),cl);
    check(`${cl}: done:true with no trailing newline -> no error event`,!/event: error|response\.failed|"error":\{/.test(t),'events='+events(t).length);
  }
  { const t=await conv(nd(ERR),C);
    check('exactly one error event, after the partial thinking',(t.match(/event: error/g)||[]).length===1&&/thinking_delta/.test(t),'errors='+(t.match(/event: error/g)||[]).length); }
  { const t=await conv(nd(ERR),C,'ollama-local');
    check('ollama-local provider -> same error event',last(t).type==='error'&&last(t).error.message.startsWith('ollama-local/'),JSON.stringify(last(t))); }
  // Non-Ollama upstream: an OpenAI-format stream cut short must not gain an error event.
  { const cut='data: '+JSON.stringify({id:'c',object:'chat.completion.chunk',created:1,model:M,choices:[{index:0,delta:{content:'hi'},finish_reason:null}]})+'\n\n';
    const t=await conv(cut,C,'openrouter',FMT.OPENAI);
    check('non-Ollama (openai-format) truncated stream -> untouched, no error event',!/event: error/.test(t),'events='+events(t).length); }

  // Byte-identical to the pristine converter for finished Ollama streams and non-Ollama streams.
  const orig=process.argv[3];
  if(orig){ const {execFileSync}=require('child_process');
    const dump=root=>JSON.parse(execFileSync(process.execPath,[__filename,root,'','--dump'],{env:process.env,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\n@@DUMP@@').pop());
    const a=await dumpNow(), b=dump(orig);
    for(const k of Object.keys(a)) check(`byte-identical to pristine bundle: ${k}`,a[k]===b[k],a[k]===b[k]?'same':'DIFFERS'); }
  try{ fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}); }catch{}
  console.log(fail?`${fail} scenario(s) FAILED`:'all ollama-stream-error scenarios pass'); process.exit(fail?1:0);
})().catch(e=>{ console.error('ERROR',e&&e.stack); process.exit(1); });

async function dumpNow(){ const C=FMT.CLAUDE,O=FMT.OPENAI,R=FMT.OPENAI_RESPONSES,r={};
  for(const cl of [C,O,R]){ r[`${cl} finished ollama`]=await conv(nd(OK),cl); r[`${cl} finished ollama, no trailing newline`]=await conv(nd(OK,false),cl);
    r[`${cl} openai-format upstream`]=await conv('data: '+JSON.stringify({id:'c',object:'chat.completion.chunk',created:1,model:M,choices:[{index:0,delta:{content:'hi'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',cl,'openrouter',FMT.OPENAI); }
  return r; }
