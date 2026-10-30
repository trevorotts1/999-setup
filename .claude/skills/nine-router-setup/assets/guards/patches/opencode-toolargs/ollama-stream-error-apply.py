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

import re
ID=r'[A-Za-z_$][\w$]*'
# The converter's locals are renamed on every 9Router build (0.5.95: cleanup P->Q; 0.5.109: provider p->s, state C->G, encoder k->n,
# log q->t ...). So nothing is spelled: the anchors are shapes, and every name the edits need is read out of the converter's own
# header, its translate-state initialiser and its flush. On 0.5.104 the result is byte-for-byte what the literal anchors wrote.
HEAD_RX=re.compile(r'let (?P<enc>'+ID+r')=new TextEncoder,(?P<tr>'+ID+r')="translate",'+ID+r'="passthrough";function '+ID+r'\(a=\{\}\)\{'
                   r'let\{mode:(?P<mode>'+ID+r')=(?P=tr),targetFormat:(?P<tf>'+ID+r'),sourceFormat:(?P<sf>'+ID+r'),provider:(?P<prov>'+ID+r')=null,'
                   r'reqLogger:(?P<log>'+ID+r')=null,[^}]*?model:(?P<model>'+ID+r')=null,[^}]*?\}=a,')
FLUSH_HEAD_RX=re.compile(r'flush\((?P<fa>'+ID+r')\)\{let '+ID+r'=Object\.entries\(')
LINE_RX=re.compile(r'let (?P<p>'+ID+r')=\(0,(?P<h>'+ID+r')\.tV\)\((?P<n>'+ID+r'),(?P<c>'+ID+r')\);if\(!(?P=p)\)continue;')
LEFT_RX=re.compile(r'let (?P<b>'+ID+r')=\(0,(?P<h>'+ID+r')\.tV\)\((?P<z>'+ID+r')\.trim\(\),(?P<c>'+ID+r')\),(?P<f>'+ID+r')=(?P=b)\?\.done&&(?P=c)!==(?P<e>'+ID+r')\.h\.OLLAMA;')
END_RX=re.compile(r'(?P<cl>'+ID+r')\(\)\}catch\((?P<ex>'+ID+r')\)\{console\.log\("Error in flush:",(?P=ex)\),(?P=cl)\(\)\}')
def __names(s):
    """Converter identifiers, or None when the header / flush shape is unknown."""
    hs=list(HEAD_RX.finditer(s))
    if len(hs)!=1: return None
    d=hs[0].groupdict()
    st=re.search(r'(?P<st>'+ID+r')='+re.escape(d['mode'])+r'==='+re.escape(d['tr'])+r'\?\{\.\.\.\(0,'+ID+r'\.Ws\)\('+re.escape(d['sf'])+r'\),provider:'+re.escape(d['prov'])+r',',s[hs[0].end():])
    fl=list(FLUSH_HEAD_RX.finditer(s,hs[0].end()))
    if not st or len(fl)!=1: return None
    d.update(st=st['st'],fa=fl[0]['fa'],start=hs[0].start(),mod_end=s.index('"passthrough";',hs[0].start())+len('"passthrough";'))
    return d
def __locate_conv():
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    txt={f:open(f,errors='ignore').read() for f in fs}
    hit=[f for f in fs if MARK in txt[f]]
    if hit: return hit[0]
    hit=[f for f in fs if HEAD_RX.search(txt[f])]
    if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
F=__locate_conv(); s=open(F).read()
if MARK in s: print('already patched:',F); sys.exit(0)
N=__names(s)
if N is None: print('ANCHOR 0 (stream converter header / translate state / flush) not recognised - bundle changed, not patching'); sys.exit(2)
lines=list(LINE_RX.finditer(s)); lefts=list(LEFT_RX.finditer(s)); ends=list(END_RX.finditer(s))
for i,(label,ms) in enumerate((('upstream line parse',lines),('flush leftover line',lefts),('flush end',ends)),2):
    if len(ms)!=1: print(f'{MARK} ANCHOR {i} ({label}) matched {len(ms)} times (need 1) - bundle changed, not patching'); sys.exit(2)
