/**
 * ADOPT A SESSION TOKEN HANDED OVER IN THE URL, BEFORE ANYTHING MOUNTS.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * A hosted tenant does not deliver its token the way a desktop install does.
 * Desktop finds one in localStorage, so `userAuth` state seeds from it
 * synchronously at store construction and every request made from that point
 * carries it. A tenant hands the token over IN THE URL — the browser arrives
 * at `https://<slug>.t1.agnt.gg/settings?token=eyJ...` with localStorage empty.
 *
 * That token used to be picked up in `LoginSection.vue`'s `onMounted`, which
 * is a grandchild of the settings screen and therefore one of the LAST things
 * to run. Every component that mounted before it — and every poll those
 * components start — ran with `state.token === null`, so the request
 * interceptor had nothing to attach and the requests went out with no
 * `Authorization` header at all.
 *
 * The backend refuses those correctly, with `401 {reason:'missing'}`. The
 * damage was on the client: the response interceptor treated that refusal as
 * proof of a dead session and cleared localStorage, so the token was destroyed
 * moments after arriving and could not be recovered without signing in again.
 * Measured on the live fleet before this fix: 63-89% of all 401s on every
 * tenant carried no Authorization header.
 *
 * So the extraction moves to the earliest point that HAS a store — module
 * scope in main.js, before `app.mount()`. There is no ordering left to lose:
 * nothing can observe a null token, because nothing has mounted yet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT ALSO VERIFY
 * ---------------------------------------------------------------------------
 * Adopting is synchronous and boot-critical; verifying is neither. Boot's
 * existing `initializeApp` already verifies whatever is in the store, and
 * `verifySession` de-duplicates concurrent callers, so the sign-in path in
 * LoginSection can await the same answer without issuing a second request.
 * Keeping this function synchronous is what lets it run before mount at all.
 */

/**
 * Does this look like a JWT?
 *
 * Deliberately structural only — three non-empty dot-separated segments. This
 * is NOT a security check; the backend verifies the signature and nothing here
 * could. It exists to stop a malformed `?token=` from evicting a WORKING
 * session: adopting garbage would store it, fail verification, and take the
 * user's existing localStorage token down with it. Ignoring garbage instead
 * leaves an already-signed-in user exactly as they were.
 *
 * Exported because there are two ways a token can arrive from outside — the
 * address bar and the Google popup's postMessage — and they must apply the
 * same rule. A second copy of this would be one more place to forget.
 */
export function looksLikeJwt(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

// Set by adoptTokenFromUrl, read once by the sign-in path so it can navigate
// and report failure. Module-scoped rather than passed through the component
// tree because the two ends are boot and a leaf component.
let adoptedToken = null;

/**
 * Read `?token=` from the address bar, store it, and strip it from the URL.
 *
 * Stripping is not cosmetic. The token stays in `location.search` for the life
 * of the page otherwise, and the browser sends the full URL as `Referer` on
 * every subsequent request — which put live session tokens into the reverse
 * proxy's access log on every tenant, one line per API call.
 *
 * @param {object} store            the Vuex store
 * @param {Location} [loc]          injectable for tests
 * @param {History}  [hist]         injectable for tests
 * @returns {boolean} whether a token was adopted
 */
export function adoptTokenFromUrl(store, loc = globalThis.location, hist = globalThis.history) {
  try {
    if (!loc?.href) return false;

    const url = new URL(loc.href);
    const token = url.searchParams.get('token');
    if (!token) return false;

    // Strip it whether or not we keep it — a malformed token is still a
    // credential-shaped string that does not belong in browser history or in
    // a Referer header.
    url.searchParams.delete('token');
    hist?.replaceState?.({}, document.title, `${url.pathname}${url.search}${url.hash}`);

    if (!looksLikeJwt(token)) {
      console.warn('[boot] ignoring a malformed ?token= — leaving any existing session intact');
      return false;
    }

    adoptedToken = token;
    store.commit('userAuth/SET_TOKEN', token);
    return true;
  } catch (error) {
    // Boot must survive a hostile or exotic URL. Failing to adopt costs a
    // sign-in; throwing here costs the whole app.
    console.warn('[boot] could not read ?token= from the URL:', error?.message);
    return false;
  }
}

/**
 * Take the adopted token, if there was one. Single-use: the sign-in path reads
 * it exactly once to decide whether to confirm the session and navigate.
 */
export function consumeAdoptedToken() {
  const token = adoptedToken;
  adoptedToken = null;
  return token;
}

/** Test seam. Not used in production code. */
export function __resetAdoptedTokenForTests() {
  adoptedToken = null;
}
