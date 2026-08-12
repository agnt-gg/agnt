/**
 * The two client events that carry a recovered first word.
 *
 * buildAudioInputItem delivers the pre-connection audio as conversation
 * history; buildUserTurnResponse closes a turn the server VAD never saw.
 * Their shapes are contracts with the realtime API — a drifted field name is
 * a silently ignored event, not an error — so they are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { buildAudioInputItem, buildUserTurnResponse, buildResponseCreate } from './realtimeBridge.js';

describe('buildAudioInputItem — the pre-roll as a user message', () => {
  it('is a user message item carrying base64 input_audio', () => {
    expect(buildAudioInputItem('UFJFUk9MTA==')).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_audio', audio: 'UFJFUk9MTA==' }],
      },
    });
  });
});

describe('buildUserTurnResponse — closing the stranded turn', () => {
  it('is deliberately bare, so the session config governs it', () => {
    // It stands in for the response the server VAD would have created: it
    // must inherit the session's tools (run_agnt) and text-only modality.
    // ANY response override here re-opens the freelancing bug that
    // buildResponseCreate's tools:[] exists to close — from the other side.
    expect(buildUserTurnResponse()).toEqual({ type: 'response.create' });
  });

  it('is the documented opposite of buildResponseCreate', () => {
    // The narration response strips tools (it exists to speak, never to act).
    // The user-turn response keeps them (it exists to act, via run_agnt).
    // If either shape drifts toward the other, one of two bugs returns:
    // spoken answers that can act, or recovered turns that cannot.
    expect(buildResponseCreate().response.tools).toEqual([]);
    expect('response' in buildUserTurnResponse()).toBe(false);
  });
});
