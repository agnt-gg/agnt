/**
 * The delta mirror must say who sent the turn.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `run:started` carries `originClientId` so the client that started a run can
 * recognise and ignore its own announcement. The reasoning is written out in
 * frontend/src/services/clientId.js: for a NEW conversation the sender's slot
 * is still keyed by a temp id, so conversation id cannot identify it and
 * identity has to be carried explicitly.
 *
 * That reasoning applies word for word to the OTHER thing this handler
 * broadcasts to the same audience — the chat:* delta mirror — and it was wired
 * into the announcement only. The mirror went out unstamped, the sender could
 * not tell its own echo from another tab's turn, and the first message of every
 * new conversation was rendered twice.
 *
 * WHY SOURCE ASSERTIONS
 * ---------------------
 * Same reason as OrchestratorService.runAnnouncement: these are call sites
 * inside a 4,000-line handler that no unit test drives end to end. The
 * behaviour on the receiving end is covered by chat.mirrorEcho.spec.js; what
 * cannot be checked there is whether the server ever labels what it sends.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CODE = fs.readFileSync(
  fileURLToPath(new URL('./OrchestratorService.js', import.meta.url)),
  'utf8',
);

/** The chat:* delta mirror — one broadcast for every mapped SSE event. */
const mirrorIdx = CODE.indexOf('const socketEvent = chatEventMappings[eventName];');
/** The separate user-message broadcast. */
const userMsgIdx = CODE.indexOf('RealtimeEvents.CHAT_USER_MESSAGE');

describe('the delta mirror identifies its sender', () => {
  it('stamps every mirrored chat event with the originating client', () => {
    expect(mirrorIdx).toBeGreaterThan(-1);
    const payload = CODE.slice(mirrorIdx, mirrorIdx + 400);
    expect(payload).toMatch(/broadcastToUser\(userId, socketEvent, \{/);
    expect(payload).toMatch(/originClientId/);
  });

  it('stamps the user-message broadcast too', () => {
    // The echo of the user's own words is the same defect wearing a different
    // hat: rendered locally the instant it was typed, then delivered again.
    expect(userMsgIdx).toBeGreaterThan(-1);
    expect(CODE.slice(userMsgIdx, userMsgIdx + 400)).toMatch(/originClientId/);
  });

  it('reads the id from the request header, not from anywhere inferred', () => {
    // Identity is carried explicitly precisely because it cannot be deduced
    // from delivery order across two transports.
    expect(CODE).toMatch(/const originClientId = req\?\.headers\?\.\['x-agnt-client-id'\] \|\| null;/);
  });

  it('resolves the header EXACTLY once, so no path can be left unstamped', () => {
    // This bug was a second broadcast that never got the inline lookup the
    // first one had. A literal read per call site is a per-call-site chance to
    // forget; one binding is a thing you have to actively remove.
    const header = /req\?\.headers\?\.\['x-agnt-client-id'\]/g;
    expect((CODE.match(header) || []).length).toBe(1);
  });

  it('feeds every broadcast to the user room from that one binding', () => {
    // All three things this handler tells the user's other clients about a
    // turn: it started, the user said something, and here is the answer.
    const stamped = /originClientId,/g;
    expect((CODE.match(stamped) || []).length).toBe(3);
  });
});

describe('the announcement contract is unchanged', () => {
  it('still stamps run:started', () => {
    // Regression guard: the refactor to a shared binding must not quietly drop
    // the property it was extracted from.
    const announceIdx = CODE.indexOf('RealtimeEvents.RUN_STARTED');
    expect(CODE.slice(announceIdx, announceIdx + 400)).toMatch(/originClientId/);
  });
});
