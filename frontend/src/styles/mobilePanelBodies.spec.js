import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(src,p),'utf8');
const css=postcss.parse(read('styles/components/_compact-app.css'));
function rule(selector){let found;css.walkRules(r=>{if(r.selector===selector)found=r;});expect(found,selector).toBeDefined();return found;}
const property=(r,p)=>r.nodes.find(n=>n.prop===p)?.value;
describe('mobile panel body ownership',()=>{
 it('left and right panels use the same mobile content marker without changing desktop markup',()=>{
  for(const panel of ['LeftPanel','RightPanel']){
   const s=read(`views/Terminal/${panel}/${panel}.vue`);
   expect(s).toContain(':class="{ \'mobile-panel-body\': isMobile }"');
   expect((s.match(/class="panel-content-wrapper"/g)||[])).toHaveLength(1);
  }
 });
 it('one body owns the safe gutter and remains a bounded scroll region',()=>{
  const body=rule('body .mobile-panel-visible > .mobile-panel-body');
  expect(body.parent.params).toBe('(max-width: 800px)');
  expect(property(body,'padding')).toContain('16px max(16px');
  expect(property(body,'box-sizing')).toBe('border-box');
  expect(property(body,'min-height')).toBe('0');
  expect(property(body,'overflow-y')).toBe('auto');
 });
 it('underlying page state stays mounted but does not bleed into the sheet',()=>{
  const body=rule('.terminal-content.mobile-presentation > .three-panel-container > .main-panel[inert]');
  expect(property(body,'visibility')).toBe('hidden');
  expect(property(body,'display')).toBeUndefined();
 });
 it('does not turn the trace Agent Details subsection into a page overlay',()=>{
  css.walkRules(r=>{if(r.selector.includes('agent-details-section')&&r.nodes.some(n=>n.prop==='position'&&['absolute','fixed'].includes(n.value)))expect(r.selector).toMatch(/\.agents-(panel|content)/);});
 });
 it('reopens a selected run and workflow without relying on an ID change',()=>{
  const traces=read('views/Terminal/CenterPanel/screens/Traces/Traces.vue');
  const body=traces.slice(traces.indexOf('const handleExecutionClick'),traces.indexOf('// Double-click'));
  expect(body.indexOf("openMobilePanel('right')")).toBeGreaterThan(0);
  expect(body.indexOf("openMobilePanel('right')")).toBeLessThan(body.indexOf('if (selectedExecutionId.value === execution.id)'));
  const workflow=read('views/Terminal/CenterPanel/screens/Workflows/Workflows.vue');
  const selection=workflow.slice(workflow.indexOf('const handleWorkflowClick'),workflow.indexOf('const handleWorkflowDoubleClick'));
  expect(selection).toContain("openMobilePanel('right')");
 });
 it('selected execution is reactive input instead of only an imperative mount-time call',()=>{
  const screen=read('views/Terminal/CenterPanel/screens/Traces/Traces.vue');
  const panel=read('views/Terminal/RightPanel/types/TracesPanel/TracesPanel.vue');
  expect(screen).toContain('executionDetail: selectedExecution.value');
  expect(panel).toContain('executionDetail: { type: Object, default: null }');
  expect(panel).toContain('watch(() => props.executionDetail, detail => { selectedExecution.value = detail; }, { immediate: true })');
 });
});
