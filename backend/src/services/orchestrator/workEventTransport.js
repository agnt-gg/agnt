/** Durable status replay is separate from provider-message replay. */
export function createWorkEventTransport({store,work,send,onError=console.error,intervalMs=1000}){
 let cursor=0,stopped=true,timer=null,polling=null;
 async function poll(){
  if(stopped||polling)return polling;
  polling=(async()=>{
   const events=await store.events(work.id,work.owner_id,cursor);
   for(const event of events){
    if(stopped)break;
    await send('work_state_changed',event);
    cursor=event.sequence;
   }
  })();
  try{await polling;}finally{polling=null;}
 }
 return {
  start(after=0){
   if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid work-event cursor');
   if(!stopped)return;
   cursor=after;stopped=false;
   timer=setInterval(()=>poll().catch(onError),intervalMs);timer.unref?.();
   poll().catch(onError);
  },
  async stop(){stopped=true;clearInterval(timer);if(polling)await polling;},
  poll,
 };
}
