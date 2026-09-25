import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach
} from 'vitest';
import {
  mount,
  flushPromises
} from '@vue/test-utils';
import {
  createStore
} from 'vuex';
import {
  createRouter,
  createMemoryHistory
} from 'vue-router';
import JumpPalette from './JumpPalette.vue';
beforeEach(()=>{localStorage.setItem('token','test-session');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({outputs:[],agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[],items:[],results:[]})})));});
const wrappers = [];
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount());
  document.body.innerHTML = '';vi.unstubAllGlobals();localStorage.clear();
});
async function setup() {
  const store = createStore({
    modules: {
      shell: {
        namespaced: true,
        state: () => ({
          open: false
        }),
        getters: {
          jumpOpen: s => s.open
        },
        mutations: {
          open(s, v) {
            s.open = v
          }
        },
        actions: {
          closeJump({
            commit
          }) {
            commit('open', false)
          }
        }
      }
    },
    getters: {
      'agents/allAgents': () => [{
        id: 'a',
        name: 'Research agent'
      }],
      'goals/allGoals': () => [],
      'workflows/allWorkflows': () => [],
      'contentOutputs/visibleOutputs': () => [],
      'tools/allTools': () => [],
      'skills/allSkills': () => [],
      'widgetLayout/allPages': () => []
    }
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/:pathMatch(.*)*',
      component: {
        template: '<div/>'
      }
    }]
  });
  await router.push('/chat');
  const w = mount(JumpPalette, {
    attachTo: document.body,
    global: {
      plugins: [store, router]
    }
  });
  wrappers.push(w);
  store.commit('shell/open', true);
  await flushPromises();
  return {
    w,
    store,
    router
  }
}
describe('JumpPalette real grid', () => {
  it('opens six categories with saved children collapsed', async () => {
    await setup();
    expect(document.querySelectorAll('.jp-group')).toHaveLength(6);
    // Saved items hide behind the count chip on their page row: no nested
    // disclosure box, nothing expanded until clicked.
    expect(document.querySelectorAll('details')).toHaveLength(0);
    expect(document.querySelectorAll('.jp-child')).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector('input'));
    expect(document.body.textContent).not.toContain('New agent')
  });
  it('opens a page row\'s saved items from its count chip and closes them again', async () => {
    await setup();
    const chip = document.querySelector('.jp-count');
    expect(chip.textContent.trim()).toBe('1');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    chip.click();
    await flushPromises();
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('.jp-child')].map(r => r.textContent)).toEqual([expect.stringContaining('Research agent')]);
    chip.click();
    await flushPromises();
    expect(document.querySelectorAll('.jp-child')).toHaveLength(0);
  });
  it('navigates page directly without command execution', async () => {
    const {
      w
    } = await setup();
    document.querySelector('[data-jump-id="go:WorkflowsScreen"]').click();
    await flushPromises();
    expect(w.emitted('navigate')[0]).toEqual(['WorkflowsScreen', {}])
  });
  it('search finds a resource by category and name', async () => {
    await setup();
    const input = document.querySelector('input');
    input.value = 'research automation';
    input.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    await flushPromises();
    expect(document.querySelector('[data-jump-id="agent:a"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-jump-id]')).toHaveLength(1)
  });
  it('no match drafts to Annie, never silently sends', async () => {
    await setup();
    const fn = vi.fn();
    window.addEventListener('agnt:ask-annie', fn, {
      once: true
    });
    const input = document.querySelector('input');
    input.value = 'unmatched query';
    input.dispatchEvent(new Event('input', {
      bubbles: true
    }));
    await flushPromises();
    document.querySelector('.jp-ask').click();
    await flushPromises();
    expect(fn.mock.calls[0][0].detail).toEqual({
      text: 'unmatched query',
      send: false
    })
  });
});

