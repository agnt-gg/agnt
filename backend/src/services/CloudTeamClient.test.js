import {describe,it,expect,vi,afterEach} from 'vitest';
import {CloudTeamClient} from './CloudTeamClient.js';
afterEach(()=>vi.unstubAllEnvs());
describe('CloudTeamClient',()=>{
 it('forwards the calling credential only to the configured authority',async()=>{const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>[]}));const client=new CloudTeamClient({baseUrl:'https://api.example.test',fetchImpl});await client.request('Bearer example','');expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/teams');expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer example');expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');});
 it('denies requests without a bearer',async()=>{const fetchImpl=vi.fn();await expect(new CloudTeamClient({fetchImpl}).request('', '')).rejects.toMatchObject({status:401});expect(fetchImpl).not.toHaveBeenCalled();});
 it('preserves definitive membership refusals',async()=>{const client=new CloudTeamClient({fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'Business required',code:'business_required'})})});await expect(client.request('Bearer example','/x')).rejects.toMatchObject({status:403,code:'business_required'});});
 it('rejects another tenant even when the caller belongs to both',async()=>{vi.stubEnv('AGNT_TENANT_SLUG','alpha');const client=new CloudTeamClient({fetchImpl:async()=>({ok:true,json:async()=>({tenantSlug:'beta'})})});await expect(client.access('Bearer example','team')).rejects.toMatchObject({status:409});});
});
