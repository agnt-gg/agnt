/**
 * "New" in Focused creates IN Focused.
 *
 * Every New / Add button used to seed the chat ("Create an agent that …") and
 * navigate there. Each one now opens Focused's own blank editor; Save creates
 * through the shared store and lands on the new item. None of these paths may
 * call nav.ask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const CREATED = {
  'agents/createAgent': { message: 'New agent created', agentId: 'a-new' },
  'workflows/createWorkflow': { id: 'w-new', name: 'Digest', nodes: [], edges: [] },
  'tools/createTool': { id: 't-new' },
  'skills/createSkill': { skill: { id: 's-new' } },
  'widgetDefinitions/createDefinition': { id: 'cw_new' },
};
const dispatch = vi.fn((action) => Promise.resolve(CREATED[action]));
const getters = reactive({
  'agents/allAgents': [],
  'agents/isLoading': false,
  'workflows/allWorkflows': [],
  'tools/allTools': [{ id: 'x' }],
  'tools/customTools': [],
  'skills/allSkills': [],
  'widgetDefinitions/definitions': [],
  'aiProvider/filteredProviders': [],
});
const state = reactive({ aiProvider: { providers: [], allModels: {} } });
vi.mock('@/components/UpgradeModal.vue', () => ({ default: { props: ['open'], template: '<div v-if="open" />' } }));
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters, state }) }));

const files = vi.hoisted(() => ({
  getTree: vi.fn(),
  getFile: vi.fn(),
  saveFile: vi.fn(),
  rawFileUrl: vi.fn(() => ''),
}));
vi.mock('@/services/fileSystemService.js', () => files);
vi.mock('@/utils/workspacePath.js', () => ({ getWorkspaceRoot: () => Promise.resolve('C:/ws'), artifactSelectToWorkspacePath: (s) => s.replace(/^artifact:/, '') }));
vi.mock('@/utils/openLocalFile.js', () => ({ openLocalPath: vi.fn() }));

import FocusedLibrary from './FocusedLibrary.vue';
import FocusedAgentEditor from './FocusedAgentEditor.vue';
import FocusedAssetEditor from './FocusedAssetEditor.vue';
import FocusedFiles from './FocusedFiles.vue';

const nav = { go: vi.fn(), ask: vi.fn(), toast: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)), prompt: vi.fn(), studio: vi.fn(), openScreen: vi.fn() };
const global = {
  provide: { focusedNav: nav },
  directives: { tooltip: {} },
  stubs: { CustomSelect: true, CustomWidgetRenderer: true, FocusedParamField: true, MarketplaceShelf: true, PdfFrame: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  files.getTree.mockResolvedValue({ items: [{ name: 'a.md', path: 'reports/a.md', type: 'file' }] });
  files.saveFile.mockResolvedValue({});
});

async function nameAndSave(w, name) {
  await w.find('.focused-inline-title').setValue(name);
  await w.find('.focused-save-bar .focused-primary').trigger('click');
  await flushPromises();
}

describe('Library New', () => {
  it.each(['agents', 'workflows', 'tools', 'skills', 'widgets'])('New on %s opens the blank editor, not the chat', async (tab) => {
    const w = mount(FocusedLibrary, { props: { location: { page: 'library', tab, item: null } }, global: { ...global, stubs: { ...global.stubs, FocusedAgentEditor: true, FocusedAssetEditor: true } } });
    await w.find('.focused-page-head .focused-primary').trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'library', tab, isNew: true });
    expect(nav.ask).not.toHaveBeenCalled();
    w.unmount();
  });

  it('a new location renders the editor with no id', () => {
    const stubs = { ...global.stubs, FocusedAgentEditor: true, FocusedAssetEditor: true };
    const a = mount(FocusedLibrary, { props: { location: { page: 'library', tab: 'agents', item: null, isNew: true } }, global: { ...global, stubs } });
    expect(a.findComponent(FocusedAgentEditor).exists()).toBe(true);
    expect(a.findComponent(FocusedAgentEditor).props('agentId')).toBeNull();
    a.unmount();
    const t = mount(FocusedLibrary, { props: { location: { page: 'library', tab: 'tools', item: null, isNew: true } }, global: { ...global, stubs } });
    expect(t.findComponent(FocusedAssetEditor).props()).toMatchObject({ kind: 'tools', itemId: null });
    t.unmount();
  });
});

describe('new agent', () => {
  it('starts blank, creates on Save, then opens the new agent', async () => {
    const w = mount(FocusedAgentEditor, { props: { agentId: null }, global });
    await flushPromises();
    expect(w.find('.focused-inline-title').element.value).toBe('');
    expect(w.text()).not.toContain('Delete agent');
    expect(w.text()).not.toContain('Edit in chat');
    expect(w.find('.focused-save-bar').exists()).toBe(false); // nothing to save yet
    await nameAndSave(w, '  Scout ');
    expect(dispatch).toHaveBeenCalledWith('agents/createAgent', expect.objectContaining({ name: 'Scout', status: 'ACTIVE', toolAccessMode: 'restricted', assignedTools: [] }));
    expect(dispatch).not.toHaveBeenCalledWith('agents/updateAgent', expect.anything());
    expect(nav.go).toHaveBeenCalledWith({ page: 'library', tab: 'agents', item: 'a-new' });
    expect(nav.ask).not.toHaveBeenCalled();
    w.unmount();
  });

  it('needs a name, and says so', async () => {
    const w = mount(FocusedAgentEditor, { props: { agentId: null }, global });
    await flushPromises();
    await nameAndSave(w, ' x');
    await w.find('.focused-inline-title').setValue('   ');
    await w.find('.focused-save-bar .focused-primary').trigger('click');
    expect(w.text()).toContain('Give the agent a name.');
    w.unmount();
  });

  it('a failed create stays on the form with the reason', async () => {
    dispatch.mockImplementationOnce(() => Promise.reject(new Error('HTTP error! status: 500')));
    const w = mount(FocusedAgentEditor, { props: { agentId: null }, global });
    await flushPromises();
    await nameAndSave(w, 'Scout');
    expect(w.text()).toContain('Couldn’t save. HTTP error! status: 500');
    expect(nav.go).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('new workflow / tool / skill / widget', () => {
  it.each([
    ['workflows', 'workflows/createWorkflow', { name: 'Digest', nodes: [], edges: [] }, 'w-new'],
    ['tools', 'tools/createTool', { title: 'Digest', base: 'AI' }, 't-new'],
    ['skills', 'skills/createSkill', { name: 'Digest', category: 'general' }, 's-new'],
    ['widgets', 'widgetDefinitions/createDefinition', { name: 'Digest', widget_type: 'html' }, 'cw_new'],
  ])('%s: blank, created on Save, then opened', async (kind, action, body, id) => {
    const w = mount(FocusedAssetEditor, { props: { kind, itemId: null }, global });
    await flushPromises();
    expect(w.find('.focused-inline-title').element.value).toBe('');
    expect(w.text()).not.toMatch(/Delete|Open full editor|Edit in chat/);
    await nameAndSave(w, 'Digest');
    expect(dispatch).toHaveBeenCalledWith(action, expect.objectContaining(body));
    expect(nav.go).toHaveBeenCalledWith({ page: 'library', tab: kind, item: id });
    expect(nav.ask).not.toHaveBeenCalled();
    w.unmount();
  });

  it('a create that returns no id is an error, not a silent success', async () => {
    dispatch.mockImplementationOnce(() => Promise.resolve(null));
    const w = mount(FocusedAssetEditor, { props: { kind: 'widgets', itemId: null }, global });
    await flushPromises();
    await nameAndSave(w, 'Digest');
    expect(w.text()).toContain('AGNT didn’t return the new item.');
    expect(nav.go).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('New file', () => {
  const mountFiles = () => mount(FocusedFiles, { props: { dir: 'reports', file: '' }, global });

  it('asks for a name, creates it in this folder, and opens it', async () => {
    nav.prompt.mockResolvedValueOnce('plan.md');
    const w = mountFiles();
    await flushPromises();
    await w.find('.focused-page-head .focused-primary').trigger('click');
    await flushPromises();
    expect(nav.prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'New file', message: 'In reports' }));
    expect(files.saveFile).toHaveBeenCalledWith('reports/plan.md', '');
    expect(nav.go).toHaveBeenCalledWith({ page: 'library', tab: 'files', item: 'reports/plan.md' });
    expect(nav.ask).not.toHaveBeenCalled();
    w.unmount();
  });

  it('never overwrites a file that is already there', async () => {
    nav.prompt.mockResolvedValueOnce('a.md');
    const w = mountFiles();
    await flushPromises();
    await w.find('.focused-page-head .focused-primary').trigger('click');
    await flushPromises();
    expect(files.saveFile).not.toHaveBeenCalled();
    expect(nav.toast).toHaveBeenCalledWith('“a.md” already exists here.');
    w.unmount();
  });

  it('cancel does nothing', async () => {
    nav.prompt.mockResolvedValueOnce(null);
    const w = mountFiles();
    await flushPromises();
    await w.find('.focused-page-head .focused-primary').trigger('click');
    await flushPromises();
    expect(files.saveFile).not.toHaveBeenCalled();
    expect(nav.go).not.toHaveBeenCalled();
    w.unmount();
  });
});
