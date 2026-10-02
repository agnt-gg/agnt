// #91: a confirmation left focus on the button BEHIND it, so Enter re-clicked
// that button (reopening the dialog), Tab walked the page underneath and
// Escape did nothing. Every confirm in the app goes through SimpleModal (and
// Focused's nav.confirm), so the keyboard contract lives here.
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SimpleModal from './SimpleModal.vue';

let wrapper;
let trigger;
afterEach(() => { wrapper?.unmount(); trigger?.remove(); document.body.innerHTML = ''; });

async function open(options) {
  trigger = document.createElement('button');
  trigger.textContent = 'trash';
  document.body.appendChild(trigger);
  trigger.focus();
  wrapper = mount(SimpleModal, { attachTo: document.body });
  const answer = wrapper.vm.showModal(options);
  await nextTick();
  await nextTick();
  // Wrapped: an async function returning the bare promise would adopt it,
  // and `await open()` would wait for the dialog to close.
  return { answer };
}
const buttons = () => [...document.querySelectorAll('.modal-actions button')];
const key = (k, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
const label = () => document.activeElement?.textContent.trim();

const DELETE_CHAT = { title: 'Delete Chat', message: 'Sure?', confirmText: 'Delete', cancelText: 'Cancel', confirmClass: 'btn-danger' };

describe('confirmation keyboard', () => {
  it('a destructive confirmation opens with Cancel focused, not the button behind it', async () => {
    await open(DELETE_CHAT);
    expect(label()).toBe('Cancel');
  });

  it('a non-destructive confirmation opens with its confirm button focused', async () => {
    await open({ title: 'Saved', message: 'Done', confirmText: 'OK' });
    expect(label()).toBe('OK');
  });

  it('Enter on the focused Cancel cancels', async () => {
    const { answer } = await open(DELETE_CHAT);
    document.activeElement.click(); // Enter on a focused button is a native click
    expect(await answer).toBe(null);
  });

  it('arrow keys move between the buttons and Delete confirms', async () => {
    const { answer } = await open(DELETE_CHAT);
    key('ArrowLeft');
    expect(label()).toBe('Delete');
    key('ArrowRight');
    expect(label()).toBe('Cancel');
    key('ArrowLeft');
    document.activeElement.click();
    expect(await answer).toBe(true);
  });

  it('Escape cancels', async () => {
    const { answer } = await open(DELETE_CHAT);
    key('Escape');
    expect(await answer).toBe(null);
  });

  it('Tab stays inside the dialog', async () => {
    await open(DELETE_CHAT);
    const [del, cancel] = buttons();
    cancel.focus();
    key('Tab');
    expect(document.activeElement).toBe(del);
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('focus goes back to what opened it when it closes', async () => {
    const { answer } = await open(DELETE_CHAT);
    key('Escape');
    await answer;
    await nextTick();
    expect(document.activeElement).toBe(trigger);
  });

  it('a closed dialog ignores keys', async () => {
    const { answer } = await open(DELETE_CHAT);
    key('Escape');
    await answer;
    trigger.focus();
    expect(() => key('Escape')).not.toThrow();
    expect(document.activeElement).toBe(trigger);
  });
});
