import {describe,it,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {validatePng} from './pngIntegrity.js';
import {png} from '../../../../tests/fixtures/imagePng.js';
import {workstationImageUrl,generateWorkstationImage} from './workstationImage.js';
afterEach(()=>vi.unstubAllEnvs());
const health={service:'teacher-prep-image-service',status:'ok',model_id:'fixture-model',profile_id:'fixture',pipeline_loaded:false};
const base='http://127.0.0.1:1281';
function params(){return {model:'provider-default',imagePrompt:'fixture',imageOperation:'Generate',imageRequest:{binding:crypto.createHash('sha256').update(JSON.stringify([base,'fixture','fixture-model'])).digest('hex')},beforeImageDispatch:vi.fn()};}
describe('operator-configured local image facade',()=>{
 it('rejects a truncated header, invalid checksum and zero dimensions',()=>{expect(()=>validatePng(png.subarray(0,24))).toThrow();const bad=Buffer.from(png);bad[20]^=1;expect(()=>validatePng(bad)).toThrow();});
 it('validates a full fixture without native image libraries',()=>expect(validatePng(png)).toEqual({width:1,height:1}));
 it.each(['https://example.com','http://localhost:1281','http://127.0.0.1:1281/path','http://u:p@127.0.0.1:1281','http://127.0.0.1:1281/?x=y'])('rejects nonapproved endpoint %s',url=>expect(()=>workstationImageUrl(url)).toThrow());
 it('rejects edit before any fetch',async()=>{vi.stubEnv('AGNT_WORKSTATION_IMAGE_URL',base);const fetcher=vi.fn();await expect(generateWorkstationImage({...params(),imageOperation:'Edit'},{fetcher})).rejects.toThrow(/editing/);expect(fetcher).not.toHaveBeenCalled();});
 it('generates once, without credentials, and imports only its owned PNG',async()=>{vi.stubEnv('AGNT_WORKSTATION_IMAGE_URL',base);const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-image-'));const p=params();const fetcher=vi.fn(async(url,options)=>{if(url.endsWith('/health'))return {ok:true,json:async()=>health};expect(options.headers.Authorization).toBeUndefined();expect(options.redirect).toBe('error');const b=JSON.parse(options.body);await fs.writeFile(path.join(b.output_dir,'image.png'),png);return {ok:true,status:200,json:async()=>({image_model:'fixture-model',images:[{path:'image.png'}]})};});const result=await generateWorkstationImage(p,{root,fetcher});expect(result.generatedImages[0]).toBe('data:image/png;base64,'+png.toString('base64'));expect(p.beforeImageDispatch).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledTimes(2);expect(result.imageMetadata.pipelineInitiallyLoaded).toBe(false);});
 it('admission503 never loops or falls back',async()=>{vi.stubEnv('AGNT_WORKSTATION_IMAGE_URL',base);const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-image-'));const fetcher=vi.fn(async url=>url.endsWith('/health')?{ok:true,json:async()=>health}:{ok:false,status:503,json:async()=>({status:'warming'})});await expect(generateWorkstationImage(params(),{root,fetcher})).rejects.toMatchObject({retryable:false,httpStatus:503});expect(fetcher).toHaveBeenCalledTimes(2);});
});
