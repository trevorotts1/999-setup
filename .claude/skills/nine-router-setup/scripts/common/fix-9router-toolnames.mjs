#!/usr/bin/env node
// fix-9router-toolnames.mjs - strip a bogus namespace prefix from the tool
// names in 9Router's replies. No dependencies; macOS and Windows.
//
// Some upstream models answer a tool call with a namespaced name such as
// `default.Bash`, `functions.Read` or `tools:Edit`. Claude Code only knows
// `Bash` and rejects the call ("No such tool available: default.Bash"). Hooks
// cannot rename a tool and 9Router has no setting for it, so this patches its
// built chunks (app/.next-cli-build/server/chunks/*.js), the same way
// fix-9router-catalog.mjs does. Every `npm i -g 9router` reverts it.
//
// The rule: when the part after the LAST `.` or `:` is exactly the name of a
// tool the REQUEST declared, the reply carries that name. Anything else is left
// alone: `mcp__x__y`, `default.Nope` with no `Nope` tool, and a declared tool
// whose own name has a dot.
//
// Three sites, each found by string literals plus its minified shape, never by
// variable names alone:
//   core - the chat handler's `{provider:,model:,body:,stream:,translatedBody:}`
//          object: the request's tool names ride on its toolNameMap.
//   hr   - the toolNameMap applier every translated reply goes through, stream
//          chunks and non-stream JSON alike (`if(!map?.size||!obj)return obj`
//          followed by the "content_block_start" rename).
//   pass - the same-format stream passthrough (an Anthropic-format upstream to
//          Claude Code), which skips that applier: each SSE `data:` line's
//          `JSON.parse(line.slice(5).trim())`.
// All three must be found (patched or patchable) and every patched chunk must
// still compile, or nothing is written (exit 2) - never a partial patch.
//
// Usage: node fix-9router-toolnames.mjs [--check] [--quiet] [--pkg <9router dir>]
//        node fix-9router-toolnames.mjs --selftest
// Exit codes:
//   --check : 0 already patched | 3 needs patching     | 2 undetermined (reason named)
//   apply   : 0 nothing to do   | 10 patched - restart 9Router | 2 undetermined
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { CHUNKS, findPkgs } from './fix-9router-catalog.mjs';

