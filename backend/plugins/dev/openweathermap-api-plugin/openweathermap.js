import { URLSearchParams } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


class OpenWeatherMapCurrentWeatherTool {
  constructor() {
    this.name = 'openweathermap-current-weather';
    this._baseUrl = 'https://api.openweathermap.org/data/2.5/weather';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[openweathermap-api-plugin] Executing openweathermap-current-weather with params:', JSON.stringify(params, null, 2));

    try {
      const { locationMode = 'city', city, lat, lon, zip, units = 'metric', lang = 'en', includeRaw = false } = params || {};

      if (!workflowEngine?.userId) {
        throw new Error('Missing workflowEngine.userId for authentication context.');
      }

      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'openweathermap');
      if (!apiKey) {
        throw new Error('Missing OpenWeatherMap API key. Please connect your OpenWeatherMap account/API key.');
      }

      const resolvedMode = String(locationMode || 'city').trim();
      const validModes = new Set(['city', 'coords', 'zip']);
      if (!validModes.has(resolvedMode)) {
        throw new Error(`Invalid locationMode: ${resolvedMode}. Must be one of: city, coords, zip.`);
      }

      const query = new URLSearchParams();
      query.set('appid', apiKey);

      const resolvedUnits = units ? String(units).trim() : 'metric';
      const validUnits = new Set(['standard', 'metric', 'imperial']);
      if (!validUnits.has(resolvedUnits)) {
        throw new Error(`Invalid units: ${resolvedUnits}. Must be one of: standard, metric, imperial.`);
      }
      query.set('units', resolvedUnits);

      const resolvedLang = lang ? String(lang).trim() : 'en';
      if (resolvedLang) query.set('lang', resolvedLang);

      if (resolvedMode === 'city') {
        const q = (city ?? '').toString().trim();
        if (!q) throw new Error('Parameter "city" is required when locationMode="city".');
        query.set('q', q);
      } else if (resolvedMode === 'coords') {
        const nLat = Number(lat);
        const nLon = Number(lon);
        if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) {
          throw new Error('Parameters "lat" and "lon" must be valid numbers when locationMode="coords".');
        }
        if (nLat < -90 || nLat > 90) throw new Error('Parameter "lat" must be between -90 and 90.');
        if (nLon < -180 || nLon > 180) throw new Error('Parameter "lon" must be between -180 and 180.');
        query.set('lat', String(nLat));
        query.set('lon', String(nLon));
      } else if (resolvedMode === 'zip') {
        const z = (zip ?? '').toString().trim();
        if (!z) throw new Error('Parameter "zip" is required when locationMode="zip".');
        query.set('zip', z);
      }

      const url = `${this._baseUrl}?${query.toString()}`;
      console.log('[openweathermap-api-plugin] Request URL:', url.replace(apiKey, '***'));

      const controller = new AbortController();
      const timeoutMs = 20000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      let data;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = { _nonJsonBody: text };
        }
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response?.ok) {
        const apiMsg =
          (data && (data.message || data.error || data?.status_message)) ||
          `OpenWeatherMap API request failed with status ${response?.status || 'unknown'}.`;
        throw new Error(apiMsg);
      }

      if (!data || typeof data !== 'object') {
        throw new Error('OpenWeatherMap API returned an invalid response.');
      }

      // OpenWeatherMap sometimes returns cod as string on errors; handle defensively.
      const cod = data.cod;
      if (cod && String(cod) !== '200') {
        const apiMsg = data.message || `OpenWeatherMap API error (cod=${cod}).`;
        throw new Error(apiMsg);
      }

      const weather0 = Array.isArray(data.weather) && data.weather.length > 0 ? data.weather[0] : null;

      const location = {
        name: data.name ?? null,
        country: data.sys?.country ?? null,
        coordinates: {
          lat: data.coord?.lat ?? null,
          lon: data.coord?.lon ?? null,
        },
        timezone: data.timezone ?? null,
      };

      const current = {
        temperature: data.main?.temp ?? null,
        feels_like: data.main?.feels_like ?? null,
        humidity: data.main?.humidity ?? null,
        pressure: data.main?.pressure ?? null,
        temp_min: data.main?.temp_min ?? null,
        temp_max: data.main?.temp_max ?? null,
        wind: {
          speed: data.wind?.speed ?? null,
          deg: data.wind?.deg ?? null,
          gust: data.wind?.gust ?? null,
        },
        clouds: {
          all: data.clouds?.all ?? null,
        },
        visibility: data.visibility ?? null,
        condition: weather0
          ? {
              id: weather0.id ?? null,
              main: weather0.main ?? null,
              description: weather0.description ?? null,
              icon: weather0.icon ?? null,
            }
          : null,
        sunrise: data.sys?.sunrise ?? null,
        sunset: data.sys?.sunset ?? null,
        dt: data.dt ?? null,
        units: resolvedUnits,
        lang: resolvedLang,
      };

      return {
        success: true,
        location,
        current,
        raw: includeRaw ? data : null,
        error: null,
      };
    } catch (error) {
      console.error('[openweathermap-api-plugin] Error:', error);
      return {
        success: false,
        location: null,
        current: null,
        raw: null,
        error: error?.message ? String(error.message) : 'Unknown error occurred.',
      };
    }
  }
}

export default new OpenWeatherMapCurrentWeatherTool();
