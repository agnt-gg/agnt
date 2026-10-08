import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issueToolToken, verifyToolToken, toolRequestPermitted, withToolActor, currentToolActor, currentToolAuthorization } from './toolRunAuthority.js';
const key='test-key-not-a-live-credential'.repeat(3);
let previous;
beforeEach(()=>{previous=process.env.AGNT_TENANT_SLUG;process.env.AGNT_TENANT_SLUG='alpha';});
afterEach(()=>{if(previous===undefined)delete process.env.AGNT_TENANT_SLUG;else process.env.AGNT_TENANT_SLUG=previous;});
describe('tool-run authority',()=>{
 it('expires in five minutes and belongs to one instance',()=>{
  const token=issueToolToken('owner',{key,now:1000});
  expect(verifyToolToken(token,{key,now:1299}).sub).toBe('owner');
  expect(()=>verifyToolToken(token,{key,now:1300})).toThrow();
  process.env.AGNT_TENANT_SLUG='bravo';expect(()=>verifyToolToken(token,{key,now:1100})).toThrow();
 });
 it('rejects forgery and a cloud bearer',()=>{
  const token=issueToolToken('owner',{key,now:1000});
  expect(()=>verifyToolToken(token,{key:'different',now:1100})).toThrow();
  expect(()=>verifyToolToken('full-session',{key,now:1100})).toThrow();
 });
 it('permits the declared reads and rejects writes, credentials, SQL and encoded traversal',()=>{
  for(const p of ['/api/agents/','/api/workflows?limit=2','/api/health'])expect(toolRequestPermitted('GET',p)).toBe(true);
  for(const p of ['/api/auth/token','/api/keys','/api/settings','/api/tools/execute','/api/files/read','/api/agents/%2e%2e/auth','/api/workflows/../auth'])expect(toolRequestPermitted('GET',p)).toBe(false);
  expect(toolRequestPermitted('POST','/api/agents')).toBe(false);
 });
 it('parallel tool calls never borrow the other callers identity',async()=>{
  const values=await Promise.all(['one','two'].map(id=>withToolActor(id,async()=>{await new Promise(r=>setTimeout(r,5));return [currentToolActor(),currentToolAuthorization()];},'test-bearer-'+id)));
  expect(values).toEqual([['one','test-bearer-one'],['two','test-bearer-two']]);expect(currentToolActor()).toBeUndefined();expect(currentToolAuthorization()).toBeNull();
 });
});
