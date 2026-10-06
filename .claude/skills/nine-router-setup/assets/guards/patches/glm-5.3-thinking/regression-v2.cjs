#!/usr/bin/env node
// GLM 5.3 Flash reasoning-control regression suite (v2, 2026-09-18).
//
// Deterministic, offline, no network, no database, no router process: it
// instantiates the REAL modules out of a 9Router prebuilt bundle through a
// minimal webpack-runtime shim and drives the real request pipeline --
//   GH(fromWire,toWire,model,body,stream,...,provider,...)   translate + thinking applier
//   transport.transformRequest(model,body,stream,credentials) last stage before JSON.stringify
// -- so every assertion below is about the code that actually runs.
//
// Usage: node regression-v2.cjs [9router_root]          (default: the npm global install)
// Exit 0 = all pass. Exit 1 = at least one FAIL. Exit 2 = the bundle could not be loaded
// (never reported as a pass).
'use strict';
const fs=require('fs'), path=require('path'), os=require('os');

// ---------------------------------------------------------------- loader ----
function walk(dir,out=[]){ for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name); if(e.isDirectory()) walk(p,out); else if(e.name.endsWith('.js')) out.push(p); } return out; }
function makeLoader(root){
  const serverDir=path.join(root,'server'), chunkDir=path.join(serverDir,'chunks');
  if(!fs.existsSync(chunkDir)) { console.error('FATAL: no server/chunks under '+root); process.exit(2); }
  const factories={};
  for(const f of fs.readdirSync(chunkDir).sort()){
    if(!f.endsWith('.js')) continue;
    let m; try{ m=require(path.join(chunkDir,f)); }catch(e){ continue; }
    if(m&&m.modules) for(const id of Object.keys(m.modules)) if(!(id in factories)) factories[id]=m.modules[id];
  }
  const extRe=/(\d+):a=>\{a\.exports=require\("([^"]+)"\)\}/g;
  for(const p of walk(serverDir)){
    if(p.startsWith(chunkDir)) continue;
    let s; try{ s=fs.readFileSync(p,'utf8'); }catch(e){ continue; }
    let m; extRe.lastIndex=0;
    while((m=extRe.exec(s))){ const id=m[1],spec=m[2];
      if(!(id in factories)) factories[id]=(mod)=>{ mod.exports=require(spec); }; }
  }
  const cache={};
  function req(id){ id=String(id);
    if(cache[id]) return cache[id].exports;
    const f=factories[id];
    if(!f){ const bomb=()=>{throw new Error('bundle module '+id+' unresolved and used');};
            const mod={exports:new Proxy({},{get:bomb,apply:bomb,set:bomb}),id}; cache[id]=mod; return mod.exports; }
    const mod={exports:{},id}; cache[id]=mod; f(mod,mod.exports,req); return mod.exports; }
  req.d=(e,defs)=>{ for(const k in defs) Object.defineProperty(e,k,{enumerable:true,configurable:true,get:defs[k]}); };
  req.r=(e)=>Object.defineProperty(e,'__esModule',{value:true});
  req.o=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  req.n=(m)=>{ const g=m&&m.__esModule?()=>m.default:()=>m; req.d(g,{a:g}); return g; };
  req.t=(v)=>v; req.e=()=>Promise.resolve(); req.f={}; req.u=()=>''; req.p=''; req.g=globalThis;
  return req;
}

const ROOT=process.argv[2]||path.join(os.homedir(),'.npm-global/lib/node_modules/9router');
const BUILD=path.join(ROOT,'app/.next-cli-build');
const req=makeLoader(BUILD);
const CAPS=req(24), LEVELS=req(72239), PIPE=req(88499), FMT=req(14170).h, REG=req(26070), BASE=req(96179);
if(!FMT||!FMT.OLLAMA){ console.error('FATAL: format enum not found'); process.exit(2); }

