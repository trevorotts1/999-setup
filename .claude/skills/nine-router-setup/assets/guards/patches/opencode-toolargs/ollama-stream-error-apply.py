#!/usr/bin/env python3
"""Ollama stream error for 9Router (stream converter module 71857, chunk 8895.js), marker /*ollama-stream-error-v1*/.
Ollama reports a mid-stream failure as an NDJSON line {"error":"..."} after the 200 is out, and the Ollama
translator drops it; a stream that closes without done:true is dropped the same way. The client got a stream
that silently stopped. Now, when an Ollama stream closes without done:true, the client gets a proper error
event in its own format (Claude `event: error`, OpenAI error chunk, Responses `response.failed`) carrying the
Ollama error text when there was one. Streams that finish (done:true) and non-Ollama streams are untouched.
Content-anchored; each anchor must be unique.
Usage: ollama-stream-error-apply.py [--check] [9router_root]. Idempotent: an already-patched file is left alone."""
import sys, os, shutil, time, subprocess, glob
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
MARK='/*ollama-stream-error-v1*/'
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
def __locate(mark, anchor):
    # Chunk file names are renumbered between 9router releases, so find the target by content.
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    hit=[f for f in fs if mark in open(f,errors='ignore').read()]
    if hit: return hit[0]
    hit=[f for f in fs if anchor in open(f,errors='ignore').read()]
    if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
def __prune(pattern_prefix):
    # keep only the newest backup of this kind (Trevor: backups must not pile up)
    for o in sorted(glob.glob(pattern_prefix+'*'),key=os.path.getmtime)[:-1]: os.remove(o)

MOD='let k=new TextEncoder,l="translate",m="passthrough";'
# Module scope of the stream converter (e = formats, k = its TextEncoder).
#  __oeSeen: records, on the converter's translate state, that an Ollama line carried done:true or an error.
#  __oeEnd:  at flush, if an Ollama stream never sent done:true, writes one error event in the client's format.
HELPERS=MARK+r'''function __oeSeen(s,p,f){return s&&p&&"object"==typeof p&&f===e.h.OLLAMA&&(p.done&&(s.__oeDone=!0),p.error&&!s.__oeErr&&(s.__oeErr=String(p.error?.message||p.error).slice(0,500))),p}function __oeEnd(a,o,s,f,q,p,t){if(!s||f!==e.h.OLLAMA||s.__oeDone)return;let m=`${p||"ollama"}/${t||"model"}: `+(s.__oeErr?"Ollama stream error: "+s.__oeErr:"Ollama stream ended before the reply finished (no done:true)"),x;if(o===e.h.CLAUDE)x=`event: error\ndata: ${JSON.stringify({type:"error",error:{type:"api_error",message:m}})}\n\n`;else if(o===e.h.OPENAI)x=`data: ${JSON.stringify({error:{message:m,type:"server_error",code:"upstream_stream_error"}})}\n\n`;else if(o===e.h.OPENAI_RESPONSES)x=`event: response.failed\ndata: ${JSON.stringify({type:"response.failed",response:{id:"resp_"+Date.now(),object:"response",status:"failed",error:{code:"server_error",message:m}}})}\n\n`;else return;q?.appendConvertedChunk?.(x),a.enqueue(k.encode(x))}'''
E=[(MOD,MOD+HELPERS),
 # every parsed upstream line, in transform and the leftover line in flush
 ('let p=(0,h.tV)(n,c);if(!p)continue;','let p=__oeSeen(C,(0,h.tV)(n,c),c);if(!p)continue;'),
 ('let b=(0,h.tV)(z.trim(),c),f=b?.done&&c!==e.h.OLLAMA;','let b=__oeSeen(C,(0,h.tV)(z.trim(),c),c),f=b?.done&&c!==e.h.OLLAMA;'),
 # end of the translate-mode flush, after the translator's own flush output
 ('P()}catch(a){console.log("Error in flush:",a),P()}','__oeEnd(a,o,C,c,q,p,t);P()}catch(a){console.log("Error in flush:",a),P()}')]
# Suffix-only anchor so it works whether or not the ollama-done guard already inserted its [DONE] before the cleanup call.
# 0.5.95 renamed the cleanup fn P->Q: use whichever spelling the located file has.
E_Q=('Q()}catch(a){console.log("Error in flush:",a),Q()}','__oeEnd(a,o,C,c,q,p,t);Q()}catch(a){console.log("Error in flush:",a),Q()}')

F=__locate(MARK,E[1][0]); s=open(F).read()
if s.count(E[3][0])!=1 and s.count(E_Q[0])==1: E[3]=E_Q
if MARK in s: print('already patched:',F); sys.exit(0)
for i,(old,new) in enumerate(E,1):
    n=s.count(old)
    if n!=1: print(f'{MARK} ANCHOR {i} matched {n} times (need 1) - bundle changed, not patching'); sys.exit(2)
if CHECK: print(f'all {len(E)} anchors unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-ollamaerror-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
for old,new in E: s=s.replace(old,new,1)
open(F,'w').write(s)
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0:
    shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
__prune(F+'.bak-pre-ollamaerror-')
print('patched',F,'\nbackup',bak)