const MARK = 'nine-toolnames-v1';
const SITES = ['core', 'hr', 'pass'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Injected JS. Outer (minified) names only ever appear as call arguments, so the
// helpers' own parameter names can never shadow them.
// (name, request tool Set, 9Router's name map?) -> replacement name, or undefined.
const RESOLVE = '(n,t,m)=>{if("string"!=typeof n||t.has(n)||m?.has(n))return;let i=Math.max(n.lastIndexOf("."),n.lastIndexOf(":"));if(i<1)return;let s=n.slice(i+1);return m?.has(s)?m.get(s):t.has(s)?s:void 0}';
// request body -> Set of declared tool names (Anthropic `name`, OpenAI `function.name`).
const TOOLS = 'b=>{let t=new Set;for(let x of Array.isArray(b?.tools)?b.tools:[]){let n=x?.name||x?.function?.name;"string"==typeof n&&n&&t.add(n)}return t}';
const inject = {
  core: (map, body) => `${map}=((m,t)=>!t.size||m&&!(m instanceof Map)?m:Object.defineProperty(m||new Map,"__nineTools",{value:t,configurable:!0}))(${map},(${TOOLS})(${body}));/*${MARK}:core*/`,
  hr: (map) => `/*${MARK}:hr*/if(${map}?.__nineTools)${map}=(m=>{let t=m.__nineTools,r=${RESOLVE},g=n=>m.has(n)?m.get(n):r(n,t,m);return{size:1,has:n=>void 0!==g(n),get:g}})(${map});`,
  pass: (evt, flag, body) => `/*${MARK}:pass*/${flag}=((a,T)=>{let r=${RESOLVE},t,x=!1,f=n=>"string"==typeof n&&/[.:]/.test(n)?r(n,t??=T()):void 0;try{let c=a?.content_block;if("content_block_start"===a?.type&&"tool_use"===c?.type){let v=f(c.name);v&&(c.name=v,x=!0)}for(let h of Array.isArray(a?.choices)?a.choices:[]){let k=h?.delta?.tool_calls;if(Array.isArray(k))for(let q of k){let v=f(q?.function?.name);v&&(q.function.name=v,x=!0)}}}catch{}return x})(${evt},()=>(${TOOLS})(${body}))||${flag};`,
};

const V = '[\\w$]+';
const ANCHOR = {
  // `}let X={provider:P,model:M,body:B,stream:S,translatedBody:` (not yet marked)
  core: new RegExp(`[;}]let ${V}=\\{provider:${V},model:${V},body:(${V}),stream:${V},translatedBody:`, 'g'),
  // `function a(b,c){if(!c?.size||!b)return b;if(Array.isArray(b))return b.map(b=>a(b,c));if("object"!=typeof b)return b;`
  hr: new RegExp(`function (${V})\\((${V}),(${V})\\)\\{if\\(!\\3\\?\\.size\\|\\|!\\2\\)return \\2;if\\(Array\\.isArray\\(\\2\\)\\)return \\2\\.map\\((${V})=>\\1\\(\\4,\\3\\)\\);if\\("object"!=typeof \\2\\)return \\2;`, 'g'),
  // `try{let a=JSON.parse(n.slice(5).trim()),f=(0,h.X)(a),j=!1;` (not yet marked)
  pass: new RegExp(`try\\{let (${V})=JSON\\.parse\\(${V}\\.slice\\(5\\)\\.trim\\(\\)\\),${V}=\\(0,${V}\\.${V}\\)\\(\\1\\),(${V})=!1;(?!/\\*${MARK})`, 'g'),
};

// Patch one source string. Returns { out, sites: {core|hr|pass: {patched, todo}} }.
// An anchor whose surroundings do not confirm it is not counted, so a changed
// 9Router build ends up "not found" (undetermined), never mis-patched.
export function patchSource(src) {
  const sites = {};
  const edits = []; // [index, text]
  for (const s of SITES) sites[s] = { patched: src.split(`/*${MARK}:${s}*/`).length - 1, todo: 0 };
  for (const m of src.matchAll(ANCHOR.core)) {
    // The map handed to the reply handlers right after this object, and the one
    // the request translator filled (`X=Y._toolNameMap`), must be the same variable.
    const maps = new Set([...src.slice(m.index, m.index + 3000).matchAll(new RegExp(`toolNameMap:(${V})`, 'g'))].map((x) => x[1]));
    if (maps.size !== 1) continue;
    const [map] = maps;
    if (!new RegExp(`(^|[^\\w$.])${esc(map)}=${V}\\._toolNameMap\\b`).test(src)) continue;
    edits.push([m.index + 1, inject.core(map, m[1])]);
    sites.core.todo++;
  }
  for (const m of src.matchAll(ANCHOR.hr)) {
    const [, , obj, map] = m;
    const body = src.slice(m.index, m.index + 1200);
    if (!body.includes(`"content_block_start"===${obj}.type`) || !body.includes(`${map}.has(`) || !body.includes(`${map}.get(`)) continue;
    edits.push([m.index + `function ${m[1]}(${obj},${map}){`.length, inject.hr(map)]);
    sites.hr.todo++;
  }
  for (const m of src.matchAll(ANCHOR.pass)) {
    // The request body is destructured at the top of the enclosing stream converter.
    const heads = [...src.slice(0, m.index).matchAll(new RegExp(`function ${V}\\(${V}=\\{\\}\\)\\{let\\{mode:[^}]*?\\bbody:(${V})=null`, 'g'))];
    if (!heads.length) continue;
    edits.push([m.index + m[0].length, inject.pass(m[1], m[2], heads[heads.length - 1][1])]);
    sites.pass.todo++;
  }
  let out = src;
  for (const [i, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, i) + text + out.slice(i);
  return { out, sites };
}

// Scan one package dir; with apply, write only when all three sites were found.
// Returns { sites, patched: [files] } or throws with the reason.
function processPkg(pkg, apply) {
  const dir = path.join(pkg, CHUNKS);
  const sites = Object.fromEntries(SITES.map((s) => [s, { patched: 0, todo: 0 }]));
  const writes = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf8');
    const r = patchSource(src);
    for (const s of SITES) { sites[s].patched += r.sites[s].patched; sites[s].todo += r.sites[s].todo; }
    if (r.out === src) continue;
    try { new vm.Script(r.out, { filename: file }); } catch (e) { throw new Error(`${name} would not compile after patching (${e.message}) - left untouched`); }
    writes.push([file, r.out]);
  }
  const missing = SITES.filter((s) => !sites[s].patched && !sites[s].todo);
  if (missing.length) throw new Error(`site(s) not found in ${CHUNKS}: ${missing.join(', ')} (9Router build changed?) - nothing written`);
  const patched = [];
  if (apply) {
    for (const [file, out] of writes) {
      if (!fs.existsSync(file + '.orig')) fs.copyFileSync(file, file + '.orig'); // one-time pristine copy
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, file);
      patched.push(file);
    }
  }
  return { sites, patched };
}

