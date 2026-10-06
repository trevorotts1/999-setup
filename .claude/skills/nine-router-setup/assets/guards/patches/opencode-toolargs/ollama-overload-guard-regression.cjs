#!/usr/bin/env node
// Ollama overload guard (combo loop Pr + non-stream Ollama->client translation). Offline: drives the REAL
// combo loop with fake per-model handlers whose replies come out of the router's REAL Ollama stream
// translator (module 71857 i5) fed native Ollama NDJSON. So the broken reply is the same bytes Claude Code
// got on 2026-09-23: thinking deltas, then Ollama's {"error":...} line, which the translator drops, and no
// message_stop. Exit 0 = all pass, 1 = a scenario failed, 2 = bundle not loadable.
'use strict';
const path=require('path'),os=require('os'),fs=require('fs');
process.env.NINEROUTER_FG_KEEPALIVE_MS='50';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'og-data-'));   // never the live ~/.9router DB
const AUDIT=path.join(os.tmpdir(),'og-regression-'+process.pid+'.log'); process.env.NINEROUTER_FG_LOG=AUDIT;
const {req}=require(path.join(__dirname,'regression.cjs'));
let Pr,S,NS,FMT; try{ Pr=req(18910).Pr; S=req(71857).i5; NS=req(5016).N; FMT=req(14170).h; if(typeof Pr!=='function'||typeof S!=='function'||typeof NS!=='function') throw 0; }
catch(e){ console.error('FATAL: bundle modules 18910.Pr / 71857.i5 / 5016.N not loadable', e&&e.message); process.exit(2); }

const M='deepseek-v4.1-flash';
const THINK={model:M,message:{role:'assistant',content:'',thinking:'Let me think.'}};
const OK=[THINK,{model:M,message:{role:'assistant',content:'OK'}},{model:M,message:{role:'assistant',content:''},done:true,done_reason:'stop',prompt_eval_count:3,eval_count:2}];
const OVERLOAD=[THINK,THINK,{error:'Internal Server Error (ref: overload)'}];
const CUT=[THINK,THINK];                                                   // connection dropped, no error line
const nd=lines=>new ReadableStream({start(c){const e=new TextEncoder();for(const l of lines)c.enqueue(e.encode(JSON.stringify(l)+'\n'));c.close();}});
// What the router sends the client for this Ollama stream, in the client's wire format.
const wire=async(lines,client='claude')=>new Response(nd(lines).pipeThrough(S('ollama',client,'ollama',null,null,M,null,{messages:[]}))).text();
const sse=(t,ms=0)=>new Response(new ReadableStream({async start(c){ if(ms) await new Promise(r=>setTimeout(r,ms)); c.enqueue(new TextEncoder().encode(t)); c.close(); }}),{status:200,headers:{'Content-Type':'text/event-stream'}});
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json'}});
const MSG={id:'m1',type:'message',role:'assistant',model:M,content:[{type:'text',text:'OK'}],stop_reason:'end_turn',usage:{input_tokens:3,output_tokens:1}};

const logs=[]; const log={info:(t,m)=>logs.push('I '+m),warn:(t,m)=>logs.push('W '+m)};
const OL='ollama/deepseek-v4.1-flash(max)',OL2='ollama/glm-5.3-flash:cloud(max)',DS='ds/deepseek-flash(max)',OR='openrouter/z-ai/glm-5.3-flash(max)';
async function run(replies,names,body=stream){ const called=[]; logs.length=0; let orig=[];
  const models=names.slice(0,replies.length);
  const res=await Pr({body,models,handleSingleModel:async(b,m)=>{const i=models.indexOf(m); called.push('m'+i); return orig[i]=await replies[i]();},log,comboName:'t',comboStrategy:'fallback'});
  const text=await res.text(); return {res,text,called,orig,clean:text.replace(/^: keepalive\n\n/gm,'')}; }
const stream={model:'sonnet-chain',stream:true,messages:[{role:'user',content:'hi'}]};
const done=t=>/"type":"message_stop"/.test(t);
let fail=0; const check=(name,ok,detail)=>{ if(!ok) fail++; console.log((ok?'  PASS  ':'  FAIL  ')+name.padEnd(70)+' '+detail); };

