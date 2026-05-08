import http from 'http';
import https from 'https';
import { URL } from 'url';

const DEFAULT_BASE_URL = 'https://127.0.0.1:27124';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

class ObsidianAPI {
  constructor() {
    this.name = 'obsidian-api';
  }

  async execute(params = {}, inputData, workflowEngine) {
    const action = String(params.action || 'CHECK_STATUS').toUpperCase();
    console.log('[ObsidianPlugin] Executing action:', action);

    try {
      const apiKey = this.requireApiKey(params);
      const client = this.createClient(params, apiKey);

      switch (action) {
        case 'CHECK_STATUS':
          return await this.checkStatus(client, action);

        case 'LIST_FILES':
          return await this.listFiles(client, params, action);
        case 'READ_NOTE':
          return await this.readNote(client, params, action);
        case 'CREATE_OR_REPLACE_NOTE':
          return await this.writeVaultFile(client, params, action, 'PUT');
        case 'APPEND_TO_NOTE':
          return await this.writeVaultFile(client, params, action, 'POST');
        case 'PATCH_NOTE':
          return await this.patchVaultFile(client, params, action);
        case 'DELETE_NOTE':
          return await this.deleteVaultFile(client, params, action);
        case 'OPEN_NOTE':
          return await this.openNote(client, params, action);

        case 'GET_ACTIVE_FILE':
          return await this.activeFile(client, params, action, 'GET');
        case 'REPLACE_ACTIVE_FILE':
          return await this.activeFile(client, params, action, 'PUT');
        case 'APPEND_ACTIVE_FILE':
          return await this.activeFile(client, params, action, 'POST');
        case 'PATCH_ACTIVE_FILE':
          return await this.patchActiveFile(client, params, action);
        case 'DELETE_ACTIVE_FILE':
          return await this.activeFile(client, params, action, 'DELETE');

        case 'SEARCH_SIMPLE':
          return await this.searchSimple(client, params, action);
        case 'SEARCH_DQL':
          return await this.searchAdvanced(client, params, action, 'application/vnd.olrapi.dataview.dql+txt');
        case 'SEARCH_JSONLOGIC':
          return await this.searchAdvanced(client, params, action, 'application/vnd.olrapi.jsonlogic+json');

        case 'GET_PERIODIC_NOTE':
          return await this.periodicNote(client, params, action, 'GET');
        case 'CREATE_OR_REPLACE_PERIODIC_NOTE':
          return await this.periodicNote(client, params, action, 'PUT');
        case 'APPEND_PERIODIC_NOTE':
          return await this.periodicNote(client, params, action, 'POST');
        case 'PATCH_PERIODIC_NOTE':
          return await this.patchPeriodicNote(client, params, action);
        case 'DELETE_PERIODIC_NOTE':
          return await this.periodicNote(client, params, action, 'DELETE');

        case 'LIST_TAGS':
          return await this.simpleGet(client, '/tags/', action, 'tags');
        case 'LIST_COMMANDS':
          return await this.simpleGet(client, '/commands/', action, 'commands');
        case 'EXECUTE_COMMAND':
          return await this.executeCommand(client, params, action);
        case 'GET_OPENAPI_SPEC':
          return await this.simpleGet(client, '/openapi.yaml', action, 'content');
        case 'GET_CERTIFICATE':
          return await this.simpleGet(client, '/obsidian-local-rest-api.crt', action, 'content');

        default:
          throw new Error(`Unsupported Obsidian action: ${action}`);
      }
    } catch (error) {
      console.error('[ObsidianPlugin] Error:', error.message);
      return this.errorResult(action, error);
    }
  }

  requireApiKey(params) {
    const apiKey = params?.__auth?.token;
    if (!apiKey) {
      throw new Error('Not connected to Obsidian. Store your Obsidian Local REST API key in AGNT provider "obsidian".');
    }
    return apiKey;
  }

