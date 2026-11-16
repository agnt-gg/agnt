/**
 * Business Cloud seats, as agnt.gg/account sells them (agnt.gg/public/assets/js/
 * agnt-instance.js) and the server clamps them (api.agnt.gg resolveSeats):
 * three included, up to a hundred, extra seats billed with the plan, monthly
 * or yearly.
 */
export const SEATS_INCLUDED = 3;
export const SEATS_MAX = 100;
export const SEAT_PRICE = 25;
export const SEAT_PRICE_YEARLY = 250;

/** "$25/mo", or "$250/yr" for a plan billed yearly. */
export function seatPriceLabel(interval) {
  return interval === 'yearly' ? `$${SEAT_PRICE_YEARLY}/yr` : `$${SEAT_PRICE}/mo`;
}

/** The button text for a change of `delta` seats. */
export function seatActionLabel(delta) {
  if (!delta) return 'Update seats';
  const count = Math.abs(delta);
  return `${delta > 0 ? 'Add' : 'Remove'} ${count} ${count === 1 ? 'seat' : 'seats'}`;
}
