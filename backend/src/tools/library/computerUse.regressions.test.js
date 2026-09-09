import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import input from './actions/computer-input.js';
import observe from './utilities/computer-observe.js';

let directory, previous;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-contracts-'));
  const driver = path.join(directory, 'driver.cjs');
  fs.writeFileSync(driver, `const [,,command,tool,json]=process.argv; const args=JSON.parse(json||'{}');
if(command==='status') console.log('daemon running');
else if(tool==='get_window_state') {
 if(args.pid===2) console.log(JSON.stringify({status:'refused',refusal:{code:'window_scope_disabled',message:'refused'}}));
 else if(args.pid===3) console.log('not a snapshot');
 else if(args.pid===4) console.log('{}');
 else { const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=','base64'); if(args.screenshot_out_file)require('fs').writeFileSync(args.screenshot_out_file,png);console.log(JSON.stringify({snapshot_id:'s1',elements:[],degraded:true})); }
} else if(tool==='verify_state') console.log(JSON.stringify({status:args.expect[0].window?'satisfied':'unknown',stable:true}));
else console.log(JSON.stringify({effect:'unverifiable',received:args}));`);
  previous = process.env.AGNT_CUA_DRIVER_PATH;
  process.env.AGNT_CUA_DRIVER_PATH = driver;
});
afterAll(() => {
  if (previous === undefined) delete process.env.AGNT_CUA_DRIVER_PATH;
  else process.env.AGNT_CUA_DRIVER_PATH = previous;
  fs.rmSync(directory, {recursive:true,force:true});
});

describe('real wrapper boundary regressions', () => {
  it.each(['click','double_click','right_click'])('%s preserves pixel window identity', async action => {
    const result = await input.execute({action,pid:1,windowId:7,x:20,y:30,confirm:true});
    expect(result.result.received).toMatchObject({pid:1,window_id:7,x:20,y:30});
  });
  it('press_key preserves index and snapshot', async () => {
    const result = await input.execute({action:'press_key',pid:1,windowId:7,elementIndex:0,snapshotId:'s1',text:'return',confirm:true});
    expect(result.result.received).toMatchObject({window_id:7,element_index:0,snapshot_id:'s1'});
  });
  it.each([2,3,4])('failed snapshot pid=%i fails closed', async pid => {
    const result = await observe.execute({pid,windowId:7,treeOnly:true});
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
  it('returns typed images even when display HTML is disabled', async () => {
    const result = await observe.execute({pid:1,windowId:7,showImage:false});
    expect(result.modelImages).toHaveLength(1);
    expect(result.modelImages[0]).toMatchObject({mimeType:'image/png',width:1,height:1,coordinateSpace:'window'});
    expect(result.imageHtml).toBeNull();
  });
  it('tree-only observations do not claim visual input', async () => {
    const result = await observe.execute({pid:1,windowId:7,treeOnly:true});
    expect(result.modelImages || []).toHaveLength(0);
  });
  it.each([[{}],[{element:{selector:{},exists:true}}],[{window:{exists:'yes'}}],[{element:{selector:{label_contains:'x'},exists:false}}]])('invalid predicate is refused before dispatch: %j', async predicate => {
    const result = await input.execute({action:'click',pid:1,windowId:7,x:1,y:1,confirm:true,expect:[predicate]});
    expect(result.success).toBe(false);expect(result.dispatched).toBe(false);expect(result.result).toBeUndefined();
  });
  it('postcondition measurement confirms the task separately from dispatch', async () => {
    const result = await input.execute({action:'click',pid:1,windowId:7,x:1,y:1,confirm:true,expect:[{window:{exists:true}}]});
    expect(result.effect).toBe('unverifiable');
    expect(result.verification?.satisfied).toBe(true);
    expect(result.taskVerified).toBe(true);
  });
  it('unknown postcondition never counts as success', async () => {
    const result = await input.execute({action:'click',pid:1,windowId:7,x:1,y:1,confirm:true,expect:[{element:{selector:{label_contains:'missing'},exists:true}}]});
    expect(result.taskVerified).toBe(false);
    expect(result.verification?.status).toBe('unknown');
  });
});