  createClient(params, apiKey) {
    const baseUrl = this.normalizeBaseUrl(params.baseUrl || DEFAULT_BASE_URL);
    const url = new URL(baseUrl);
    const allowSelfSigned = this.toBoolean(params.allowSelfSignedLocalhostCert, true);
    const timeoutMs = this.toPositiveInt(params.timeoutMs, 30000);

    if (allowSelfSigned && !this.isLocalBaseUrl(baseUrl)) {
      throw new Error('allowSelfSignedLocalhostCert can only be used with localhost/loopback Obsidian URLs. Disable it for non-local URLs.');
    }

    const agent = url.protocol === 'https:' && allowSelfSigned
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    return { baseUrl, apiKey, timeoutMs, agent };
  }

  normalizeBaseUrl(baseUrl) {
    const trimmed = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const url = new URL(trimmed);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('baseUrl must start with http:// or https://');
    }
    return trimmed;
  }

  isLocalBaseUrl(baseUrl) {
    const host = new URL(baseUrl).hostname;
    return LOCAL_HOSTNAMES.has(host) || host.startsWith('127.') || host === '::1';
  }

  async request(client, endpoint, { method = 'GET', body, headers = {}, responseKind = 'auto' } = {}) {
    const url = new URL(`${client.baseUrl}${endpoint}`);
    const requestHeaders = {
      Authorization: `Bearer ${client.apiKey}`,
      Accept: '*/*',
      ...headers,
    };

    let requestBody = body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      requestBody = JSON.stringify(body);
      if (!requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json';
    }

    if (['GET', 'HEAD'].includes(method)) {
      requestBody = undefined;
    }

    if (requestBody !== undefined && requestBody !== null) {
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const transport = url.protocol === 'https:' ? https : http;
    const requestOptions = {
      method,
      headers: requestHeaders,
      timeout: client.timeoutMs,
    };

    if (url.protocol === 'https:' && client.agent) {
      requestOptions.agent = client.agent;
    }

    return await new Promise((resolve, reject) => {
      const req = transport.request(url, requestOptions, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const contentType = res.headers['content-type'] || '';
          let data = raw;

          if (responseKind === 'json' || (responseKind === 'auto' && String(contentType).includes('application/json'))) {
            try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
          } else if (responseKind === 'auto') {
            try { data = raw ? JSON.parse(raw) : raw; } catch { data = raw; }
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message = this.extractErrorMessage(data) || raw || `HTTP ${res.statusCode}`;
            const err = new Error(`Obsidian ${method} ${endpoint} failed with HTTP ${res.statusCode}: ${message}`);
            err.status = res.statusCode;
            err.data = data;
            reject(err);
            return;
          }

          resolve({ status: res.statusCode, contentType: String(contentType), data, raw });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Obsidian request timed out after ${client.timeoutMs}ms: ${method} ${endpoint}`));
      });
      req.on('error', reject);

      if (requestBody !== undefined && requestBody !== null) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  extractErrorMessage(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    return data.message || data.error || data.detail || data.reason || '';
  }

  encodePath(pathValue) {
    const path = String(pathValue || '').trim().replace(/^\/+/, '');
    if (!path) throw new Error('`path` is required for this Obsidian action.');
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  }

  contentType(params, fallback = 'text/markdown') {
    return params.contentType || fallback;
  }

  requireContent(params) {
    if (params.content === undefined || params.content === null) {
      throw new Error('`content` is required for this Obsidian action.');
    }
    return String(params.content);
  }

  patchHeaders(params) {
    const operation = String(params.operation || 'append').toLowerCase();
    if (!['append', 'prepend', 'replace'].includes(operation)) {
      throw new Error('`operation` must be one of: append, prepend, replace.');
    }

    const targetType = params.targetType ? String(params.targetType).toLowerCase() : '';
    const headers = {
      Operation: operation,
      'Content-Type': this.contentType(params),
    };

    if (targetType) {
      if (!['heading', 'block', 'frontmatter'].includes(targetType)) {
        throw new Error('`targetType` must be one of: heading, block, frontmatter.');
      }
      headers['Target-Type'] = targetType;
      if (!params.target) throw new Error('`target` is required when `targetType` is provided.');
      headers.Target = String(params.target);
    }

    if (params.createTargetIfMissing !== undefined && params.createTargetIfMissing !== '') {
      headers['Create-Target-If-Missing'] = this.toBoolean(params.createTargetIfMissing, false) ? 'true' : 'false';
    }
    if (params.applyIfContentPreexists !== undefined && params.applyIfContentPreexists !== '') {
      headers['Apply-If-Content-Preexists'] = this.toBoolean(params.applyIfContentPreexists, false) ? 'true' : 'false';
    }
    if (params.trimTargetWhitespace !== undefined && params.trimTargetWhitespace !== '') {
      headers['Trim-Target-Whitespace'] = this.toBoolean(params.trimTargetWhitespace, false) ? 'true' : 'false';
    }

    return headers;
  }

  periodicEndpoint(params) {
    const period = String(params.period || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) {
      throw new Error('`period` must be one of: daily, weekly, monthly, quarterly, yearly.');
    }

    const year = String(params.year || '').trim();
    const month = String(params.month || '').trim();
    const day = String(params.day || '').trim();

    if (year || month || day) {
      if (!year || !month || !day) {
        throw new Error('For dated periodic notes, provide year, month, and day together.');
      }
      return `/periodic/${encodeURIComponent(period)}/${encodeURIComponent(year)}/${encodeURIComponent(month)}/${encodeURIComponent(day)}/`;
    }

    return `/periodic/${encodeURIComponent(period)}/`;
  }

  async checkStatus(client, action) {
    const response = await this.request(client, '/', { method: 'GET' });
    return this.successResult(action, response, { message: 'Connected to Obsidian Local REST API.' });
  }

  async listFiles(client, params, action) {
    const directory = String(params.path || '').trim().replace(/^\/+/, '');
    const endpoint = directory ? `/vault/${this.encodePath(directory)}/` : '/vault/';
    const response = await this.request(client, endpoint, { method: 'GET', responseKind: 'auto' });
    return this.successResult(action, response, { path: directory, data: response.data });
  }

  async readNote(client, params, action) {
    const endpoint = `/vault/${this.encodePath(params.path)}`;
    const headers = this.optionalTargetHeaders(params);
    const response = await this.request(client, endpoint, { method: 'GET', headers });
    return this.successResult(action, response, { path: params.path, content: response.raw, data: response.data });
  }

  async writeVaultFile(client, params, action, method) {
    const endpoint = `/vault/${this.encodePath(params.path)}`;
    const response = await this.request(client, endpoint, {
      method,
      body: this.requireContent(params),
      headers: { 'Content-Type': this.contentType(params) },
    });
    return this.successResult(action, response, { path: params.path, content: response.raw, data: response.data });
  }

  async patchVaultFile(client, params, action) {
    const endpoint = `/vault/${this.encodePath(params.path)}`;
    const response = await this.request(client, endpoint, {
      method: 'PATCH',
      body: this.requireContent(params),
      headers: this.patchHeaders(params),
    });
    return this.successResult(action, response, { path: params.path, data: response.data, content: response.raw });
  }

  async deleteVaultFile(client, params, action) {
    const endpoint = `/vault/${this.encodePath(params.path)}`;
    const response = await this.request(client, endpoint, { method: 'DELETE' });
    return this.successResult(action, response, { path: params.path });
  }

  async openNote(client, params, action) {
    const endpoint = `/open/${this.encodePath(params.path)}`;
    const response = await this.request(client, endpoint, { method: 'POST' });
    return this.successResult(action, response, { path: params.path });
  }

  optionalTargetHeaders(params) {
    const headers = {};
    if (params.targetType) {
      const targetType = String(params.targetType).toLowerCase();
      if (!['heading', 'block', 'frontmatter'].includes(targetType)) {
        throw new Error('`targetType` must be one of: heading, block, frontmatter.');
      }
      headers['Target-Type'] = targetType;
      if (!params.target) throw new Error('`target` is required when `targetType` is provided.');
      headers.Target = String(params.target);
    }
    return headers;
  }

  async activeFile(client, params, action, method) {
    const options = { method };
    if (['PUT', 'POST'].includes(method)) {
      options.body = this.requireContent(params);
      options.headers = { 'Content-Type': this.contentType(params) };
    }
    const response = await this.request(client, '/active/', options);
    return this.successResult(action, response, { content: response.raw, data: response.data });
  }

  async patchActiveFile(client, params, action) {
    const response = await this.request(client, '/active/', {
      method: 'PATCH',
      body: this.requireContent(params),
      headers: this.patchHeaders(params),
    });
    return this.successResult(action, response, { content: response.raw, data: response.data });
  }

  async searchSimple(client, params, action) {
    const query = String(params.query || '').trim();
    if (!query) throw new Error('`query` is required for SEARCH_SIMPLE.');
    const endpoint = `/search/simple/?query=${encodeURIComponent(query)}`;
    const response = await this.request(client, endpoint, { method: 'POST', responseKind: 'auto' });
    return this.successResult(action, response, { query, results: response.data, data: response.data });
  }

  async searchAdvanced(client, params, action, contentType) {
    const query = String(params.query || '').trim();
    if (!query) throw new Error('`query` is required for this search action.');
    const response = await this.request(client, '/search/', {
      method: 'POST',
      body: action === 'SEARCH_JSONLOGIC' ? this.parseJsonLogic(query) : query,
      headers: { 'Content-Type': contentType },
      responseKind: 'auto',
    });
    return this.successResult(action, response, { query, results: response.data, data: response.data });
  }

  parseJsonLogic(query) {
    try {
      JSON.parse(query);
      return query;
    } catch {
      throw new Error('SEARCH_JSONLOGIC requires `query` to be valid JSONLogic JSON.');
    }
  }

  async periodicNote(client, params, action, method) {
    const endpoint = this.periodicEndpoint(params);
    const options = { method };
    if (['PUT', 'POST'].includes(method)) {
      options.body = this.requireContent(params);
      options.headers = { 'Content-Type': this.contentType(params) };
    }
    const response = await this.request(client, endpoint, options);
    return this.successResult(action, response, { period: params.period || 'daily', content: response.raw, data: response.data });
  }

  async patchPeriodicNote(client, params, action) {
    const endpoint = this.periodicEndpoint(params);
    const response = await this.request(client, endpoint, {
      method: 'PATCH',
      body: this.requireContent(params),
      headers: this.patchHeaders(params),
    });
    return this.successResult(action, response, { period: params.period || 'daily', content: response.raw, data: response.data });
  }

  async simpleGet(client, endpoint, action, dataKey) {
    const response = await this.request(client, endpoint, { method: 'GET' });
    return this.successResult(action, response, { [dataKey]: response.data, data: response.data, content: response.raw });
  }

  async executeCommand(client, params, action) {
    const commandId = String(params.commandId || '').trim();
    if (!commandId) throw new Error('`commandId` is required for EXECUTE_COMMAND.');
    const endpoint = `/commands/${encodeURIComponent(commandId)}/`;
    const response = await this.request(client, endpoint, { method: 'POST' });
    return this.successResult(action, response, { commandId, data: response.data });
  }

  successResult(action, response, extra = {}) {
    return {
      success: true,
      action,
      status: response.status,
      contentType: response.contentType,
      error: null,
      ...extra,
    };
  }

  errorResult(action, error) {
    const status = error.status || error.response?.status || null;
    return {
      success: false,
      action,
      status,
      error: error.message,
      details: error.data || error.response?.data || null,
    };
  }

  toBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    return ['true', 'yes', '1', 'on'].includes(normalized);
  }

  toPositiveInt(value, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
}

export default new ObsidianAPI();
