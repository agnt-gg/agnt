import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TermsPrivacyModal from './TermsPrivacyModal.vue';

const heading = (wrapper) => wrapper.find('.content-section h3, .content-section h1').text();

describe('TermsPrivacyModal', () => {
  it('opens on the tab it was asked for, even after an earlier open on another tab', async () => {
    // The modal stays mounted between opens. Before the fix, activeTab was captured once at
    // setup, so a "Privacy Policy" link opened on whichever tab had been used before.
    const wrapper = mount(TermsPrivacyModal, { props: { show: false, defaultTab: 'terms' } });

    await wrapper.setProps({ show: true, defaultTab: 'terms' });
    expect(heading(wrapper)).toBe('Terms of Service');

    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true, defaultTab: 'privacy' });
    expect(heading(wrapper)).toBe('Privacy Manifesto');
  });

  it('renders the repository LICENSE.md, not a hard-coded license', async () => {
    const wrapper = mount(TermsPrivacyModal, { props: { show: true, defaultTab: 'license' } });

    await vi.waitFor(() => {
      expect(wrapper.find('.license-text h1').exists()).toBe(true);
    });

    const license = wrapper.find('.license-text');
    expect(license.find('h1').text()).toBe('AGNT Community Core License');
    // The can/can't summary table must render as a real table, not raw pipes.
    expect(license.find('table').exists()).toBe(true);
    expect(license.text()).toContain('AGNT GG, Inc.');
    expect(license.text()).toContain('Certified Partner');
    expect(wrapper.text()).not.toContain('Genesis Epoch');
    expect(wrapper.text()).not.toContain('AGNT Master License Agreement');
  });
});
