import { searchRequest } from './searchSources.js';

/**
 * Execute a jump-catalog action (see jumpCatalog.js for the shapes).
 *
 * ONE executor for every surface that opens "a thing": the Jump palette, and
 * Focused's Library / Plugins / Scheduled pages. Before this lived inline in
 * JumpPalette.run, so a second surface would have needed a second copy of the
 * same switch — and the two would drift the first time a kind was added.
 *
 * Surface-specific behaviour comes in through the context:
 *   navigate(screen, opts)  — Terminal.changeScreen, via the host's emit
 *   onError(message)        — how this surface shows a failure (optional)
 *
 * Returns true when the action was recognised.
 */
export function runJumpAction(action, { store, router, navigate, onError = () => {} } = {}) {
  const a = action;
  if (!a || typeof a !== 'object') return false;

  switch (a.type) {
    case 'inspect':
      store.dispatch('shell/inspect', { kind: a.kind, id: a.id, screen: a.screen });
      navigate(a.screen, { select: { kind: a.kind, id: a.id } });
      return true;
    case 'screen':
      navigate(a.screen, a.opts || {});
      return true;
    case 'chat':
    case 'output':
      router.push({ path: '/chat', query: { 'content-id': a.id } });
      return true;
    case 'conversation':
      searchRequest('/content-outputs/by-conversation/' + encodeURIComponent(a.id), {
        token: localStorage.getItem('token') || '',
      })
        .then((body) => {
          const output = body.output || body.contentOutput || body;
          if (!output.id) throw Error('Conversation not available');
          router.push({ path: '/chat', query: { 'content-id': output.id } });
        })
        .catch((error) => onError(error.message));
      return true;
    case 'store':
      // ?item=<asset_id> is the catalogue's existing deep link: Marketplace.vue
      // resolves it on cold mount AND from a route watcher when warm, and the
      // asset id is stable across republishes where the listing UUID is not.
      router.push({ path: '/marketplace', query: { item: a.assetId } });
      return true;
    case 'teams':
      window.dispatchEvent(new CustomEvent('agnt:open-team-workspace'));
      return true;
    case 'page':
      window.dispatchEvent(new CustomEvent('agnt:open-page', { detail: { pageId: a.id } }));
      return true;
    default:
      return false;
  }
}
