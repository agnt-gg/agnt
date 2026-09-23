import { PREVIEW_MESSAGE, PREVIEW_CHANNEL_PARAM } from '../../../backend/src/utils/artifactPreviewUrls.js';

/**
 * Owner-side load diagnostics. A frame load event alone is never a readiness
 * assertion. Messages are bound to the actual frame, its origin and this load.
 */
export function monitorArtifactPreview(iframe, status, { timeoutMs = 12000 } = {}) {
  const original = iframe.getAttribute('src') || '';
  const url = new URL(original, window.location.href);
  if (!/\/local-preview\//.test(url.pathname)) return () => {};
  const channel = crypto.randomUUID().replaceAll('-','');
  url.searchParams.set(PREVIEW_CHANNEL_PARAM,channel);
  let disposed=false, warned=false;
  status.setAttribute('role','status');
  status.textContent='Loading artifact…';
  status.dataset.state='loading';
  const show=(state,text)=>{if(disposed)return;status.dataset.state=state;status.textContent=text;status.hidden=false;};
  const timer=setTimeout(()=>show('unconfirmed','Preview did not confirm loading. Open the original file or retry; its content policy may block preview diagnostics.'),timeoutMs);
  const onMessage=event=>{
    const message=event.data;
    if(event.source!==iframe.contentWindow || event.origin!==url.origin || message?.type!==PREVIEW_MESSAGE || message.channel!==channel)return;
    if(message.state==='loaded'){
      clearTimeout(timer);
      if(!warned){status.hidden=true;status.dataset.state='loaded';}
    }else if(message.state==='warning'){
      warned=true;clearTimeout(timer);
      show('warning',typeof message.detail==='string'?message.detail.slice(0,180):'An artifact resource could not load.');
    }
  };
  const onError=()=>{clearTimeout(timer);show('error','The artifact could not load. Open the original file or retry.');};
  window.addEventListener('message',onMessage);
  iframe.addEventListener('error',onError);
  iframe.setAttribute('src',url.href);
  // Removed streaming messages and unmounted components must not leak timers/listeners.
  const observer=new MutationObserver(()=>{if(!iframe.isConnected)dispose();});
  const dispose=()=>{if(disposed)return;disposed=true;clearTimeout(timer);window.removeEventListener('message',onMessage);iframe.removeEventListener('error',onError);observer.disconnect();};
  observer.observe(document.body,{childList:true,subtree:true});
  return dispose;
}
