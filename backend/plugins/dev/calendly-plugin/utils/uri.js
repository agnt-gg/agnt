export function extractUuid(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  const match = trimmed.match(/([0-9a-fA-F-]{8,}|[A-Za-z0-9_-]{8,})$/);
  return match ? match[1] : trimmed;
}

export function calendlyUri(resource, value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('https://api.calendly.com/')) return trimmed;
  const uuid = extractUuid(trimmed);
  return `https://api.calendly.com/${resource}/${uuid}`;
}

export function parseOptionalJson(value, fallback = undefined, fieldName = 'JSON field') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${error.message}`);
  }
}

export function parseGuests(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('[')) return parseOptionalJson(trimmed, undefined, 'eventGuests');
  return trimmed.split(',').map((email) => email.trim()).filter(Boolean);
}

export function ensureBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export function requireParam(params, key, message) {
  const value = params[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(message || `${key} is required.`);
  }
  return value;
}

export function validateIsoDate(value, fieldName) {
  if (!value) return;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO 8601 datetime.`);
  }
}

export function validateAvailableTimeWindow(startTime, endTime) {
  validateIsoDate(startTime, 'startTime');
  validateIsoDate(endTime, 'endTime');
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (end <= start) {
    throw new Error('endTime must be after startTime.');
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (end - start > sevenDaysMs) {
    throw new Error('Calendly GET_AVAILABLE_TIMES supports a maximum 7-day window per request. Please narrow startTime/endTime.');
  }
}
