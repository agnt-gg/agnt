import BaseAction from '../BaseAction.js';
import AuthManager from '../../../services/auth/AuthManager.js';
import axios from 'axios';

class DropboxAPI extends BaseAction {
  static schema = {
    title: 'Dropbox API',
    category: 'action',
    type: 'dropbox-api',
    icon: 'dropbox',
    description: 'This action node interacts with Dropbox to perform various operations on files and folders.',
    authRequired: 'oauth',
    authProvider: 'dropbox',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: [
          'LIST_FOLDER',
          'UPLOAD_FILE',
          'DOWNLOAD_FILE',
          'DELETE_FILE',
          'MOVE_FILE',
          'CREATE_FOLDER',
          'GET_FILE_METADATA',
          'CREATE_SHARED_LINK',
        ],
        description: 'The action to perform on Dropbox',
      },
      path: {
        type: 'string',
        inputType: 'text',
        description: "The path of the file or folder in Dropbox (e.g., '/Documents/file.txt' or '/Photos/Vacation')",
        placeholder: '/path/to/file/or/folder',
      },
      content: {
        type: 'string',
        inputType: 'textarea',
        description: 'The content of the file to upload (for UPLOAD_FILE action)',
        conditional: {
          field: 'action',
          value: 'UPLOAD_FILE',
        },
      },
      newPath: {
        type: 'string',
        inputType: 'text',
        description: 'The new path for the file or folder (for MOVE_FILE action)',
        conditional: {
          field: 'action',
          value: 'MOVE_FILE',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the Dropbox operation was successful',
      },
      result: {
        type: 'object',
        description: 'The data returned by the Dropbox operation',
      },
      error: {
        type: 'string',
        description: 'Error message if the Dropbox operation failed',
      },
    },
  };

  constructor() {
    super('dropbox-api');
    this.baseUrl = 'https://api.dropboxapi.com/2';
  }
  async execute(params, inputData, workflowEngine) {
    console.log('Executing Dropbox API with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'dropbox');
      if (!accessToken) {
        throw new Error('No valid access token found. Please reconnect to Dropbox.');
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

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('Error executing Dropbox API:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }
  async listFolder(params) {
    const response = await this.makeRequest(
      '/files/list_folder',
      {
        method: 'POST',
        data: { path: params.path },
      },
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

    try {
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
    } catch (error) {
      console.error('Error uploading file to Dropbox:', error.response ? error.response.data : error.message);
      throw new Error(`Error uploading file to Dropbox: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    }
  }
  async downloadFile(params) {
    const url = 'https://content.dropboxapi.com/2/files/download';
    const headers = {
      Authorization: `Bearer ${params.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path: params.path,
      }),
      'Content-Type': 'application/octet-stream',
    };

    try {
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
    } catch (error) {
      console.error('Error downloading file from Dropbox:', error.response ? error.response.data : error.message);
      throw new Error(`Error downloading file from Dropbox: ${error.response ? error.response.data : error.message}`);
    }
  }
  async deleteFile(params) {
    const response = await this.makeRequest(
      '/files/delete_v2',
      {
        method: 'POST',
        data: { path: params.path },
      },
      params.accessToken
    );

    return response;
  }
  async moveFile(params) {
    const response = await this.makeRequest(
      '/files/move_v2',
      {
        method: 'POST',
        data: {
          from_path: params.path,
          to_path: params.newPath,
        },
      },
      params.accessToken
    );

    return response;
  }
  async createFolder(params) {
    const response = await this.makeRequest(
      '/files/create_folder_v2',
      {
        method: 'POST',
        data: { path: params.path },
      },
      params.accessToken
    );

    return response;
  }
  async getFileMetadata(params) {
    const response = await this.makeRequest(
      '/files/get_metadata',
      {
        method: 'POST',
        data: { path: params.path },
      },
      params.accessToken
    );

    return response;
  }
  async createSharedLink(path, accessToken) {
    try {
      const response = await this.makeRequest(
        '/sharing/create_shared_link_with_settings',
        {
          method: 'POST',
          data: {
            path: path,
            settings: {
              requested_visibility: 'public',
            },
          },
        },
        accessToken
      );

      console.log('Shared link created:', response.url);

      return response.url;
    } catch (error) {
      console.error('Error creating shared link:', error);
      throw new Error(`Error creating shared link: ${error.message}`);
    }
  }
  async makeRequest(endpoint, options, accessToken) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': options.headers?.['Content-Type'] || 'application/json',
      ...options.headers,
    };

    try {
      const response = await axios({
        url,
        ...options,
        headers,
        responseType: options.responseType || 'json',
      });

      return response.data;
    } catch (error) {
      console.error('Dropbox API error:', error.response ? error.response.data : error.message);
      throw new Error(`Dropbox API error: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    }
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
    if (params.action === 'CREATE_SHARED_LINK' && !params.path) {
      throw new Error('Path is required for CREATE_SHARED_LINK action');
    }
  }
  formatOutput(output) {
    return {
      success: output.success,
      result: output.result,
      error: output.error,
    };
  }
}

export default new DropboxAPI();
