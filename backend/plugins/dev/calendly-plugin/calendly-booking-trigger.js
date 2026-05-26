import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { CalendlyClient } from './utils/calendly-client.js';
import { calendlyUri, ensureBoolean, extractUuid } from './utils/uri.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

let instance = null;
let authManagerPromise = null;

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function isoNow() {
  return new Date().toISOString();
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getScheduledEventUuid(eventUri) {
  return extractUuid(eventUri || '');
}

async function loadAuthManager() {
  if (authManagerPromise) return authManagerPromise;

  authManagerPromise = (async () => {
    const candidates = [
      path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js'),
      path.join(APP_PATH, 'src/services/auth/AuthManager.js'),
      path.join(process.cwd(), 'backend/src/services/auth/AuthManager.js'),
      path.join(process.cwd(), 'src/services/auth/AuthManager.js')
    ];

    for (const candidate of candidates) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      try {
        const mod = await import(pathToFileURL(candidate).href);
        if (mod?.default?.getValidAccessToken) {
          console.log(`[CalendlyPlugin] Loaded AGNT AuthManager from ${candidate}`);
          return mod.default;
        }
      } catch (error) {
        console.warn(`[CalendlyPlugin] Failed to import AuthManager candidate ${candidate}: ${error.message}`);
      }
    }

    console.warn('[CalendlyPlugin] Could not load AGNT AuthManager. Calendly trigger will use the injected setup token only.');
    return null;
  })();

  return authManagerPromise;
}

function normalizeScheduledEvent(event = {}, invitee = null, raw = null) {
  const scheduledEventUri = event.uri || invitee?.event || null;
  const eventTypeUri = event.event_type || null;
  const inviteeUri = invitee?.uri || null;

  return {
    event: 'invitee.created',
    triggerType: 'calendly.new_booking',
    bookingUri: inviteeUri || scheduledEventUri,
    inviteeUri,
    inviteeUuid: extractUuid(inviteeUri || ''),
    scheduledEventUri,
    scheduledEventUuid: getScheduledEventUuid(scheduledEventUri),
    eventTypeUri,
    eventTypeUuid: extractUuid(eventTypeUri || ''),
    eventName: event.name || null,
    eventStatus: event.status || null,
    inviteeName: invitee?.name || null,
    inviteeEmail: invitee?.email || null,
    timezone: invitee?.timezone || event.timezone || null,
    startTime: event.start_time || null,
    endTime: event.end_time || null,
    location: event.location || null,
    cancelUrl: invitee?.cancel_url || null,
    rescheduleUrl: invitee?.reschedule_url || null,
    questionsAndAnswers: invitee?.questions_and_answers || [],
    tracking: invitee?.tracking || {},
    createdAt: event.created_at || invitee?.created_at || null,
    updatedAt: event.updated_at || invitee?.updated_at || null,
    raw,
    response: raw || { scheduledEvent: event, invitee }
  };
}

