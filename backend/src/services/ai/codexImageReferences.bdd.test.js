import {describe,it,expect} from 'vitest';
import { bindUploadReferences, resolveImageReferences } from './codexImageReferences.js';
import { png, uri } from './codexImageTestFixture.js';
const encoded = png.toString('base64');
describe('Feature: host-owned explicit image references',()=>{
 it.each([{}, [null], [{type:'image/png',data:'not-image-bytes'}]])('Given malformed uploads %j, Then no usable reference is minted',input=>{const refs=bindUploadReferences(input,'turn-1');expect(Object.keys(refs.entries)).toHaveLength(0);});
 it('Given two uploads, When selecting one handle, Then only its bytes are resolved',()=>{
  const refs=bindUploadReferences([{type:'image/png',data:encoded,filename:'first'},{type:'image/png',data:encoded,filename:'second'}],'turn-1');
  expect(resolveImageReferences(['upload:1'],refs,'turn-1')).toEqual([uri]);
 });
 it.each(['file:///etc/passwd','../../secret','https://example.com/a.png','upload:99'])('Given arbitrary selector %s, Then reject without filesystem or network',selector=>{
  const refs=bindUploadReferences([{type:'image/png',data:encoded}],'turn-1');expect(()=>resolveImageReferences([selector],refs,'turn-1')).toThrow(/reference/);
 });
 it('Given references from another turn, Then refuse reuse',()=>{const refs=bindUploadReferences([{type:'image/png',data:encoded}],'turn-1');expect(()=>resolveImageReferences(['upload:0'],refs,'turn-2')).toThrow(/scope/);});
 it('Given no explicit handles, Then do not choose a recent screenshot',()=>{expect(()=>resolveImageReferences([],bindUploadReferences([], 'turn-1'),'turn-1')).toThrow(/explicit/);});
 it('Given duplicate handles, Then reject rather than duplicate input silently',()=>{const refs=bindUploadReferences([{type:'image/png',data:encoded}],'turn-1');expect(()=>resolveImageReferences(['upload:0','upload:0'],refs,'turn-1')).toThrow(/Duplicate/);});
 it('Given an unsupported image, Then its original index stays unavailable',()=>{const refs=bindUploadReferences([{type:'image/jpeg',data:encoded},{type:'image/png',data:encoded}],'turn-1');expect(()=>resolveImageReferences(['upload:0'],refs,'turn-1')).toThrow(/reference/);expect(resolveImageReferences(['upload:1'],refs,'turn-1')).toHaveLength(1);});
});
