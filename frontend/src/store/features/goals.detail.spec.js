import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import goals from './goals.js';
beforeEach(()=>{ localStorage.setItem('token','test');vi.stubGlobal('fetch',vi.fn()); });
afterEach(()=>vi.unstubAllGlobals());
describe('goal detail loading',()=>{
  it('hydrates full detail metadata without dropping existing evaluation',async()=>{
    const evaluation={overall_score:89.5};const state={goals:[{id:'g',title:'Review',evaluation}]};
    const detail={id:'g',tasks:[],credits_used:200,total_tokens:5000,notional_cost:1.2};
    fetch.mockResolvedValue({ok:true,json:async()=>({goal:detail})});
    const commit=(type,payload)=>goals.mutations[type](state,payload);
    await goals.actions.fetchGoalTasks({commit},'g');
    expect(state.goals[0]).toMatchObject({...detail,evaluation});
  });
  it('accepts the direct goal response shape',async()=>{
    const detail={id:'g',tasks:[]};fetch.mockResolvedValue({ok:true,json:async()=>detail});const commit=vi.fn();
    expect(await goals.actions.fetchGoalTasks({commit},'g')).toEqual(detail);
    expect(commit).toHaveBeenCalledWith('UPDATE_GOAL',detail);
  });
  it('throws on HTTP failure so the view can show Retry',async()=>{
    fetch.mockResolvedValue({ok:false,status:403});const commit=vi.fn();
    await expect(goals.actions.fetchGoalTasks({commit},'g')).rejects.toThrow('403');expect(commit).not.toHaveBeenCalled();
  });
  it('rejects malformed or wrong-goal payloads',async()=>{
    fetch.mockResolvedValue({ok:true,json:async()=>({goal:{id:'another',tasks:[]}})});const commit=vi.fn();
    await expect(goals.actions.fetchGoalTasks({commit},'g')).rejects.toThrow('Invalid goal detail');expect(commit).not.toHaveBeenCalled();
  });
});
