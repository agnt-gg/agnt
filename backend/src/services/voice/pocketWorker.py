"""Optional CPU Pocket-TTS worker. Fixed JSON-lines protocol, no HTTP or credentials.
Install pinned pocket-tts in an isolated CPU-only environment. No automatic install.
"""
import os,sys,json,time
os.environ['CUDA_VISIBLE_DEVICES']=''
import torch
import numpy as np
from pocket_tts import TTSModel
import base64
torch.set_num_threads(2)
if torch.version.cuda is not None:
    raise RuntimeError('CPU-only Torch build required for this candidate')
language=os.environ.get('AGNT_POCKET_LANGUAGE','english')
if language not in ('english','german'):raise ValueError('unsupported language')
model=TTSModel.load_model(language=language)
state=model.get_state_for_audio_prompt('alba')
print(json.dumps({'type':'ready','engine':'pocket-tts-cpu','sampleRate':model.sample_rate,'language':language}),flush=True)
last_generation=0
while True:
    line=sys.stdin.buffer.readline(20001)
    if not line:break
    if len(line)>20000 or not line.endswith(b'\n'):raise ValueError('oversized request')
    req=json.loads(line);text=req.get('text');rid=req.get('requestId');generation=req.get('generation')
    if not isinstance(text,str) or not text.strip() or len(text)>4096 or not isinstance(rid,str) or not rid or len(rid)>1024 or type(generation) is not int or generation<=last_generation:raise ValueError('invalid request')
    last_generation=generation
    started=time.monotonic();count=0;samples=0
    try:
        for chunk in model.generate_audio_stream(state,text,copy_state=True):
            pcm=(np.clip(chunk.detach().cpu().numpy().reshape(-1),-1,1)*32767).astype('<i2').tobytes()
            # Smaller fixed frames bound transport/backpressure; generation itself streams.
            for offset in range(0,len(pcm),model.sample_rate*2):
                b=pcm[offset:offset+model.sample_rate*2];samples+=len(b)//2
                print(json.dumps({'type':'audio','requestId':rid,'generation':generation,'sequence':count,'pcm':base64.b64encode(b).decode(),'generationMs':round((time.monotonic()-started)*1000,2)}),flush=True);count+=1
        print(json.dumps({'type':'done','requestId':rid,'generation':generation,'chunks':count,'samples':samples,'generationMs':round((time.monotonic()-started)*1000,2)}),flush=True)
    except Exception:
        print(json.dumps({'type':'error','requestId':rid,'generation':generation,'code':'generation'}),flush=True)
    finally:
        # Keep only the immutable built-in Alba prompt state across requests.
        # generate_audio_stream(copy_state=True) never updates that shared state.
        req=None;text=None;rid=None;line=None;chunk=None;pcm=None;b=None
