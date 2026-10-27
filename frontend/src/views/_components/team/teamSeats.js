/**
 * Business Cloud seats, as agnt.gg/account sells them (agnt.gg/public/assets/js/
 * agnt-instance.js) and the server clamps them (api.agnt.gg resolveSeats):
 * three included, up to a hundred, extra seats billed per month.
 */
export const SEATS_INCLUDED = 3;
export const SEATS_MAX = 100;
export const SEAT_PRICE = 25;

/** The button text for a change of `delta` seats. */
export function seatActionLabel(delta) {
  if (!delta) return 'Update seats';
  const count = Math.abs(delta);
  return `${delta > 0 ? 'Add' : 'Remove'} ${count} ${count === 1 ? 'seat' : 'seats'}`;
}
