import { describe, it, expect } from 'vitest';
import { redactToolSecrets } from './redactToolSecrets.js';
const access='sk-ant-oat01-'+ 'A'.repeat(35);
const refresh='sk-ant-ort01-'+ 'B'.repeat(35);
describe('credential-safe tool output',()=>{
 it('covers both token formats in objects and embedded JSON stdout',()=>{
  for(const value of [{accessToken:access,refreshToken:refresh},JSON.stringify({access_token:access,refresh_token:refresh}),{stdout:JSON.stringify({accessToken:access,refreshToken:refresh})}]){
   const output=JSON.stringify(redactToolSecrets(value));expect(output).not.toContain(access);expect(output).not.toContain(refresh);expect(output).toContain('[REDACTED]');
  }
 });
 it('recognizes camelCase and snake_case fields even without a known token prefix',()=>{
  const output=redactToolSecrets({a:{accessToken:'secret-value'},refresh_token:'refresh-value',text:'"accessToken": "another-value"'});
  expect(output.a.accessToken).toBe('[REDACTED]');expect(output.refresh_token).toBe('[REDACTED]');expect(output.text).not.toContain('another-value');
 });
 it('never bypasses redaction for large output',()=>{
  const value='x'.repeat(2000000)+'\n'+access;expect(redactToolSecrets(value)).not.toContain(access);
 });
 it('does not mutate its input and preserves ordinary output',()=>{
  const input={result:42,url:'https://example.com',accessToken:access};const output=redactToolSecrets(input);expect(input.accessToken).toBe(access);expect(output.result).toBe(42);expect(output.url).toBe(input.url);
 });
});