E_,L_=lefts[0],lines[0]
if E_['c']!=N['tf'] or L_['c']!=N['tf']: print(f'{MARK} ANCHOR 3 parses with a different format variable than the converter header - bundle changed, not patching'); sys.exit(2)
ENC,FMT=N['enc'],E_['e']
if {ENC,FMT}&set('aoqsfpt'): print(f'{MARK} the helpers use the parameter names a,o,s,f,q,p,t, which would shadow the encoder/format locals ({ENC}, {FMT}) - bundle changed, not patching'); sys.exit(2)
# Module scope of the stream converter (FMT = formats, ENC = its TextEncoder).
#  __oeSeen: records, on the converter's translate state, that an Ollama line carried done:true or an error.
#  __oeEnd:  at flush, if an Ollama stream never sent done:true, writes one error event in the client's format.
HELPERS=MARK+(r"""function __oeSeen(s,p,f){return s&&p&&"object"==typeof p&&f===@E@.h.OLLAMA&&(p.done&&(s.__oeDone=!0),p.error&&!s.__oeErr&&(s.__oeErr=String(p.error?.message||p.error).slice(0,500))),p}function __oeEnd(a,o,s,f,q,p,t){if(!s||f!==@E@.h.OLLAMA||s.__oeDone)return;let m=`${p||"ollama"}/${t||"model"}: `+(s.__oeErr?"Ollama stream error: "+s.__oeErr:"Ollama stream ended before the reply finished (no done:true)"),x;if(o===@E@.h.CLAUDE)x=`event: error\ndata: ${JSON.stringify({type:"error",error:{type:"api_error",message:m}})}\n\n`;else if(o===@E@.h.OPENAI)x=`data: ${JSON.stringify({error:{message:m,type:"server_error",code:"upstream_stream_error"}})}\n\n`;else if(o===@E@.h.OPENAI_RESPONSES)x=`event: response.failed\ndata: ${JSON.stringify({type:"response.failed",response:{id:"resp_"+Date.now(),object:"response",status:"failed",error:{code:"server_error",message:m}}})}\n\n`;else return;q?.appendConvertedChunk?.(x),a.enqueue(@K@.encode(x))}""").replace('@E@',FMT).replace('@K@',ENC)
# (start,end,replacement) edits, applied back to front so earlier offsets stay valid.
ST=N['st']
EDITS=[(N['mod_end'],N['mod_end'],HELPERS),
 # every parsed upstream line, in transform and the leftover line in flush
 (L_.start(),L_.end(),f"let {L_['p']}=__oeSeen({ST},(0,{L_['h']}.tV)({L_['n']},{L_['c']}),{L_['c']});if(!{L_['p']})continue;"),
 (E_.start(),E_.end(),f"let {E_['b']}=__oeSeen({ST},(0,{E_['h']}.tV)({E_['z']}.trim(),{E_['c']}),{E_['c']}),{E_['f']}={E_['b']}?.done&&{E_['c']}!=={FMT}.h.OLLAMA;"),
 # end of the translate-mode flush, after the translator's own flush output (whichever name the cleanup call has)
 (ends[0].start(),ends[0].start(),f"__oeEnd({N['fa']},{N['sf']},{ST},{N['tf']},{N['log']},{N['prov']},{N['model']});")]
if CHECK: print(f'all {len(EDITS)} anchors unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-ollamaerror-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
for a_,b_,new in sorted(EDITS,key=lambda e:-e[0]): s=s[:a_]+new+s[b_:]
open(F,'w').write(s)
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0:
    shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
__prune(F+'.bak-pre-ollamaerror-')
print('patched',F,'\nbackup',bak)
