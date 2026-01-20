import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Dropbox API Plugin Tool
 *
 * Manage files and folders in Dropbox.
 */
class DropboxAPI {
  constructor() {
    this.name = 'dropbox-api';
    this.baseUrl = 'https://api.dropboxapi.com/2';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[DropboxPlugin] Executing with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      // Import AuthManager dynamically
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'dropbox');
      if (!accessToken) {
        throw new Error('No valid access token found. Please connect to Dropbox in Settings.');
      }

      params.accessToken = accessToken;

      let result;
      switch (params.action) {
        case 'LIST_FOLDER':
          result = await this.listFolder(params);
          break;
        case 'UPLOAD_FILE':
          result = await this.uploadFile(params);
          const sharedLink = await this.createSharedLink(params.path, params.accessToken);
          result.sharedLink = sharedLink;
          break;
        case 'DOWNLOAD_FILE':
          result = await this.downloadFile(params);
          break;
        case 'DELETE_FILE':
          result = await this.deleteFile(params);
          break;
        case 'MOVE_FILE':
          result = await this.moveFile(params);
          break;
        case 'CREATE_FOLDER':
          result = await this.createFolder(params);
          break;
        case 'GET_FILE_METADATA':
          result = await this.getFileMetadata(params);
          break;
        case 'CREATE_SHARED_LINK':
          result = await this.createSharedLink(params.path, params.accessToken);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[DropboxPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async listFolder(params) {
    const response = await this.makeRequest(
      '/files/list_folder',
      { method: 'POST', data: { path: params.path } },
      params.accessToken
    );
    return response.entries;
  }

  async uploadFile(params) {
    const url = 'https://content.dropboxapi.com/2/files/upload';
    const headers = {
      Authorization: `Bearer ${params.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path: params.path,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
      'Content-Type': 'application/octet-stream',
    };

    let content = params.content;
    if (typeof content === 'string') {
      const base64Data = content.replace(/^data:[^;]+;base64,/, '');
      content = Buffer.from(base64Data, 'base64');
    } else if (content instanceof Uint8Array) {
      content = Buffer.from(content);
    }

    if (!(content instanceof Buffer)) {
      throw new Error('Content must be a Buffer, Uint8Array, or base64 string');
    }

    const response = await axios({
      method: 'POST',
      url: url,
      headers: headers,
      data: content,
      maxBodyLength: Infinity,
    });

    return response.data;
  }

  async downloadFile(params) {
    const url = 'https://content.dropboxapi.com/2/files/download';
    const headers = {
      Authorization: `Bearer ${params.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: params.path }),
      'Content-Type': 'application/octet-stream',
    };

    const response = await axios({
      method: 'POST',
      url: url,
      headers: headers,
      responseType: 'arraybuffer',
    });

    return {
      filename: params.path.split('/').pop(),
      content: response.data,
      contentType: response.headers['content-type'],
    };
  }

  async deleteFile(params) {
    return await this.makeRequest(
      '/files/delete_v2',
      { method: 'POST', data: { path: params.path } },
      params.accessToken
    );
  }

  async moveFile(params) {
    return await this.makeRequest(
      '/files/move_v2',
      {
        method: 'POST',
        data: { from_path: params.path, to_path: params.newPath },
      },
      params.accessToken
    );
  }

  async createFolder(params) {
    return await this.makeRequest(
      '/files/create_folder_v2',
      { method: 'POST', data: { path: params.path } },
      params.accessToken
    );
  }

  async getFileMetadata(params) {
    return await this.makeRequest(
      '/files/get_metadata',
      { method: 'POST', data: { path: params.path } },
      params.accessToken
    );
  }

  async createSharedLink(path, accessToken) {
    try {
      const response = await this.makeRequest(
        '/sharing/create_shared_link_with_settings',
        {
          method: 'POST',
          data: {
            path: path,
            settings: { requested_visibility: 'public' },
          },
        },
        accessToken
      );
      return response.url;
    } catch (error) {
      console.error('[DropboxPlugin] Error creating shared link:', error);
      throw new Error(`Error creating shared link: ${error.message}`);
    }
  }

  async makeRequest(endpoint, options, accessToken) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await axios({
      url,
      ...options,
      headers,
      responseType: options.responseType || 'json',
    });

    return response.data;
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }
    if (!params.path) {
      throw new Error('Path is required');
    }
    if (params.action === 'UPLOAD_FILE' && !params.content) {
      throw new Error('Content is required for UPLOAD_FILE action');
    }
    if (params.action === 'MOVE_FILE' && !params.newPath) {
      throw new Error('New path is required for MOVE_FILE action');
    }
  }
}

export default new DropboxAPI();
