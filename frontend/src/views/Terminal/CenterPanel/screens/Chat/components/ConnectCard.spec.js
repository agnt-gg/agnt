import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const connection = {
  isProviderConnected: vi.fn(),
  fetchProviderDetails: vi.fn(),
  handleProviderToggle: vi.fn(),
};
vi.mock('@/composables/useProviderConnection.js', () => ({ useProviderConnection: () => connection }));

import ConnectCard from './ConnectCard.vue';

const mountCard = (provider) => mount(ConnectCard, { props: { provider }, global: { stubs: { SimpleModal: true } } });

describe('ConnectCard', () => {
  beforeEach(() => {
    connection.isProviderConnected.mockReset().mockReturnValue(false);
    connection.fetchProviderDetails.mockReset();
    connection.handleProviderToggle.mockReset().mockResolvedValue(undefined);
  });

  it('offers Connect for an app AGNT can connect, under its catalog name', async () => {
    connection.fetchProviderDetails.mockResolvedValue({ id: 'google-calendar', name: 'Google Calendar' });
    const wrapper = mountCard('google-calendar');
    await flushPromises();
    expect(wrapper.find('.connect-card-name').text()).toBe('Google Calendar');
    await wrapper.find('.connect-card-button').trigger('click');
    expect(connection.handleProviderToggle).toHaveBeenCalledWith('google-calendar');
  });

  it('draws nothing for an app AGNT has no connection for (seen live: Pipedrive)', async () => {
    connection.fetchProviderDetails.mockResolvedValue(undefined);
    const wrapper = mountCard('pipedrive');
    await flushPromises();
    expect(wrapper.find('.connect-card').exists()).toBe(false);
  });

  it('draws nothing while the catalog is still answering', () => {
    connection.fetchProviderDetails.mockReturnValue(new Promise(() => {}));
    expect(mountCard('slack').find('.connect-card').exists()).toBe(false);
  });

  it('shows Connected, never a button, for an app that is already connected', async () => {
    connection.isProviderConnected.mockReturnValue(true);
    const wrapper = mountCard('slack');
    await flushPromises();
    expect(wrapper.find('.connect-card-status').text()).toContain('Connected');
    expect(wrapper.find('.connect-card-button').exists()).toBe(false);
    expect(connection.fetchProviderDetails).not.toHaveBeenCalled();
  });

  it('says so when the connection fails, and can be tried again', async () => {
    connection.fetchProviderDetails.mockResolvedValue({ id: 'notion', name: 'Notion' });
    connection.handleProviderToggle.mockRejectedValueOnce(new Error('popup blocked'));
    const wrapper = mountCard('notion');
    await flushPromises();
    await wrapper.find('.connect-card-button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.connect-card-status.is-error').text()).toBe('Could not connect. Try again.');
    expect(wrapper.find('.connect-card-button').attributes('disabled')).toBeUndefined();
  });
});