// ---------------------------------------------------------------- harness ----
let pass=0, fail=0; const failures=[];
function chk(name, got, want){
  const g=JSON.stringify(got), w=JSON.stringify(want);
  if(g===w){ pass++; console.log('  PASS  '+name); }
  else { fail++; failures.push(name); console.log('  FAIL  '+name+'\n          got  '+g+'\n          want '+w); }
}
function chkTrue(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  '+name); }
  else { fail++; failures.push(name); console.log('  FAIL  '+name+(detail?'\n          '+detail:'')); }
}
const strip=(m)=>String(m).replace(/\([^()]*\)\s*$/,'').trim();

// Full pipeline: client wire -> provider wire -> thinking applier -> transport.
// Mirrors chat-core: ah = GH(...); ah.model = stripSuffix(model); transport.transformRequest(...)
function finalRequest({fromWire,toWire,provider,model,body,stream,creds}){
  const b=JSON.parse(JSON.stringify(body));
  const out=PIPE.GH(fromWire,toWire,model,b,!!stream,null,provider,null,[],null,null);
  if(!out) throw new Error('GH returned falsy');
  // chat-core strips the suffix from the BODY's model but passes the still-suffixed id
  // to the transport: `ah.model=stripSuffix(aC)` then `execute({model:ap,body:ah,...})`,
  // and execute() calls `this.transformRequest(model, body, stream, credentials)`.
  // The suite must mirror that asymmetry or it cannot see a suffix-sensitive bug.
  out.model=strip(model);
  const tr=new BASE.L(provider);
  const fin=tr.transformRequest(model,out,!!stream,creds||{});
  const url=tr.buildUrl(fin.model,!!stream,0,creds||{});
  const shown={}; for(const k of Object.keys(fin)) if(k!=='messages') shown[k]=fin[k];
  return {url, body:fin, shown};
}
const MSG=[{role:'user',content:'What is 17*23?'}];
const OR_CUSTOM='openai-compatible-chat-5ca0b14b-5cca-49f1-a53e-11858325475d';
const OR_CREDS={providerSpecificData:{baseUrl:'https://openrouter.ai/api/v1'}};

console.log('9Router root : '+ROOT);
try{ console.log('package      : '+JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version); }catch(e){}
console.log('');

// ===================== 1. capability resolution per identifier form =========
console.log('1. capability resolution (which entry wins per identifier form)');
{
  const M=CAPS.MODEL_CAPABILITIES['glm-5.3-flash'];
  chk('1.1 MODEL_CAPABILITIES[glm-5.3-flash] keeps every stock capability and gains the flag',
      M, {vision:true,videoInput:true,pdf:true,reasoning:true,thinkingFormat:'zai',
          thinkingEffortSupported:true,contextWindow:1000000,maxOutput:131072});
  const forms=[
    ['openrouter','z-ai/glm-5.3-flash',            'MODEL_CAPABILITIES basename'],
    ['openrouter','glm-5.3-flash',                 'MODEL_CAPABILITIES exact'],
    [OR_CUSTOM,   'z-ai/glm-5.3-flash',            'MODEL_CAPABILITIES basename'],
    ['ollama',    'glm-5.3-flash:cloud',           'PATTERN_CAPABILITIES *glm-5.3*'],
    ['ollama',    'glm-5.3-flash',                 'MODEL_CAPABILITIES exact'],
    ['ollama-local','glm-5.3-flash:cloud',         'PATTERN_CAPABILITIES *glm-5.3*'],
  ];
  for(const [p,m,which] of forms){
    const c=CAPS.getCapabilitiesForModel(p,m);
    chkTrue(`1.2 ${p}/${m} resolves reasoning+effort-supported (entry: ${which})`,
      c.reasoning===true && c.thinkingEffortSupported===true,
      'reasoning='+c.reasoning+' thinkingEffortSupported='+c.thinkingEffortSupported+
      ' thinkingFormat='+c.thinkingFormat+' maxOutput='+c.maxOutput);
  }
  // the (level) suffix is stripped before the caps lookup by the applier, so the
  // suffixed id must resolve to the same entry as the bare one
  const a=CAPS.getCapabilitiesForModel('openrouter',strip('z-ai/glm-5.3-flash(max)'));
  const b=CAPS.getCapabilitiesForModel('openrouter','z-ai/glm-5.3-flash');
  chk('1.3 suffix-stripped id resolves identically to the bare id', a, b);
}

