import { google } from 'googleapis';
import { Buffer } from 'buffer';
import {
  addressesOf,
  buildMimeMessage,
  parseAttachments,
  splitAddressList,
  toRaw,
  unfoldHeader,
} from './gmail-mime.js';

/**
 * Gmail API Plugin Tool
 *
 * Send, reply, draft, read, organize, and manage attachments in Gmail.
 *
 * Draft operations never send: they only call users.drafts.*, so a run limited
 * to them cannot deliver mail. Sending a draft is deliberately not offered here.
 */

const REPLY_HEADERS = ['Subject', 'From', 'Reply-To', 'To', 'Cc', 'Message-ID', 'References'];

const headerReader = (headers = []) => (name) =>
  headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';

class GmailAPI {
  constructor() {
    this.name = 'gmail-api';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      params = params ?? {};
      console.log('[GmailPlugin] Executing operation:', params.operation || '(missing)');

      const accessToken = params.__auth?.token;
      if (!accessToken) throw new Error('Not connected to Google. Connect in Settings → Connections.');

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: 'v1', auth });
      const result = await this.runOperation(gmail, params);

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      // Message only: provider client errors carry the outgoing request on
      // `error.config`, including the Authorization header, so logging the
      // error object writes the user's bearer token to disk.
      console.error('[GmailPlugin] Error:', error?.message || 'Unknown Gmail error');
      return {
        success: false,
        result: null,
        error: error?.message || 'Unknown Gmail error',
      };
    }
  }

  async runOperation(gmail, params) {
    const operation = params.operation ? params.operation.trim() : '';
    switch (operation) {
      case 'Send Email':
        return this.sendEmail(gmail, params);
      case 'Reply to Email':
        return this.replyToEmail(gmail, params);
      case 'Create Draft':
        return this.createDraft(gmail, params);
      case 'Create Reply Draft':
        return this.createReplyDraft(gmail, params);
      case 'Update Draft':
        return this.updateDraft(gmail, params);
      case 'List Drafts':
        return this.listDrafts(gmail, params);
      case 'Get Draft':
        return this.getDraft(gmail, params);
      case 'Delete Draft':
        return this.deleteDraft(gmail, params);
      case 'Search and Read Emails':
        return this.searchAndReadEmails(gmail, params);
      case 'List Emails Page':
        return this.listEmailsPage(gmail, params);
      case 'Read Email':
        return this.readEmail(gmail, params);
      case 'Modify Email':
        return this.modifyEmail(gmail, params);
      case 'Get Attachments':
        return this.getAttachments(gmail, params);
      default:
        throw new Error(`Unsupported Gmail operation: '${params.operation}'`);
    }
  }

  async sendEmail(gmail, { to, cc, bcc, subject, body, attachments }) {
    if (!to || !subject || !body) {
      throw new Error("'to', 'subject', and 'body' parameters are required for Send Email operation.");
    }
    const raw = toRaw(buildMimeMessage({ to, cc, bcc, subject, body, attachments }));
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return res.data;
  }

  async replyToEmail(gmail, params) {
    const { raw, threadId } = await this.composeReply(gmail, params, 'Reply to Email');
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } });
    return res.data;
  }

  /**
   * Build a threaded reply to messageId. Addressing follows Gmail's own rules:
   * Reply-To wins over From; replying to a message I sent goes to its original
   * recipients; reply-all adds the other To/Cc recipients minus me and the
   * primary recipient.
   */
  async composeReply(gmail, { messageId, body, attachments, replyAll }, operationName) {
    if (!messageId || !body) {
      throw new Error(`'messageId' and 'body' are required for ${operationName}.`);
    }

    const [{ data: original }, { data: profile }] = await Promise.all([
      gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: REPLY_HEADERS }),
      gmail.users.getProfile({ userId: 'me' }),
    ]);
    const getHeader = headerReader(original.payload?.headers);
    const myAddress = (profile.emailAddress || '').toLowerCase();

    const sender = unfoldHeader(getHeader('Reply-To') || getHeader('From'));
    const senderIsMe = addressesOf(sender).length > 0 && addressesOf(sender).every((email) => email === myAddress);
    const to = senderIsMe ? unfoldHeader(getHeader('To')) : sender;

    let cc = '';
    if (replyAll === true || replyAll === 'true') {
      const excluded = new Set([myAddress, ...addressesOf(to)]);
      const kept = [];
      for (const entry of [...splitAddressList(unfoldHeader(getHeader('To'))), ...splitAddressList(unfoldHeader(getHeader('Cc')))]) {
        const [email] = addressesOf(entry);
        if (!email || excluded.has(email)) continue;
        excluded.add(email);
        kept.push(entry);
      }
      cc = kept.join(', ');
    }

    const subject = unfoldHeader(getHeader('Subject'));
    const messageIdHeader = unfoldHeader(getHeader('Message-ID'));
    const references = [unfoldHeader(getHeader('References')), messageIdHeader].filter(Boolean).join(' ');

    const raw = toRaw(
      buildMimeMessage({
        to,
        cc,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        body,
        inReplyTo: messageIdHeader,
        references,
        attachments,
      })
    );
    return { raw, threadId: original.threadId };
  }

  draftSummary(draft) {
    return {
      draftId: draft.id,
      messageId: draft.message?.id,
      threadId: draft.message?.threadId,
      sent: false,
    };
  }

  async createDraft(gmail, { to, cc, bcc, subject, body, attachments }) {
    if (!subject && !body) {
      throw new Error("'subject' or 'body' is required for Create Draft.");
    }
    const raw = toRaw(buildMimeMessage({ to, cc, bcc, subject, body, attachments }));
    const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    return this.draftSummary(res.data);
  }

  async createReplyDraft(gmail, params) {
    const { raw, threadId } = await this.composeReply(gmail, params, 'Create Reply Draft');
    const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw, threadId } } });
    return this.draftSummary(res.data);
  }

  /**
   * Replace a draft's content. Omitted fields keep the draft's current value,
   * and threading headers are always preserved so a reply draft stays a reply.
   */
  async updateDraft(gmail, { draftId, to, cc, bcc, subject, body, attachments }) {
    if (!draftId) throw new Error("'draftId' is required for Update Draft.");

    const { data: existing } = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
    const payload = existing.message?.payload || {};
    const getHeader = headerReader(payload.headers);

    const hasNewAttachments = parseAttachments(attachments).length > 0;
    if (!hasNewAttachments && this.collectParts(payload).some((part) => part.filename && part.body?.attachmentId)) {
      // Rebuilding the message would silently drop them; make the caller decide.
      throw new Error('This draft has attachments. Pass them again in \'attachments\' to update it, or edit it in Gmail.');
    }

    const keep = (value, headerName) => (value === undefined || value === null || value === '' ? unfoldHeader(getHeader(headerName)) : value);
    const currentBody = this.extractBody(payload);
    const raw = toRaw(
      buildMimeMessage({
        to: keep(to, 'To'),
        cc: keep(cc, 'Cc'),
        bcc: keep(bcc, 'Bcc'),
        subject: keep(subject, 'Subject'),
        body: body === undefined || body === null || body === '' ? currentBody.html || currentBody.text : body,
        inReplyTo: getHeader('In-Reply-To'),
        references: getHeader('References'),
        attachments,
      })
    );

    const res = await gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: { id: draftId, message: { raw, threadId: existing.message?.threadId } },
    });
    return this.draftSummary(res.data);
  }

  async listDrafts(gmail, { searchQuery, pageToken, maxResults = 10 }) {
    const listRes = await gmail.users.drafts.list({
      userId: 'me',
      q: searchQuery || undefined,
      maxResults: this.normalizeMaxResults(maxResults),
      pageToken: pageToken || undefined,
    });

    const failedDraftIds = [];
    const drafts = await this.mapWithConcurrency(listRes.data.drafts || [], 10, async (draft) => {
      try {
        const { data } = await gmail.users.drafts.get({
          userId: 'me',
          id: draft.id,
          format: 'metadata',
          metadataHeaders: ['To', 'Cc', 'Subject', 'Date', 'In-Reply-To'],
        });
        const getHeader = headerReader(data.message?.payload?.headers);
        return {
          ...this.draftSummary(data),
          to: getHeader('To'),
          cc: getHeader('Cc'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          isReply: Boolean(getHeader('In-Reply-To')),
          snippet: data.message?.snippet || '',
        };
      } catch (error) {
        failedDraftIds.push(draft.id);
        console.error(`[GmailPlugin] Failed to read draft ${draft.id}:`, error?.message || 'Unknown Gmail error');
        return null;
      }
    });

    const result = {
      drafts: drafts.filter(Boolean),
      nextPageToken: listRes.data.nextPageToken || null,
      resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
    };
    if (failedDraftIds.length > 0) result.failedDraftIds = failedDraftIds;
    return result;
  }

  async getDraft(gmail, { draftId }) {
    if (!draftId) throw new Error("'draftId' is required for Get Draft.");
    const { data } = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
    const payload = data.message?.payload || {};
    const getHeader = headerReader(payload.headers);
    const body = this.extractBody(payload);
    return {
      ...this.draftSummary(data),
      to: getHeader('To'),
      cc: getHeader('Cc'),
      bcc: getHeader('Bcc'),
      subject: getHeader('Subject'),
      inReplyTo: getHeader('In-Reply-To'),
      body: body.text || body.html,
      bodyHtml: body.html,
      attachments: this.collectParts(payload)
        .filter((part) => part.filename && part.body?.attachmentId)
        .map((part) => ({ filename: part.filename, mimetype: part.mimeType, size: part.body.size })),
    };
  }

  async deleteDraft(gmail, { draftId }) {
    if (!draftId) throw new Error("'draftId' is required for Delete Draft.");
    await gmail.users.drafts.delete({ userId: 'me', id: draftId });
    return { draftId, deleted: true };
  }

  /** Every MIME part of a payload, depth-first, including the root. */
  collectParts(payload) {
    const parts = [];
    const visit = (part) => {
      if (!part) return;
      parts.push(part);
      (part.parts || []).forEach(visit);
    };
    visit(payload);
    return parts;
  }

  extractBody(payload) {
    const decode = (part) => (part?.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf-8') : '');
    const parts = this.collectParts(payload).filter((part) => !part.filename);
    return {
      text: decode(parts.find((part) => part.mimeType === 'text/plain')),
      html: decode(parts.find((part) => part.mimeType === 'text/html')),
    };
  }

  normalizeMaxResults(maxResults) {
    const parsed = Number.parseInt(maxResults, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(500, Math.max(1, parsed));
  }

  async mapWithConcurrency(items, concurrency, mapItem) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapItem(items[currentIndex], currentIndex);
      }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async readEmailMetadata(gmail, { messageId, metadataHeaders }) {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders,
    });
    const headers = res.data.payload?.headers || [];
    const getHeader = (name) => headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';

    return {
      id: res.data.id,
      threadId: res.data.threadId,
      snippet: res.data.snippet,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      labels: res.data.labelIds,
    };
  }

  async listEmailsPage(
    gmail,
    { searchQuery, pageToken, maxResults = 10, format = 'ids', metadataHeaders, includeSpamTrash = false }
  ) {
    const normalizedFormat = ['ids', 'metadata', 'full'].includes(format) ? format : 'ids';
    const normalizedHeaders = Array.isArray(metadataHeaders)
      ? metadataHeaders
      : typeof metadataHeaders === 'string' && metadataHeaders.trim()
        ? metadataHeaders.split(',').map((header) => header.trim()).filter(Boolean)
        : ['Subject', 'From', 'To', 'Date'];

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery || '',
      maxResults: this.normalizeMaxResults(maxResults),
      pageToken: pageToken || undefined,
      includeSpamTrash: includeSpamTrash === true || includeSpamTrash === 'true',
    });

    const listedMessages = listRes.data.messages || [];
    let messages = listedMessages.map(({ id, threadId }) => ({ id, threadId }));

    const failedMessageIds = [];
    const readMessage = async (message, read) => {
      try {
        return await read();
      } catch (error) {
        failedMessageIds.push(message.id);
        console.error(`Failed to read email ${message.id}:`, error?.message || 'Unknown Gmail error');
        return null;
      }
    };

    if (normalizedFormat === 'metadata') {
      messages = await this.mapWithConcurrency(listedMessages, 10, (message) =>
        readMessage(message, () => this.readEmailMetadata(gmail, {
          messageId: message.id,
          metadataHeaders: normalizedHeaders,
        }))
      );
    } else if (normalizedFormat === 'full') {
      messages = await this.mapWithConcurrency(listedMessages, 10, (message) =>
        readMessage(message, () => this.readEmail(gmail, { messageId: message.id }))
      );
    }

    const result = {
      messages: messages.filter(Boolean),
      nextPageToken: listRes.data.nextPageToken || null,
      resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
    };
    if (failedMessageIds.length > 0) result.failedMessageIds = failedMessageIds;
    return result;
  }

  async searchAndReadEmails(gmail, { searchQuery, maxResults = 10 }) {
    const page = await this.listEmailsPage(gmail, {
      searchQuery,
      maxResults,
      format: 'full',
    });
    return page.messages;
  }

  async modifyEmail(gmail, { messageId, addLabelIds, removeLabelIds }) {
    if (!messageId) {
      throw new Error("'messageId' is required for Modify Email operation.");
    }
    const add = addLabelIds ? (Array.isArray(addLabelIds) ? addLabelIds : [addLabelIds]) : [];
    const remove = removeLabelIds
      ? Array.isArray(removeLabelIds)
        ? removeLabelIds
        : [removeLabelIds]
      : [];

    if (add.length === 0 && remove.length === 0) {
      throw new Error("Either 'addLabelIds' or 'removeLabelIds' must be provided.");
    }

    const res = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: add,
        removeLabelIds: remove,
      },
    });
    return res.data;
  }

  async getAttachments(gmail, { messageId }) {
    if (!messageId) {
      throw new Error("'messageId' is required for Get Attachments operation.");
    }
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId });
    const payload = res.data.payload;

    if (!payload.parts) {
      return [];
    }

    const attachments = [];
    const parts = [payload, ...payload.parts];

    for (const part of parts) {
      if (part.filename && part.body && part.body.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: messageId,
          id: part.body.attachmentId,
        });
        attachments.push({
          filename: part.filename,
          mimetype: part.mimeType,
          size: attachment.data.size,
          content: attachment.data.data,
        });
      }
    }
    return attachments;
  }

  async readEmail(gmail, { messageId }) {
    if (!messageId) {
      throw new Error("'messageId' parameter is required for Read Email operation.");
    }
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = res.data.payload;
    const headers = payload.headers;

    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let body = '';
    const partsToSearch = [payload, ...(payload.parts || [])];
    const queue = partsToSearch.flatMap((p) => (p.parts ? p.parts : [p]));

    let textPart = queue.find((p) => p.mimeType === 'text/plain');
    let htmlPart = queue.find((p) => p.mimeType === 'text/html');

    let chosenPart = textPart || htmlPart;

    if (chosenPart && chosenPart.body && chosenPart.body.data) {
      body = Buffer.from(chosenPart.body.data, 'base64url').toString('utf-8');
    }

    return {
      id: res.data.id,
      threadId: res.data.threadId,
      snippet: res.data.snippet,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      labels: res.data.labelIds,
      body,
    };
  }
}

export default new GmailAPI();
