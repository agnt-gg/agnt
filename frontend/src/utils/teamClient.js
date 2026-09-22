import { API_CONFIG } from '@/tt.config.js';

/** One request shape for every team call: bearer auth, JSON, and the server's own error text. */
async function call(prefix, path, options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + prefix + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || result.reason || 'Team request failed'), { status: response.status, code: result.code });
  return result;
}
export const teamRequest = (path, options) => call('/teams', path, options);
export const tenantRequest = (path, options) => call('/tenants', path, options);
/** Copy to team / copy to personal. Always the personal backend; see backend ShareRoutes.js. */
export const shareRequest = (path, options) => call('/share', path, options);
export const PROVIDER_NAMES = Object.freeze({ agnt: 'AGNT', openai: 'OpenAI', anthropic: 'Anthropic', github: 'GitHub', groq: 'Groq', deepseek: 'DeepSeek', grokai: 'Grok', openrouter: 'OpenRouter', google: 'Google', gemini: 'Gemini', slack: 'Slack', discord: 'Discord', stripe: 'Stripe', dropbox: 'Dropbox', twitter: 'X', youtube: 'YouTube', firecrawl: 'Firecrawl' });
export const providerName = id => PROVIDER_NAMES[id] || id;
const body = value => JSON.stringify(value);

export const ROLES = Object.freeze([
  { value: 'member', label: 'Member', hint: 'Build and run in every project' },
  { value: 'admin', label: 'Admin', hint: 'Everything a member can do, plus people and access' },
  { value: 'viewer', label: 'Guest', hint: 'Can look, cannot change or run' },
]);
export const roleLabel = role => (role === 'owner' ? 'Owner' : ROLES.find(r => r.value === role)?.label || role || 'No access');

/** Re-apply everyone's role to every project. Idempotent. */
export const syncAccess = teamId => teamRequest('/' + teamId + '/access/sync', { method: 'POST', body: '{}' });

/**
 * Adding a person is ONE grant: a seat on the instance and a place on the team.
 * Uses the cloud's single atomic endpoint when it exists; until then it performs
 * the two grants and undoes the seat if the team grant fails, so nobody is left
 * able to sign in but unable to see anything.
 */
export async function addPerson(team, { email, role }) {
  const normalized = email.trim().toLowerCase();
  try {
    return await teamRequest('/' + team.id + '/people', { method: 'POST', body: body({ email: normalized, role }) });
  } catch (error) {
    if (error.status !== 404 || error.code) throw error;
  }
  const seated = await tenantRequest('/' + team.tenantSlug + '/members', { method: 'POST', body: body({ email: normalized, role: role === 'admin' ? 'admin' : 'member' }) });
  if (!seated.userId) return seated;
  try {
    await teamRequest('/' + team.id + '/members', { method: 'POST', body: body({ userId: seated.userId, role }) });
  } catch (error) {
    await tenantRequest('/' + team.tenantSlug + '/members/' + encodeURIComponent(seated.userId), { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  await syncAccess(team.id).catch(error => console.warn('[team] access sync after add:', error.message));
  return seated;
}

/** Removing a person revokes both grants. Team first: losing the seat alone would strand their membership. */
export async function removePerson(team, userId) {
  try {
    await teamRequest('/' + team.id + '/people/' + encodeURIComponent(userId), { method: 'DELETE' });
    return;
  } catch (error) {
    if (error.status !== 404 || error.code) throw error;
  }
  await teamRequest('/' + team.id + '/members/' + encodeURIComponent(userId), { method: 'DELETE' }).catch(error => { if (error.status !== 404) throw error; });
  await tenantRequest('/' + team.tenantSlug + '/members/' + encodeURIComponent(userId), { method: 'DELETE' });
}

export async function changeRole(team, userId, role) {
  await teamRequest('/' + team.id + '/members/' + encodeURIComponent(userId), { method: 'PATCH', body: body({ role }) });
  await syncAccess(team.id);
}
