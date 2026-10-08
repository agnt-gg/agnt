/**
 * Linking a phone to Text Annie. Reported 2026-10-08: the pending phone's
 * "Finish linking" button actually asked the service for a NEW code, which
 * silently killed the code the person had been shown and might already have
 * texted. And because the service only stores a hash, leaving Settings lost
 * the code, so that button was the only way back to one.
 *
 * Now the code you were given comes back as it was, and a new code is asked for
 * by name, with a warning while the old one still works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const getStatus = vi.fn();
const addPhone = vi.fn();
const newCode = vi.fn();
const removePhone = vi.fn();

vi.mock('@/services/textAnnieService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getStatus: (...a) => getStatus(...a),
  addPhone: (...a) => addPhone(...a),
  newCode: (...a) => newCode(...a),
  removePhone: (...a) => removePhone(...a),
  setRoute: vi.fn(),
}));
vi.mock('@/utils/qrcode.js', () => ({ toSvg: () => '<svg id="stub-qr"></svg>' }));

import TextAnnieCard from './TextAnnieCard.vue';

const LINE = '+16465792868';
const NUMBER = '+14705550123';
const pendingPhone = (codeExpiresAt) => ({ id: 'phone-1', number: NUMBER, state: 'pending', route: 'desktop', line: LINE, codeExpiresAt });
const status = (phones) => ({
  phones,
  targets: [{ target: 'desktop', online: true }],
  instances: [],
  plan: { eligible: true, maxPhones: 5, planName: 'Business', remainingUnits: 10, includedUnits: 10 },
  linking: true,
  instance: 'desktop',
});

const mountCard = async () => {
  const wrapper = mount(TextAnnieCard, {
    global: { stubs: { CustomSelect: true }, directives: { tooltip: {} } },
  });
  await flushPromises();
  return wrapper;
};
const buttons = (wrapper) => wrapper.findAll('button').map((b) => b.text());
const shownCode = (wrapper) => wrapper.find('.ta-code').exists() ? wrapper.find('.ta-code').text() : null;

beforeEach(() => {
  sessionStorage.clear();
  [getStatus, addPhone, newCode, removePhone].forEach((fn) => fn.mockReset());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('the code you were given', () => {
  it('is still shown after leaving Settings and coming back, without asking for a new one', async () => {
    const expires = Date.now() + 30 * 60_000;
    getStatus.mockResolvedValue(status([]));
    addPhone.mockResolvedValue({ phone: pendingPhone(expires), code: 'AGNT-K7Q2XM' });
    const first = await mountCard();
    await first.find('input[type="tel"]').setValue(NUMBER);
    await first.find('form').trigger('submit');
    await flushPromises();
    expect(shownCode(first)).toBe('AGNT-K7Q2XM');
    first.unmount();

    getStatus.mockResolvedValue(status([pendingPhone(expires)]));
    const second = await mountCard();
    expect(shownCode(second)).toBe('AGNT-K7Q2XM');
    expect(newCode).not.toHaveBeenCalled();
    second.unmount();
  });

  it('is offered as "Show code", which reopens the SAME code', async () => {
    const expires = Date.now() + 30 * 60_000;
    sessionStorage.setItem('agnt.textAnnie.linkCodes', JSON.stringify({ 'phone-1': { code: 'AGNT-K7Q2XM', expiresAt: expires } }));
    getStatus.mockResolvedValue(status([pendingPhone(expires)]));
    const w = await mountCard();
    expect(buttons(w)).toContain('Show code');
    await w.findAll('button').find((b) => b.text() === 'Show code').trigger('click');
    expect(shownCode(w)).toBe('AGNT-K7Q2XM');
    expect(newCode).not.toHaveBeenCalled();
    w.unmount();
  });

  it('is not shown once a different code was issued elsewhere', async () => {
    // mobile.agnt.gg can issue a new code; the remembered one is then dead.
    const old = Date.now() + 10 * 60_000;
    sessionStorage.setItem('agnt.textAnnie.linkCodes', JSON.stringify({ 'phone-1': { code: 'AGNT-K7Q2XM', expiresAt: old } }));
    getStatus.mockResolvedValue(status([pendingPhone(old + 60_000)]));
    const w = await mountCard();
    expect(shownCode(w)).toBeNull();
    expect(buttons(w)).toContain('Get new code');
    w.unmount();
  });

  it('is forgotten once the phone finishes linking', async () => {
    const expires = Date.now() + 30 * 60_000;
    sessionStorage.setItem('agnt.textAnnie.linkCodes', JSON.stringify({ 'phone-1': { code: 'AGNT-K7Q2XM', expiresAt: expires } }));
    getStatus.mockResolvedValue(status([{ ...pendingPhone(null), state: 'active' }]));
    const w = await mountCard();
    expect(shownCode(w)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('agnt.textAnnie.linkCodes'))).toEqual({});
    w.unmount();
  });
});

describe('asking for a new code', () => {
  it('never hides behind "Finish linking"', async () => {
    getStatus.mockResolvedValue(status([pendingPhone(Date.now() + 60_000)]));
    const w = await mountCard();
    expect(w.text()).not.toMatch(/finish linking/i);
    w.unmount();
  });

  it('warns while the old code still works, and does nothing if you cancel', async () => {
    window.confirm.mockReturnValue(false);
    getStatus.mockResolvedValue(status([pendingPhone(Date.now() + 20 * 60_000)]));
    const w = await mountCard();
    await w.findAll('button').find((b) => b.text() === 'Get new code').trigger('click');
    await flushPromises();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/current code stops working/i));
    expect(newCode).not.toHaveBeenCalled();
    w.unmount();
  });

  it('issues and shows the new code when you confirm', async () => {
    const expires = Date.now() + 30 * 60_000;
    getStatus.mockResolvedValue(status([pendingPhone(Date.now() + 20 * 60_000)]));
    newCode.mockResolvedValue({ phone: pendingPhone(expires), code: 'AGNT-NEW234' });
    const w = await mountCard();
    await w.findAll('button').find((b) => b.text() === 'Get new code').trigger('click');
    await flushPromises();
    expect(newCode).toHaveBeenCalledWith('phone-1');
    expect(shownCode(w)).toBe('AGNT-NEW234');
    w.unmount();
  });

  it('does not ask when the old code has already expired', async () => {
    getStatus.mockResolvedValue(status([pendingPhone(Date.now() - 1000)]));
    newCode.mockResolvedValue({ phone: pendingPhone(Date.now() + 30 * 60_000), code: 'AGNT-NEW234' });
    const w = await mountCard();
    await w.findAll('button').find((b) => b.text() === 'Get new code').trigger('click');
    await flushPromises();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(newCode).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('is offered right in the panel once the shown code expires', async () => {
    const expires = Date.now() + 30 * 60_000;
    sessionStorage.setItem('agnt.textAnnie.linkCodes', JSON.stringify({ 'phone-1': { code: 'AGNT-K7Q2XM', expiresAt: expires } }));
    getStatus.mockResolvedValue(status([pendingPhone(expires)]));
    const w = await mountCard();
    expect(w.find('.ta-link-panel').text()).not.toContain('Get new code');

    w.vm.$.setupState.now = expires + 1;
    await flushPromises();
    const panel = w.find('.ta-link-panel');
    expect(panel.text()).toContain('code expired');
    expect(panel.findAll('button').map((b) => b.text())).toContain('Get new code');
    w.unmount();
  });
});
