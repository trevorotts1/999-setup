#!/usr/bin/env python3
"""Tool-call argument recovery for 9Router's OPENAI_RESPONSES->OPENAI stream translator
(module 4845, function t, chunk 8499.js). Content-anchored; each anchor must be unique.
Usage: apply.py [--check] [9router_root]. Idempotent: already-patched files are left alone."""
import sys, os, shutil, time, subprocess
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
MARK='/*toolargs-recovery-v1*/'
META='{id:b.chatId,created:b.created,model:b.model||j.rP}'
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
def __locate(mark, anchor):
    # Chunk file names are renumbered between 9router releases, so find the target by content.
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    hit=[f for f in fs if mark in open(f,errors='ignore').read()]
    if hit: return hit[0]
    hit=[f for f in fs if anchor in open(f,errors='ignore').read()]
    if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
def __prune(pattern_prefix):
    # keep only the newest backup of this kind (Trevor: backups must not pile up)
    import glob
    old=sorted(glob.glob(pattern_prefix+'*'),key=os.path.getmtime)[:-1]
    for o in old: os.remove(o)
F=None
E=[]
# 1. added: carry arguments present on the item itself, or buffered deltas that arrived before it.
E.append(('function:{name:c.name||"",arguments:""}}]})}if("response.function_call_arguments.delta"===c',
 'function:{name:c.name||"",arguments:(()=>{let p="";if(b.__pendArgs&&b.__pendArgs.size){let k=b.__pendArgs.has(e)?e:b.__pendArgs.keys().next().value;p=b.__pendArgs.get(k)||"";b.__pendArgs.delete(k)}let s=p||("string"==typeof c.arguments?c.arguments:"");return s&&((b.respToolArgsEmitted??=new Set).add(a),(b.__argText??=new Map).set(a,s)),s})()}}]})}'+MARK+'if("response.function_call_arguments.delta"===c'))
# 2. delta: buffer fragments that arrive before any tool call is open; track emitted text.
E.append(('{let a=d.delta||"";if(!a)return null;let c=(d.item_id?b.respToolChatIndex?.get(d.item_id):void 0)??Math.max(0,(b.toolCallIndex||1)-1);return b.respToolArgsEmitted??=new Set,b.respToolArgsEmitted.add(c),',
 '{let a=d.delta||"";if(!a)return null;if(!(b.toolCallIndex>0)){b.__pendArgs??=new Map;let k=d.item_id||"__any";b.__pendArgs.set(k,(b.__pendArgs.get(k)||"")+a);return null}let c=(d.item_id?b.respToolChatIndex?.get(d.item_id):void 0)??Math.max(0,(b.toolCallIndex||1)-1);(b.__argText??=new Map).set(c,(b.__argText.get(c)||"")+a);return b.respToolArgsEmitted??=new Set,b.respToolArgsEmitted.add(c),'))
# 3. new handler: arguments delivered whole in function_call_arguments.done.
E.append(('if("response.output_item.done"===c&&(d.item?.type===j.Du.FUNCTION_CALL||d.item?.type==="custom_tool_call")){let a=d.item?.id||d.item_id,',
 'if("response.function_call_arguments.done"===c){let a=d.arguments;if("string"!=typeof a||!a)return null;if(!(b.toolCallIndex>0)){b.__pendArgs??=new Map;b.__pendArgs.set(d.item_id||"__any",a);return null}let c=(d.item_id?b.respToolChatIndex?.get(d.item_id):void 0)??Math.max(0,(b.toolCallIndex||1)-1);if((b.respToolArgsEmitted??=new Set).has(c))return null;b.respToolArgsEmitted.add(c);(b.__argText??=new Map).set(c,a);return(0,f.k)('+META+',{tool_calls:[{index:c,function:{arguments:a}}]})}if("response.output_item.done"===c&&(d.item?.type===j.Du.FUNCTION_CALL||d.item?.type==="custom_tool_call")){let a=d.item?.id||d.item_id,'))
# 4. completed: recover arguments that only appear in response.output, emitted just before the finish chunk.
E.append(('if(!b.finishReasonSent){let a=s(b);b.finishReasonSent=!0,b.finishReason=a;let c=(0,f.k)('+META+',{},a);return b.usage&&"object"==typeof b.usage&&(c.usage=b.usage),c}return null}if("error"===c',
 'let __rec=[];for(let o of(Array.isArray(d.response?.output)?d.response.output:[])){if(!o||o.type!==j.Du.FUNCTION_CALL||"string"!=typeof o.arguments||!o.arguments)continue;let x=b.respToolChatIndex?.get(o.id)??b.respToolChatIndex?.get(o.call_id);if(void 0===x&&1===b.toolCallIndex)x=0;if(void 0===x||(b.respToolArgsEmitted??=new Set).has(x))continue;b.respToolArgsEmitted.add(x);(b.__argText??=new Map).set(x,o.arguments);__rec.push((0,f.k)('+META+',{tool_calls:[{index:x,function:{arguments:o.arguments}}]}))}if(!b.finishReasonSent){let a=s(b);b.finishReasonSent=!0,b.finishReason=a;let c=(0,f.k)('+META+',{},a);return b.usage&&"object"==typeof b.usage&&(c.usage=b.usage),__rec.length?[...__rec,c]:c}return __rec.length?__rec:null}if("error"===c'))
F=__locate(MARK,E[0][0]); s=open(F).read()
if MARK in s: print('already patched:',F); sys.exit(0)
# 0.5.91 renamed the finish-reason helper used by anchor 4 (s -> t); read its current name from the bundle.
import re
_m=re.search(r'if\(!b\.finishReasonSent\)\{let a=([A-Za-z_$][\w$]*)\(b\);b\.finishReasonSent=!0,b\.finishReason=a;let c=\(0,f\.k\)\('+re.escape(META)+r',\{\},a\);return b\.usage&&"object"==typeof b\.usage&&\(c\.usage=b\.usage\),c\}return null\}if\("error"===c',s)
if _m and _m.group(1)!='s': E[3]=tuple(x.replace('let a=s(b);','let a=%s(b);'%_m.group(1)) for x in E[3])
for i,(old,new) in enumerate(E,1):
    n=s.count(old)
    if n!=1: print(f'ANCHOR {i} matched {n} times (need 1) - bundle changed, not patching'); sys.exit(2)
if CHECK: print('all 4 anchors unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-toolargs-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
for old,new in E: s=s.replace(old,new,1)
open(F,'w').write(s)
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0:
    shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
__prune(F+'.bak-pre-toolargs-')
print('patched',F,'\nbackup',bak)
