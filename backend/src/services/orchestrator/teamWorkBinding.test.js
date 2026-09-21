import {it,expect,vi} from 'vitest';
import {createTeamWorkResolver} from './teamWorkBinding.js';
it('refuses revoked membership before accessing a stored principal',async()=>{
 const repository={get:vi.fn()};const resolve=createTeamWorkResolver({repository,authorizeActor:async()=>null});
 await expect(resolve({owner_id:'owner'},{actorId:'owner',teamId:'team'})).rejects.toMatchObject({code:'waiting_permission'});
 expect(repository.get).not.toHaveBeenCalled();
});
it('does not run a changed resource revision under an old approval',async()=>{
 const resolve=createTeamWorkResolver({repository:{get:async()=>({principal_id:'principal',approved_revision:1}),asset:async()=>({revision:2})},authorizeActor:async()=>({actorId:'owner',teamId:'team',role:'member'})});
 await expect(resolve({owner_id:'owner'},{actorId:'owner',teamId:'team',principalId:'principal',approvedRevision:1})).rejects.toMatchObject({code:'waiting_permission'});
});
