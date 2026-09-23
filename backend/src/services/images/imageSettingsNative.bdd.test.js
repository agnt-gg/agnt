import {describe,it,expect,vi,beforeAll,beforeEach} from 'vitest';
const boundary=vi.hoisted(()=>({generate:vi.fn(),api:vi.fn(),connections:vi.fn()}));
vi.mock('../auth/AuthManager.js',()=>({default:{getConnectedApps:boundary.connections,getValidAccessToken:boundary.api}}));
vi.mock('openai/index.mjs',()=>{class Client{constructor(){this.models={list:async()=>({data:[{id:'gpt-image-2.5-sunburst'},{id:'gpt-image-2.5-flare'}]})};this.images={generate:boundary.generate};}}return {default:Client,OpenAI:Client};});
let service,TOOLS;
beforeAll(async()=>{await (await import('../../models/database/index.js')).dbReady;service=(await import('./imageSettingsRuntime.js')).imageSettingsService;TOOLS=(await import('../orchestrator/tools.js')).TOOLS;});
beforeEach(()=>{vi.clearAllMocks();boundary.connections.mockResolvedValue([{providerId:'openai',connected:true}]);boundary.api.mockResolvedValue('synthetic-key');boundary.generate.mockResolvedValue({data:[{b64_json:'AAAA'}]});});
describe('Feature: stored API image default through native tool',()=>{
 it.each(['latest','latest-fast'])('Given %s saved and another chat model, Then dispatch its exact resolved API candidate',async model=>{const userId=crypto.randomUUID();await service.update(userId,{expectedRevision:0,selectedConnectionId:'openai',options:{connectionId:'openai',value:{model}}});const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'fixture'},null,{userId,useImageSettings:true,provider:'anthropic'}));expect(out.success).toBe(true);expect(out.imageMetadata.imageConnectionId).toBe('openai');expect(boundary.generate.mock.calls[0][0].model).toBe(model==='latest'?'gpt-image-2.5-sunburst':'gpt-image-2.5-flare');expect(boundary.generate).toHaveBeenCalledOnce();});
 it('Given no configuration, Then do not acquire API credentials or generate',async()=>{const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'fixture'},null,{userId:crypto.randomUUID(),useImageSettings:true}));expect(out.success).toBe(false);expect(boundary.api).not.toHaveBeenCalled();expect(boundary.generate).not.toHaveBeenCalled();});
});
