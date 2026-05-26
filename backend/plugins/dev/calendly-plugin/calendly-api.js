import { CalendlyClient } from './utils/calendly-client.js';
import {
  calendlyUri,
  ensureBoolean,
  extractUuid,
  parseGuests,
  parseOptionalJson,
  requireParam,
  validateAvailableTimeWindow,
  validateIsoDate
} from './utils/uri.js';

class CalendlyAPI {
  constructor() {
    this.name = 'calendly-api';
  }

  async execute(params = {}, inputData, workflowEngine) {
    console.log('[CalendlyPlugin] Executing Calendly action:', params.action);

    const apiKey = params.__auth?.token;
    const client = new CalendlyClient(apiKey);
    const action = params.action || 'GET_CURRENT_USER';

    switch (action) {
      case 'GET_CURRENT_USER':
        return this.getCurrentUser(client, params);
      case 'LIST_EVENT_TYPES':
        return this.listEventTypes(client, params);
      case 'GET_AVAILABLE_TIMES':
        return this.getAvailableTimes(client, params);
      case 'CREATE_SCHEDULING_LINK':
        return this.createSchedulingLink(client, params);
      case 'BOOK_INVITEE':
        return this.bookInvitee(client, params);
      case 'LIST_SCHEDULED_EVENTS':
        return this.listScheduledEvents(client, params);
      case 'CANCEL_EVENT':
        return this.cancelEvent(client, params);
      default:
        throw new Error(`Unsupported Calendly action: ${action}`);
    }
  }

  withRaw(base, raw, includeRaw) {
    return includeRaw ? { ...base, raw } : base;
  }

  async getCurrentUser(client, params) {
    const raw = await client.request('GET', '/users/me');
    const user = raw.resource || raw;
    const organizationUri = user.current_organization || user.organization || user.current_organization_uri;

    return this.withRaw({
      success: true,
      action: 'GET_CURRENT_USER',
      userUri: user.uri,
      userUuid: extractUuid(user.uri || ''),
      name: user.name,
      email: user.email,
      schedulingUrl: user.scheduling_url,
      timezone: user.timezone,
      organizationUri
    }, raw, params.includeRaw);
  }

  async listEventTypes(client, params) {
    const query = {
      count: Math.min(Number(params.count || 20), 100)
    };

    if (params.userUri) query.user = calendlyUri('users', params.userUri);
    if (params.organizationUri) query.organization = calendlyUri('organizations', params.organizationUri);

    if (!query.user && !query.organization) {
      const me = await client.request('GET', '/users/me');
      query.user = me.resource?.uri;
    }

    const raw = await client.request('GET', '/event_types', { params: query });
    const collection = raw.collection || [];
    const eventTypes = collection.map((eventType) => ({
      uri: eventType.uri,
      uuid: extractUuid(eventType.uri || ''),
      name: eventType.name,
      active: eventType.active,
      duration: eventType.duration,
      kind: eventType.kind,
      slug: eventType.slug,
      schedulingUrl: eventType.scheduling_url,
      profile: eventType.profile,
      createdAt: eventType.created_at,
      updatedAt: eventType.updated_at
    }));

    return this.withRaw({
      success: true,
      action: 'LIST_EVENT_TYPES',
      count: eventTypes.length,
      eventTypes,
      nextPage: raw.pagination?.next_page || null
    }, raw, params.includeRaw);
  }

  async getAvailableTimes(client, params) {
    const eventType = calendlyUri('event_types', requireParam(params, 'eventTypeUri', 'eventTypeUri is required for GET_AVAILABLE_TIMES.'));
    const startTime = requireParam(params, 'startTime', 'startTime is required for GET_AVAILABLE_TIMES.');
    const endTime = requireParam(params, 'endTime', 'endTime is required for GET_AVAILABLE_TIMES.');
    validateAvailableTimeWindow(startTime, endTime);

    const raw = await client.request('GET', '/event_type_available_times', {
      params: {
        event_type: eventType,
        start_time: startTime,
        end_time: endTime
      }
    });

    const availableTimes = (raw.collection || []).map((slot) => ({
      startTime: slot.start_time,
      status: slot.status,
      inviteesRemaining: slot.invitees_remaining,
      schedulingUrl: slot.scheduling_url
    }));

    return this.withRaw({
      success: true,
      action: 'GET_AVAILABLE_TIMES',
      eventTypeUri: eventType,
      count: availableTimes.length,
      firstAvailableTime: availableTimes[0]?.startTime || null,
      availableTimes
    }, raw, params.includeRaw);
  }

  async createSchedulingLink(client, params) {
    const eventType = calendlyUri('event_types', requireParam(params, 'eventTypeUri', 'eventTypeUri is required for CREATE_SCHEDULING_LINK.'));
    const maxEventCount = Number(params.singleUseLinkMaxEventCount || 1);

    const raw = await client.request('POST', '/scheduling_links', {
      data: {
        max_event_count: maxEventCount,
        owner: eventType,
        owner_type: 'EventType'
      }
    });

    const resource = raw.resource || raw;
    return this.withRaw({
      success: true,
      action: 'CREATE_SCHEDULING_LINK',
      bookingUrl: resource.booking_url,
      owner: resource.owner,
      ownerType: resource.owner_type,
      maxEventCount: resource.max_event_count
    }, raw, params.includeRaw);
  }

