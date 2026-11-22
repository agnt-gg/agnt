/**
 * Focused's start-screen ideas, ported from the AGNT One demo (projects/agnt-one-demo).
 *
 * Three cards under the input, each one lane ("Build", "Save money"…) and one
 * short label. The label fits one line; `prompt` is what is actually sent.
 * A fresh random mix every visit; one card changes every few seconds (the
 * component pauses that on hover, focus, a hidden tab or reduced motion), and
 * "More ideas" replaces all three. The three on screen never share a lane.
 *
 * Pure: the component owns the timer and the DOM; this owns the choosing.
 */

/** lane → [tag label, SVG body for a 24×24 stroke icon]. Static, trusted markup. */
export const LANES = Object.freeze({
  build: ['Build', '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'],
  create: ['Create', '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>'],
  grow: ['Grow', '<path d="M4 17l6-6 4 4 6-7M14 8h6v6"/>'],
  save: ['Save money', '<path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3"/>'],
  clean: ['Clean up', '<path d="M4 13l4 4L20 5"/>'],
  learn: ['Get ahead', '<path d="M12 3l2.6 5.6L20 9.5l-4 4 1 5.5-5-2.7-5 2.7 1-5.5-4-4 5.4-.9z"/>'],
});

/** [lane, label, prompt] — verbatim from the demo. */
export const STARTERS = Object.freeze([
  ['build', 'Make me an agent', 'Help me create an AGNT agent for a job I do often. Ask me what the job is, then create the agent for me.'],
  ['build', 'Build a budget tracker app', 'Build me a focused, good-looking budget tracker web app: add expenses, see categories as a chart, and track a monthly budget. Make it work in the browser.'],
  ['build', 'Make a landing page', 'Make a modern one-page landing page for a small business. Ask me what the business is first, then build it.'],
  ['build', 'Build a habit tracker', 'Build a habit tracker web app with daily check-ins, streaks and a weekly view.'],
  ['build', 'Make a booking page', 'Make a booking page where clients can pick a service and request a time slot.'],
  ['build', 'Build a quote calculator', 'Build a quote calculator my customers can use on a website: pick options, see a live price, and email the quote.'],
  ['build', 'Turn a spreadsheet into an app', 'Turn a spreadsheet into a focused web app with search and filters. I\u2019ll attach or paste the spreadsheet.'],
  ['create', 'Make a 30-second promo video', 'Make a 30-second promo video for my business with captions and music. Ask me about the business first.'],
  ['create', 'Design a logo', 'Design a clean, modern logo. Ask me the name and the feel I want, then show me three options.'],
  ['create', 'Write a week of social posts', 'Write a week of social media posts for my business, one a day, with a suggested image for each.'],
  ['create', 'Make a pitch deck', 'Make a 10-slide pitch deck. Ask me what it\u2019s for, then build it.'],
  ['create', 'Illustrate a bedtime story', 'Write and illustrate a short bedtime story for a 6-year-old, with a picture for each page.'],
  ['create', 'Make a product explainer video', 'Make a 60-second explainer video about a product. Ask me what it is and who it\u2019s for.'],
  ['grow', 'Find 20 local business leads', 'Find 20 local businesses that could use my services, with their website, phone and why they\u2019re a fit. Ask me what I sell and where first.'],
  ['grow', 'Write a cold email that works', 'Write a short cold email that gets replies, plus two follow-ups. Ask me what I sell and to whom.'],
  ['grow', 'Research my top competitors', 'Research my top five competitors: pricing, strengths, weaknesses and where I can win. Ask me my business first.'],
  ['grow', 'Get more Google reviews', 'Help me get more Google reviews: write the ask message and a focused plan to send it to past customers.'],
  ['grow', 'Price my services', 'Help me price my services by comparing what others charge near me. Ask me what I offer and where.'],
  ['grow', 'Plan a launch week', 'Plan a launch week for a new product: what to post, email and announce each day.'],
  ['save', 'Cut my subscriptions', 'Find subscriptions I\u2019m paying for and help me cut the ones I don\u2019t use.'],
  ['save', 'Lower my phone bill', 'Find a cheaper phone plan for how I actually use my phone, and tell me how to switch.'],
  ['save', 'Find a cheaper flight', 'Find the cheapest way to fly somewhere I need to go. Ask me where and when.'],
  ['save', 'Compare my insurance quotes', 'Compare my insurance quotes line by line and flag hidden fees.'],
  ['save', 'Plan a week of cheap dinners', 'Plan five cheap, healthy dinners for this week with one shopping list.'],
  ['save', 'Negotiate my internet bill', 'Write me a script to call my internet provider and get a lower price.'],
  ['clean', 'Clean up my inbox', 'Help me clean up my inbox: find newsletters to unsubscribe from and emails I still need to answer.'],
  ['clean', 'Organize my files', 'Look through my Downloads folder and suggest a tidy folder structure. Don\u2019t move anything until I say so.'],
  ['clean', 'Turn notes into to\u2011dos', 'Turn my messy meeting notes into a clear to-do list with owners and dates. I\u2019ll paste the notes.'],
  ['clean', 'Plan my week', 'Plan my week around my calendar, with time blocked for my top three priorities.'],
  ['clean', 'Reply to what I\u2019ve put off', 'Help me reply to the emails I\u2019ve been putting off, starting with the oldest.'],
  ['clean', 'Summarize a long document', 'Summarize a long document on one page, with the decisions and dates that matter. I\u2019ll attach it.'],
  ['learn', 'Tailor my r\u00e9sum\u00e9 to a job', 'Tailor my r\u00e9sum\u00e9 to a job posting without inventing anything. I\u2019ll paste both.'],
  ['learn', 'Prep me for an interview', 'Prep me for a job interview with likely questions and strong answers. Ask me the role first.'],
  ['learn', 'Explain a topic in 5 minutes', 'Explain a topic I pick in five minutes, with a focused diagram. Ask me the topic.'],
  ['learn', 'Plan a weekend trip', 'Plan a weekend trip on a budget, with a day-by-day plan and a map. Ask me where from and how much I want to spend.'],
  ['learn', 'Make a workout plan', 'Make a four-week workout plan I can do at home with no equipment.'],
  ['learn', 'Learn a skill in 30 days', 'Make a 30-day plan to learn a new skill, 20 minutes a day. Ask me what skill.'],
]);

