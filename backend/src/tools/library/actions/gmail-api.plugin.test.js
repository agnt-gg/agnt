import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The mock has to be COMPLETE ENOUGH TO RUN execute(), not merely present.
 *
 * `googleapis` is declared by backend/plugins/dev/gmail-plugin/package.json and
 * installed into that plugin's own node_modules — which .gitignore excludes and
 * no install step in CI creates (the workflow runs `npm ci` at the root only).
 * So on a fresh clone the plugin's `import { google } from 'googleapis'` has no
 * real module to resolve and this mock is what answers it.
 *
 * The first version returned `{ google: {} }`. That passed HERE only because a
 * developer machine has the plugin's node_modules, so the real library shadowed
 * the mock and it was never exercised. The moment it did apply — CI, or any
 * fresh checkout — execute() died on `new google.auth.OAuth2()` with
 * "Cannot read properties of undefined (reading 'OAuth2')".
 *
 * Only the two execute() tests reach this; every other test passes its own
 * gmail fixture straight to listEmailsPage. So the stub covers exactly the two
 * calls execute() makes, and the suite now runs identically with or without
 * the real library installed.
 */
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(credentials) { this.credentials = credentials; }
      },
    },
    gmail: () => ({ users: { messages: { list: async () => ({ data: {} }), get: async () => ({ data: {} }) } } }),
  },
}));

import fs from 'fs';
import { fileURLToPath } from 'url';
import GmailAPI from '../../../../plugins/dev/gmail-plugin/gmail-api.js';
import BuiltInGmailAPI from './_gmail-api.js';

const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../../plugins/dev/gmail-plugin/manifest.json', import.meta.url)), 'utf8'));

afterEach(() => {
  vi.restoreAllMocks();
});

function gmailFixture({ messages = [], nextPageToken = null, resultSizeEstimate = 0, onGet } = {}) {
  const list = async (params) => ({
    data: { messages, nextPageToken, resultSizeEstimate, receivedParams: params },
  });
  const get = async (params) => {
    if (onGet) await onGet(params);
    return {
      data: {
        id: params.id,
        threadId: `thread-${params.id}`,
        snippet: `snippet-${params.id}`,
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'Subject', value: `subject-${params.id}` },
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Date', value: 'Thu, 4 Sep 2026 10:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from(`body-${params.id}`).toString('base64url') },
        },
      },
    };
  };

  return { users: { messages: { list, get } } };
}

