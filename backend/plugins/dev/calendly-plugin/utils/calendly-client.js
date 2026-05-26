import axios from 'axios';

export class CalendlyClient {
  constructor(accessToken) {
    if (!accessToken) {
      throw new Error('Not connected to Calendly. Connect Calendly in Settings -> Connections.');
    }

    this.http = axios.create({
      baseURL: 'https://api.calendly.com',
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async request(method, path, { params, data } = {}) {
    try {
      const response = await this.http.request({ method, url: path, params, data });
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  normalizeError(error) {
    if (!error.response) {
      return new Error(`Calendly request failed: ${error.message}`);
    }

    const status = error.response.status;
    const body = error.response.data;
    const calendlyMessage = body?.message || body?.title || body?.error || JSON.stringify(body);
    const hints = {
      400: 'Check required fields, resource URIs, and timestamp formats.',
      401: 'Invalid, expired, or revoked Calendly access token. Reconnect Calendly if automatic refresh does not recover.',
      403: 'Missing Calendly permission, OAuth scope, or paid-plan capability.',
      404: 'Calendly resource not found. Check the URI or UUID.',
      409: 'Calendly conflict. The selected slot may no longer be available.',
      422: 'Calendly validation failed. Check request fields.',
      429: 'Calendly rate limit reached. Retry later with backoff.'
    };

    const normalized = new Error(`Calendly API error ${status}: ${calendlyMessage}${hints[status] ? ` Hint: ${hints[status]}` : ''}`);
    normalized.statusCode = status;
    normalized.responseBody = body;
    return normalized;
  }
}
