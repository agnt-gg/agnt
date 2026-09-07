import {describe,it,expect,vi} from 'vitest';
import {syncActivation} from './activationSync.js';
describe('activation sync',()=>{
 it('sends only an enabled request to the local authenticated milestone endpoint',async()=>{const axios={post:vi.fn().mockResolvedValue({data:{success:true}})};await syncActivation({axios,baseUrl:'/api',token:'test',storage:{getItem:()=>null},navigator:{}});expect(axios.post).toHaveBeenCalledWith('/api/users/activation-sync',{enabled:true},{headers:{Authorization:'Bearer test'},timeout:28000});});
 it('honors DNT and local opt-out',async()=>{const axios={post:vi.fn()};for(const [navigator,storage]of [[{doNotTrack:'1'},{getItem:()=>null}],[{},{getItem:()=> '1'}]])expect(await syncActivation({axios,baseUrl:'/api',token:'test',storage,navigator})).toEqual({skipped:true});expect(axios.post).not.toHaveBeenCalled();});
 it('a failed delivery never breaks the calling stats flow',async()=>{const logger={warn:vi.fn()};expect(await syncActivation({axios:{post:vi.fn().mockRejectedValue(new Error('unavailable'))},baseUrl:'/api',token:'test',storage:{getItem:()=>null},navigator:{},logger})).toEqual({deferred:true});expect(logger.warn).toHaveBeenCalled();});
});
