import {describe,it,expect,vi,afterEach} from 'vitest';
const state=vi.hoisted(()=>({connections:[]}));
vi.mock('../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn()}));
vi.mock('./cdpConnection.js',()=>({
 CdpConnection:class {
  constructor(){state.connections.push(this);this.listener=null;}
  async connect(){return this;}
  async send(){return {};}
  post(){}
  close(){}
  onEvent(fn){this.listener=fn;}
 },
 attachToPage:async()=>({sessionId:'s',targetId:'t'}),
}));
import {startViewing,_stopAll,streamsForUser} from './BrowserScreencastService.js';
afterEach(()=>{_stopAll();state.connections.length=0;});
describe('Given a browser instance name reused across CDP connections',()=>{
 it('When a retired connection closes late, Then its replacement survives',async()=>{
  await startViewing({userId:'u',instanceId:'i',cdpUrl:'ws://fixture'});const old=state.connections[0];
  _stopAll();await startViewing({userId:'u',instanceId:'i',cdpUrl:'ws://fixture'});
  old.listener({method:'__closed',params:{reason:'delayed close'}});
  expect(streamsForUser('u')).toEqual([{instanceId:'i',viewers:1}]);
 });
});