// ===================== 2. level resolution, no global side effects ==========
console.log('\n2. level resolution');
{
  for(const [p,m] of [['openrouter','z-ai/glm-5.3-flash'],['ollama','glm-5.3-flash:cloud'],
                      ['ollama-local','glm-5.3-flash:cloud'],[OR_CUSTOM,'z-ai/glm-5.3-flash']])
    chk(`2.1 levels for ${p}/${m}`, LEVELS.k(p,m), ['low','high','max']);
  // CodeBuddy must be exactly what stock gave it
  chk('2.2 codebuddy-cn/glm-5.3-flash levels unchanged from stock', LEVELS.k('codebuddy-cn','glm-5.3-flash'), ['low','high','max']);
  chk('2.3 codebuddy-cn/glm-5.3 levels unchanged from stock',       LEVELS.k('codebuddy-cn','glm-5.3'),       ['low','high','max']);
  chk('2.4 codebuddy-cn/glm-5.2 rule untouched',                    LEVELS.k('codebuddy-cn','glm-5.2'),       ['high','xhigh']);
  // stock ordering: the generic {pattern:"*deepseek-v4.*"} rule is listed BEFORE the
  // codebuddy-scoped {pattern:"deepseek-v4*"} one, so a dotted id hits the generic rule.
  // Both values are pinned to stock 0.5.81 truth.
  chk('2.5a codebuddy-cn/deepseek-v4 rule untouched',   LEVELS.k('codebuddy-cn','deepseek-v4'),   ['low','high','xhigh']);
  chk('2.5b codebuddy-cn/deepseek-v4.1 ordering untouched', LEVELS.k('codebuddy-cn','deepseek-v4.1'),
      ['none','low','medium','high','xhigh','max']);
  // a provider with no GLM 5.3 rule of its own must NOT pick one up
  chk('2.6 an unlisted provider gets no GLM 5.3 level rule (by-format default)',
      LEVELS.k('nvidia','z-ai/glm-5.3-flash'), ['none','thinking']);
  // representative unrelated models
  chk('2.7 unrelated: deepseek/deepseek-flash levels unchanged', LEVELS.k('deepseek','deepseek-flash'), ['none','high','max']);
  chk('2.8 unrelated: codex/gpt-6 levels unchanged', LEVELS.k('codex','gpt-6'),
      ['none','minimal','low','medium','high','xhigh','max']);
}

