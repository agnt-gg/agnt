import { describe, it, expect } from 'vitest';
import { catchUpTranscript } from './transcriptCatchUp.js';

const u = (id, content) => ({ id, role: 'user', content });
const a = (id, content) => ({ id, role: 'assistant', content });
const REPORT = '[System: Sub-chat finished]\n\nSub-chat: "Landing page rebuild" (conversation id c9)\nStatus: completed\n\nIts final answer:\nBuilt it.\n\n<!-- agnt-subchats:abc -->';

// What the phone held when it went to sleep, under the ids it gave them.
const PHONE = [u('p1', 'build a landing page'), a('p2', 'Started a sub-chat for the build.')];
// What the server saved: the same turns re-projected with fresh ids, then the
// report turn and Main's reply, which ran while the phone slept.
const SERVER = [
  u('srv-0', 'build a landing page'),
  a('srv-1', 'Started a sub-chat for the build.'),
  u('srv-2', REPORT),
  a('srv-3', 'Built and checked: Bramble & Bloom Coffee.'),
];

describe('catchUpTranscript', () => {
  it('adopts the server copy when it holds a report turn this client missed', () => {
    expect(catchUpTranscript(PHONE, SERVER)).toEqual(SERVER);
  });

  it('keeps a message typed here that the server has not received, after the server copy', () => {
    const typed = u('p3', 'and add a gallery');
    expect(catchUpTranscript([...PHONE, typed], SERVER)).toEqual([...SERVER, typed]);
  });

  it('keeps a whole turn sent from here before catching up, question and reply', () => {
    const turn = [u('p3', 'and add a gallery'), a('p4', 'Added a gallery.')];
    expect(catchUpTranscript([...PHONE, ...turn], SERVER)).toEqual([...SERVER, ...turn]);
  });

  it('takes the server copy of a turn it already holds, rather than keeping both', () => {
    const server = [...SERVER, u('srv-4', 'and add a gallery'), a('srv-5', 'Added a gallery with six photos.')];
    const phone = [...PHONE, u('p3', 'and add a gallery'), a('p4', 'Added a gall')];
    expect(catchUpTranscript(phone, server)).toEqual(server);
  });

  it('adopts a turn the user sent from another device, such as a text', () => {
    const server = [...SERVER.slice(0, 2), u('srv-2', '[TEXT MESSAGE TURN]\nalso make it dark'), a('srv-3', 'Done.')];
    expect(catchUpTranscript(PHONE, server)).toEqual(server);
  });

  it('leaves an up-to-date chat alone even though the server re-projected it with new ids', () => {
    const phone = [...PHONE, u('p3', REPORT), a('p4', 'Built and checked: Bramble & Bloom Coffee.')];
    expect(catchUpTranscript(phone, SERVER)).toBeNull();
  });

  it('does not mistake server-internal nudges for turns the user missed', () => {
    const server = [...SERVER.slice(0, 1), u('srv-n', '[System: Your previous response contained only tool calls with no text.]'), a('srv-1', 'Started a sub-chat for the build.')];
    expect(catchUpTranscript(PHONE, server)).toBeNull();
  });

  // OrchestratorService puts the upload's paths and extracted text in front of what the user sent.
  const uploaded = (sent) => `[ATTACHED FILES]\nThe user uploaded 1 file(s), saved on disk at these absolute paths.\n- /uploads/menu.pdf (application/pdf, 12 KB)\n[/ATTACHED FILES]\n\nESPRESSO 3.50\n\nLATTE 4.50\n\n${sent}`;

  it('recognises a turn with an upload as the one this client sent', () => {
    const phone = [u('p1', 'Attached 1 file: menu.pdf'), a('p2', 'Read it.')];
    expect(catchUpTranscript(phone, [u('srv-0', uploaded('Attached 1 file: menu.pdf')), a('srv-1', 'Read it.')])).toBeNull();
    const typed = [u('p1', 'price this menu'), a('p2', 'Read it.')];
    expect(catchUpTranscript(typed, [u('srv-0', uploaded('price this menu')), a('srv-1', 'Read it.')])).toBeNull();
  });

  it('still adopts a report that arrived after an upload turn', () => {
    const phone = [u('p1', 'price this menu'), a('p2', 'Read it.')];
    const server = [u('srv-0', uploaded('price this menu')), a('srv-1', 'Read it.'), u('srv-2', REPORT), a('srv-3', 'Priced.')];
    expect(catchUpTranscript(phone, server)).toEqual(server);
  });

  it('does not treat ordinary words as an upload', () => {
    const phone = [u('p1', 'yes')];
    expect(catchUpTranscript(phone, [u('srv-0', 'oh yes')])).toEqual([u('srv-0', 'oh yes'), u('p1', 'yes')]);
  });

  it('keeps this client when the server holds nothing', () => {
    expect(catchUpTranscript(PHONE, [])).toBeNull();
    expect(catchUpTranscript(PHONE, null)).toBeNull();
  });

  it('adopts into an empty client', () => {
    expect(catchUpTranscript([], SERVER)).toEqual(SERVER);
  });
});
