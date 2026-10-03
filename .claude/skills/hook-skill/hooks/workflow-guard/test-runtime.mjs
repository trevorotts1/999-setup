import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-runtime-'));
try {
 const gen=path.join(tmp,'gen');
 const units=Array.from({length:10},(_,i)=>({id:'TST-'+String(i+1).padStart(3,'0'),prompt:'build',qcPrompt:'qc',ownership:`file-${i}`}));
 fs.writeFileSync(path.join(tmp,'units.json'),JSON.stringify(units));
 execFileSync('python3',[path.join(root,'make-workflow.py'),'--units',path.join(tmp,'units.json'),'--out-dir',gen,'--provider-slots','10','--program','test','--wave','1','--run-root',tmp]);
 const launch=JSON.parse(fs.readFileSync(path.join(gen,'launch-01.json'))),source=fs.readFileSync(launch.scriptPath,'utf8').replace('export const meta','const meta');
 for(const fail of [false,true]) {
  let active=0,peak=0,builds=0,qcs=0;
  const ctx=vm.createContext({args:launch.args,log(){},pipeline:(items,...stages)=>Promise.all(items.map(async item=>{let prev=item;for(const stage of stages){try{prev=await stage(prev,item);}catch{return null;}}return prev;})),agent:async(prompt,opt)=>{
   active++;peak=Math.max(peak,active);assert(['Build','QC'].includes(opt.phase));assert(opt.label);assert(opt.model);
   if(opt.phase==='Build')builds++;else qcs++;
   await new Promise(r=>setTimeout(r,5));active--;
   if(fail && opt.label==='build:TST-004')return null;
   return {id:opt.label.split(':')[1],status:'PASS',evidence:'synthetic test receipt'};
  }});
  const result=await new vm.Script('(async()=>{'+source+'})()').runInContext(ctx,{timeout:1000});
  assert.equal(peak,10);assert.equal(builds,10);assert.equal(qcs,fail?9:10);assert.equal(result.complete,!fail);
  if(fail)assert.equal(result.results[3].status,'BLOCKED');
  console.log(`PASS mock runtime: peak=${peak}, builds=${builds}, qc=${qcs}, complete=${result.complete}; no lost null unit`);
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
