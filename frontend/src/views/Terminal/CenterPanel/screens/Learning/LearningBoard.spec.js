import {describe,it,expect} from 'vitest';
import {mount} from '@vue/test-utils';
import LearningBoard from './LearningBoard.vue';
const finding={id:'f',revision:3,state:'detected',capability:'read_file',error_kind:'timeout',occurrences:7,independent_runs:4,candidate:{when:{capability:'read_file',error_kind:'timeout'},action:{type:'retry_read_only',max_retries:1}},candidate_hash:'hash'};
const trial={id:'t',revision:1,state:'watching',candidate:finding.candidate,candidate_hash:'hash',baseline:{eligible:28,failed:7},minimum_samples:20,started_at:Date.now()-86400000,review_due_at:Date.now()+6*86400000};
const snapshot=()=>({settings:{paused:false},findings:[finding],trials:[trial],policies:[],coverage:{events:48,work:12}});
const insight=(id,title='Tighten the prompt')=>({id,title,description:'Shorter system prompt',target_type:'agent',autonomy_decision:'escalate',status:'pending',confidence:.8});
describe('one consolidated Learning page',()=>{
 it('shows meaningful states without legacy parameter controls or creation counters',()=>{const w=mount(LearningBoard,{props:{data:snapshot()}});for(const tab of ['Waiting for you','Needs attention','Being tested','Learned'])expect(w.text()).toContain(tab);expect(w.text()).not.toContain('Min confidence');expect(w.text()).not.toContain('Generate dataset');});
 it('selecting a card hands it to the right panel instead of opening an inline aside',async()=>{const w=mount(LearningBoard,{props:{data:snapshot()}});await w.find('.learning-card').trigger('click');expect(w.find('aside').exists()).toBe(false);expect(w.emitted('select')[0][0]).toMatchObject({id:'f',kind:'finding',revision:3,candidate_hash:'hash'});});
 it('marks the selected card',()=>{const w=mount(LearningBoard,{props:{data:snapshot(),selectedKey:'finding:f'}});expect(w.find('.learning-card.chosen').exists()).toBe(true);});
 it('honestly renders a healthy empty state and pause control',async()=>{const data={settings:{paused:true},findings:[],trials:[],policies:[],coverage:{events:0,work:0}};const w=mount(LearningBoard,{props:{data}});expect(w.text()).toContain('Nothing needs your attention.');await w.find('.pause-button').trigger('click');expect(w.emitted('pause')[0]).toEqual([false]);});
 it('does not render hostile trace text as markup',()=>{const data=snapshot();data.findings[0]={...finding,capability:'<script>alert(1)</script>'};const w=mount(LearningBoard,{props:{data}});expect(w.find('script').exists()).toBe(false);expect(w.text()).toContain('<script>');});
});
describe('a recurring problem on one page, and a kept fix spread to other tools',()=>{
 it('a finding reads as what happened, why it keeps happening, what we will try, and how we will know',()=>{const w=mount(LearningBoard,{props:{data:snapshot()}});const page=w.get('[data-testid="one-page"]');expect(page.findAll('dt').map(d=>d.text())).toEqual(['What happened','Why it keeps happening','What we\u2019ll try','How we\u2019ll know']);expect(page.text()).toContain('read_file timed out 7 times across 4 separate runs.');expect(page.text()).toContain('Try read_file once more after a timeout.');expect(page.text()).toContain('at least 20 known calls on each side');});
 it('a finding with no supported change says so instead of promising a trial',()=>{const data=snapshot();data.findings[0]={...finding,error_kind:'authentication',candidate:null,candidate_hash:null};const w=mount(LearningBoard,{props:{data}});const page=w.get('[data-testid="one-page"]').text();expect(page).toContain('had its sign-in rejected');expect(page).toContain('needs signing in again');expect(page).toContain('There is no trial to run');});
 it('a kept fix lists other tools with the same problem and offers one trial each',async()=>{
  const policy={id:'p',trial_id:'old',state:'active',version:1,capability:'web_scrape_cached',error_kind:'timeout',activated_at:Date.now()};
  const other=(id,capability,occurrences)=>({...finding,id,capability,occurrences,candidate_hash:'h-'+id});
  const data={...snapshot(),trials:[],policies:[policy],findings:[other('a','list_files',9),other('b','grep_files',4),{...finding,id:'c',error_kind:'unavailable'},{...finding,id:'d',capability:'glob_files',state:'watching'}]};
  const w=mount(LearningBoard,{props:{data,initialView:'learned'}});
  const spread=w.get('[data-testid="spread"]');
  expect(spread.text()).toContain('list_files (9 times) and grep_files (4 times) have reported timeout failures too.');
  await spread.get('button').trigger('click');
  expect(w.emitted('spread')[0][0].map(f=>f.id)).toEqual(['a','b']);
  expect(w.emitted('select')).toBeUndefined();
 });
});
describe('Waiting for you: the escalation queue on the Learning page',()=>{
 it('counts exactly what the queue holds, the same list the chat panel counts',()=>{const waiting=[insight('a'),insight('b'),insight('c')];const w=mount(LearningBoard,{props:{data:snapshot(),waiting}});const tab=w.findAll('.tab-button').find(b=>b.text().startsWith('Waiting for you'));expect(tab.find('.tab-count').text()).toBe('3');expect(w.findAll('.queue .row')).toHaveLength(3);});
 it('opens on the queue when anything is waiting, and on Needs attention when nothing is',()=>{expect(mount(LearningBoard,{props:{data:snapshot(),waiting:[insight('a')]}}).find('.queue').exists()).toBe(true);expect(mount(LearningBoard,{props:{data:snapshot()}}).find('.queue').exists()).toBe(false);});
 it('switches to the queue when it fills after load, unless the user already chose a tab',async()=>{const w=mount(LearningBoard,{props:{data:snapshot()}});await w.setProps({waiting:[insight('a')]});expect(w.find('.queue').exists()).toBe(true);const v=mount(LearningBoard,{props:{data:snapshot()}});await v.findAll('.tab-button').find(b=>b.text().startsWith('Being tested')).trigger('click');await v.setProps({waiting:[insight('a')]});expect(v.find('.queue').exists()).toBe(false);});
 it('forwards queue verbs as accept-insights / reject-insights',async()=>{const w=mount(LearningBoard,{props:{data:snapshot(),waiting:[insight('a')]}});const row=w.find('.queue .row');await row.findAll('button').find(b=>b.text()==='Accept').trigger('click');await row.findAll('button').find(b=>b.text()==='Reject').trigger('click');expect(w.emitted('accept-insights')).toEqual([[['a']]]);expect(w.emitted('reject-insights')).toEqual([[['a']]]);});
});
