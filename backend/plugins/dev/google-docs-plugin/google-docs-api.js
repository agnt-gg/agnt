import { google } from 'googleapis';

/**
 * Google Docs API Plugin Tool
 *
 * Create, read, edit, template, and export Google Docs. Uses the Docs API
 * for text operations and the Drive API for markdown import, template
 * copying, folder placement, and export.
 */
class GoogleDocsAPI {
  constructor() {
    this.name = 'google-docs-api';
  }

  async execute(params, inputData, workflowEngine) {
    const { __auth, ...loggableParams } = params;
    console.log('[GoogleDocsPlugin] Executing with params:', JSON.stringify({ ...loggableParams, content: params.content ? `<${String(params.content).length} chars>` : undefined }, null, 2));
    this.validateParams(params);

    try {
      const accessToken = params.__auth?.token || (typeof workflowEngine?.getAuth === 'function' ? await workflowEngine.getAuth('google') : null);
      if (!accessToken) throw new Error('Not connected to Google. Connect in Settings → Connections.');

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const docs = google.docs({ version: 'v1', auth });
      const drive = google.drive({ version: 'v3', auth });

      let result;

      switch (params.action) {
        case 'CREATE_DOC':
          result = await this.createDoc(docs, drive, params);
          break;
        case 'CREATE_DOC_FROM_MARKDOWN':
          result = await this.createDocFromMarkdown(drive, params);
          break;
        case 'GET_DOC_TEXT':
          result = await this.getDocText(docs, params.documentId);
          break;
        case 'APPEND_TEXT':
          result = await this.appendText(docs, params);
          break;
        case 'REPLACE_TEXT':
          result = await this.replaceText(docs, params);
          break;
        case 'CREATE_FROM_TEMPLATE':
          result = await this.createFromTemplate(docs, drive, params);
          break;
        case 'EXPORT_DOC':
          result = await this.exportDoc(drive, params);
          break;
        case 'INSERT_IMAGE':
          result = await this.insertImage(docs, params);
          break;
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[GoogleDocsPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: this.friendlyError(error),
      };
    }
  }

  friendlyError(error) {
    const status = error.code || error.response?.status;
    if (status === 403) {
      return 'Google Docs access not granted. Reconnect Google in Settings → Connections to grant Docs permission. (' + error.message + ')';
    }
    if (status === 404) {
      return 'Document not found. Check the documentId. (' + error.message + ')';
    }
    return error.message;
  }

  async createDoc(docs, drive, params) {
    if (!params.title) throw new Error('title is required for CREATE_DOC');

    const createResponse = await docs.documents.create({
      requestBody: { title: params.title },
    });
    const documentId = createResponse.data.documentId;

    if (params.content) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: params.content,
              },
            },
          ],
        },
      });
    }

    if (params.folderId) {
      await this.moveToFolder(drive, documentId, params.folderId);
    }

    return {
      documentId,
      title: params.title,
      url: `https://docs.google.com/document/d/${documentId}/edit`,
    };
  }

  async createDocFromMarkdown(drive, params) {
    if (!params.title) throw new Error('title is required for CREATE_DOC_FROM_MARKDOWN');
    if (!params.content) throw new Error('content (markdown) is required for CREATE_DOC_FROM_MARKDOWN');

    // Drive converts markdown → native Google Doc on import
    const response = await drive.files.create({
      requestBody: {
        name: params.title,
        mimeType: 'application/vnd.google-apps.document',
        parents: params.folderId ? [params.folderId] : undefined,
      },
      media: {
        mimeType: 'text/markdown',
        body: params.content,
      },
      fields: 'id, name, webViewLink',
    });

    return {
      documentId: response.data.id,
      title: response.data.name,
      url: response.data.webViewLink,
    };
  }

  async getDocText(docs, documentId) {
    if (!documentId) throw new Error('documentId is required for GET_DOC_TEXT');

    const response = await docs.documents.get({ documentId });
    const text = this.extractText(response.data.body?.content || []);

    return {
      documentId,
      title: response.data.title,
      text,
      characterCount: text.length,
    };
  }

  /**
   * Recursively walk Docs structural elements and collect plain text.
   * Handles paragraphs, tables, and nested table cells.
   */
  extractText(content) {
    let text = '';
    for (const element of content) {
      if (element.paragraph) {
        for (const pe of element.paragraph.elements || []) {
          if (pe.textRun?.content) text += pe.textRun.content;
        }
      } else if (element.table) {
        for (const row of element.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            text += this.extractText(cell.content || []);
          }
        }
      } else if (element.tableOfContents) {
        text += this.extractText(element.tableOfContents.content || []);
      }
    }
    return text;
  }

  async appendText(docs, params) {
    if (!params.documentId) throw new Error('documentId is required for APPEND_TEXT');
    if (!params.content) throw new Error('content is required for APPEND_TEXT');

    // Find the end of the document body. The final structural element's
    // endIndex includes the trailing newline, which cannot be inserted at —
    // insert one position before it.
    const doc = await docs.documents.get({ documentId: params.documentId, fields: 'body(content(endIndex))' });
    const content = doc.data.body?.content || [];
    const endIndex = content.length ? content[content.length - 1].endIndex : 2;
    const insertIndex = Math.max(1, endIndex - 1);

    await docs.documents.batchUpdate({
      documentId: params.documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: insertIndex },
              text: '\n' + params.content,
            },
          },
        ],
      },
    });

    return { documentId: params.documentId, appendedCharacters: params.content.length + 1 };
  }

  async replaceText(docs, params) {
    if (!params.documentId) throw new Error('documentId is required for REPLACE_TEXT');
    if (!params.findText) throw new Error('findText is required for REPLACE_TEXT');
    if (params.replaceWith === undefined || params.replaceWith === null) {
      throw new Error('replaceWith is required for REPLACE_TEXT (use an empty string to delete matches)');
    }

    const response = await docs.documents.batchUpdate({
      documentId: params.documentId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: params.findText,
                matchCase: params.matchCase === 'true',
              },
              replaceText: params.replaceWith,
            },
          },
        ],
      },
    });

    const occurrences = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
    return { documentId: params.documentId, occurrencesChanged: occurrences };
  }

  async createFromTemplate(docs, drive, params) {
    if (!params.templateId) throw new Error('templateId is required for CREATE_FROM_TEMPLATE');
    if (!params.title) throw new Error('title is required for CREATE_FROM_TEMPLATE');

    let replacements = {};
    if (params.replacements) {
      try {
        replacements = typeof params.replacements === 'string' ? JSON.parse(params.replacements) : params.replacements;
      } catch (e) {
        throw new Error('replacements must be valid JSON, e.g. {"{{name}}": "Ada"}');
      }
    }

    // Copy the template
    const copyResponse = await drive.files.copy({
      fileId: params.templateId,
      requestBody: {
        name: params.title,
        parents: params.folderId ? [params.folderId] : undefined,
      },
      fields: 'id, name, webViewLink',
    });
    const documentId = copyResponse.data.id;

    // Swap all placeholders in one batchUpdate
    const entries = Object.entries(replacements);
    let occurrencesChanged = 0;
    if (entries.length > 0) {
      const response = await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: entries.map(([find, replace]) => ({
            replaceAllText: {
              containsText: { text: find, matchCase: true },
              replaceText: String(replace),
            },
          })),
        },
      });
      occurrencesChanged = (response.data.replies || []).reduce(
        (sum, r) => sum + (r.replaceAllText?.occurrencesChanged || 0),
        0
      );
    }

    return {
      documentId,
      title: copyResponse.data.name,
      url: copyResponse.data.webViewLink,
      placeholdersReplaced: occurrencesChanged,
    };
  }

  /**
   * Insert an inline image into an existing document.
   *
   * Placement (first match wins):
   *   1. insertAfterText — image goes in a new paragraph immediately AFTER the
   *      first paragraph containing this text.
   *   2. insertIndex — explicit body index (advanced).
   *   3. default — end of the document.
   *
   * The image URL must be publicly accessible (no auth/cookies), < 50 MB,
   * and PNG/JPEG/GIF — these are Google Docs API requirements.
   */
  async insertImage(docs, params) {
    if (!params.documentId) throw new Error('documentId is required for INSERT_IMAGE');
    if (!params.imageUrl) throw new Error('imageUrl is required for INSERT_IMAGE');
    if (!/^https?:\/\//i.test(params.imageUrl)) {
      throw new Error('imageUrl must be a public http(s) URL — Google fetches it server-side');
    }

    const doc = await docs.documents.get({
      documentId: params.documentId,
      fields: 'body(content(startIndex,endIndex,paragraph(elements(textRun(content)))))',
    });
    const content = doc.data.body?.content || [];
    const docEnd = content.length ? content[content.length - 1].endIndex : 2;

    // Resolve the paragraph-boundary index E such that the anchor paragraph's
    // trailing newline sits at E-1. Inserting "\n" at E-1 then the image at E
    // places the image in its own new paragraph right after the anchor.
    let boundary;
    let placement;
    if (params.insertAfterText) {
      let found = null;
      for (const el of content) {
        if (!el.paragraph) continue;
        const text = (el.paragraph.elements || []).map((e) => e.textRun?.content || '').join('');
        if (text.includes(params.insertAfterText)) { found = el; break; }
      }
      if (!found) throw new Error(`insertAfterText not found in document: "${params.insertAfterText}"`);
      boundary = found.endIndex;
      placement = 'after anchor text';
    } else if (params.insertIndex !== undefined && params.insertIndex !== null && params.insertIndex !== '') {
      const idx = parseInt(params.insertIndex, 10);
      if (isNaN(idx) || idx < 1 || idx >= docEnd) {
        throw new Error(`insertIndex must be an integer between 1 and ${docEnd - 1}`);
      }
      boundary = idx + 1;
      placement = 'explicit index';
    } else {
      boundary = docEnd;
      placement = 'end of document';
    }

    const image = {
      insertInlineImage: {
        location: { index: boundary },
        uri: params.imageUrl,
      },
    };
    const width = parseFloat(params.imageWidth);
    if (!isNaN(width) && width > 0) {
      image.insertInlineImage.objectSize = { width: { magnitude: width, unit: 'PT' } };
    }

    // Two requests in one atomic batchUpdate. The "\n" at boundary-1 splits a
    // new empty paragraph; indexes at/after boundary-1 shift +1, so the image
    // request at `boundary` lands inside that new paragraph.
    await docs.documents.batchUpdate({
      documentId: params.documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: boundary - 1 }, text: '\n' } },
          image,
        ],
      },
    });

    return {
      documentId: params.documentId,
      imageUrl: params.imageUrl,
      placement,
      insertedAtIndex: boundary,
      widthPt: !isNaN(width) && width > 0 ? width : null,
      url: `https://docs.google.com/document/d/${params.documentId}/edit`,
    };
  }

  async exportDoc(drive, params) {
    if (!params.documentId) throw new Error('documentId is required for EXPORT_DOC');

    const mimeTypes = {
      pdf: 'application/pdf',
      html: 'text/html',
      markdown: 'text/markdown',
      txt: 'text/plain',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const format = params.exportFormat || 'pdf';
    const mimeType = mimeTypes[format];
    if (!mimeType) throw new Error(`Unknown exportFormat: ${format}. Use one of: ${Object.keys(mimeTypes).join(', ')}`);

    const isBinary = format === 'pdf' || format === 'docx';
    const response = await drive.files.export(
      { fileId: params.documentId, mimeType },
      { responseType: isBinary ? 'arraybuffer' : 'text' }
    );

    return {
      documentId: params.documentId,
      format,
      mimeType,
      encoding: isBinary ? 'base64' : 'utf8',
      content: isBinary ? Buffer.from(response.data).toString('base64') : response.data,
    };
  }

  async moveToFolder(drive, fileId, folderId) {
    const file = await drive.files.get({ fileId, fields: 'parents' });
    await drive.files.update({
      fileId,
      addParents: folderId,
      removeParents: (file.data.parents || []).join(','),
    });
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required for Google Docs operations');
    }
  }
}

export default new GoogleDocsAPI();
