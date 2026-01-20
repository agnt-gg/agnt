import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory, RouterLink } from 'vue-router';
import { createStore } from 'vuex';
import LeftSidebar from './LeftSidebar.vue';

// Create a mock router
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'Dashboard', component: { template: '<div>Dashboard</div>' } },
    { path: '/workflow-designer', name: 'WorkflowDesigner', component: { template: '<div>Workflow Designer</div>' } },
    { path: '/tool-forge', name: 'ToolForge', component: { template: '<div>Tool Forge</div>' } },
    { path: '/chat', name: 'Chat', component: { template: '<div>Chat</div>' } },
    { path: '/marketplace', name: 'Marketplace', component: { template: '<div>Marketplace</div>' } },
    { path: '/docs', name: 'Documentation', component: { template: '<div>Documentation</div>' } },
    { path: '/settings', name: 'Settings', component: { template: '<div>Settings</div>' } },
  ],
});

// Create a mock Vuex store
const createMockStore = () => {
  return createStore({
    modules: {
      userAuth: {
        namespaced: true,
        state: {
          isAuthenticated: true,
        },
        getters: {
          isAuthenticated: (state) => state.isAuthenticated,
        },
      },
    },
  });
};

describe('LeftSidebar', () => {
  it('mounts without crashing', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
      },
    });
    expect(wrapper.exists()).toBe(true);
  });

  it('contains the correct number of navigation links', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
        stubs: {
          RouterLink: RouterLink,
        },
      },
    });
    const navLinks = wrapper.findAllComponents(RouterLink);
    expect(navLinks).toHaveLength(7); // 7 RouterLinks in the component (including marketplace)
  });

  it('has the correct links in the top navigation', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
        stubs: {
          RouterLink: RouterLink,
        },
      },
    });
    const topNav = wrapper.find('.left-sidebar-top-nav');
    const topNavLinks = topNav.findAllComponents(RouterLink);

    expect(topNavLinks).toHaveLength(5);
    expect(topNavLinks[0].props('to')).toBe('/');
    expect(topNavLinks[1].props('to')).toBe('/workflow-designer');
    expect(topNavLinks[2].props('to')).toBe('/tool-forge');
    expect(topNavLinks[3].props('to')).toBe('/chat');
    expect(topNavLinks[4].props('to')).toBe('/marketplace');
  });

  it('has the correct links in the bottom navigation', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
        stubs: {
          RouterLink: RouterLink,
        },
      },
    });
    const bottomNav = wrapper.find('.left-sidebar-bottom-nav');
    const bottomNavLinks = bottomNav.findAllComponents(RouterLink);

    expect(bottomNavLinks).toHaveLength(2);
    expect(bottomNavLinks[0].props('to')).toBe('/docs');
    expect(bottomNavLinks[1].props('to')).toBe('/settings');
  });

  it('applies the correct CSS classes', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
      },
    });
    expect(wrapper.attributes('id')).toBe('left-sidebar');
    expect(wrapper.find('.left-sidebar-top-nav').exists()).toBe(true);
    expect(wrapper.find('.left-sidebar-bottom-nav').exists()).toBe(true);
  });

  it('renders SVG icons for each link', () => {
    const store = createMockStore();
    const wrapper = mount(LeftSidebar, {
      global: {
        plugins: [router, store],
      },
    });
    const svgIcons = wrapper.findAll('svg.svg-icon');
    expect(svgIcons).toHaveLength(7); // One SVG icon for each link (including marketplace)
  });
});
