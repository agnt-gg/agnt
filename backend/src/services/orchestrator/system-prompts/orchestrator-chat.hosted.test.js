import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
// Reported 2026-10-08: on a cloud instance Annie refused to install a marketplace
// plugin without ever trying, because this guidance told her hosted code was
// read-only and had no AGNT_AUTH_TOKEN. Code there holds a run-scoped proxy key
// and may drive the whole API; the guidance must say so.
it('hosted guidance gives code the documented API pattern and permits writes',async()=>{
 vi.stubEnv('AGNT_TENANT_SLUG','test');vi.resetModules();
 const {IMPORTANT_GUIDELINES}=await import('./orchestrator-chat.js');
 expect(IMPORTANT_GUIDELINES).toContain("Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN");
 expect(IMPORTANT_GUIDELINES).toContain('reads AND writes');
 expect(IMPORTANT_GUIDELINES).toContain('POST /api/plugins/install');
 expect(IMPORTANT_GUIDELINES).toContain('Never work around a security-policy refusal');
 for (const stale of ['read-only','mutations require native tools','No AGNT_AUTH_TOKEN','does NOT apply']) expect(IMPORTANT_GUIDELINES).not.toContain(stale);
});
it('desktop guidance keeps its existing local API capability and has no hosted note',async()=>{
 vi.stubEnv('AGNT_TENANT_SLUG','');vi.resetModules();
 const {IMPORTANT_GUIDELINES}=await import('./orchestrator-chat.js');
 expect(IMPORTANT_GUIDELINES).toContain("Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN");
 expect(IMPORTANT_GUIDELINES).not.toContain('On this cloud instance');
});
it('the code tool description promises the token on every runtime',async()=>{
 vi.stubEnv('AGNT_TENANT_SLUG','test');vi.resetModules();
 const {TOOLS}=await import('../tools.js');
 const {description,parameters}=TOOLS.execute_javascript_code.schema.function;
 expect(description).toContain('process.env.AGNT_AUTH_TOKEN');
 for (const text of [description,parameters.properties.code.description]) expect(text).not.toMatch(/read-only|No AGNT_AUTH_TOKEN|calls are denied|session token are available/);
});
