/**
 * Is this a live hosted webhook address (https://webhooks.agnt.gg/in/<slug>)?
 *
 * Workflows saved before hosted webhooks still carry an api.agnt.gg/webhook/<id>
 * address, and never-started ones carry "pending". Nothing reads either any
 * more: a sender pointed at one gets a 200 and its events are never delivered.
 * So they are shown as not-yet-active, never offered for copying.
 */
const HOSTED = /^https:\/\/webhooks\.agnt\.gg\/in\/[a-z2-7]{12}$/;

export function isHostedWebhookUrl(url) {
  return typeof url === 'string' && HOSTED.test(url);
}