export function run(argv) {
  const check = argv.includes('--check');
  const quiet = argv.includes('--quiet');
  const say = (m) => { if (!quiet) console.log(m); };
  const undetermined = (m) => { console.error(`fix-9router-toolnames: UNDETERMINED - ${m}`); return 2; };
  const pi = argv.indexOf('--pkg');
  let pkgs;
  if (pi !== -1) {
    const d = argv[pi + 1];
    if (!d || !fs.existsSync(path.join(d, CHUNKS))) return undetermined(`--pkg ${d || '(missing)'} has no ${CHUNKS}`);
    pkgs = [d];
  } else {
    pkgs = findPkgs();
    if (!pkgs.length) return undetermined('no 9Router install found (checked NINE_ROUTER_NPM_PREFIX, ~/.local/share/999/npm, ~/.npm-global, %APPDATA%\\npm, npm root -g)');
  }
  let rc = 0;
  for (const pkg of pkgs) {
    let r;
    try { r = processPkg(pkg, !check); } catch (e) { return undetermined(`${pkg}: ${e.message}`); }
    const todo = SITES.reduce((n, s) => n + r.sites[s].todo, 0);
    if (check) {
      say(`${pkg}: ${todo ? `${todo} tool-name site(s) need patching` : 'tool-name fix applied'}`);
      if (todo) rc = 3;
    } else if (r.patched.length) {
      say(`${pkg}: patched ${r.patched.length} chunk(s) - restart 9Router to load them`);
      rc = 10;
    } else {
      say(`${pkg}: tool-name fix already applied, nothing to do`);
    }
  }
  return rc;
}

