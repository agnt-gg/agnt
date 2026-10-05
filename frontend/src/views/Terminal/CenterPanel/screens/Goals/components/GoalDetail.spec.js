import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import GoalDetail from './GoalDetail.vue';
import GoalDetailEvidence from './GoalDetailEvidence.vue';
import GoalDetailVerdict from './GoalDetailVerdict.vue';
import { reviewPercent, taskOutputText, OUTPUT_LIMIT } from '../goalDetailModel.js';

const REPORT = 'C:/work/weekly/report.md';
const htmlFile = 'C:/work/site/index.html';
const fileMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/fileSystemService.js', () => ({ getFile: fileMock }));
const state = reactive({ goals: [] });
const evaluation = { overall_score: 89.5, evaluation_data: { scores: { completeness: 100, quality: 85, taskAverage: 85 }, checklist: [
  {id:'c1',text:'Dated weekly/report.md',met:true,evidence:'Task 1 wrote weekly/report.md.'},
  {id:'c2',text:'Metrics must include a baseline',met:false,evidence:'Task 1 did not verify the baseline.'},
] } };
const store = {getters:{'goals/getGoalById':id => state.goals.find(g=>g.id===id)},dispatch:vi.fn()};
vi.mock('vuex', () => ({useStore:()=>store}));
const makeGoal = () => ({id:'g1',title:'Weekly review',status:'needs_review',current_iteration:4,max_iterations:50,priority:'high',success_criteria:{deliverables:['Dated weekly/report.md']},tasks:[{id:'t1',title:'Verify baseline',status:'completed',output:JSON.stringify({content:[{type:'text',text:'Work completed.'}],toolExecutions:[{name:'write_file',arguments:{path:REPORT}},{name:'write_file',arguments:{path:htmlFile}}]})}]});
const inspectorStub = {props:['artifact'],template:'<div class="inline-inspector">{{ artifact.name }} {{ artifact.kind }}<button class="close-preview" @click="$emit(\'close\')">Close</button></div>'};
const mountGoal = () => mount(GoalDetail,{props:{goalId:'g1',goals:state.goals},global:{stubs:{ArtifactInspector:inspectorStub}}});
function button(wrapper, text) { const found = wrapper.findAll('button').find(b=>b.text().includes(text));if(!found)throw Error('Missing button: '+text);return found; }
beforeEach(() => {
  state.goals=[makeGoal()];
  fileMock.mockReset().mockResolvedValue({content:'# Weekly\n## Metrics\nBaseline evidence.\n## Receipts\nAll five receipts.'});
  store.dispatch.mockReset().mockImplementation(async (action,id) => {
    if(action==='goals/fetchGoalEvaluation'){const index=state.goals.findIndex(g=>g.id===id);state.goals.splice(index,1,{...state.goals[index],evaluation});return evaluation;}
    return {};
  });
});

