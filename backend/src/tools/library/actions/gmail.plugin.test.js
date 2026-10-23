/**
 * Gmail plugin (backend/plugins/dev/gmail-plugin): drafts, replies, and the
 * shared MIME builder every outgoing path uses.
 *
 * The Gmail client is a recording fake whose messages.send throws, so any draft
 * operation that reaches the send endpoint fails here, not in someone's inbox.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

// googleapis lives in the plugin's own gitignored node_modules, which CI never
// installs (see gmail-api.plugin.test.js). Every test here passes its own fake
// client; execute() only needs these two constructors to reach its auth check.
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => ({}),
  },
}));

import gmailApi from '../../../../plugins/dev/gmail-plugin/gmail-api.js';
import {
  addressesOf,
  buildMimeMessage,
  encodeHeaderText,
  splitAddressList,
} from '../../../../plugins/dev/gmail-plugin/gmail-mime.js';
import manifest from '../../../../plugins/dev/gmail-plugin/manifest.json' with { type: 'json' };

const ME = 'nathan@bizop.io';

/** Parse a base64url raw message into { headers, body } (single-part only). */
function decodeRaw(raw) {
  const message = Buffer.from(raw, 'base64url').toString('utf8');
  const [headerBlock, ...rest] = message.split('\r\n\r\n');
  const headers = {};
  for (const line of headerBlock.split('\r\n')) {
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  const encodedBody = rest.join('\r\n\r\n');
  const body = headers['content-transfer-encoding'] === 'base64'
    ? Buffer.from(encodedBody.replace(/\r\n/g, ''), 'base64').toString('utf8')
    : encodedBody;
  return { message, headers, body };
}

const header = (name, value) => ({ name, value });

function fakeGmail({ originalHeaders = [], threadId = 'thread-1', existingDraft, draftsList = [], failingDraftIds = [] } = {}) {
  const calls = [];
  const record = (name, result) => async (args) => {
    calls.push({ name, args });
    if (result instanceof Error) throw result;
    return { data: typeof result === 'function' ? result(args) : result };
  };
  const gmail = {
    calls,
    users: {
      getProfile: record('getProfile', { emailAddress: ME }),
      messages: {
        get: record('messages.get', { id: 'msg-1', threadId, payload: { headers: originalHeaders } }),
        send: record('messages.send', new Error('messages.send must never be called by this test')),
      },
      drafts: {
        create: record('drafts.create', (args) => ({ id: 'draft-1', message: { id: 'dmsg-1', threadId: args.requestBody.message.threadId } })),
        update: record('drafts.update', (args) => ({ id: args.id, message: { id: 'dmsg-2', threadId: args.requestBody.message.threadId } })),
        delete: record('drafts.delete', ''),
        list: record('drafts.list', { drafts: draftsList.map((id) => ({ id })), nextPageToken: 'next', resultSizeEstimate: draftsList.length }),
        get: async (args) => {
          calls.push({ name: 'drafts.get', args });
          if (failingDraftIds.includes(args.id)) throw new Error('boom');
          return { data: existingDraft ?? { id: args.id, message: { id: `m-${args.id}`, threadId: 't', snippet: 'hi', payload: { headers: [header('Subject', `S ${args.id}`), header('To', 'a@x.com'), header('In-Reply-To', '<x@y>')] } } } };
        },
      },
    },
  };
  return gmail;
}

const lastCall = (gmail, name) => gmail.calls.filter((call) => call.name === name).at(-1);

describe('buildMimeMessage', () => {
  it.each([
    ['to', { to: 'a@x.com\r\nBcc: attacker@evil.com', subject: 's', body: 'b' }],
    ['to', { to: 'a@x.com\nBcc: attacker@evil.com', subject: 's', body: 'b' }],
    ['subject', { to: 'a@x.com', subject: 'Hi\r\nBcc: attacker@evil.com', body: 'b' }],
    ['cc', { to: 'a@x.com', cc: 'b@x.com\rBcc: c@evil.com', subject: 's', body: 'b' }],
  ])('rejects a line break in %s (header injection)', (field, fields) => {
    expect(() => buildMimeMessage(fields)).toThrow(new RegExp(`'${field}' must be a single line`));
  });

  it('uses CRLF line endings and RFC 2047 for a non-ASCII subject', () => {
    const message = buildMimeMessage({ to: 'a@x.com', subject: 'Café ☕ follow-up', body: 'hi' });
    expect(message).toContain('\r\nSubject: =?UTF-8?B?');
    expect(message.replace(/\r\n/g, '')).not.toMatch(/\n/);
    const encoded = message.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('Café ☕ follow-up');
    expect(encodeHeaderText('plain ascii')).toBe('plain ascii');
  });

  it('sends plain text as text/plain and tagged bodies as text/html, round-tripping UTF-8', () => {
    const plain = decodeRaw(Buffer.from(buildMimeMessage({ to: 'a@x.com', subject: 's', body: 'Line 1\nLine 2 — ok' })).toString('base64url'));
    expect(plain.headers['content-type']).toBe('text/plain; charset=UTF-8');
    expect(plain.body).toBe('Line 1\nLine 2 — ok');

    const html = decodeRaw(Buffer.from(buildMimeMessage({ to: 'a@x.com', subject: 's', body: '<p>Hello</p>' })).toString('base64url'));
    expect(html.headers['content-type']).toBe('text/html; charset=UTF-8');
  });

  it('builds multipart/mixed with attachments and validates them', () => {
    const message = buildMimeMessage({
      to: 'a@x.com', subject: 's', body: 'b',
      attachments: JSON.stringify([{ filename: 'notes.txt', mimetype: 'text/plain', content: Buffer.from('x').toString('base64') }]),
    });
    const boundary = message.match(/boundary="([^"]+)"/)[1];
    expect(message).toContain(`--${boundary}\r\nContent-Type: text/plain; name="notes.txt"`);
    expect(message.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(() => buildMimeMessage({ to: 'a@x.com', subject: 's', body: 'b', attachments: '{not json' })).toThrow(/JSON array/);
    expect(() => buildMimeMessage({ to: 'a@x.com', subject: 's', body: 'b', attachments: [{ filename: 'x' }] })).toThrow(/needs 'filename' and base64 'content'/);
  });

  it('splits address lists without breaking quoted display names', () => {
    expect(splitAddressList('"Doe, Jane" <jane@x.com>, bob@y.com')).toEqual(['"Doe, Jane" <jane@x.com>', 'bob@y.com']);
    expect(addressesOf('"Doe, Jane" <Jane@X.com>, bob@y.com')).toEqual(['jane@x.com', 'bob@y.com']);
  });
});

describe('Gmail drafts', () => {
  const run = (gmail, params) => gmailApi.runOperation(gmail, params);

  it('Create Draft saves a draft and never sends', async () => {
    const gmail = fakeGmail();
    const result = await run(gmail, { operation: 'Create Draft', to: 'ada@example.com', subject: 'Agenda', body: 'Draft body' });

    expect(result).toEqual({ draftId: 'draft-1', messageId: 'dmsg-1', threadId: undefined, sent: false });
    const { headers, body } = decodeRaw(lastCall(gmail, 'drafts.create').args.requestBody.message.raw);
    expect(headers.to).toBe('ada@example.com');
    expect(headers.subject).toBe('Agenda');
    expect(body).toBe('Draft body');
    expect(gmail.calls.some((call) => call.name === 'messages.send')).toBe(false);
  });

  it('Create Draft needs a subject or a body', async () => {
    await expect(run(fakeGmail(), { operation: 'Create Draft', to: 'a@x.com' })).rejects.toThrow(/'subject' or 'body'/);
  });

  it('Create Reply Draft threads the reply and addresses Reply-To over From', async () => {
    const gmail = fakeGmail({
      threadId: 'thread-9',
      originalHeaders: [
        header('Subject', 'Partnership'),
        header('From', 'Ada <ada@example.com>'),
        header('Reply-To', 'Deals <deals@example.com>'),
        header('To', ME),
        header('Message-ID', '<orig@example.com>'),
        header('References', '<root@example.com>'),
      ],
    });
    const result = await run(gmail, { operation: 'Create Reply Draft', messageId: 'msg-1', body: 'Thanks — confirming Thursday.' });

    expect(result).toMatchObject({ draftId: 'draft-1', threadId: 'thread-9', sent: false });
    const { requestBody } = lastCall(gmail, 'drafts.create').args;
    expect(requestBody.message.threadId).toBe('thread-9');
    const { headers } = decodeRaw(requestBody.message.raw);
    expect(headers).toMatchObject({
      to: 'Deals <deals@example.com>',
      subject: 'Re: Partnership',
      'in-reply-to': '<orig@example.com>',
      references: '<root@example.com> <orig@example.com>',
    });
    expect(headers.cc).toBeUndefined();
    expect(gmail.calls.some((call) => call.name === 'messages.send')).toBe(false);
  });

  it('replying to a message I sent goes to its recipients, and Re: is not doubled', async () => {
    const gmail = fakeGmail({
      originalHeaders: [header('Subject', 'RE: Pricing'), header('From', `Nathan <${ME}>`), header('To', 'client@acme.com'), header('Message-ID', '<m@x>')],
    });
    await run(gmail, { operation: 'Create Reply Draft', messageId: 'msg-1', body: 'Following up.' });
    const { headers } = decodeRaw(lastCall(gmail, 'drafts.create').args.requestBody.message.raw);
    expect(headers.to).toBe('client@acme.com');
    expect(headers.subject).toBe('RE: Pricing');
  });

  it('reply-all Cc excludes me and the primary recipient, de-duplicates, and keeps display names', async () => {
    const gmail = fakeGmail({
      originalHeaders: [
        header('Subject', 'Kickoff'),
        header('From', 'Ada <ada@example.com>'),
        header('To', `${ME}, "Doe, Jane" <jane@example.com>`),
        header('Cc', 'ADA@example.com, bob@example.com, jane@example.com'),
        header('Message-ID', '<k@x>'),
      ],
    });
    await run(gmail, { operation: 'Create Reply Draft', messageId: 'msg-1', body: 'See you then.', replyAll: 'true' });
    const { headers } = decodeRaw(lastCall(gmail, 'drafts.create').args.requestBody.message.raw);
    expect(headers.to).toBe('Ada <ada@example.com>');
    expect(headers.cc).toBe('"Doe, Jane" <jane@example.com>, bob@example.com');
  });

  it('Update Draft keeps omitted fields and the reply threading', async () => {
    const existingDraft = {
      id: 'draft-7',
      message: {
        id: 'dm', threadId: 'thread-3',
        payload: {
          mimeType: 'text/plain',
          headers: [header('To', 'ada@example.com'), header('Subject', 'Re: Plan'), header('In-Reply-To', '<p@x>'), header('References', '<p@x>')],
          body: { data: Buffer.from('old body').toString('base64url') },
        },
      },
    };
    const gmail = fakeGmail({ existingDraft });
    const result = await run(gmail, { operation: 'Update Draft', draftId: 'draft-7', body: 'new body' });

    expect(result).toMatchObject({ draftId: 'draft-7', threadId: 'thread-3', sent: false });
    const { id, requestBody } = lastCall(gmail, 'drafts.update').args;
    expect(id).toBe('draft-7');
    const { headers, body } = decodeRaw(requestBody.message.raw);
    expect(headers).toMatchObject({ to: 'ada@example.com', subject: 'Re: Plan', 'in-reply-to': '<p@x>', references: '<p@x>' });
    expect(body).toBe('new body');

    await run(gmail, { operation: 'Update Draft', draftId: 'draft-7', subject: 'Re: Plan v2' });
    expect(decodeRaw(lastCall(gmail, 'drafts.update').args.requestBody.message.raw).body).toBe('old body');
  });

  it('Update Draft refuses to silently drop existing attachments', async () => {
    const existingDraft = {
      id: 'draft-8',
      message: { threadId: 't', payload: { mimeType: 'multipart/mixed', headers: [], parts: [{ mimeType: 'application/pdf', filename: 'deck.pdf', body: { attachmentId: 'att-1', size: 10 } }] } },
    };
    const gmail = fakeGmail({ existingDraft });
    await expect(run(gmail, { operation: 'Update Draft', draftId: 'draft-8', body: 'x' })).rejects.toThrow(/has attachments/);
    expect(gmail.calls.some((call) => call.name === 'drafts.update')).toBe(false);
  });

  it('List Drafts returns summaries, forwards the query, and reports partial failures', async () => {
    const gmail = fakeGmail({ draftsList: ['d1', 'd2', 'd3'], failingDraftIds: ['d2'] });
    const result = await run(gmail, { operation: 'List Drafts', searchQuery: 'to:ada@example.com', maxResults: '2000' });

    expect(lastCall(gmail, 'drafts.list').args).toMatchObject({ q: 'to:ada@example.com', maxResults: 500 });
    expect(result.drafts.map((draft) => draft.draftId)).toEqual(['d1', 'd3']);
    expect(result.drafts[0]).toMatchObject({ subject: 'S d1', to: 'a@x.com', isReply: true, sent: false });
    expect(result.failedDraftIds).toEqual(['d2']);
    expect(result.nextPageToken).toBe('next');
  });

  it('Get Draft returns headers, body and attachment metadata', async () => {
    const existingDraft = {
      id: 'draft-5',
      message: {
        id: 'dm', threadId: 't5',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [header('To', 'a@x.com'), header('Subject', 'Hello')],
          parts: [
            { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('plain').toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from('<p>html</p>').toString('base64url') } }] },
            { mimeType: 'application/pdf', filename: 'deck.pdf', body: { attachmentId: 'a1', size: 42 } },
          ],
        },
      },
    };
    const result = await run(fakeGmail({ existingDraft }), { operation: 'Get Draft', draftId: 'draft-5' });
    expect(result).toMatchObject({ draftId: 'draft-5', subject: 'Hello', body: 'plain', bodyHtml: '<p>html</p>' });
    expect(result.attachments).toEqual([{ filename: 'deck.pdf', mimetype: 'application/pdf', size: 42 }]);
  });

  it('Delete Draft deletes by id', async () => {
    const gmail = fakeGmail();
    await expect(run(gmail, { operation: 'Delete Draft', draftId: 'draft-1' })).resolves.toEqual({ draftId: 'draft-1', deleted: true });
    expect(lastCall(gmail, 'drafts.delete').args).toEqual({ userId: 'me', id: 'draft-1' });
  });

  it.each(['Update Draft', 'Get Draft', 'Delete Draft'])('%s requires draftId', async (operation) => {
    await expect(run(fakeGmail(), { operation })).rejects.toThrow(/'draftId' is required/);
  });
});

describe('Gmail plugin contract', () => {
  const operations = manifest.tools[0].schema.parameters.operation.options;

  it('every manifest operation is implemented', async () => {
    for (const operation of operations) {
      const error = await gmailApi.runOperation(fakeGmail(), { operation }).then(() => null, (failure) => failure);
      expect(error?.message ?? '', operation).not.toMatch(/Unsupported Gmail operation/);
    }
  });

  it('every conditional names a real operation', () => {
    for (const [name, parameter] of Object.entries(manifest.tools[0].schema.parameters)) {
      if (!parameter.conditional) continue;
      for (const value of [].concat(parameter.conditional.value)) {
        expect(operations, `${name} → ${value}`).toContain(value);
      }
    }
  });

  it('versions agree across manifest and package.json', async () => {
    const { default: pkg } = await import('../../../../plugins/dev/gmail-plugin/package.json', { with: { type: 'json' } });
    expect(pkg.version).toBe(manifest.version);
  });

  it('execute reports a missing connection without throwing', async () => {
    await expect(gmailApi.execute({ operation: 'Create Draft' })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/Not connected to Google/) });
  });
});