// ===================== 3. OpenRouter final outgoing request =================
console.log('\n3. OpenRouter: final outgoing request');
{
  const r=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash(max)',body:{model:'x',messages:MSG,max_tokens:1024},stream:false});
  chk('3.1 endpoint', r.url, 'https://openrouter.ai/api/v1/chat/completions');
  chk('3.2 reasoning envelope carries effort max', r.body.reasoning, {effort:'max'});
  chkTrue('3.3 no conflicting reasoning_effort field', r.body.reasoning_effort===undefined, 'reasoning_effort='+r.body.reasoning_effort);
  chkTrue('3.4 no vendor-native thinking object', r.body.thinking===undefined && r.body.enable_thinking===undefined,
    'thinking='+JSON.stringify(r.body.thinking)+' enable_thinking='+r.body.enable_thinking);
  chk('3.5 the (max) suffix is NOT forwarded in the upstream model id', r.body.model, 'z-ai/glm-5.3-flash');
  // every supported level once, plus disable and omitted
  for(const [lvl,want] of [['low','low'],['high','high'],['max','max'],['none','none']]){
    const x=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
      model:`z-ai/glm-5.3-flash(${lvl})`,body:{model:'x',messages:MSG,max_tokens:512},stream:false});
    chk(`3.6 (${lvl}) -> reasoning.effort`, x.body.reasoning&&x.body.reasoning.effort, want);
  }
  const om=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash',body:{model:'x',messages:MSG,max_tokens:512},stream:false});
  chkTrue('3.7 omitted effort stays omitted (not silently max)',
    om.body.reasoning===undefined && om.body.reasoning_effort===undefined,
    'reasoning='+JSON.stringify(om.body.reasoning)+' reasoning_effort='+om.body.reasoning_effort);
  // the custom openai-compatible OpenRouter node must land on the same envelope
  const c=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:OR_CUSTOM,
    model:'z-ai/glm-5.3-flash(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:false,creds:OR_CREDS});
  chk('3.8 custom openai-compatible OpenRouter node: same envelope', c.body.reasoning, {effort:'max'});
  chkTrue('3.9 custom node: Z.ai-native fields stripped', c.body.thinking===undefined && c.body.reasoning_effort===undefined);
  // claude wire in, openai wire out (this is what claude-nine speaks)
  const cw=finalRequest({fromWire:FMT.CLAUDE,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash(max)',body:{model:'x',messages:MSG,max_tokens:1024},stream:true});
  chk('3.10 claude wire -> openrouter keeps reasoning.effort max', cw.body.reasoning, {effort:'max'});
}

// ===================== 4. Ollama final outgoing request =====================
console.log('\n4. Ollama Cloud: final outgoing request');
{
  const r=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'glm-5.3-flash:cloud(max)',body:{model:'x',messages:MSG,max_tokens:1024},stream:true});
  chk('4.1 endpoint (native /api/chat, connection API unchanged)', r.url, 'https://ollama.com/api/chat');
  chk('4.2 top-level think carries the level verbatim (never think:true for max)', r.body.think, 'max');
  chkTrue('4.3 Z.ai-native fields removed', r.body.thinking===undefined && r.body.reasoning_effort===undefined
    && r.body.enable_thinking===undefined,
    'thinking='+JSON.stringify(r.body.thinking)+' reasoning_effort='+r.body.reasoning_effort);
  chk('4.4 the (max) suffix is NOT forwarded in the upstream model id', r.body.model, 'glm-5.3-flash:cloud');
  chkTrue('4.5 think is top-level, not nested in options', r.body.options&&r.body.options.think===undefined);
  for(const [lvl,want] of [['low','low'],['high','high'],['max','max']]){
    const x=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
      model:`glm-5.3-flash:cloud(${lvl})`,body:{model:'x',messages:MSG,max_tokens:512},stream:true});
    chk(`4.6 (${lvl}) -> think`, x.body.think, want);
  }
  const off=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'glm-5.3-flash:cloud(none)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.7 (none) disables thinking the way Ollama expects', off.body.think, false);
  const om=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'glm-5.3-flash:cloud',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chkTrue('4.8 omitted effort emits no think at all (server default preserved)',
    !('think' in om.body), 'think='+JSON.stringify(om.body.think));
  const lo=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama-local',
    model:'glm-5.3-flash:cloud(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.9 ollama-local connection gets the same native serialization', lo.body.think, 'max');

  // ---- v3: native think for EVERY reasoning model on an Ollama target ----------------
  // deepseek-v4.1-flash(max) is a live sonnet-chain member. Its own serializer writes
  // thinking:{type:"enabled"} + reasoning_effort, which the native endpoint never reads.
  const ds=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'deepseek-v4.1-flash(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.10 ollama/deepseek-v4.1-flash(max) emits native think', ds.body.think, 'max');
  chkTrue('4.11 ollama/deepseek-v4.1-flash(max) drops the non-native fields',
    ds.body.thinking===undefined && ds.body.reasoning_effort===undefined
    && ds.body.enable_thinking===undefined && ds.body.output_config===undefined,
    JSON.stringify(ds.shown));
  // the deepseek serializer collapses every level below max to "high"; the level must come
  // from the INTENT so the mapping stays 1:1
  const dl=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'deepseek-v4.1-flash(low)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.12 ollama/deepseek-v4.1-flash(low) maps 1:1, not via the serializer collapse to high',
      dl.body.think, 'low');
  const dn=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'deepseek-v4.1-flash(none)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.13 ollama/deepseek-v4.1-flash(none) disables thinking natively', dn.body.think, false);
  const dlo=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama-local',
    model:'deepseek-v4.1-flash(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.14 ollama-local/deepseek-v4.1-flash(max) too', dlo.body.think, 'max');
  // a model with NO reasoning capability must get no think field at all
  const nr=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'llama3.3:cloud(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chkTrue('4.15 a non-reasoning Ollama model gets NO think field',
    !('think' in nr.body), 'caps.reasoning='+CAPS.getCapabilitiesForModel('ollama','llama3.3:cloud').reasoning
    +' body='+JSON.stringify(nr.shown));
  const nr2=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'nomic-embed-text(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chkTrue('4.16 a second non-reasoning Ollama model gets NO think field',
    !('think' in nr2.body), JSON.stringify(nr2.shown));
  // GPT-OSS is the one documented exception: low/medium/high only, so max is aliased to high
  const go=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'gpt-oss:120b(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.17 gpt-oss: max is aliased to high (its documented native set)', go.body.think, 'high');
  const go2=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'gpt-oss:120b(low)',body:{model:'x',messages:MSG,max_tokens:512},stream:true});
  chk('4.18 gpt-oss: low is untouched by the alias', go2.body.think, 'low');
}

