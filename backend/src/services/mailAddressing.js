/**
 * PER-WORKFLOW ADDRESSES on mail.agnt.gg. Pure functions, no I/O.
 *
 * The account has one inbox; each Built-in Email workflow listens on its own
 * subaddress of it, inbox+wf-<workflowId>@domain. mail.agnt.gg delivers a
 * subaddress to the base inbox and records the one used as `deliveredTo`, so
 * the receiver hands each message only to the workflow it was addressed to.
 * Mail to the bare inbox address goes to every listening workflow.
 */
const TAG_MAX = 40; // mail.agnt.gg accepts [a-z0-9-]{1,40}

export function workflowTag(workflowId) {
  return ('wf-' + String(workflowId).toLowerCase().replace(/[^a-z0-9-]/g, '')).slice(0, TAG_MAX);
}

export function workflowAddress(inboxAddress, workflowId) {
  const [local, domain] = String(inboxAddress).split('@');
  return `${local}+${workflowTag(workflowId)}@${domain}`;
}

/** The subaddress tag a message was delivered to, or null for the bare inbox. */
export function deliveredTag(message) {
  // deliveredTo comes from the SMTP envelope, set by mail.agnt.gg. To is the
  // fallback for a message stored before the service recorded it.
  for (const field of [message?.deliveredTo, message?.to]) {
    if (!field) continue;
    const text = String(field);
    const address = (/<([^>]+)>/.exec(text)?.[1] || text).trim().toLowerCase();
    const match = /^[^@+\s,]+\+([a-z0-9-]{1,40})@[^\s,]+$/.exec(address);
    return match ? match[1] : null;
  }
  return null;
}
