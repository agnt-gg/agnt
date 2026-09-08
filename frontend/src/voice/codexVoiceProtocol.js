/** Native Codex wire reference: Howaboua 94eb6c07; see third-party notice. */
const size=s=>new TextEncoder().encode(s).length;
export function parseCodexEvent(raw){
 if(typeof raw!=='string'||size(raw)>73728)throw new Error('invalid_voice_event');
 const event=JSON.parse(raw);
 if(event?.type==='error')throw new Error('voice_provider_error');
 if(event?.type==='delegation.created'){
  const x=event.item;
  if(x?.type!=='delegation'||x.target!=='client'||typeof x.id!=='string'||!x.id||size(x.id)>256||!Array.isArray(x.content))throw new Error('invalid_voice_delegation');
  const text=x.content.map(p=>{if(p?.type!=='input_text'||typeof p.text!=='string')throw new Error('invalid_voice_content');return p.text;}).join('').trim();
  if(!text||size(text)>16384)throw new Error('invalid_voice_content');
  if(x.user_bidi_turn_id!==undefined&&(typeof x.user_bidi_turn_id!=='string'||!x.user_bidi_turn_id||size(x.user_bidi_turn_id)>256))throw new Error('invalid_voice_turn_id');
  return {type:'delegation',id:x.id,text,...(x.user_bidi_turn_id?{turnId:x.user_bidi_turn_id}:{})};
 }
 if(['input_transcript.added','output_transcript.added'].includes(event?.type)){
  const text=event.item?.text;if(typeof text!=='string'||size(text)>32768)throw new Error('invalid_voice_transcript');
  const id=event.item?.turn_id ?? event.turn_id;
  if(id!==undefined&&(typeof id!=='string'||!id||size(id)>256))throw new Error('invalid_voice_turn_id');
  return {type:'transcript',role:event.type==='input_transcript.added'?'user':'assistant',text,final:false,...(id?{id}:{})};
 }
 if(event?.type==='turn.created'&&['user','assistant'].includes(event.turn?.role)){
  const id=event.turn.id;
  if(typeof id!=='string'||!id||size(id)>256)throw new Error('invalid_voice_turn_id');
  return {type:event.turn.role==='user'?'user-turn-start':'assistant-turn-start',id};
 }
 if(event?.type==='turn.done'){
  const {role,transcript:text}=event.turn||{};
  if(!['user','assistant'].includes(role)||typeof text!=='string'||size(text)>32768)throw new Error('invalid_voice_turn');
  if(event.turn.id!==undefined&&(typeof event.turn.id!=='string'||!event.turn.id||size(event.turn.id)>256))throw new Error('invalid_voice_turn_id');
  return {type:'transcript',role,text,final:true,...(event.turn.id?{id:event.turn.id}:{})};
 }
 return {type:'ignore'};
}
export function codexContextFrames(id,channel,text){
 if((id!==null&&(typeof id!=='string'||!id||size(id)>256))||!['commentary','speakable'].includes(channel)||typeof text!=='string'||size(text)>65536)throw new Error('invalid_voice_context');
 const parts=[];let part='',n=0;
 for(const c of text){const count=size(c);if(n+count>500){parts.push(part);part='';n=0;}part+=c;n+=count;}
 if(part)parts.push(part);
 return parts.map(text=>({type:id===null?'session.context.append':'delegation.context.append',...(id===null?{}:{delegation_item_id:id}),channel,content:[{type:'input_text',text}]}));
}