// ===================== 5. precedence, unchanged elsewhere ===================
console.log('\n5. precedence and blast radius');
{
  // existing precedence: the model-suffix override outranks a request-body effort
  const p1=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash(max)',body:{model:'x',messages:MSG,max_tokens:512,reasoning_effort:'low'},stream:false});
  chk('5.1 model suffix (max) outranks body reasoning_effort=low', p1.body.reasoning, {effort:'max'});
  const p2=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash',body:{model:'x',messages:MSG,max_tokens:512,reasoning_effort:'high'},stream:false});
  chk('5.2 with no suffix the body effort is used', p2.body.reasoning, {effort:'high'});
  const p3=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'z-ai/glm-5.3-flash',body:{model:'x',messages:MSG,max_tokens:512,output_config:{effort:'max'}},stream:false});
  chk('5.3 output_config.effort (the /effort form claude-nine sends) is honoured', p3.body.reasoning, {effort:'max'});
  const p4=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OLLAMA,provider:'ollama',
    model:'glm-5.3-flash:cloud',body:{model:'x',messages:MSG,max_tokens:512,reasoning_effort:'max'},stream:true});
  chk('5.4 ollama honours a body effort with no suffix', p4.body.think, 'max');
  // unrelated model on the SAME OpenRouter connection keeps the stock field
  const u1=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'qwen/qwen3.8-flash(high)',body:{model:'x',messages:MSG,max_tokens:512},stream:false});
  chkTrue('5.5 unrelated OpenRouter model still uses stock reasoning_effort (no envelope)',
    u1.body.reasoning_effort==='high' && u1.body.reasoning===undefined,
    'reasoning_effort='+u1.body.reasoning_effort+' reasoning='+JSON.stringify(u1.body.reasoning));
  // v3 replaced the old 5.6 ("unrelated Ollama model unchanged"): native think is now
  // emitted for every reasoning model on an Ollama target, which is the point of v3.
  // The remaining blast-radius question is that non-Ollama targets are untouched.
  const u2=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'openrouter',
    model:'deepseek/deepseek-v4.1-flash(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:false});
  chkTrue('5.6 a non-Ollama target never receives a think field',
    u2.body.think===undefined, 'think='+JSON.stringify(u2.body.think)+' body='+JSON.stringify(u2.shown));
  // a representative unrelated provider entirely
  const u3=finalRequest({fromWire:FMT.OPENAI,toWire:FMT.OPENAI,provider:'deepseek',
    model:'deepseek-flash(max)',body:{model:'x',messages:MSG,max_tokens:512},stream:false});
  chkTrue('5.7 unrelated provider deepseek unchanged',
    u3.body.reasoning_effort==='max' && u3.body.reasoning===undefined && JSON.stringify(u3.body.thinking)==='{"type":"enabled"}',
    JSON.stringify(u3.shown));
}

