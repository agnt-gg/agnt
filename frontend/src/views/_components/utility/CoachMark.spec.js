import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CoachMark from './CoachMark.vue';

const view = (overrides = {}) => ({
  key: 'k1',
  eyebrow: 'Mission',
  title: 'Do the thing',
  content: 'Here is how.',
  actions: [{ id: 'next', label: 'Next', primary: true }],
  ...overrides,
});

/** jsdom lays nothing out; give one element a real box. */
function placeTarget(id, rect = { top: 300, left: 400, width: 120, height: 40 }) {
  const element = document.createElement('button');
  element.id = id;
  document.body.appendChild(element);
  element.getClientRects = () => [rect];
  element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  return element;
}

let wrapper;
const card = () => document.body.querySelector('[data-coach-popup]');

describe('CoachMark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.innerWidth = 1280;
    window.innerHeight = 800;
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('keeps invitations compact until opened and allows minimizing without a blackout', async () => {
    placeTarget('invitation');
    wrapper = mount(CoachMark, { props: { view: view({ compact: true, target: '#invitation' }) }, attachTo: document.body });
    await vi.advanceTimersByTimeAsync(450); await flushPromises();
    expect(card().classList.contains('coach-collapsed')).toBe(true);
    expect(document.body.querySelector('.coach-ring')).toBeNull();
    expect(card().querySelector('.coach-body')).toBeNull();
    card().querySelector('.coach-expand').click(); await flushPromises();
    expect(card().querySelector('.coach-body')).not.toBeNull();
    expect(document.body.querySelector('.coach-ring-dim')).toBeNull();
    card().querySelector('[aria-label="Minimize guide"]').click(); await flushPromises();
    expect(card().querySelector('.coach-body')).toBeNull();
  });
  it('renders nothing without a view', () => {
    wrapper = mount(CoachMark, { props: { view: null }, attachTo: document.body });
    expect(card()).toBeNull();
  });

  it('a missing target docks the card instead of skipping the step', async () => {
    wrapper = mount(CoachMark, { props: { view: view({ target: '#nowhere', canReturn: true }) }, attachTo: document.body });
    await flushPromises();
    expect(card().classList.contains('coach-docked')).toBe(true);
    expect(card().textContent).toContain('Do the thing');
    // After the grace period it offers to go where the step belongs.
    await vi.advanceTimersByTimeAsync(2000);
    expect(card().textContent).toContain('Take me there');
  });

  it('anchors next to a visible target, spotlights it, and reports clicks on it', async () => {
    const target = placeTarget('here');
    wrapper = mount(CoachMark, { props: { view: view({ target: '#here', placement: 'bottom' }) }, attachTo: document.body });
    await vi.advanceTimersByTimeAsync(450);
    await flushPromises();
    expect(card().classList.contains('coach-docked')).toBe(false);
    expect(document.body.querySelector('.coach-ring')).not.toBeNull();
    target.click();
    expect(wrapper.emitted('target-click')).toHaveLength(1);
  });

  it('skips hidden copies (KeepAlive) and anchors to the visible one', async () => {
    const hidden = document.createElement('div');
    hidden.id = 'twin';
    hidden.getClientRects = () => [];
    document.body.appendChild(hidden);
    const visible = placeTarget('twin-visible');
    visible.className = 'twin';
    hidden.className = 'twin';
    document.body.insertBefore(hidden, visible);
    wrapper = mount(CoachMark, { props: { view: view({ target: '.twin' }) }, attachTo: document.body });
    await vi.advanceTimersByTimeAsync(450);
    await flushPromises();
    expect(card().classList.contains('coach-docked')).toBe(false);
  });

  it('emits actions, prompts and close', async () => {
    wrapper = mount(CoachMark, {
      props: { view: view({ prompts: ['Say hi'], secondary: { id: 'skip', label: 'Skip step' } }) },
      attachTo: document.body,
    });
    await flushPromises();
    const buttons = [...card().querySelectorAll('button')];
    buttons.find((b) => b.textContent.trim() === 'Say hi').click();
    buttons.find((b) => b.textContent.trim() === 'Skip step').click();
    buttons.find((b) => b.textContent.trim() === 'Next').click();
    buttons.find((b) => b.getAttribute('aria-label') === 'Close').click();
    expect(wrapper.emitted('prompt')[0]).toEqual(['Say hi']);
    expect(wrapper.emitted('action').map((args) => args[0])).toEqual(['skip', 'next']);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
