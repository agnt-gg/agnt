import {it,expect,vi} from 'vitest';
import {installWorkCredentialRecovery} from './workCredentialRecovery.js';
it('wakes matching auth waits without forwarding token values',async()=>{
 let listener;const unsubscribe=vi.fn();const store={run:vi.fn(async()=>({changes:1}))};const scheduler={tick:vi.fn(async()=>{})};
 const stop=installWorkCredentialRecovery({subscribe:callback=>{listener=callback;return unsubscribe;},store,scheduler});
 listener({userId:'owner',token:'must-not-be-stored'});
 await vi.waitFor(()=>expect(scheduler.tick).toHaveBeenCalledOnce());
 expect(JSON.stringify(store.run.mock.calls)).not.toContain('must-not-be-stored');
 expect(store.run.mock.calls[0][0]).toContain("status='waiting_auth'");
 stop();listener({userId:'owner'});expect(store.run).toHaveBeenCalledOnce();expect(unsubscribe).toHaveBeenCalledOnce();
});
