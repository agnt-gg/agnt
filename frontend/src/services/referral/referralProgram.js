/**
 * The referral program, as the app sees it.
 *
 * The rules and their numbers live on api.agnt.gg (services/ReferralProgram.js
 * there): partners earn 30% of every payment for a customer's first 12 months,
 * everyone else earns a free month per paying friend, and an invited friend's
 * first month of Personal Cloud is free. The app reads those numbers from
 * /referrals/milestones rather than restating them.
 */
import { API_CONFIG } from '@/tt.config.js';

/** A referral code as the API stores it. Anything else is never sent. */
export const REFERRAL_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** The public invite page for a code. */
export function inviteLink(code) {
  return REFERRAL_CODE.test(code || '') ? `https://agnt.gg/invite/${encodeURIComponent(code)}` : 'https://agnt.gg/';
}

/** The one line that tells a friend what they get. */
export const FRIEND_OFFER = 'Join through my link and your first month of AGNT Cloud is free.';

/** Share intents for a URL. Plain links: nothing is sent anywhere until the user posts. */
export function shareIntents(url, text) {
  const enc = encodeURIComponent;
  return {
    x: `https://x.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    email: `mailto:?subject=${enc('You should look at AGNT')}&body=${enc(text + '\n\n' + url)}`,
  };
}

/**
 * Credit a referrer for the signed-in user.
 *
 * The API accepts this only for the caller's own email and only while the
 * account has no referrer yet, so calling it for someone already referred is a
 * harmless no-op. Never throws: attribution must not break what triggered it.
 *
 * @returns {Promise<{ claimed: boolean, reason?: string }>}
 */
export async function claimReferral({ code, email, token, remoteUrl = API_CONFIG?.REMOTE_URL, fetchImpl = globalThis.fetch }) {
  if (!REFERRAL_CODE.test(code || '') || !email || !token || !remoteUrl) return { claimed: false, reason: 'missing' };
  try {
    const response = await fetchImpl(`${remoteUrl}/referrals/referral`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ referralCode: code, newUserEmail: email }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? { claimed: true } : { claimed: false, reason: data.message || `http_${response.status}` };
  } catch (error) {
    return { claimed: false, reason: 'network' };
  }
}

/** Reward labels, from the milestone shape the API returns. */
export function milestoneLabel(milestone) {
  if (!milestone) return '';
  if (milestone.reward === 'always_on') return `${milestone.months} ${milestone.months === 1 ? 'month' : 'months'} of Always-On`;
  if (milestone.reward === 'founding_member') return 'Founding member';
  return String(milestone.reward || '');
}