describe('goal detail review workspace', () => {
  it('follows a replacement store object and shows real scores, criteria and report tabs',async()=>{
    const wrapper=mountGoal();await flushPromises();
    expect(wrapper.text()).toContain('89.5%');expect(wrapper.text()).toContain('1 of 2 met');
    expect(wrapper.findAll('.gd-tab').map(b=>b.text())).toContain('Metrics');
    await button(wrapper,'Metrics').trigger('click');
    expect(wrapper.find('.gd-evidence-body').text()).toContain('Baseline evidence.');
    expect(store.dispatch).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('opens passed proof and its report section or task without navigating',async()=>{
    const wrapper=mountGoal();await flushPromises();
    const passed=wrapper.find('.gd-check.is-met');await button(passed,'Proof').trigger('click');
    expect(passed.text()).toContain('Task 1 wrote');
    await button(passed,'Task 1').trigger('click');await flushPromises();
    expect(wrapper.find('[data-review-task="1"]').text()).toContain('Work completed.');
    const missed=wrapper.find('.gd-check.is-missed');await button(missed,'Proof').trigger('click');
    await button(missed,'Metrics in the report').trigger('click');
    expect(wrapper.find('.gd-evidence-body').text()).toContain('Baseline evidence.');wrapper.unmount();
  });
  it('previews an HTML file in the existing inspector and closes back to files',async()=>{
    const wrapper=mountGoal();await flushPromises();await button(wrapper,'All files').trigger('click');
    const row=wrapper.findAll('.gd-file').find(r=>r.text().includes('index.html'));
    await button(row,'Preview').trigger('click');
    expect(wrapper.find('.inline-inspector').text()).toContain('index.html html');
    expect(wrapper.findComponent(GoalDetail).exists()).toBe(true);
    await wrapper.find('.close-preview').trigger('click');expect(wrapper.findAll('.gd-file')).toHaveLength(2);wrapper.unmount();
  });
  it('retains comments after a failed return and clears only after success; no implicit run',async()=>{
    const wrapper=mountGoal();await flushPromises();await button(wrapper,'Request changes').trigger('click');await wrapper.find('textarea').setValue('Verify C4 first.');
    store.dispatch.mockRejectedValueOnce(Error('Offline'));
    await button(wrapper,'Send back to queue').trigger('click');await flushPromises();
    expect(wrapper.find('textarea').element.value).toBe('Verify C4 first.');expect(wrapper.find('[role="alert"]').text()).toContain('Offline');
    store.dispatch.mockResolvedValueOnce({status:'planning',message:'Returned for revision'});
    await button(wrapper,'Send back to queue').trigger('click');await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(store.dispatch).toHaveBeenCalledWith('goals/reviewGoal',{goalId:'g1',action:'reject',feedback:'Verify C4 first.'});
    expect(store.dispatch.mock.calls.some(([action])=>action==='goals/executeGoalAutonomous')).toBe(false);wrapper.unmount();
  });
  it('dispatches approval once during a pending request and shows the result',async()=>{
    const wrapper=mountGoal();await flushPromises();let finish;
    store.dispatch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await button(wrapper,'Approve result').trigger('click');await button(wrapper,'Approve result').trigger('click');
    expect(store.dispatch.mock.calls.filter(([action])=>action==='goals/reviewGoal')).toHaveLength(1);
    finish({status:'validated',message:'Accepted'});await flushPromises();expect(wrapper.text()).toContain('Accepted');wrapper.unmount();
  });
  it('labels an unrun proposal as plan approval and does not offer pause',async()=>{
    state.goals=[{...makeGoal(),current_iteration:0,tasks:[{id:'t1',status:'pending',title:'Plan'}]}];
    const wrapper=mountGoal();await flushPromises();expect(wrapper.text()).toContain('Approve plan');
    expect(wrapper.findAll('button').some(b=>b.text()==='Pause goal')).toBe(false);wrapper.unmount();
  });
  it('reports read errors with retry instead of a blank report',async()=>{
    fileMock.mockRejectedValueOnce(Error('Missing file'));const wrapper=mountGoal();await flushPromises();
    expect(wrapper.find('.gd-doc [role="alert"]').text()).toContain('Missing file');
    await button(wrapper.find('.gd-doc'),'Retry').trigger('click');await flushPromises();expect(wrapper.find('.gd-rendered').text()).toContain('Baseline evidence');wrapper.unmount();
  });
  it('rejects a late file read from the previous goal, even when the path is the same',async()=>{
    const pending=[];fileMock.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const wrapper=mountGoal();await flushPromises();
    state.goals.push({...makeGoal(),id:'g2',title:'Second goal'});
    await wrapper.setProps({goalId:'g2'});await flushPromises();
    pending.at(-1)({content:'## Fresh\nSecond goal evidence.'});await flushPromises();
    pending[0]({content:'## Stale\nWrong goal.'});await flushPromises();
    expect(wrapper.text()).toContain('Second goal evidence');expect(wrapper.text()).not.toContain('Wrong goal.');wrapper.unmount();
  });
  it('sanitises hostile report HTML and leaves all work inside the page',async()=>{
    fileMock.mockResolvedValue({content:'## Metrics\n<img src=x onerror="alert(1)"><script>alert(2)</script><iframe src="https://example.com"></iframe>'});
    const wrapper=mountGoal();await flushPromises();
    expect(wrapper.find('.gd-rendered').html()).not.toContain('onerror');expect(wrapper.find('.gd-rendered script').exists()).toBe(false);expect(wrapper.find('.gd-rendered iframe').exists()).toBe(false);wrapper.unmount();
  });
  it('shows fetch failures rather than pretending the goal is loaded',async()=>{
    store.dispatch.mockRejectedValueOnce(Error('Forbidden'));
    const wrapper=mountGoal();await flushPromises();expect(wrapper.find('[role="alert"]').text()).toContain('Forbidden');wrapper.unmount();
  });
});

describe('detail display boundaries',()=>{
  it.each([null,undefined,'',NaN,Infinity,false])('does not turn %s into a score',value=>expect(reviewPercent(value)).toBe(null));
  it('preserves decimals and clamps invalid bounds',()=>{expect(reviewPercent(89.5)).toBe(89.5);expect(reviewPercent(120)).toBe(100);expect(reviewPercent(-2)).toBe(0);});
  it('unwraps nested content, skips reasoning/tool blocks and bounds long output',()=>{
    expect(taskOutputText({content:[{type:'thinking',thinking:'private'},{type:'text',text:'answer'},{type:'tool_use',name:'test'}]})).toBe('answer');
    expect(taskOutputText('x'.repeat(500000))).toHaveLength(OUTPUT_LIMIT);
  });
  it('renders absent evaluation without invented zero bars',()=>{
    const wrapper=mount(GoalDetailVerdict,{props:{verdict:{evaluated:false,met:0,total:1},items:[{id:'c1',text:'Deliver',met:null,proof:{tasks:[],files:[],section:null}}],submitFeedback:async()=>false}});
    expect(wrapper.text()).toContain('1 not checked');expect(wrapper.text()).not.toContain('0%');expect(wrapper.find('.gd-ring-num').text()).toBe('—');wrapper.unmount();
  });
  it('keeps a selected section on content refresh',async()=>{
    const wrapper=mount(GoalDetailEvidence,{props:{report:{path:REPORT,text:'A'},sections:[{heading:'Metrics',body:'A'},{heading:'Receipts',body:'B'}],renderMarkdown:text=>text}});
    await button(wrapper,'Receipts').trigger('click');await wrapper.setProps({sections:[{heading:'Metrics',body:'A2'},{heading:'Receipts',body:'B2'}]});
    expect(wrapper.find('.gd-rendered').text()).toBe('B2');wrapper.unmount();
  });
});
