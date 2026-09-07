import {describe,it,expect,vi,afterEach} from 'vitest';
import {monitorArtifactPreview} from './artifactPreviewStatus.js';
import {PREVIEW_MESSAGE,PREVIEW_CHANNEL_PARAM} from '../../../backend/src/utils/artifactPreviewUrls.js';
const disposals=[];
function setup(){const frame=document.createElement('iframe'),status=document.createElement('div');frame.src='http://localhost:3000/api/local-preview/C:/x/a.html#tab';document.body.append(frame,status);disposals.push(monitorArtifactPreview(frame,status,{timeoutMs:100}));return{frame,status,url:new URL(frame.src)};}
afterEach(()=>{disposals.splice(0).forEach(fn=>fn());document.body.innerHTML='';vi.useRealTimers();});
describe('artifact loading evidence',()=>{
  it('does not treat a native load event as success',()=>{vi.useFakeTimers();const {frame,status}=setup();frame.dispatchEvent(new Event('load'));expect(status.dataset.state).toBe('loading');vi.advanceTimersByTime(101);expect(status.dataset.state).toBe('unconfirmed');});
  it('accepts only the frame, origin, and per-load channel together',()=>{
    const {frame,status,url}=setup();const data={type:PREVIEW_MESSAGE,channel:url.searchParams.get(PREVIEW_CHANNEL_PARAM),state:'loaded'};
    for(const extra of [{origin:'https://unrelated.example',source:frame.contentWindow},{origin:url.origin,source:window},{origin:url.origin,source:frame.contentWindow,data:{...data,channel:'wrong'}}])window.dispatchEvent(new MessageEvent('message',{data,origin:url.origin,source:frame.contentWindow,...extra}));
    expect(status.dataset.state).toBe('loading');
    window.dispatchEvent(new MessageEvent('message',{data,origin:url.origin,source:frame.contentWindow}));
    expect(status.dataset.state).toBe('loaded');expect(status.hidden).toBe(true);
  });
  it('retains reported resource warnings after load and treats details as text',()=>{
    const {frame,status,url}=setup();const send=message=>window.dispatchEvent(new MessageEvent('message',{origin:url.origin,source:frame.contentWindow,data:{type:PREVIEW_MESSAGE,channel:url.searchParams.get(PREVIEW_CHANNEL_PARAM),...message}}));
    send({state:'warning',detail:'<img src=x onerror=evil()>'});send({state:'loaded'});
    expect(status.hidden).toBe(false);expect(status.querySelector('img')).toBeNull();expect(status.textContent).toContain('<img');
  });
  it('preserves fragments and removes listeners/timers when the frame is removed',async()=>{
    vi.useFakeTimers();const {frame,status,url}=setup();expect(url.hash).toBe('#tab');frame.remove();await Promise.resolve();vi.advanceTimersByTime(101);expect(status.dataset.state).toBe('loading');
  });
});
