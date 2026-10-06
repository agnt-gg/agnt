/**
 * AGNT's paid plans: one table for every place that sells them (the plan
 * picker in the upgrade modal and on Billing, the chat's out-of-credits card).
 * Prices and allowances mirror the live plan tables on api.agnt.gg; change
 * them there first. Prices also live in BillingManager/planPrices.js (what
 * checkout charges) and a spec pins the two together.
 */
export const PLANS = [
  {
    id: 'personal',
    name: 'AGNT Pro',
    price: 29,
    yearly: 290,
    tagline: 'Your agent, hosted. Everything included.',
    includes: [
      { label: 'Hosted instance', value: 'Sleeps when idle · up to 8 active hrs/day' },
      { label: 'AGNT Flash', value: '5M credits / mo' },
      { label: 'Search', value: '150 searches + 750 pages / mo' },
      { label: 'Sandbox', value: '100 compute-minutes / mo' },
      { label: 'Mail', value: '1,000 units · 1 inbox' },
      { label: 'Webhooks', value: '1,000 units · 10 endpoints' },
    ],
    meta: '1 seat.',
  },
  {
    id: 'always_on',
    name: 'Pro + Always-On',
    price: 49,
    yearly: 490,
    tagline: 'Pro, awake around the clock.',
    includes: [
      { label: 'Hosted instance', value: 'Never sleeps' },
      { label: 'AGNT Flash', value: '15M credits / mo' },
      { label: 'Search', value: '500 searches + 2,500 pages / mo' },
      { label: 'Sandbox', value: '300 compute-minutes / mo' },
      { label: 'Mail', value: '5,000 units · 5 inboxes' },
      { label: 'Webhooks', value: '5,000 units · 25 endpoints' },
    ],
    meta: '1 seat. $29 Pro + $20 Always-On.',
  },
  {
    id: 'business',
    name: 'AGNT Team',
    price: 99,
    yearly: 990,
    tagline: 'Always-On for three people, one shared instance.',
    includes: [
      { label: 'Hosted instance', value: 'Never sleeps · shared vault · audit receipts' },
      { label: 'AGNT Flash', value: '25M credits / mo' },
      { label: 'Search', value: '1,400 searches + 7,000 pages / mo' },
      { label: 'Sandbox', value: '600 compute-minutes / mo' },
      { label: 'Mail', value: '20,000 units · 15 inboxes' },
      { label: 'Webhooks', value: '20,000 units · 100 endpoints' },
    ],
    meta: '3 seats included · +$25/mo each extra.',
  },
];