class CalendlyBookingTrigger extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-calendly-booking';
    this.pollers = new Map();
    this.subscriptions = new Map();
    this.seen = new Map();
  }

  async resolveValidToken(engine, fallbackToken, forceRefresh = false) {
    const userId = engine?.userId;
    if (!userId) return fallbackToken;

    try {
      const AuthManager = await loadAuthManager();
      if (!AuthManager?.getValidAccessToken) return fallbackToken;

      const token = await AuthManager.getValidAccessToken(userId, 'calendly');
      if (token) {
        if (forceRefresh) console.log('[CalendlyPlugin] Retrieved refreshed Calendly OAuth token after 401');
        return token;
      }
    } catch (error) {
      console.warn(`[CalendlyPlugin] Could not retrieve fresh Calendly token from AGNT Auth: ${error.message}`);
    }

    return fallbackToken;
  }

  async makeClient(engine, fallbackToken, forceRefresh = false) {
    const token = await this.resolveValidToken(engine, fallbackToken, forceRefresh);
    return { token, client: new CalendlyClient(token) };
  }

  async requestCalendly(state, method, apiPath, options = {}) {
    try {
      return await state.client.request(method, apiPath, options);
    } catch (error) {
      if (error?.statusCode !== 401) throw error;

      console.warn('[CalendlyPlugin] Calendly returned 401. Resolving a fresh OAuth token and retrying once.');
      const refreshed = await this.makeClient(state.engine, state.token, true);
      state.token = refreshed.token;
      state.client = refreshed.client;
      return state.client.request(method, apiPath, options);
    }
  }

  async setup(engine, node) {
    console.log('[CalendlyPlugin] Setting up Calendly booking trigger');

    const params = node?.parameters || {};
    const injectedToken = params.__auth?.token;
    if (!injectedToken) {
      throw new Error('Not connected to Calendly. Connect Calendly in Settings -> Connections.');
    }

    const initial = await this.makeClient(engine, injectedToken);
    const me = await initial.client.request('GET', '/users/me');
    const user = me.resource || me;
    const userUri = params.userUri ? calendlyUri('users', params.userUri) : user.uri;
    const organizationUri = params.organizationUri ? calendlyUri('organizations', params.organizationUri) : (user.current_organization || user.organization || user.current_organization_uri);

    const scope = String(params.scope || 'user').toLowerCase() === 'organization' ? 'organization' : 'user';
    const pollIntervalMs = clampNumber(params.pollIntervalMs, 60000, 10000, 3600000);
    const lookAheadDays = clampNumber(params.lookAheadDays, 30, 1, 365);
    const count = clampNumber(params.count, 100, 1, 100);
    const includeInvitees = params.includeInvitees === undefined ? true : ensureBoolean(params.includeInvitees);
    const includeRaw = ensureBoolean(params.includeRaw);
    const dropExistingOnStart = params.dropExistingOnStart === undefined ? true : ensureBoolean(params.dropExistingOnStart);
    const eventTypeFilters = new Set(parseList(params.eventTypeUri).map((value) => calendlyUri('event_types', value)));

    const pollerKey = [engine?.userId || 'unknown-user', scope, scope === 'organization' ? organizationUri : userUri, lookAheadDays, count, includeInvitees].join(':');
    const subscriptionId = `${engine?.workflowId || engine?.id || engine?.userId || 'workflow'}:${node?.id || node?.nodeId || Date.now()}:${Math.random().toString(36).slice(2)}`;

    const subscription = {
      id: subscriptionId,
      engine,
      node,
      eventTypeFilters,
      includeRaw,
      callback: (bookingData) => engine.processWorkflowTrigger(bookingData)
    };

    if (!this.pollers.has(pollerKey)) {
      await this.createPoller(pollerKey, {
        engine,
        token: initial.token,
        client: initial.client,
        scope,
        userUri,
        organizationUri,
        lookAheadDays,
        pollIntervalMs,
        count,
        includeInvitees,
        dropExistingOnStart,
        subscriptions: new Set(),
        running: true,
        timer: null,
        consecutiveErrors: 0,
        lastTokenRefreshAt: Date.now()
      });
    }

    this.subscriptions.set(subscriptionId, subscription);
    this.pollers.get(pollerKey).subscriptions.add(subscriptionId);

    if (engine) {
      engine.receivers = engine.receivers || {};
      engine.receivers.calendly = this;
    }

    console.log(`[CalendlyPlugin] Subscribed to new Calendly bookings for ${scope} scope`);
  }

  async createPoller(key, state) {
    this.pollers.set(key, state);

    if (state.dropExistingOnStart) {
      const currentEvents = await this.fetchEvents(state);
      for (const item of currentEvents) {
        this.markSeen(item.event);
      }
      console.log(`[CalendlyPlugin] Dropped ${currentEvents.length} existing Calendly events on trigger start`);
    }

    const tick = async () => {
      if (!state.running) return;
      try {
        await this.refreshClientIfDue(state);
        await this.pollOnce(state);
        state.consecutiveErrors = 0;
      } catch (error) {
        state.consecutiveErrors += 1;
        console.error('[CalendlyPlugin] Error polling Calendly bookings:', error);
      }

      if (state.running) {
        const backoffMs = Math.min(state.pollIntervalMs * Math.max(1, state.consecutiveErrors), 5 * 60 * 1000);
        state.timer = setTimeout(tick, backoffMs);
      }
    };

    state.timer = setTimeout(tick, state.pollIntervalMs);
    console.log(`[CalendlyPlugin] Started polling Calendly bookings every ${state.pollIntervalMs}ms`);
  }

  async refreshClientIfDue(state) {
    // Calendly OAuth access tokens are short-lived. Long-running triggers must not
    // keep the setup-time __auth token forever, so refresh from AGNT Auth periodically.
    const minRefreshIntervalMs = 5 * 60 * 1000;
    if (Date.now() - (state.lastTokenRefreshAt || 0) < minRefreshIntervalMs) return;

    const fresh = await this.makeClient(state.engine, state.token);
    state.token = fresh.token;
    state.client = fresh.client;
    state.lastTokenRefreshAt = Date.now();
  }

  async fetchEvents(state) {
    const params = {
      count: state.count,
      status: 'active',
      sort: 'start_time:asc',
      min_start_time: isoNow(),
      max_start_time: isoDaysFromNow(state.lookAheadDays)
    };

    if (state.scope === 'organization') {
      if (!state.organizationUri) throw new Error('organizationUri is required for organization-scoped Calendly booking polling.');
      params.organization = state.organizationUri;
    } else {
      if (!state.userUri) throw new Error('userUri is required for user-scoped Calendly booking polling.');
      params.user = state.userUri;
    }

    const raw = await this.requestCalendly(state, 'GET', '/scheduled_events', { params });
    return (raw.collection || []).map((event) => ({ event, scheduledEventsRaw: raw }));
  }

  async fetchInvitees(state, scheduledEventUri) {
    if (!state.includeInvitees || !scheduledEventUri) return [];
    const uuid = getScheduledEventUuid(scheduledEventUri);
    if (!uuid) return [];
    const raw = await this.requestCalendly(state, 'GET', `/scheduled_events/${encodeURIComponent(uuid)}/invitees`, {
      params: { count: 100, status: 'active' }
    });
    return (raw.collection || []).map((invitee) => ({ invitee, inviteesRaw: raw }));
  }

  markSeen(event) {
    const key = event?.uri || event?.uuid || JSON.stringify(event);
    if (!key) return;
    this.seen.set(key, Date.now());
  }

  isSeen(event) {
    const key = event?.uri || event?.uuid || JSON.stringify(event);
    return key ? this.seen.has(key) : true;
  }

  pruneSeen() {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, timestamp] of this.seen.entries()) {
      if (timestamp < cutoff) this.seen.delete(key);
    }
  }

  async pollOnce(state) {
    this.pruneSeen();
    const events = await this.fetchEvents(state);

    for (const { event, scheduledEventsRaw } of events) {
      if (this.isSeen(event)) continue;
      this.markSeen(event);

      const invitees = await this.fetchInvitees(state, event.uri);
      const inviteeItems = invitees.length ? invitees : [{ invitee: null, inviteesRaw: null }];

      for (const { invitee, inviteesRaw } of inviteeItems) {
        await this.dispatchBooking(state, event, invitee, { scheduledEventsRaw, inviteesRaw });
      }
    }
  }

  async dispatchBooking(state, event, invitee, rawParts) {
    const subscriptionIds = [...state.subscriptions];
    for (const subscriptionId of subscriptionIds) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) continue;
      if (subscription.eventTypeFilters.size && !subscription.eventTypeFilters.has(event.event_type)) continue;

      const raw = subscription.includeRaw ? { scheduledEvent: event, invitee, ...rawParts } : null;
      const bookingData = normalizeScheduledEvent(event, invitee, raw);

      try {
        this.emit('booking', bookingData);
        await Promise.resolve(subscription.callback(bookingData));
      } catch (error) {
        console.error('[CalendlyPlugin] Error dispatching Calendly booking to workflow:', error);
      }
    }
  }

  validate(triggerData) {
    return !!triggerData && triggerData.triggerType === 'calendly.new_booking' && !!triggerData.scheduledEventUri;
  }

  async process(inputData) {
    return {
      event: inputData.event,
      triggerType: inputData.triggerType,
      bookingUri: inputData.bookingUri,
      inviteeUri: inputData.inviteeUri,
      inviteeUuid: inputData.inviteeUuid,
      scheduledEventUri: inputData.scheduledEventUri,
      scheduledEventUuid: inputData.scheduledEventUuid,
      eventTypeUri: inputData.eventTypeUri,
      eventTypeUuid: inputData.eventTypeUuid,
      eventName: inputData.eventName,
      eventStatus: inputData.eventStatus,
      inviteeName: inputData.inviteeName,
      inviteeEmail: inputData.inviteeEmail,
      timezone: inputData.timezone,
      startTime: inputData.startTime,
      endTime: inputData.endTime,
      location: inputData.location,
      cancelUrl: inputData.cancelUrl,
      rescheduleUrl: inputData.rescheduleUrl,
      questionsAndAnswers: inputData.questionsAndAnswers || [],
      tracking: inputData.tracking || {},
      createdAt: inputData.createdAt,
      updatedAt: inputData.updatedAt,
      raw: inputData.raw || null,
      response: inputData.response || inputData
    };
  }

  async teardown() {
    console.log('[CalendlyPlugin] Tearing down Calendly booking trigger');

    for (const state of this.pollers.values()) {
      state.running = false;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      state.subscriptions.clear();
    }

    this.pollers.clear();
    this.subscriptions.clear();
    this.removeAllListeners('booking');
  }
}

function getCalendlyBookingTrigger() {
  if (!instance) instance = new CalendlyBookingTrigger();
  return instance;
}

export default getCalendlyBookingTrigger();
