import {
  describe,
  it,
  expect,
  vi,
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
  nextTick
} from 'vue';
import ArtifactInspector from './ArtifactInspector.vue';
import ArtifactCards from './ArtifactCards.vue';
import ChatPanel from '@/views/Terminal/RightPanel/types/ChatPanel/ChatPanel.vue';
vi.mock('@/utils/openLocalFile.js', () => ({
  openLocalPath: vi.fn()
}));
vi.mock('@/utils/markdownPipeline.js', () => ({
  renderMarkdown: s => '<p>' + s + '</p>'
}));
const wrappers = [];
afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount());
  vi.unstubAllGlobals()
});

function render(artifact) {
  const w = mount(ArtifactInspector, {
    props: {
      artifact
    }
  });
  wrappers.push(w);
  return w
}

function store() {
  return createStore({
    modules: {
      shell: {
        namespaced: true,
        state: () => ({
          inspect: null
        }),
        getters: {
          inspect: s => s.inspect
        },
        mutations: {
          set(s, v) {
            s.inspect = v
          }
        },
        actions: {
          inspect({
            commit
          }, v) {
            commit('set', v)
          },
          clearInspect({
            commit
          }) {
            commit('set', null)
          }
        }
      }
    },
    state: {
      chat: {},
      agents: {
        agents: []
      },
      workflows: {
        workflows: []
      },
      goals: {
        goals: []
      }
    }
  })
}
describe('real card → existing inspector integration', () => {
  it('cards dispatch actual payload without navigating the conversation', async () => {
    const s = store();
    const card = mount(ArtifactCards, {
      props: {
        content: '```csv\nname,value\nA,7\n```',
        messageId: 'm1'
      },
      global: {
        plugins: [s]
      }
    });
    wrappers.push(card);
    await card.find('button').trigger('click');
    expect(s.getters['shell/inspect']).toMatchObject({
      kind: 'artifact',
      screen: 'ChatScreen',
      payload: {
        kind: 'csv',
        source: 'name,value\nA,7\n'
      }
    });
    const panel = mount(ChatPanel, {
      global: {
        plugins: [s],
        directives: {
          tooltip: {}
        }
      }
    });
    wrappers.push(panel);
    expect(panel.find('table').text()).toContain('A');
    expect(panel.find('table').text()).toContain('7');
    await panel.find('[aria-label="Close artifact preview"]').trigger('click');
    expect(s.getters['shell/inspect']).toBeNull()
  });
  it('HTML preview isolates scripts from the app origin', () => {
    const w = render({
      id: 'h',
      name: 'Page',
      kind: 'html',
      source: '<h1>Hi</h1>'
    });
    expect(w.find('iframe').attributes('sandbox')).toBe('allow-scripts');
    expect(w.find('iframe').attributes('srcdoc')).toContain('Hi')
  });
  it('markdown uses sanitization before HTML insertion', () => {
    const w = render({
      id: 'm',
      kind: 'markdown',
      source: '<img onerror="bad()"><script>bad()</script>'
    });
    expect(w.html()).not.toContain('onerror');
    expect(w.find('script').exists()).toBe(false)
  });
  it('fetches a valid small-file range after the one-byte probe', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 206,
      headers: new Headers({
        'Content-Range': 'bytes 0-0/7'
      }),
      body: {
        cancel: vi.fn()
      }
    }).mockResolvedValueOnce({
      ok: true,
      status: 206,
      text: async () => 'a,b\n1,2'
    });
    vi.stubGlobal('fetch', fetch);
    const w = render({
      id: 'c',
      name: 'a.csv',
      kind: 'csv',
      href: 'file:///C:/a.csv'
    });
    await flushPromises();
    expect(fetch.mock.calls[1][1].headers.Range).toBe('bytes=0-6');
    expect(w.find('table').text()).toContain('2')
  });
  it('does not put an HTTP error body into the preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers()
    }));
    const w = render({
      name: 'secret.txt',
      kind: 'text',
      href: 'file:///C:/secret.txt'
    });
    await flushPromises();
    expect(w.find('[role=alert]').text()).toContain('access');
    expect(w.find('pre').exists()).toBe(false)
  });
  it('ignores stale asynchronous content after a different file is selected', async () => {
    let resolveOld;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise(r => resolveOld = r)));
    const w = render({
      id: 'old',
      name: 'old.md',
      kind: 'markdown',
      href: 'file:///C:/old.md'
    });
    await w.setProps({
      artifact: {
        id: 'new',
        name: 'new',
        kind: 'text',
        source: 'new content'
      }
    });
    resolveOld({
      ok: true,
      status: 206,
      headers: new Headers(),
      body: {
        cancel: vi.fn()
      }
    });
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('new content');
    expect(w.text()).not.toContain('old.md')
  });
});
