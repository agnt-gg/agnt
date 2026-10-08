import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it('hosted guidance does not promise a session token and explicitly forbids policy workarounds',async()=>{
 vi.stubEnv('AGNT_TENANT_SLUG','test');vi.resetModules();
 const {IMPORTANT_GUIDELINES}=await import('./orchestrator-chat.js');
 expect(IMPORTANT_GUIDELINES).toContain('No AGNT_AUTH_TOKEN or server secret is exposed to code');
 expect(IMPORTANT_GUIDELINES).toContain('reword a refused request to evade');
 expect(IMPORTANT_GUIDELINES).toContain('desktop example below does NOT apply');
});
it('desktop guidance keeps its existing local API capability',async()=>{
 vi.stubEnv('AGNT_TENANT_SLUG','');vi.resetModules();
 const {IMPORTANT_GUIDELINES}=await import('./orchestrator-chat.js');
 expect(IMPORTANT_GUIDELINES).not.toContain('HOSTED TOOL BOUNDARY');
 expect(IMPORTANT_GUIDELINES).toContain("Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN");
});
