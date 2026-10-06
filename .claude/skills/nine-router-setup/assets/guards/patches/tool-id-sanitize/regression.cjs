// Loads the patched helper out of the live chunk and proves it: bad ids fixed, pairs kept, good ids untouched.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const root=process.argv[2]||path.join(os.homedir(),'.npm-global/lib/node_modules/9router');
const dir=path.join(root,'app/.next-cli-build/server/chunks');
const f=fs.readdirSync(dir).filter(n=>n.endsWith('.js')).map(n=>path.join(dir,n)).find(p=>fs.readFileSync(p,'utf8').includes('/*tool-id-sanitize-v1*/'));
assert(f,'patch marker not found');const s=fs.readFileSync(f,'utf8');
// handler is `y` up to 0.5.86, `z` in 0.5.91: end the slice at whichever async handler follows the helper
const a=s.indexOf('function __tidFix'),b=a+s.slice(a).search(/async function [A-Za-z_$][\w$]*\(a,b=null\)/);
const {__tidFix,__tidScrub}=new Function(s.slice(a,b)+';return{__tidFix,__tidScrub}')();
const ok=/^[a-zA-Z0-9_-]+$/;
const body={messages:[
 {role:'assistant',content:[{type:'tool_use',id:'Bash:0',name:'Bash',input:{}},{type:'tool_use',id:'toolu_01AbC',name:'Read',input:{}}]},
 {role:'user',content:[{type:'tool_result',tool_use_id:'Bash:0',content:'x'},{type:'tool_result',tool_use_id:'toolu_01AbC',content:'y'}]},
 {role:'assistant',tool_calls:[{id:'Read:0',type:'function',function:{name:'Read',arguments:'{}'}}]},
 {role:'tool',tool_call_id:'Read:0',content:'z'}]};
__tidScrub(body);
const [m0,m1,m2,m3]=body.messages;
assert(ok.test(m0.content[0].id)&&m0.content[0].id===m1.content[0].tool_use_id,'claude pair');
assert.strictEqual(m0.content[1].id,'toolu_01AbC');assert.strictEqual(m1.content[1].tool_use_id,'toolu_01AbC');
assert(ok.test(m2.tool_calls[0].id)&&m2.tool_calls[0].id===m3.tool_call_id,'openai pair');
assert.notStrictEqual(__tidFix('Bash:0'),__tidFix('Bash;0'),'no collision');
__tidScrub(null);__tidScrub({});__tidScrub({messages:[null,1,{content:[null]}]});
console.log('tool-id-sanitize regression: all passed');