(async()=>{
  const W={ok:await wire(OK),over:await wire(OVERLOAD),cut:await wire(CUT)};
  // With ollama-stream-error-v1 the stream also ends in an `event: error`; either way it has no message_stop.
  check('reproduction: Ollama error line -> Claude stream with no message_stop',!done(W.over)&&/thinking_delta/.test(W.over),'bytes='+W.over.length+' errorEvent='+/event: error/.test(W.over));

  let r=await run([()=>sse(W.over),()=>sse(W.ok)],[OL,DS]);
  check('(1) ollama member, overload error mid-stream -> next member serves',r.called.join()==='m0,m1'&&r.clean===W.ok,'called='+r.called+' message_stop='+done(r.text));
  { let f=''; try{ f=fs.readFileSync(AUDIT,'utf8'); fs.unlinkSync(AUDIT); }catch{}
    check('trigger + serving model written to the audit log',new RegExp(`ollama-overload-guard: ${OL.replace(/[()]/g,'\\$&')} answered 200 with (a stream that ended without finishing|an error event: .*Internal Server Error)`).test(f)&&f.includes('retry served by '+DS),JSON.stringify(f.trim().split('\n').map(l=>l.slice(25)))); }

  r=await run([()=>sse(W.cut),()=>sse(W.ok)],[OL,DS]);
  check('(2) ollama stream cut with no error line -> next member serves',r.called.join()==='m0,m1'&&r.clean===W.ok,'called='+r.called);

  r=await run([()=>sse(W.ok),()=>sse(W.ok)],[OL,DS]);
  check('(3) valid ollama stream passes through byte-identical, still SSE',r.clean===W.ok&&r.called.join()==='m0'&&/event-stream/.test(r.res.headers.get('content-type')),'called='+r.called);

  r=await run([()=>json({error:'x'},500),()=>sse(W.over)],[OR,OL]);
  check('(4) last member (ollama) truncated -> returned as-is, no loop',r.called.join()==='m0,m1'&&r.res===r.orig[1]&&r.text===W.over,'called='+r.called+' sameResponse='+(r.res===r.orig[1]));

  r=await run([()=>sse(W.over),()=>sse(W.ok)],[OR,OL]);
  check('(5) non-ollama member truncated -> untouched (same Response object)',r.called.join()==='m0'&&r.res===r.orig[0],'called='+r.called);

  r=await run([()=>sse(W.over),()=>sse(W.over),()=>sse(W.ok)],[OL,OL2,DS]);
  check('(6) ollama bad -> second ollama bad -> third member serves',r.called.join()==='m0,m1,m2'&&r.clean===W.ok,'called='+r.called);

  r=await run([()=>sse(W.over),()=>json({error:{message:'down'}},503)],[OL,DS]);
  check('(7) later members all fail -> original reply, never worse than before',r.called.join()==='m0,m1'&&r.res.status===200&&r.clean===W.over,'called='+r.called+' status='+r.res.status);

  const ns={...stream,stream:false};
  r=await run([()=>json({error:'server busy'}),()=>json(MSG)],[OL,DS],ns);
  check('(8) non-stream: 200 error-shaped JSON -> next member',r.called.join()==='m0,m1'&&JSON.parse(r.text).type==='message','called='+r.called);

  r=await run([()=>json({model:M,done:false}),()=>json(MSG)],[OL,DS],ns);
  check('(9) non-stream: 200 JSON that is not a message -> next member',r.called.join()==='m0,m1'&&JSON.parse(r.text).type==='message','called='+r.called);

  r=await run([()=>json(MSG),()=>json(MSG)],[OL,DS],ns);
  check('(10) non-stream valid message passes through unchanged',r.called.join()==='m0'&&r.text===JSON.stringify(MSG),'called='+r.called);

  r=await run([()=>json({error:'busy'}),()=>json({error:{message:'down'}},503)],[OL,DS],ns);
  check('(11) non-stream, all later fail -> the combo error status (not a fake 200)',r.called.join()==='m0,m1'&&r.res.status===503,'status='+r.res.status);

  for(const cl of ['openai','openai-responses']){
    const bad=await wire(OVERLOAD,cl),good=await wire(OK,cl);
    r=await run([()=>sse(bad),()=>sse(good)],[OL,DS]);
    check(`(12) ${cl} client, ollama truncated -> next member serves`,r.called.join()==='m0,m1'&&r.clean===good,'called='+r.called); }

  r=await run([()=>sse(W.ok,200),()=>sse(W.ok)],[OL,DS]);
  check('(13) keepalive comments flow while the reply is buffered',/^: keepalive/m.test(r.text)&&r.clean===W.ok,'keepalives='+(r.text.match(/^: /gm)||[]).length);

  { const called=[]; const res=await Pr({body:stream,models:[OL,DS],log,comboName:'t',comboStrategy:'fallback',
      handleSingleModel:async(b,m)=>{const i=m===OL?'m0':'m1'; called.push(i); return i==='m0'?sse(W.over,150):sse(W.ok);}});
    await res.body.cancel(); await new Promise(r=>setTimeout(r,300));
    check('(14) client disconnect while buffering -> next member is not called',called.join()==='m0','called='+called); }

  // Non-stream Ollama reply through the real ChatCore non-stream handler: Claude clients must get a Message.
  const ollamaJSON={model:M,message:{role:'assistant',content:'OK',thinking:'t'},done:true,done_reason:'stop',prompt_eval_count:5,eval_count:2};
  const nsr=async client=>{ const x=await NS({providerResponse:json(ollamaJSON),provider:'ollama',model:M,sourceFormat:client,targetFormat:FMT.OLLAMA,body:{messages:[]},stream:false,requestStartTime:Date.now(),
    reqLogger:{logProviderResponse(){},logConvertedResponse(){}},trackDone(){},appendLog(){}}); return JSON.parse(await x.response.text()); };
  let j=await nsr(FMT.CLAUDE);
  check('(15) non-stream Ollama reply to a Claude client is a Claude Message',j.type==='message'&&j.content.some(b=>b.type==='text'&&b.text==='OK')&&j.content.some(b=>b.type==='thinking'),'type='+j.type+' object='+j.object);
  j=await nsr(FMT.OPENAI);
  check('(16) non-stream Ollama reply to an OpenAI client is unchanged chat.completion',j.object==='chat.completion'&&j.choices[0].message.content==='OK','object='+j.object);
  j=await nsr(FMT.OPENAI_RESPONSES);
  check('(17) non-stream Ollama reply to a Responses client is a response object',j.object==='response'&&JSON.stringify(j.output).includes('OK'),'object='+j.object);

  try{ fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}); }catch{}
  console.log(fail?`${fail} scenario(s) FAILED`:'all ollama-overload-guard scenarios pass'); process.exit(fail?1:0);
})().catch(e=>{ console.error('ERROR',e&&e.stack); process.exit(1); });
