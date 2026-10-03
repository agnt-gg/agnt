/**
 * Client for Text Annie (Settings -> Phone Access): `/api/agnt-services/mobile/*`,
 * which proxies mobile.agnt.gg with this install's own session.
 */
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

const auth = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const base = () => `${API_CONFIG.BASE_URL}/agnt-services/mobile`;

export async function getStatus() {
  return (await axios.get(`${base()}/status`, { headers: auth() })).data;
}
export async function addPhone(number, route) {
  return (await axios.post(`${base()}/phones`, { number, route }, { headers: auth() })).data;
}
export async function newCode(phoneId) {
  return (await axios.post(`${base()}/phones/${encodeURIComponent(phoneId)}/code`, {}, { headers: auth() })).data;
}
export async function setRoute(phoneId, route) {
  return (await axios.put(`${base()}/phones/${encodeURIComponent(phoneId)}`, { route }, { headers: auth() })).data;
}
export async function removePhone(phoneId) {
  return (await axios.delete(`${base()}/phones/${encodeURIComponent(phoneId)}`, { headers: auth() })).data;
}

/**
 * What the linking QR code encodes: the standard SMS form, `SMSTO:<line>:<code>`.
 * iPhone and Android cameras recognise it natively and open Messages with the
 * code typed in. A web link that redirects into Messages does not survive the
 * camera on iOS, and Android drops its `&body=`; it is also ~3x longer, which
 * makes a denser code that a camera struggles to read off a laptop screen.
 * Null when the line is unknown (the number and code are still on screen).
 */
export function linkQrPayload(line, code) {
  if (!/^\+[1-9]\d{6,14}$/.test(line || '') || !/^AGNT-[A-Z2-9]{6}$/.test(code || '')) return null;
  return `SMSTO:${line}:${code}`;
}

/** One sentence for any failure: the service's own message when it gave one. */
export function explain(error) {
  const data = error?.response?.data;
  if (data?.message) return data.message;
  if (data?.reason === 'hosting_required') return 'Texting needs AGNT Mobile: included with paid AGNT plans, or $5/month at mobile.agnt.gg.';
  if (typeof data?.error === 'string' && !/^[a-z_]+$/.test(data.error)) return data.error;
  if (error?.response?.status === 401) return 'Sign in to AGNT to text Annie.';
  if (!error?.response) return 'Could not reach AGNT. Check your connection and try again.';
  return (data?.reason || data?.error || 'Something went wrong').replaceAll('_', ' ');
}