describe('Gmail List Emails Page', () => {
  it('uses injected auth at the public execution boundary without logging the token', async () => {
    const page = { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: null, resultSizeEstimate: 1 };
    const listEmailsPage = vi.spyOn(GmailAPI, 'listEmailsPage').mockResolvedValue(page);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const token = 'google-oauth-secret';

    const result = await GmailAPI.execute({
      operation: 'List Emails Page',
      format: 'ids',
      __auth: { token, provider: 'google' },
    });

    expect(result.success, result.error).toBe(true);
    expect(result.result).toEqual(page);
    expect(listEmailsPage).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it('never logs the bearer token when the provider error carries the request headers', async () => {
    const token = 'qa-provider-secret';
    const providerError = new Error('Request failed with status code 401');
    providerError.config = { headers: { Authorization: `Bearer ${token}` } };
    vi.spyOn(GmailAPI, 'listEmailsPage').mockRejectedValue(providerError);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await GmailAPI.execute({
      operation: 'List Emails Page',
      __auth: { token, provider: 'google' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Request failed with status code 401');
    expect(JSON.stringify(error.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it('never logs the bearer token when a single message read fails', async () => {
    const token = 'qa-provider-secret';
    const gmail = gmailFixture({ messages: [{ id: 'bad' }] });
    gmail.users.messages.get = async () => {
      const providerError = new Error('message disappeared');
      providerError.config = { headers: { Authorization: `Bearer ${token}` } };
      throw providerError;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await GmailAPI.listEmailsPage(gmail, { format: 'full' });

    expect(result.messages).toEqual([]);
    expect(result.failedMessageIds).toEqual(['bad']);
    expect(JSON.stringify(error.mock.calls)).not.toContain(token);
  });

  it.each([undefined, null])('returns a structured failure for params %p', async (params) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await GmailAPI.execute(params);

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(typeof result.error).toBe('string');
  });

  it('is exposed by both Gmail schemas with cursor and payload controls', () => {
    for (const parameters of [manifest.tools[0].schema.parameters, BuiltInGmailAPI.constructor.schema.parameters]) {
      expect(parameters.operation.options).toContain('List Emails Page');
      expect(parameters.pageToken.conditional.value).toBe('List Emails Page');
      expect(parameters.format.options).toEqual(['ids', 'metadata', 'full']);
      expect(parameters.maxResults.conditional.value).toContain('List Emails Page');
    }
  });

  it('keeps built-in page behavior aligned with the plugin', async () => {
    const gmail = gmailFixture({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'next' });
    const result = await BuiltInGmailAPI.listEmailsPage(gmail, { format: 'ids', maxResults: 500 });
    expect(result).toEqual({
      messages: [{ id: 'm1', threadId: 't1' }],
      nextPageToken: 'next',
      resultSizeEstimate: 0,
    });
  });

  it('forwards the cursor and returns the continuation metadata', async () => {
    let received;
    const gmail = gmailFixture({
      messages: [{ id: 'm1', threadId: 't1' }],
      nextPageToken: 'next-2',
      resultSizeEstimate: 731,
    });
    const originalList = gmail.users.messages.list;
    gmail.users.messages.list = async (params) => {
      received = params;
      return originalList(params);
    };

    const result = await GmailAPI.listEmailsPage(gmail, {
      searchQuery: 'from:me',
      pageToken: 'page-1',
      maxResults: 125,
      format: 'ids',
      includeSpamTrash: true,
    });

    expect(received).toEqual({
      userId: 'me',
      q: 'from:me',
      maxResults: 125,
      pageToken: 'page-1',
      includeSpamTrash: true,
    });
    expect(result).toEqual({
      messages: [{ id: 'm1', threadId: 't1' }],
      nextPageToken: 'next-2',
      resultSizeEstimate: 731,
    });
  });

  it.each([
    ['nonsense', 10],
    [0, 1],
    [-20, 1],
    [9999, 500],
  ])('normalizes maxResults %p to %i', async (requested, expected) => {
    let received;
    const gmail = gmailFixture();
    const originalList = gmail.users.messages.list;
    gmail.users.messages.list = async (params) => {
      received = params;
      return originalList(params);
    };

    await GmailAPI.listEmailsPage(gmail, { maxResults: requested, format: 'ids' });
    expect(received.maxResults).toBe(expected);
  });

  it('preserves pagination metadata for an empty page', async () => {
    const gmail = gmailFixture({ nextPageToken: 'still-more', resultSizeEstimate: 99 });
    await expect(GmailAPI.listEmailsPage(gmail, { format: 'ids' })).resolves.toEqual({
      messages: [],
      nextPageToken: 'still-more',
      resultSizeEstimate: 99,
    });
  });

  it('bounds full-message reads instead of launching an unbounded Promise.all', async () => {
    let active = 0;
    let peak = 0;
    const messages = Array.from({ length: 40 }, (_, index) => ({ id: `m${index + 1}` }));
    const gmail = gmailFixture({
      messages,
      onGet: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      },
    });

    const result = await GmailAPI.listEmailsPage(gmail, { format: 'full', maxResults: 40 });

    expect(result.messages).toHaveLength(40);
    expect(peak).toBeLessThanOrEqual(10);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns the rest of a page when one full-message read fails', async () => {
    const gmail = gmailFixture({
      messages: [{ id: 'good-1' }, { id: 'bad' }, { id: 'good-2' }],
    });
    const originalGet = gmail.users.messages.get;
    gmail.users.messages.get = async (params) => {
      if (params.id === 'bad') throw new Error('message disappeared');
      return originalGet(params);
    };

    const result = await GmailAPI.listEmailsPage(gmail, { format: 'full' });

    expect(result.messages.map((message) => message.id)).toEqual(['good-1', 'good-2']);
    expect(result.failedMessageIds).toEqual(['bad']);
  });

  it('keeps the legacy Search and Read Emails array response', async () => {
    const gmail = gmailFixture({ messages: [{ id: 'legacy' }] });
    const result = await GmailAPI.searchAndReadEmails(gmail, { searchQuery: 'from:me', maxResults: 10 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe('legacy');
  });
});
