import BaseAction from '../BaseAction.js';
import { google } from 'googleapis';
import AuthManager from '../../../services/auth/AuthManager.js';

class GoogleDriveOperation extends BaseAction {
  static schema = {
    title: 'Google Drive API',
    category: 'action',
    type: 'google-drive-api',
    icon: 'google-drive',
    description: 'This action node interacts with Google Drive to perform various operations on files and folders.',
    authRequired: 'oauth',
    authProvider: 'google',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: ['LIST_FILES', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'CREATE_FOLDER', 'DELETE_FILE', 'MOVE_FILE', 'GET_FILE_INFO', 'SHARE_FILE'],
        description: 'The action to perform on Google Drive',
      },
      folderId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the folder (for LIST_FILES, UPLOAD_FILE, CREATE_FOLDER)',
        conditional: {
          field: 'action',
          value: ['LIST_FILES', 'UPLOAD_FILE', 'CREATE_FOLDER'],
        },
      },
      fileName: {
        type: 'string',
        inputType: 'text',
        description: 'The name or ID of the file',
        conditional: {
          field: 'action',
          value: ['UPLOAD_FILE', 'DOWNLOAD_FILE', 'DELETE_FILE', 'MOVE_FILE', 'GET_FILE_INFO', 'SHARE_FILE'],
        },
      },
      fileContent: {
        type: 'string',
        inputType: 'textarea',
        description: 'The content of the file to upload',
        conditional: {
          field: 'action',
          value: 'UPLOAD_FILE',
        },
      },
      newFolderName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the new folder to create',
        conditional: {
          field: 'action',
          value: 'CREATE_FOLDER',
        },
      },
      destinationFolderId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the destination folder',
        conditional: {
          field: 'action',
          value: 'MOVE_FILE',
        },
      },
      shareEmail: {
        type: 'string',
        inputType: 'text',
        description: 'Email address to share the file with',
        conditional: {
          field: 'action',
          value: 'SHARE_FILE',
        },
      },
      shareRole: {
        type: 'string',
        inputType: 'select',
        options: ['reader', 'writer', 'commenter'],
        description: 'The role to grant to the shared user',
        conditional: {
          field: 'action',
          value: 'SHARE_FILE',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the Google Drive operation was successful',
      },
      result: {
        type: 'object',
        description: 'The data returned by the Google Drive operation',
      },
      error: {
        type: 'string',
        description: 'Error message if the Google Drive operation failed',
      },
    },
  };

  constructor() {
    super('google-drive');
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    const resolvedParams = this.resolveParameters(params, workflowEngine);

    try {
      // Get the user's Google access token using the userId
      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const drive = google.drive({ version: 'v3', auth });

      let result;

      switch (resolvedParams.action) {
        case 'LIST_FILES':
          result = await this.listFiles(drive, resolvedParams.folderId);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(drive, resolvedParams.fileName, resolvedParams.fileContent, resolvedParams.folderId);
          break;
        case 'DOWNLOAD_FILE':
          result = await this.downloadFile(drive, resolvedParams.fileName);
          break;
        case 'CREATE_FOLDER':
          result = await this.createFolder(drive, resolvedParams.newFolderName, resolvedParams.folderId);
          break;
        case 'DELETE_FILE':
          result = await this.deleteFile(drive, resolvedParams.fileName);
          break;
        case 'MOVE_FILE':
          result = await this.moveFile(drive, resolvedParams.fileName, resolvedParams.destinationFolderId);
          break;
        case 'GET_FILE_INFO':
          result = await this.getFileInfo(drive, resolvedParams.fileName);
          break;
        case 'SHARE_FILE':
          result = await this.shareFile(drive, resolvedParams.fileName, resolvedParams.shareEmail, resolvedParams.shareRole);
          break;
        default:
          throw new Error(`Unknown action: ${resolvedParams.action}`);
      }

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('Error performing Google Drive operation:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
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
    // Add more specific validations based on the action if needed
  }

  resolveParameters(params, workflowEngine) {
    return workflowEngine.parameterResolver.resolveParameters(params);
  }
}

export default new GoogleDriveOperation();