describe('catalog loading independent of visited screens',()=>{
 it('loads archived conversations on opening and navigates by output ID',async()=>{global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.endsWith('/content-outputs')?{outputs:[{id:'saved-77',conversation_id:'conversation-22',content_type:'conversation',title:'Previous release discussion',archived_at:'2026-01-01'}]}:{agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[]}}));const{router}=await setup();const input=document.querySelector('input');input.value='previous release';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();const row=document.querySelector('[data-jump-id="chat:saved-77"]');expect(row).not.toBeNull();row.click();await flushPromises();expect(router.currentRoute.value.query['content-id']).toBe('saved-77')});
 it('loads tools and skills with empty screen stores',async()=>{global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.includes('/skills/')?{skills:[{id:'sk1',name:'Evidence skill'}]}:url.includes('/custom-tools/')?{tools:[{id:'ct1',name:'Evidence checker'}]}:{outputs:[],agents:[],workflows:[],goals:[],tools:[],widgets:[],plugins:[]}}));await setup();const input=document.querySelector('input');input.value='evidence';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();expect(document.querySelector('[data-jump-id="skill:sk1"]')).not.toBeNull();expect(document.querySelector('[data-jump-id="tool:ct1"]')).not.toBeNull()});
 it('offers the Store when nothing installed matches, and opens it by asset id',async()=>{
  const listing={id:'listing-uuid',asset_id:'agnt-invoice-parser',asset_type:'agent',title:'Invoice Parser',tagline:'Reads invoices',price:0};
  global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.includes('/marketplace/items')?{items:[listing]}:{outputs:[],agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[],results:[]}}));
  const{router}=await setup();
  const input=document.querySelector('input');input.value='invoice parser';input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));await flushPromises();
  const row=document.querySelector('[data-jump-id="store:listing-uuid"]');
  expect(row).not.toBeNull();
  expect(document.body.textContent).toContain('the Store does');
  row.click();await flushPromises();
  expect(router.currentRoute.value.path).toBe('/marketplace');
  expect(router.currentRoute.value.query.item).toBe('agnt-invoice-parser');
 });
 it('never offers the Store while something installed still matches',async()=>{
  const listing={id:'listing-uuid',asset_id:'agnt-research',asset_type:'agent',title:'Research agent',price:0};
  global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.includes('/marketplace/items')?{items:[listing]}:{outputs:[],agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[],results:[]}}));
  await setup();
  // 'Research agent' is in the local store getter, so this query has a match.
  const input=document.querySelector('input');input.value='research';input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));await flushPromises();
  expect(document.querySelector('[data-jump-id="agent:a"]')).not.toBeNull();
  expect(document.querySelector('.jp-store')).toBeNull();
 });
 it('stays quiet about local results when the Store is unreachable',async()=>{
  global.fetch.mockImplementation(async url=>url.includes('/marketplace/items')?{ok:false,status:503}:({ok:true,json:async()=>({outputs:[],agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[],results:[]})}));
  await setup();
  const input=document.querySelector('input');input.value='nothing matches this';input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,300));await flushPromises();
  expect(document.querySelector('.jp-store')).toBeNull();
  expect(document.body.textContent).toContain('the Store could not be reached');
  expect(document.querySelector('.jp-ask')).not.toBeNull();
 });
 it('shows content-only conversation matches returned by history search',async()=>{global.fetch.mockImplementation(async url=>({ok:true,json:async()=>url.includes('/memory/search')?{results:[{kind:'output',id:'out1',title:'Daily conversation',snippet:'the unusual phrase',meta:{content_type:'conversation',conversation_id:'c1'}}]}:{outputs:[],agents:[],workflows:[],goals:[],tools:[],skills:[],widgets:[],plugins:[],items:[]}}));await setup();const input=document.querySelector('input');input.value='unusual phrase';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,300));await flushPromises();expect(document.querySelector('[data-jump-id="chat:out1"]')).not.toBeNull();expect(document.body.textContent).toContain('the unusual phrase')});
});
