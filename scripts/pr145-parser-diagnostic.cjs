'use strict';
// Synthetic-only replay of the running Node's exact FileTest parser methods.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {DefaultSerializer, DefaultDeserializer} = require('node:v8');
const source = process.binding('natives')['internal/test_runner/runner'];
const begin = source.indexOf('  parseMessage(readData) {');
const end = source.indexOf('\n}\n', begin);
assert(begin > 0 && end > begin, 'runtime parser layout must match; never silently skip');
const methods = source.slice(begin, end);
const s = new DefaultSerializer(); s.writeHeader(); const v8Header = s.releaseBuffer();
const Parser = vm.runInNewContext(`(class Replay {
 #pendingPartialV8Header=false; #rawBuffer=[]; #rawBufferSize=0; name='synthetic'; items=[];
 addToReport(x) { this.items.push(x); }
 ${methods}
})`, {Buffer, FastBuffer: Uint8Array, StringFromCharCode:String.fromCharCode, DefaultDeserializer, v8Header, kV8HeaderLength:v8Header.length,
 kSerializedSizeHeader:v8Header.length+4,
 TypedArrayPrototypeGetLength:x=>x.length,
 TypedArrayPrototypeSubarray:(x,...a)=>x.subarray(...a),
 ArrayPrototypePush:(x,y)=>x.push(y), ArrayPrototypeShift:x=>x.shift()});
function frame(i) {
 const s = new DefaultSerializer(); s.writeHeader(); s.writeValue({type:'test:diagnostic',data:{message:`synthetic-${i}`}});
 const payload=s.releaseBuffer(), length=Buffer.alloc(4); length.writeUInt32BE(payload.length);
 return Buffer.concat([v8Header,length,payload]);
}
const a=frame(1), b=frame(2), text=Buffer.from('💥 synthetic late migration log\n');
const cases=[['frames-coalesced',[Buffer.concat([a,b])]],['plaintext-before',[Buffer.concat([text,a,b])]],
 ['plaintext-separate',[a,text,b]],['plaintext-after-coalesced',[Buffer.concat([a,text,b])]],
 ['bytewise',Array.from(Buffer.concat([a,b]),x=>Buffer.from([x]))]];
const results=[];
for (const [name,chunks] of cases) {
 const parser=new Parser(); let error=null;
 try { for(const chunk of chunks) parser.parseMessage(chunk); } catch(e) { error={name:e.name,message:e.message,stack:e.stack}; }
 const frames=parser.items.filter(x=>x.type==='test:diagnostic').length;
 console.log(JSON.stringify({name,chunks:chunks.map(x=>x.toString('hex')),frames,error}));
 results.push({name,frames,expectedFrames:2,missingFrames:2-frames,error});
}
console.log(JSON.stringify({runtime:process.version,parserSHA256:crypto.createHash('sha256').update(methods).digest('hex'),results,note:'Private implementation diagnostic only; missing events and errors retained, not acceptance.'}));