  async bookInvitee(client, params) {
    if (!ensureBoolean(params.confirmBooking)) {
      throw new Error('BOOK_INVITEE creates a real Calendly booking. Set confirmBooking to true to continue.');
    }

    const eventType = calendlyUri('event_types', requireParam(params, 'eventTypeUri', 'eventTypeUri is required for BOOK_INVITEE.'));
    const startTime = requireParam(params, 'startTime', 'startTime is required for BOOK_INVITEE and must be UTC.');
    validateIsoDate(startTime, 'startTime');
    if (!String(startTime).endsWith('Z')) {
      throw new Error('BOOK_INVITEE startTime must be UTC and end with Z, e.g. 2026-05-25T15:00:00Z.');
    }

    const name = requireParam(params, 'inviteeName', 'inviteeName is required for BOOK_INVITEE.');
    const email = requireParam(params, 'inviteeEmail', 'inviteeEmail is required for BOOK_INVITEE.');
    const timezone = params.timezone || 'UTC';

    const data = {
      event_type: eventType,
      start_time: startTime,
      invitee: {
        name,
        email,
        timezone
      }
    };

    const guests = parseGuests(params.eventGuests);
    if (guests?.length) data.invitee.guests = guests;

    const questionsAndAnswers = parseOptionalJson(params.questionsAndAnswersJson, undefined, 'questionsAndAnswersJson');
    if (questionsAndAnswers) data.invitee.questions_and_answers = questionsAndAnswers;

    const tracking = parseOptionalJson(params.trackingJson, undefined, 'trackingJson');
    if (tracking) data.tracking = tracking;

    const location = parseOptionalJson(params.locationJson, undefined, 'locationJson');
    if (location) data.location = location;

    const raw = await client.request('POST', '/invitees', { data });
    const resource = raw.resource || raw;

    return this.withRaw({
      success: true,
      action: 'BOOK_INVITEE',
      eventUri: resource.event,
      inviteeUri: resource.uri,
      inviteeUuid: extractUuid(resource.uri || ''),
      status: resource.status,
      name: resource.name,
      email: resource.email,
      startTime,
      timezone,
      cancelUrl: resource.cancel_url,
      rescheduleUrl: resource.reschedule_url
    }, raw, params.includeRaw);
  }

  async listScheduledEvents(client, params) {
    const query = {
      count: Math.min(Number(params.count || 20), 100),
      sort: params.sort || 'start_time:asc'
    };

    if (params.userUri) query.user = calendlyUri('users', params.userUri);
    if (params.organizationUri) query.organization = calendlyUri('organizations', params.organizationUri);
    if (params.status) query.status = params.status;
    if (params.startTime) {
      validateIsoDate(params.startTime, 'startTime');
      query.min_start_time = params.startTime;
    }
    if (params.endTime) {
      validateIsoDate(params.endTime, 'endTime');
      query.max_start_time = params.endTime;
    }

    if (!query.user && !query.organization) {
      const me = await client.request('GET', '/users/me');
      query.user = me.resource?.uri;
    }

    const raw = await client.request('GET', '/scheduled_events', { params: query });
    const events = (raw.collection || []).map((event) => ({
      uri: event.uri,
      uuid: extractUuid(event.uri || ''),
      name: event.name,
      status: event.status,
      startTime: event.start_time,
      endTime: event.end_time,
      eventType: event.event_type,
      location: event.location,
      inviteesCounter: event.invitees_counter,
      createdAt: event.created_at,
      updatedAt: event.updated_at
    }));

    return this.withRaw({
      success: true,
      action: 'LIST_SCHEDULED_EVENTS',
      count: events.length,
      events,
      nextPage: raw.pagination?.next_page || null
    }, raw, params.includeRaw);
  }

  async cancelEvent(client, params) {
    if (!ensureBoolean(params.confirmCancellation)) {
      throw new Error('CANCEL_EVENT cancels a real Calendly event. Set confirmCancellation to true to continue.');
    }

    const eventUri = calendlyUri('scheduled_events', requireParam(params, 'scheduledEventUri', 'scheduledEventUri is required for CANCEL_EVENT.'));
    const eventUuid = extractUuid(eventUri);
    const data = {};
    if (params.reason) data.reason = params.reason;

    const raw = await client.request('POST', `/scheduled_events/${encodeURIComponent(eventUuid)}/cancellation`, { data });

    return this.withRaw({
      success: true,
      action: 'CANCEL_EVENT',
      eventUri,
      eventUuid,
      canceled: true
    }, raw, params.includeRaw);
  }
}

export default new CalendlyAPI();
