import {it,expect,vi,afterEach} from 'vitest';
import source from './Agents.vue?raw';
import {authHeaders} from '@/utils/apiFetch.js';
// Run the two real page handlers without booting its unrelated canvas panels.
const handlers=source.slice(source.indexOf('    const fetchGoals = async'),source.indexOf('    const formatTaskTime ='));
afterEach(()=>{localStorage.removeItem('token');});
it('goals and task details carry the current session, not a nonexistent Vuex getter',async()=>{
 localStorage.setItem('token','first-session');
 const goals={value:[]};const terminalLines={value:[]};
 const fetch=vi.fn(async url=>({ok:true,json:async()=>url.endsWith('/goals')?{goals:[{id:'g',status:'paused'}]}:{goal:{tasks:[{id:'task'}]}}}));
 const run=new Function('fetch','authHeaders','API_CONFIG','goals','monitorGoalProgress','terminalLines','scrollToBottom','store',handlers+'; return {fetchGoals,fetchGoalTasks};');
 const page=run(fetch,authHeaders,{BASE_URL:'/api'},goals,vi.fn(),terminalLines,vi.fn(),{getters:{}});
 await page.fetchGoals();
 expect(fetch).toHaveBeenCalledTimes(2);
 for(const [_url,options] of fetch.mock.calls)expect(options.headers.Authorization).toBe('Bearer first-session');
 expect(goals.value[0].tasks).toEqual([{id:'task'}]);
 localStorage.setItem('token','renewed-session');
 await page.fetchGoalTasks('g');
 expect(fetch.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer renewed-session');
 expect(terminalLines.value).toEqual([]);
});
