/**
 * How a Market listing is named in a link (`/marketplace?item=<key>`), and how
 * a key finds its listing again.
 *
 * A listing has two ids: `asset_id` (stable forever; what agnt:// links and
 * the agnt.gg pages use) and `id` (the listing row, which changes when a
 * listing is republished). Callers used to pick one at random: shelves passed
 * `asset_id`, Focused passed `id`, most shelves passed nothing, and each Market
 * screen matched only one kind. So "open this item" opened the Market home or
 * reported "No listing found". One key, matched by either id, ends that.
 */

/** The key to put in a link: the stable asset id when there is one. */
export function marketplaceItemKey(listing) {
  if (!listing || typeof listing !== 'object') return '';
  return String(listing.asset_id || listing.id || '');
}

/** Whether `listing` is the one `key` names (by asset id or listing id). */
export function matchesMarketplaceKey(listing, key) {
  if (!listing || key == null || key === '') return false;
  const k = String(key);
  return (listing.asset_id != null && String(listing.asset_id) === k) || (listing.id != null && String(listing.id) === k);
}
