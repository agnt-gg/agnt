import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Google Drive API Plugin Tool
 *
 * Manage files and folders in Google Drive.
 */
class GoogleDriveAPI {
  constructor() {
    this.name = 'google-drive-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[GoogleDrivePlugin] Executing with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

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

      const drive = google.drive({ version: 'v3', auth });

      let result;

      switch (params.action) {
        case 'LIST_FILES':
          result = await this.listFiles(drive, params.folderId);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(drive, params.fileName, params.fileContent, params.folderId);
          break;
        case 'DOWNLOAD_FILE':
          result = await this.downloadFile(drive, params.fileName);
          break;
        case 'CREATE_FOLDER':
          result = await this.createFolder(drive, params.newFolderName, params.folderId);
          break;
        case 'DELETE_FILE':
          result = await this.deleteFile(drive, params.fileName);
          break;
        case 'MOVE_FILE':
          result = await this.moveFile(drive, params.fileName, params.destinationFolderId);
          break;
        case 'GET_FILE_INFO':
          result = await this.getFileInfo(drive, params.fileName);
          break;
        case 'SHARE_FILE':
          result = await this.shareFile(drive, params.fileName, params.shareEmail, params.shareRole);
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
      console.error('[GoogleDrivePlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async listFiles(drive, folderId) {
    const response = await drive.files.list({
      q: folderId ? `'${folderId}' in parents` : null,
      fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
    });
    return { fileList: response.data.files };
  }

  async uploadFile(drive, fileName, fileContent, folderId) {
    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : [],
    };
    const media = {
      mimeType: 'text/plain',
      body: fileContent,
    };
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    return { fileId: response.data.id };
  }

  async downloadFile(drive, fileId) {
    const response = await drive.files.get({
      fileId: fileId,
      fields: 'webContentLink',
    });
    return { downloadUrl: response.data.webContentLink };
  }

  async createFolder(drive, folderName, parentFolderId) {
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : [],
    };
    const response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
    });
    return { fileId: response.data.id };
  }

  async deleteFile(drive, fileId) {
    await drive.files.delete({ fileId: fileId });
    return { success: true };
  }

  async moveFile(drive, fileId, destinationFolderId) {
    const file = await drive.files.get({
      fileId: fileId,
      fields: 'parents',
    });
    const previousParents = file.data.parents.join(',');
    const response = await drive.files.update({
      fileId: fileId,
      addParents: destinationFolderId,
      removeParents: previousParents,
      fields: 'id, parents',
    });
    return { fileId: response.data.id, newParents: response.data.parents };
  }

  async getFileInfo(drive, fileId) {
    const response = await drive.files.get({
      fileId: fileId,
      fields: '*',
    });
    return { fileInfo: response.data };
  }

  async shareFile(drive, fileId, email, role) {
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        type: 'user',
        role: role,
        emailAddress: email,
      },
    });
    const shareResponse = await drive.files.get({
      fileId: fileId,
      fields: 'webViewLink',
    });
    return { shareLink: shareResponse.data.webViewLink };
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required for Google Drive operations');
    }
  }
}

export default new GoogleDriveAPI();
