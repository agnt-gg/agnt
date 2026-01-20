import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Gmail API Plugin Tool
 *
 * Send, reply, read, organize, and manage attachments in Gmail.
 */
class GmailAPI {
  constructor() {
    this.name = 'gmail-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[GmailPlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: 'v1', auth });

      let result;
      const operation = params.operation ? params.operation.trim() : '';

      switch (operation) {
        case 'Send Email':
          result = await this.sendEmail(gmail, params);
          break;
        case 'Reply to Email':
          result = await this.replyToEmail(gmail, params);
          break;
        case 'Search and Read Emails':
          result = await this.searchAndReadEmails(gmail, params);
          break;
        case 'Read Email':
          result = await this.readEmail(gmail, params);
          break;
        case 'Modify Email':
          result = await this.modifyEmail(gmail, params);
          break;
        case 'Get Attachments':
          result = await this.getAttachments(gmail, params);
          break;
        default:
          throw new Error(`Unsupported Gmail operation: '${params.operation}'`);
      }

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[GmailPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async sendEmail(gmail, { to, subject, body, attachments }) {
    if (!to || !subject || !body) {
      throw new Error("'to', 'subject', and 'body' parameters are required for Send Email operation.");
    }
    const boundary = '----=' + new Date().getTime();
    let emailLines = [];

    emailLines.push(`To: ${to}`);
    emailLines.push(`Subject: ${subject}`);
    emailLines.push('MIME-Version: 1.0');

    const parsedAttachments = attachments
      ? typeof attachments === 'string'
        ? JSON.parse(attachments)
        : attachments
      : [];

    if (parsedAttachments && parsedAttachments.length > 0) {
      emailLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      emailLines.push('');
      emailLines.push(`--${boundary}`);
    }

    emailLines.push('Content-Type: text/html; charset=utf-8');
    emailLines.push('');
    emailLines.push(body);

    if (parsedAttachments && parsedAttachments.length > 0) {
      for (const attachment of parsedAttachments) {
        emailLines.push('');
        emailLines.push(`--${boundary}`);
        emailLines.push(`Content-Type: ${attachment.mimetype}`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
        emailLines.push('');
        emailLines.push(attachment.content);
      }
      emailLines.push('');
      emailLines.push(`--${boundary}--`);
    }

    const email = emailLines.join('\n');
    const base64EncodedEmail = Buffer.from(email).toString('base64url');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64EncodedEmail,
      },
    });
    return res.data;
  }

  async replyToEmail(gmail, { messageId, body, attachments }) {
    if (!messageId || !body) {
      throw new Error("'messageId' and 'body' are required for Reply operation.");
    }

    const originalMessageRes = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Message-ID', 'References'],
    });
    const originalMessage = originalMessageRes.data;
    const headers = originalMessage.payload.headers;

    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const subject = getHeader('subject');
    const from = getHeader('from');
    const messageIdHeader = getHeader('message-id');
    const references = getHeader('references');

    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    const boundary = '----=' + new Date().getTime();
    let emailLines = [];

    emailLines.push(`To: ${from}`);
    emailLines.push(`Subject: ${replySubject}`);
    emailLines.push(`In-Reply-To: ${messageIdHeader}`);
    emailLines.push(`References: ${references ? references + ' ' : ''}${messageIdHeader}`);
    emailLines.push('MIME-Version: 1.0');

    const parsedAttachments = attachments
      ? typeof attachments === 'string'
        ? JSON.parse(attachments)
        : attachments
      : [];

    if (parsedAttachments && parsedAttachments.length > 0) {
      emailLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      emailLines.push('');
      emailLines.push(`--${boundary}`);
    }

    emailLines.push('Content-Type: text/html; charset=utf-8');
    emailLines.push('');
    emailLines.push(body);

    if (parsedAttachments && parsedAttachments.length > 0) {
      for (const attachment of parsedAttachments) {
        emailLines.push('');
        emailLines.push(`--${boundary}`);
        emailLines.push(`Content-Type: ${attachment.mimetype}`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
        emailLines.push('');
        emailLines.push(attachment.content);
      }
      emailLines.push('');
      emailLines.push(`--${boundary}--`);
    }

    const email = emailLines.join('\n');
    const base64EncodedEmail = Buffer.from(email).toString('base64url');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64EncodedEmail,
        threadId: originalMessage.threadId,
      },
    });
    return res.data;
  }

  async searchAndReadEmails(gmail, { searchQuery, maxResults = 10 }) {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery || '',
      maxResults: parseInt(maxResults, 10),
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return [];
    }

    const emails = await Promise.all(
      messages.map(async (message) => {
        try {
          return await this.readEmail(gmail, { messageId: message.id });
        } catch (error) {
          console.error(`Failed to read email ${message.id}:`, error);
          return null;
        }
      })
    );

    return emails.filter((email) => email !== null);
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
