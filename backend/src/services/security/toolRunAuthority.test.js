import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issueToolToken, verifyToolToken, toolRequestPermitted, withToolActor, currentToolActor, currentToolAuthorization, TOOL_TOKEN_MAX_TTL_SECONDS } from './toolRunAuthority.js';
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
 it('lives as long as its run, capped at an hour',()=>{
  const run=issueToolToken('owner',{key,now:1000,ttlSeconds:1800});
  expect(verifyToolToken(run,{key,now:2799}).sub).toBe('owner');expect(()=>verifyToolToken(run,{key,now:2800})).toThrow();
  const capped=issueToolToken('owner',{key,now:1000,ttlSeconds:999999});
  expect(verifyToolToken(capped,{key,now:1000+TOOL_TOKEN_MAX_TTL_SECONDS-1}).sub).toBe('owner');
  expect(()=>verifyToolToken(capped,{key,now:1000+TOOL_TOKEN_MAX_TTL_SECONDS})).toThrow();
 });
 it('drives the whole instance API as its user, reads and writes',()=>{
  for(const [m,p] of [['GET','/api/agents/'],['GET','/api/users/settings'],['PUT','/api/users/settings'],['POST','/api/agents/save'],['DELETE','/api/agents/abc'],
    ['POST','/api/plugins/install'],['POST','/api/plugins/build-generated'],['POST','/api/tools/web_search/execute'],['GET','/api/plugins/marketplace?x=%20y'],
    ['GET','/api/users/security-policy'],['GET','/api/tenants'],['PATCH','/api/workflows/1'],['HEAD','/api/health']])
   expect(toolRequestPermitted(m,p),m+' '+p).toBe(true);
 });
 it('refuses lasting credentials, its own guardrails, instance lifecycle and path tricks',()=>{
  for(const [m,p] of [['POST','/api/cluster/enroll'],['POST','/api/CLUSTER/Enroll/'],['GET','/api/auth/desktop/handoff/n/claim'],['POST','/api/users/sync-token'],
    ['PUT','/api/users/security-policy'],['DELETE','/api/users/security-policy'],['POST','/api/system/restart'],['POST','/api/tenants'],['DELETE','/api/tenants/alpha'],
    ['GET','/api/agents/%2e%2e/cluster/enroll'],['GET','/api/workflows/../auth'],['GET','/api//users/sync-token'],['GET','/health'],['TRACE','/api/agents'],['CONNECT','/api/agents']])
   expect(toolRequestPermitted(m,p),m+' '+p).toBe(false);
 });
 it('parallel tool calls never borrow the other callers identity',async()=>{
  const values=await Promise.all(['one','two'].map(id=>withToolActor(id,async()=>{await new Promise(r=>setTimeout(r,5));return [currentToolActor(),currentToolAuthorization()];},'test-bearer-'+id)));
  expect(values).toEqual([['one','test-bearer-one'],['two','test-bearer-two']]);expect(currentToolActor()).toBeUndefined();expect(currentToolAuthorization()).toBeNull();
 });
});
