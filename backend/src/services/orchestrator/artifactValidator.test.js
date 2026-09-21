import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createArtifactValidator} from './artifactValidator.js';
it('checks actual file bytes against the fixed contract',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'artifact-check-'));
 try{
  await writeFile(path.join(root,'result.txt'),'verified');
  const sha256=createHash('sha256').update('verified').digest('hex');
  const validate=createArtifactValidator({root,saveReceipt:async()=> 'receipt'});
  expect(await validate({requirement:{check:{path:'result.txt',sha256}}})).toEqual({passed:true,targetVersion:sha256,reference:'receipt'});
  expect((await validate({requirement:{check:{path:'result.txt',sha256:'0'.repeat(64)}}})).passed).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
