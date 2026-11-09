/**
 * The agnt.gg release feed, shared by the update dialog and Settings › About.
 *
 * A release is { version, date, title, tags, features: [{ name, status }] },
 * where status is 'new' | 'updated' | 'bug'. Feature names may carry a plan
 * prefix ("[Team] …", "[Pro] …") and an optional "Lead-in: rest" headline.
 */

export const RELEASES_URL = 'https://agnt.gg/api/releases';
export const CHANGELOG_URL = 'https://agnt.gg/changelog';

/** Display order and wording for each feature status. */
export const CHANGE_KINDS = [
  { status: 'new', label: 'New' },
  { status: 'updated', label: 'Improved' },
  { status: 'bug', label: 'Fixed' },
];

export async function fetchReleases({ timeoutMs = 15000 } = {}) {
  // The website's CORS-enabled endpoint, directly; the timeout keeps a stuck
  // remote from holding a connection slot.
  const response = await fetch(RELEASES_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`release feed answered ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.releases) ? data.releases : [];
}

/** The release for exactly this version, or null. Never a neighbouring one. */
export function findRelease(releases, version) {
  if (!version || !Array.isArray(releases)) return null;
  return releases.find((release) => release?.version === version) || null;
}

const PLAN_PREFIX = /^\[(Team|Pro)\]\s*/;
const MAX_LEAD_LENGTH = 60;

/** "[Team] Teamspaces: invite-only spaces" -> { plan: 'Team', lead: 'Teamspaces', rest: 'invite-only spaces' } */
export function parseChange(name) {
  let text = String(name ?? '');
  let plan = null;
  const prefix = text.match(PLAN_PREFIX);
  if (prefix) {
    plan = prefix[1];
    text = text.slice(prefix[0].length);
  }
  const split = text.indexOf(': ');
  if (split > 0 && split < MAX_LEAD_LENGTH) return { plan, lead: text.slice(0, split), rest: text.slice(split + 2) };
  return { plan, lead: null, rest: text };
}

/** A release's features grouped in CHANGE_KINDS order; empty groups dropped. */
export function groupChanges(release) {
  const features = Array.isArray(release?.features) ? release.features : [];
  return CHANGE_KINDS.map((kind) => ({
    ...kind,
    changes: features.filter((feature) => feature?.status === kind.status).map((feature) => parseChange(feature.name)),
  })).filter((group) => group.changes.length > 0);
}
