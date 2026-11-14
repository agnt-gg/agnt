/**
 * The referral program, as the app sees it.
 *
 * The rules and their numbers live on api.agnt.gg (services/ReferralProgram.js
 * there): partners earn 30% of every payment for a customer's first 12 months,
 * everyone else earns a free month per paying friend, and an invited friend
 * gets a 30-day trial of AGNT Pro: the free plan's local limits lifted, no
 * cloud or hosted services until they pay. The app reads those numbers from
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
export const FRIEND_OFFER = 'Join through my link and get 30 days of AGNT Pro free.';

/** What a share intent prefills: who is sharing, then the friend's offer. */
export const INVITE_SHARE_TEXT = `I build with AGNT, the agent operating system. ${FRIEND_OFFER}`;

/** Both halves of an invite in one line, in the Referrals settings' own words. */
export const INVITE_TERMS = 'Friends who join through your link get 30 days of AGNT Pro free. Give a month, get a month.';

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

const profiles = new Map();

/**
 * The signed-in account's own referral record: its invite code, and whether it
 * joined through someone else's. Null when it cannot be read (signed out,
 * offline). Asked once per account per session; a failed read is asked again.
 *
 * @returns {Promise<{ code: string|null, invited: boolean }|null>}
 */
export function fetchReferralProfile({ email, token, remoteUrl = API_CONFIG?.REMOTE_URL, fetchImpl = globalThis.fetch }) {
  if (!email || !token || !remoteUrl) return Promise.resolve(null);
  const key = `${remoteUrl}|${String(email).toLowerCase()}`;
  if (!profiles.has(key)) {
    const request = loadReferralProfile({ email, token, remoteUrl, fetchImpl }).then((profile) => {
      if (!profile) profiles.delete(key);
      return profile;
    });
    profiles.set(key, request);
  }
  return profiles.get(key);
}

async function loadReferralProfile({ email, token, remoteUrl, fetchImpl }) {
  try {
    const response = await fetchImpl(`${remoteUrl}/referrals/user/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // No record yet is an answer: no code to share, and nobody invited them.
    if (response.status === 404) return { code: null, invited: false };
    if (!response.ok) return null;
    const data = await response.json();
    return { code: REFERRAL_CODE.test(data?.referral_code || '') ? data.referral_code : null, invited: Boolean(data?.referred_by) };
  } catch (error) {
    console.warn('[referral] profile unavailable:', error?.message || error);
    return null;
  }
}

/**
 * Where an invited account's 30 days of AGNT Pro stand: 'offer' while it is on
 * the free plan, 'started' while the trial runs, null for anyone else. Checkout
 * has the last word: it applies the trial only to an account that has never
 * subscribed, which the app has no way to see.
 */
export function inviteTrialState({ invited, planType, planStatus } = {}) {
  if (!invited) return null;
  if (planStatus === 'trialing' || planType === 'trial') return 'started';
  return !planType || planType === 'free' ? 'offer' : null;
}

