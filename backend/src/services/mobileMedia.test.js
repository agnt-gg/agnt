/**
 * Media on texts: what a text's files become for Annie, and which files from
 * Annie's answer are sent back. Network, image conversion and Whisper are
 * injected; the file checks run against real files on disk.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { receiveMedia, findOutboundFiles, sendMedia, mimeForName, MAX_OUTBOUND } from './mobileMedia.js';

const served = (map) => async (url) => (map[url] ? new Response(map[url]) : new Response('nope', { status: 404 }));
const converters = {
  heicToJpeg: async () => Buffer.from('JPEG'),
  transcribe: async () => 'remind me to call mom',
};

describe('receiveMedia', () => {
  it('turns a HEIC photo into a JPEG upload and a voice note into its words', async () => {
    const fetchImpl = served({ u1: Buffer.from('HEIC'), u2: Buffer.from('M4A'), u3: Buffer.from('%PDF') });
    const { files, notes } = await receiveMedia([
      { name: 'IMG_0042.HEIC', mime: 'image/heic', url: 'u1' },
      { name: 'Audio Message.m4a', mime: 'audio/x-m4a', url: 'u2' },
      { name: 'lease.pdf', mime: 'application/pdf', url: 'u3' },
    ], { fetchImpl, converters });
    expect(files.map((f) => [f.originalname, f.mimetype, f.buffer.toString()])).toEqual([
      ['IMG_0042.jpg', 'image/jpeg', 'JPEG'],
      ['Audio Message.m4a', 'audio/x-m4a', 'M4A'],
      ['lease.pdf', 'application/pdf', '%PDF'],
    ]);
    expect(notes).toEqual(['[Voice note: "remind me to call mom"]']);
  });

  it('says so when a file cannot be fetched or converted, and keeps going', async () => {
    const { files, notes } = await receiveMedia([
      { name: 'gone.jpg', mime: 'image/jpeg', url: 'missing' },
      { name: 'x.heic', mime: 'image/heic', url: 'u1' },
    ], { fetchImpl: served({ u1: Buffer.from('HEIC') }), converters: { ...converters, heicToJpeg: async () => { throw new Error('no codec'); } } });
    expect(notes[0]).toMatch(/"gone\.jpg" could not be downloaded/);
    expect(files.map((f) => f.originalname)).toEqual(['x.heic']); // passed through unconverted
  });
});

describe('findOutboundFiles', () => {
  let dir;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-mm-'));
    await fs.writeFile(path.join(dir, 'chart.png'), 'png');
    await fs.writeFile(path.join(dir, 'report final.pdf'), 'pdf');
    await fs.writeFile(path.join(dir, 'tool.exe'), 'exe');
    await fs.mkdir(path.join(dir, '.ssh'));
    await fs.writeFile(path.join(dir, '.ssh', 'id.txt'), 'secret');
    await fs.writeFile(path.join(dir, 'empty.txt'), '');
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));
  const link = (name) => pathToFileURL(path.join(dir, name)).href;

  it('finds file links and generated images, and refuses executables, hidden paths, empty and missing files', async () => {
    const answer = `Here is [the chart](${link('chart.png')}) and ${link('report final.pdf')}.
Also ${link('tool.exe')} ${pathToFileURL(path.join(dir, '.ssh', 'id.txt')).href} ${link('empty.txt')} ${link('nope.png')}
{{IMAGE_REF:img-1}}`;
    const generated = path.join(dir, 'generated.png');
    await fs.writeFile(generated, 'gen');
    const files = await findOutboundFiles(answer, { imageIds: ['img-1'], resolveImage: async (id) => (id === 'img-1' ? generated : null) });
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ['generated.png', 'image/png'],
      ['chart.png', 'image/png'],
      ['report final.pdf', 'application/pdf'],
    ]);
    expect(files[1].token).toBe(link('chart.png'));
  });

  it('sends at most four', async () => {
    const answer = Array.from({ length: 6 }, () => link('chart.png') + '?x').join(' ') + ' ' + [1, 2, 3, 4, 5].map((i) => `{{IMAGE_REF:i${i}}}`).join(' ');
    const files = await findOutboundFiles(answer, { resolveImage: async (id) => path.join(dir, id === 'i1' ? 'chart.png' : 'report final.pdf') });
    expect(files.length).toBeLessThanOrEqual(MAX_OUTBOUND);
  });
});

describe('sendMedia', () => {
  it('reserves, uploads and returns only what made it', async () => {
    const calls = [];
    const callService = async (service, route, opts) => { calls.push([route, opts.body]); return { mediaId: 'm-' + calls.length, uploadUrl: 'put-' + calls.length }; };
    const fetchImpl = async (url) => new Response('', { status: url === 'put-2' ? 500 : 201 });
    const readFile = async (p) => Buffer.from('bytes-of-' + p);
    const sent = await sendMedia('msg-1', [{ path: 'a.png', name: 'a.png', mime: 'image/png' }, { path: 'b.pdf', name: 'b.pdf', mime: 'application/pdf' }], { callService, fetchImpl, readFile });
    expect(calls[0]).toEqual(['/messages/msg-1/media', { name: 'a.png', mime: 'image/png', bytes: 'bytes-of-a.png'.length }]);
    expect(sent.map((f) => f.mediaId)).toEqual(['m-1']);
  });
});

it('maps common extensions and refuses unknown ones', () => {
  expect(mimeForName('Photo.JPG')).toBe('image/jpeg');
  expect(mimeForName('deck.pptx')).toMatch(/presentationml/);
  expect(mimeForName('run.exe')).toBeNull();
});
