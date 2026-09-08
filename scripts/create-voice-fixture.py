"""One synthetic question through existing canonical TTS, no playback/model load."""
import json, sys, tempfile, urllib.request, hashlib, os
from pathlib import Path
if os.environ.get('AGNT_CREATE_VOICE_FIXTURE') != '1':
    raise SystemExit('Set AGNT_CREATE_VOICE_FIXTURE=1 to call the configured canonical TTS service.')
control_plane = Path(os.environ['AGNT_CONTROL_PLANE_ROOT'])
sys.path.insert(0, str(control_plane / 'packages/control-plane-runtime-adapters/src'))
from ai_control_runtime_adapters.qwen3_tts_artifact import summarize_qwen3_tts_artifact, _bounded_artifact
root=Path(tempfile.mkdtemp(prefix='codex-question-fixture-',dir=os.environ['AGNT_TEST_ARTIFACT_ROOT']))
text=os.environ.get('AGNT_FIXTURE_TEXT','What is two plus two?')
request=urllib.request.Request(os.environ['AGNT_TTS_SPEAK_URL'],data=json.dumps({'text':text,'language':'English','speaker':'Ryan','play':False}).encode(),headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(request,timeout=90) as response:
    receipt=json.loads(response.read(2_097_152))
summary=summarize_qwen3_tts_artifact(receipt,play=False)
digest,size,rate,channels,payload=_bounded_artifact(Path(summary['artifact_refs'][0]))
if digest!=summary['artifact_sha256']:raise RuntimeError('artifact_changed')
output=root/'question.wav'
with output.open('xb') as f:f.write(payload)
(root/'manifest.json').write_text(json.dumps({'text':text,'sha256':digest,'bytes':size,'sampleRate':rate,'channels':channels,'source':'canonical-Qwen3-TTS-0.6B','played':False},indent=2))
print(json.dumps({'fixture':str(output),'sha256':digest,'bytes':size,'sampleRate':rate,'channels':channels}))