export const STARTER_SLOTS = 3;
export const STARTER_INTERVAL_MS = 3800;

/** A starter by index, shaped for rendering. */
export function starterAt(index) {
  const [lane, label, prompt] = STARTERS[index];
  return { index, lane, laneLabel: LANES[lane][0], icon: LANES[lane][1], label, prompt };
}

function shuffled(length, random) {
  const a = Array.from({ length }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The chooser: one shuffled queue; take the first starter that is not on
 * screen and does not repeat a lane on screen, and send it to the back.
 *
 * The demo advanced a cursor PAST every starter it skipped for its lane, so
 * those were lost for the whole lap: measured, 74 swaps showed only 23 of 37.
 * Taking from the front and requeueing at the back keeps skipped ones next in
 * line, so every idea comes round. `random` is injectable for tests.
 */
export function createStarterRotation({ random = Math.random } = {}) {
  const queue = shuffled(STARTERS.length, random);
  let nextSlot = 0;
  let shown = [];

  function next(avoid) {
    const lanes = new Set(avoid.map((i) => STARTERS[i][0]));
    let at = queue.findIndex((i) => !avoid.includes(i) && !lanes.has(STARTERS[i][0]));
    // Unreachable with six lanes and two cards to avoid; kept so a future
    // data change degrades to "any card not on screen" instead of throwing.
    if (at < 0) at = queue.findIndex((i) => !avoid.includes(i));
    const [index] = queue.splice(at, 1);
    queue.push(index);
    return index;
  }

  /** Three fresh cards (the first paint, and "More ideas"). */
  function fill() {
    shown = [];
    for (let slot = 0; slot < STARTER_SLOTS; slot++) shown.push(next(shown));
    return shown.slice();
  }

  /** Replace one card, round-robin. Returns { slot, index }. */
  function swapOne() {
    if (!shown.length) fill();
    const slot = nextSlot;
    nextSlot = (nextSlot + 1) % STARTER_SLOTS;
    shown[slot] = next(shown.filter((_, s) => s !== slot));
    return { slot, index: shown[slot] };
  }

  return { fill, swapOne, shown: () => shown.slice() };
}
