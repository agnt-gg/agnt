import { describe, it, expect, vi } from 'vitest';
import Canvas from './Canvas.vue';
const methods=Canvas.methods;
function fixture(){const host={getBoundingClientRect:()=>({width:390,height:600})};const c={...Canvas.data(),nodes:[{id:'n1',x:40,y:40},{id:'n2',x:400,y:260}],nodeWidth:288,$el:host,$refs:{canvas:{style:{},querySelectorAll:()=>[]}},$emit:vi.fn()};for(const[k,v]of Object.entries(methods))c[k]=v.bind(c);return c;}
function event(extra={}){return {pointerType:'touch',pointerId:1,clientX:10,clientY:20,target:{closest:()=>null},currentTarget:{setPointerCapture:vi.fn(),releasePointerCapture:vi.fn()},preventDefault:vi.fn(),...extra};}
describe('workflow touch canvas',()=>{
 it('pans only the matching active pointer',()=>{const c=fixture(),e=event();c.onTouchStart(e);c.onTouchMove(event({pointerId:2,clientX:90}));expect(c.canvasOffsetX).toBe(0);c.onTouchMove(event({clientX:60,clientY:70}));expect(c.canvasOffsetX).toBe(50);expect(c.canvasOffsetY).toBe(50);c.onTouchEnd(e);expect(c.touchGesture).toBeNull();});
 it('ignores mouse events and interactive node content',()=>{const c=fixture();c.onTouchStart(event({pointerType:'mouse'}));expect(c.touchGesture).toBeNull();c.onTouchStart(event({target:{closest:()=>({})}}));expect(c.touchGesture).toBeNull();});
 it('fit changes view transform but not node coordinates',()=>{const c=fixture(),before=JSON.stringify(c.nodes);c.fitMobileGraph();expect(c.zoomLevel).toBeGreaterThanOrEqual(.2);expect(c.zoomLevel).toBeLessThan(1);expect(JSON.stringify(c.nodes)).toBe(before);expect(c.$refs.canvas.style.transform).toContain('scale');});
 it('does not let a second touch steal the active gesture',()=>{const c=fixture();c.onTouchStart(event());c.onTouchStart(event({pointerId:2,clientX:120}));expect(c.touchGesture.pointerId).toBe(1);});
 it('a drag remains a drag even when it returns to its origin',()=>{const c=fixture();c.touchGesture={pointerId:1,index:0,x:10,y:20,nodeX:40,nodeY:40};c.onTouchMove(event({clientX:60}));c.onTouchMove(event());c.onTouchEnd(event({type:'pointerup'}));expect(c.$emit).not.toHaveBeenCalledWith('select-node',0);});
 it('canceled node gestures never select the node',()=>{const c=fixture();c.touchGesture={pointerId:1,index:0};c.onTouchEnd(event({type:'pointercancel'}));expect(c.$emit).not.toHaveBeenCalledWith('select-node',0);});
 it('bounds explicit zoom controls',()=>{const c=fixture();c.mobileZoom(100);expect(c.zoomLevel).toBe(2);c.mobileZoom(-100);expect(c.zoomLevel).toBe(.2);});
});
