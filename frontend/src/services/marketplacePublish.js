/**
 * marketplacePublish — the asset half of a Market publish request.
 *
 * MarketplaceFormModal collects the listing (title, description, category,
 * price, …) and emits it; this module adds what the server needs to rebuild
 * the asset on install. The rules are the ones Studio's publish panels use
 * (AgentsPanel, ToolsPanel, WorkflowsPanel, Skills, MarketplacePanel):
 *
 *   agent    → asset_data: the agent; its avatar is the default preview image
 *   tool     → asset_data: the tool
 *   skill    → asset_data: every field a skill needs to survive the round trip
 *   workflow → workflow_data: the saved workflow, read fresh from the backend
 *
 * Plugins publish from the Plugin Forge (they need their package and a
 * sign-in check), so they are not offered here.
 */
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';

export const PUBLISHABLE_KINDS = Object.freeze(['agent', 'workflow', 'tool', 'skill']);

/** A skill, whole: instructions, allowed tools, license and compatibility included. */
export function skillAssetData(skill) {
  return {
    name: skill.name,
    description: skill.description || '',
    instructions: skill.instructions || '',
    category: skill.category || 'general',
    icon: skill.icon || 'fas fa-graduation-cap',
    license: skill.license || '',
    compatibility: skill.compatibility || '',
    metadata: skill.metadata || {},
    allowedTools: skill.allowedTools ?? skill.allowed_tools ?? [],
  };
}

/** The saved workflow, as the publish endpoint expects it. Throws with the reason. */
export async function fetchWorkflowForPublish(workflowId) {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/workflows/${encodeURIComponent(workflowId)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.workflow) throw new Error(body?.error || `Couldn’t read that workflow (${response.status}).`);
  return body.workflow;
}

/**
 * The full publish request for one item.
 * @param {string} kind  agent | workflow | tool | skill
 * @param {object} item  the item as the library store holds it
 * @param {object} form  what MarketplaceFormModal emitted
 * @param {object} [deps] { loadWorkflow } — injectable for tests
 */
export async function buildPublishRequest(kind, item, form, { loadWorkflow = fetchWorkflowForPublish } = {}) {
  if (!PUBLISHABLE_KINDS.includes(kind)) throw new Error(`A ${kind || 'thing'} can’t be published from here.`);
  if (!item || item.id == null) throw new Error('Choose what to publish first.');
  switch (kind) {
    case 'agent':
      return { ...form, asset_data: item, preview_image: form.preview_image || item.avatar || '' };
    case 'tool':
      return { ...form, asset_data: item };
    case 'skill':
      return { ...form, asset_data: skillAssetData(item) };
    case 'workflow':
      return { ...form, workflow_data: await loadWorkflow(item.id) };
    default:
      throw new Error(`Unhandled kind ${kind}`);
  }
}

/**
 * Whether paid listings are possible (Stripe Connect finished). A failed check
 * reads as "not connected": the form then offers free listings, which is safe,
 * and the reason is logged.
 */
export async function fetchStripeConnected() {
  try {
    const response = await apiFetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect/status`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    return !!(body?.exists && body?.onboardingComplete);
  } catch (e) {
    console.warn('[marketplacePublish] Stripe status unavailable:', e?.message || e);
    return false;
  }
}

/** Earnings in a currency string; missing data is $0.00, never NaN. */
export function money(value) {
  const n = Number(value);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}