// ===================== 6. provider/transport identity ======================
console.log('\n6. provider and transport identity');
{
  chk('6.1 the ollama connection still speaks the native ollama format', REG.xq.ollama.format, 'ollama');
  chk('6.2 the ollama connection base URL is unchanged', REG.xq.ollama.baseUrl, 'https://ollama.com/api/chat');
  chk('6.3 the openrouter connection still declares thinkingFormat openai', REG.xq.openrouter.thinkingFormat, 'openai');
}


// ===================== 7. response-path repairs (anchor presence) ==========
// Edits E and F live on the RESPONSE path, which this in-process harness does not
// drive (it stops at the outgoing request). They are therefore verified by exact
// final-form presence, not by behaviour: the behavioural proof for them is the
// sandbox integration test (see PORT-0.5.81.md, section "reasoning visibility").
// Anchor presence is still a real regression detector: an update replaces the whole
// bundle, so a reverted file loses the final form entirely.
console.log('\n7. response-path repairs (final-form presence)');
{
  const E_NEW='if(M?.usage&&(M.usage=(0,h.WL)((0,h.O9)(M.usage),r)),!N&&!O&&s!==d.h.OLLAMA&&M?.choices)for(let a of M.choices)'
             +'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;';
  // 0.5.85 renamed the minified locals in this function (M->N, N->O, O->P, r->s, targetFormat s->t). Same edit. (2026-09-22)
  const E_NEW85='if(N?.usage&&(N.usage=(0,h.WL)((0,h.O9)(N.usage),s)),!O&&!P&&t!==d.h.OLLAMA&&N?.choices)for(let a of N.choices)'
             +'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;';
  // 0.5.91 renamed them again (N->O, O->P, P->Q, s->t, targetFormat t->u). Same edit. (2026-09-26)
  const E_NEW91='if(O?.usage&&(O.usage=(0,h.WL)((0,h.O9)(O.usage),t)),!P&&!Q&&u!==d.h.OLLAMA&&O?.choices)for(let a of O.choices)'
             +'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;';
  const F_NEW='g=c.reasoning_content||c.provider_specific_fields?.reasoning_content||c.reasoning||'
             +'(Array.isArray(c.reasoning_details)?c.reasoning_details.map(a=>"string"==typeof a?a:a?.text||a?.content||"").join(""):"")||"";';
  let all=[]; walk(BUILD, all);
  let ce=0, cf=0;
  for(const p of all){
    let t; try{ t=fs.readFileSync(p,'utf8'); }catch(e){ continue; }
    ce+=t.split(E_NEW).length-1+t.split(E_NEW85).length-1+t.split(E_NEW91).length-1; cf+=t.split(F_NEW).length-1;
  }
  chk('7.1 non-stream Ollama reasoning_content is preserved (edit E present once)', ce, 1);
  chk('7.2 non-stream openai->claude reads reasoning/reasoning_details (edit F present once)', cf, 1);
}

console.log('\n---------------------------------------------');
console.log(`PASS ${pass}   FAIL ${fail}`);
if(fail){ console.log('failed: '+failures.join(' | ')); }
process.exit(fail?1:0);
