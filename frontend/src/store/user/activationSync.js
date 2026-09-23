/** Companion to the existing signed-in stats sync. Only milestone IDs/times are sent, never task content. */
export async function syncActivation({ axios, baseUrl, token, storage, navigator, logger = console }) {
  if (!token || navigator?.doNotTrack === '1') return { skipped:true };
  try {
    if (storage.getItem('agnt_analytics_opt_out') === '1') return { skipped:true };
    const response = await axios.post(`${baseUrl}/users/activation-sync`, { enabled:true }, {
      headers: { Authorization:`Bearer ${token}` }, timeout:28000,
    });
    return response.data;
  } catch (error) {
    logger.warn('[activation-sync] Deferred until the next stats sync:', error.message);
    return { deferred:true };
  }
}
