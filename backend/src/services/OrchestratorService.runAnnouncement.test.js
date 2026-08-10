/**
 * A run must announce itself, and announce itself in time.
 *
 * WHY SOURCE ASSERTIONS
 * ---------------------
 * Same reason as OrchestratorService.streamLifetime and .turnTranscript: the
 * property is about a CALL SITE inside a 3,700-line handler that no unit test
 * drives end to end. The behaviour on the receiving end is covered by
 * runResume.spec.js; what cannot be checked there is whether the server ever
 * speaks.
 *
 * Four properties, each protecting a different way of being subtly useless:
 *   1. it is announced at all;
 *   2. AFTER the run is registered — announcing a run that cannot yet be
 *      attached to invites a reattach that 204s, and the client gives up;
 *   3. BEFORE the first event is emitted, so there is no window in which a run
 *      is attachable but unannounced;
 *   4. it carries the originating client's id, which is the only thing that
 *      stops the sender attaching to its own run.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CODE = fs.readFileSync(
  fileURLToPath(new URL('./OrchestratorService.js', import.meta.url)),
  'utf8',
);

const announceIdx = CODE.indexOf('RealtimeEvents.RUN_STARTED');

describe('announcing a started run', () => {
  it('broadcasts RUN_STARTED exactly once', () => {
    expect(CODE.match(/RealtimeEvents\.RUN_STARTED/g) || []).toHaveLength(1);
    expect(CODE.slice(announceIdx - 200, announceIdx)).toMatch(/broadcastToUser\(\s*userId,\s*$/m);
  });

  it('announces only after the run is registered', () => {
    // Announced first, a client could reattach before activeRuns knows the
    // conversation, get a 204, and conclude nothing is running.
    expect(CODE.indexOf('activeRun = startRun(')).toBeLessThan(announceIdx);
  });

  it('announces before the first event reaches anyone', () => {
    // The inverse gap: a run that is attachable but silent is one a client can
    // only find by reloading, which is the bug being fixed.
    expect(announceIdx).toBeLessThan(CODE.indexOf("sendEvent('conversation_started'"));
  });

  it('carries the conversation, its type, and who started it', () => {
    const payload = CODE.slice(announceIdx, announceIdx + 400);
    expect(payload).toMatch(/conversationId,/);
    expect(payload).toMatch(/chatType,/);
    // Without the origin, the sender cannot recognise its own announcement for
    // a NEW conversation (its slot is still keyed by a temp id), reattaches to
    // itself, and MIGRATE_CONVERSATION_ID then overwrites its own live slot.
    expect(payload).toMatch(/originClientId:\s*req\?\.headers\?\.\['x-agnt-client-id'\]/);
  });

  it('does not announce for an unidentified user', () => {
    // broadcastToUser targets room `user:<id>`; a null id would address a room
    // nobody is in at best, and a shared one at worst.
    expect(CODE.slice(announceIdx - 300, announceIdx)).toMatch(/if \(userId\) \{/);
  });

  it('sends no transcript content in the announcement', () => {
    // Deliberately an existence notice, not a payload: the replay is the
    // delivery mechanism. userMessage can be 20KB and would be broadcast to
    // every client on every turn.
    const payload = CODE.slice(announceIdx, announceIdx + 400);
    expect(payload).not.toMatch(/userMessage/);
    expect(payload).not.toMatch(/messages/);
  });
});

describe('the event itself', () => {
  it('is declared in the shared catalogue', async () => {
    const { RealtimeEvents } = await import('../utils/realtimeSync.js');
    expect(RealtimeEvents.RUN_STARTED).toBe('run:started');
  });

  it('is not silenced — one line per turn is signal, not noise', async () => {
    const src = fs.readFileSync(
      fileURLToPath(new URL('../utils/realtimeSync.js', import.meta.url)),
      'utf8',
    );
    const silent = src.slice(src.indexOf('SILENT_BROADCAST_EVENTS'), src.indexOf(']);'));
    expect(silent).not.toMatch(/run:started/);
  });
});
