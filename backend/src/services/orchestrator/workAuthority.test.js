import {it,expect,vi} from 'vitest';
import {WorkAuthority} from './workAuthority.js';
import {currentTeamExecution} from '../authorization/TeamExecutionContext.js';
it('restores verified team context and never requests personal credentials',async()=>{
 const resolvePersonal=vi.fn();
 const authority=new WorkAuthority({loadBinding:async()=>({kind:'team',ownerId:'owner',teamId:'team',principalId:'principal'}),authorize:async()=>{},resolvePersonal,resolveTeam:async()=>({teamId:'team',principalId:'principal',actorId:'owner'})});
 const resolved=await authority.resolve({owner_id:'owner'});
 expect(resolved.run(()=>currentTeamExecution().principalId)).toBe('principal');
 expect(currentTeamExecution()).toBeNull();expect(resolvePersonal).not.toHaveBeenCalled();
});
it('revocation fails before resolving credentials',async()=>{
 const resolvePersonal=vi.fn();
 const authority=new WorkAuthority({loadBinding:async()=>({kind:'personal',ownerId:'owner'}),authorize:async()=>{throw Error('Revoked');},resolvePersonal});
 await expect(authority.resolve({owner_id:'owner'})).rejects.toThrow('Revoked');expect(resolvePersonal).not.toHaveBeenCalled();
});
it('missing current personal credential yields an auth wait',async()=>{
 const authority=new WorkAuthority({loadBinding:async()=>({kind:'personal',ownerId:'owner'}),authorize:async()=>{},resolvePersonal:async()=>null});
 await expect(authority.resolve({owner_id:'owner'})).rejects.toMatchObject({code:'waiting_auth'});
});