// Minimal chunks with the same minified shapes as 9Router 0.5.86.
const FIXTURE = {
  'hr.js': 'exports.HR=function a(b,c){if(!c?.size||!b)return b;if(Array.isArray(b))return b.map(b=>a(b,c));if("object"!=typeof b)return b;let d=b,e=(a,c)=>{d===b&&(d={...b}),d[a]=c};if("content_block_start"===b.type){let a=b.content_block;a?.type==="tool_use"&&"string"==typeof a.name&&c.has(a.name)&&e("content_block",{...a,name:c.get(a.name)})}return Array.isArray(b.content)&&e("content",b.content.map(a=>a?.type==="tool_use"&&"string"==typeof a.name&&c.has(a.name)?{...a,name:c.get(a.name)}:a)),d};',
  'core.js': 'exports.M=function(a,ai){let aj,ap="p",aq="m",aJ=!0;aj=ai._toolNameMap,delete ai._toolNameMap;if(!a){}let a3={provider:ap,model:aq,body:a,stream:aJ,translatedBody:ai};return{...a3,toolNameMap:aj}};',
  'pass.js': 'const h={A4:()=>!1};exports.n=function n(a={}){let{mode:b="passthrough",body:v=null}=a;return l=>{if(l.startsWith("data:"))try{let a=JSON.parse(l.slice(5).trim()),f=(0,h.A4)(a),j=!1;if(j)return"data: "+JSON.stringify(a)}catch{}return l}};',
};

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-9router-toolnames-'));
  const dir = path.join(tmp, CHUNKS);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"commonjs"}');
  const write = () => { for (const [n, s] of Object.entries(FIXTURE)) fs.writeFileSync(path.join(dir, n), s); };
  const read = () => Object.keys(FIXTURE).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');
  const load = (n) => { const m = { exports: {} }; new Function('exports', 'module', fs.readFileSync(path.join(dir, n), 'utf8'))(m.exports, m); return m.exports; };
  write();
  let fails = 0;
  const t = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };
  const q = ['--pkg', tmp, '--quiet'];
  t(run(['--check', ...q]) === 3, '--check on an unpatched 9Router exits 3');
  t(read() === Object.values(FIXTURE).join('\n'), '--check writes nothing');
  t(run(q) === 10, 'apply exits 10 (patched)');
  const after = read();
  t(Object.keys(FIXTURE).every((n) => fs.readFileSync(path.join(dir, n + '.orig'), 'utf8') === FIXTURE[n]), '.orig keeps each pristine file');

  const { HR } = load('hr.js'), { M } = load('core.js'), { n: pass } = load('pass.js');
  const body = { tools: [{ name: 'Bash' }, { name: 'mcp__x__y' }, { type: 'function', function: { name: 'Read' } }, { name: 'my.tool' }] };
  const map = M(body, {}).toolNameMap;
  const start = (name) => HR({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name, input: {} } }, map).content_block.name;
  t(start('default.Bash') === 'Bash', 'stream content_block_start: default.Bash -> Bash');
  t(HR({ content: [{ type: 'tool_use', name: 'functions.Read' }] }, map).content[0].name === 'Read', 'non-stream tool_use: functions.Read -> Read');
  t(start('tools:Bash') === 'Bash', 'colon prefix: tools:Bash -> Bash');
  t(start('default.Nope') === 'default.Nope', 'CONTROL: default.Nope (no Nope tool) stays default.Nope');
  t(start('mcp__x__y') === 'mcp__x__y' && start('Bash') === 'Bash', 'mcp__x__y and plain Bash untouched');
  t(start('my.tool') === 'my.tool', 'a declared tool whose name has a dot is never rewritten');
  const cloak = new Map([['Bash_cc', 'Bash']]);
  const cmap = M(body, { _toolNameMap: cloak }).toolNameMap;
  t(cmap === cloak && HR({ content: [{ type: 'tool_use', name: 'x.Bash_cc' }] }, cmap).content[0].name === 'Bash' && HR({ content: [{ type: 'tool_use', name: 'Bash_cc' }] }, cmap).content[0].name === 'Bash', "9Router's own name map still applies, prefixed or not");
  t(M({}, {}).toolNameMap === undefined, 'request without tools: map untouched');
  const line = (name) => `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name } })}`;
  const p = pass({ body });
  t(p(line('default.Bash')) === line('Bash'), 'passthrough stream: default.Bash -> Bash');
  t(p(line('default.Nope')) === line('default.Nope'), 'CONTROL passthrough: default.Nope line byte-identical');
  const oai = (name) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name } }] } }] })}`;
  t(p(oai('functions.Bash')) === oai('Bash'), 'passthrough OpenAI tool_calls: functions.Bash -> Bash');

  t(run(q) === 0 && read() === after, 'second apply is a no-op (exit 0, already patched)');
  t(run(['--check', ...q]) === 0, '--check after patch exits 0');
  t(run(['--pkg', path.join(tmp, 'nope'), '--quiet']) === 2, 'missing 9Router exits 2, never throws');
  write();
  fs.writeFileSync(path.join(dir, 'pass.js'), '/* no stream converter */');
  t(run(q) === 2 && ['hr.js', 'core.js'].every((n) => fs.readFileSync(path.join(dir, n), 'utf8') === FIXTURE[n]), 'a missing site is undetermined (2) and nothing is written');
  write();
  fs.writeFileSync(path.join(dir, 'hr.js'), FIXTURE['hr.js'].replace('"content_block_start"', '"other"'));
  t(run(['--check', ...q]) === 2, 'an anchor whose surroundings changed is undetermined (2), not patched');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `selftest FAILED (${fails})` : 'selftest OK');
  return fails ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    process.exitCode = argv.includes('--selftest') ? selftest() : run(argv);
  } catch (e) {
    console.error(`fix-9router-toolnames: UNDETERMINED - ${e.message}`);
    process.exitCode = 2;
  }
}
