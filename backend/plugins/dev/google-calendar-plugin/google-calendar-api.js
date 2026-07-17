import { google } from 'googleapis';
import crypto from 'crypto';

/**
 * Google Calendar API Plugin Tool
 *
 * Manage events, check availability, and create Google Meet meetings.
 */
class GoogleCalendarAPI {
  constructor() {
    this.name = 'google-calendar-api';
  }

  async execute(params, inputData, workflowEngine) {
    const { __auth, ...loggableParams } = params;
    console.log('[GoogleCalendarPlugin] Executing with params:', JSON.stringify(loggableParams, null, 2));
    this.validateParams(params);

    try {
      const accessToken = params.__auth?.token || (typeof workflowEngine?.getAuth === 'function' ? await workflowEngine.getAuth('google') : null);
      if (!accessToken) throw new Error('Not connected to Google. Connect in Settings → Connections.');

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const calendar = google.calendar({ version: 'v3', auth });
      const calendarId = params.calendarId || 'primary';

      let result;

      switch (params.action) {
        case 'LIST_EVENTS':
          result = await this.listEvents(calendar, calendarId, params);
          break;
        case 'GET_EVENT':
          result = await this.getEvent(calendar, calendarId, params.eventId);
          break;
        case 'CREATE_EVENT':
          result = await this.createEvent(calendar, calendarId, params, false);
          break;
        case 'CREATE_MEET_EVENT':
          result = await this.createEvent(calendar, calendarId, params, true);
          break;
        case 'UPDATE_EVENT':
          result = await this.updateEvent(calendar, calendarId, params);
          break;
        case 'DELETE_EVENT':
          result = await this.deleteEvent(calendar, calendarId, params);
          break;
        case 'QUICK_ADD':
          result = await this.quickAdd(calendar, calendarId, params.quickAddText);
          break;
        case 'GET_FREE_BUSY':
          result = await this.getFreeBusy(calendar, params);
          break;
        case 'LIST_CALENDARS':
          result = await this.listCalendars(calendar);
          break;
        case 'RESPOND_TO_EVENT':
          result = await this.respondToEvent(calendar, auth, calendarId, params);
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
      console.error('[GoogleCalendarPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: this.friendlyError(error),
      };
    }
  }

  friendlyError(error) {
    const status = error.code || error.response?.status;
    if (status === 403) {
      return 'Google Calendar access not granted. Reconnect Google in Settings → Connections to grant Calendar permission. (' + error.message + ')';
    }
    if (status === 404) {
      return 'Event or calendar not found. Check the calendarId/eventId. (' + error.message + ')';
    }
    return error.message;
  }

  /**
   * Build a Calendar API date object from a string.
   * "YYYY-MM-DD" → all-day { date }, anything else → { dateTime, timeZone? }
   */
  buildEventTime(value, timeZone) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { date: value };
    }
    const time = { dateTime: value };
    if (timeZone) time.timeZone = timeZone;
    return time;
  }

  parseAttendees(attendees) {
    if (!attendees) return undefined;
    const list = attendees.split(',').map((e) => e.trim()).filter(Boolean);
    return list.length ? list.map((email) => ({ email })) : undefined;
  }

  /**
   * Flatten an API event into a stable, workflow-friendly shape.
   */
  simplifyEvent(event) {
    return {
      id: event.id,
      summary: event.summary || '',
      description: event.description || '',
      location: event.location || '',
      status: event.status,
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      allDay: !!event.start?.date,
      attendees: (event.attendees || []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: !!a.organizer,
      })),
      meetLink: event.hangoutLink || null,
      htmlLink: event.htmlLink,
      created: event.created,
      updated: event.updated,
      organizer: event.organizer?.email || null,
      recurringEventId: event.recurringEventId || null,
    };
  }

  async listEvents(calendar, calendarId, params) {
    const now = new Date();
    const response = await calendar.events.list({
      calendarId,
      timeMin: params.timeMin || now.toISOString(),
      timeMax: params.timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      q: params.searchQuery || undefined,
      maxResults: parseInt(params.maxResults, 10) || 25,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = (response.data.items || []).map((e) => this.simplifyEvent(e));
    return { events, count: events.length };
  }

  async getEvent(calendar, calendarId, eventId) {
    if (!eventId) throw new Error('eventId is required for GET_EVENT');
    const response = await calendar.events.get({ calendarId, eventId });
    return { event: this.simplifyEvent(response.data) };
  }

  async createEvent(calendar, calendarId, params, withMeet) {
    if (!params.summary) throw new Error('summary is required to create an event');
    if (!params.startTime || !params.endTime) throw new Error('startTime and endTime are required to create an event');

    const requestBody = {
      summary: params.summary,
      description: params.description || undefined,
      location: params.location || undefined,
      start: this.buildEventTime(params.startTime, params.timeZone),
      end: this.buildEventTime(params.endTime, params.timeZone),
      attendees: this.parseAttendees(params.attendees),
    };

    if (withMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const response = await calendar.events.insert({
      calendarId,
      requestBody,
      conferenceDataVersion: withMeet ? 1 : 0,
      sendUpdates: params.sendUpdates || 'none',
    });

    return {
      event: this.simplifyEvent(response.data),
      meetLink: response.data.hangoutLink || null,
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
    };
  }

  async updateEvent(calendar, calendarId, params) {
    if (!params.eventId) throw new Error('eventId is required for UPDATE_EVENT');

    const requestBody = {};
    if (params.summary) requestBody.summary = params.summary;
    if (params.description) requestBody.description = params.description;
    if (params.location) requestBody.location = params.location;
    if (params.startTime) requestBody.start = this.buildEventTime(params.startTime, params.timeZone);
    if (params.endTime) requestBody.end = this.buildEventTime(params.endTime, params.timeZone);
    if (params.attendees) requestBody.attendees = this.parseAttendees(params.attendees);

    if (Object.keys(requestBody).length === 0) {
      throw new Error('UPDATE_EVENT requires at least one field to change (summary, description, location, startTime, endTime, attendees)');
    }

    const response = await calendar.events.patch({
      calendarId,
      eventId: params.eventId,
      requestBody,
      sendUpdates: params.sendUpdates || 'none',
    });
    return { event: this.simplifyEvent(response.data) };
  }

  async deleteEvent(calendar, calendarId, params) {
    if (!params.eventId) throw new Error('eventId is required for DELETE_EVENT');
    await calendar.events.delete({
      calendarId,
      eventId: params.eventId,
      sendUpdates: params.sendUpdates || 'none',
    });
    return { deleted: true, eventId: params.eventId };
  }

  async quickAdd(calendar, calendarId, text) {
    if (!text) throw new Error('quickAddText is required for QUICK_ADD');
    const response = await calendar.events.quickAdd({ calendarId, text });
    return { event: this.simplifyEvent(response.data) };
  }

  async getFreeBusy(calendar, params) {
    if (!params.startTime || !params.endTime) throw new Error('startTime and endTime are required for GET_FREE_BUSY');
    const ids = (params.freeBusyCalendars || 'primary').split(',').map((s) => s.trim()).filter(Boolean);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: params.startTime,
        timeMax: params.endTime,
        items: ids.map((id) => ({ id })),
      },
    });

    const calendars = {};
    for (const [id, data] of Object.entries(response.data.calendars || {})) {
      calendars[id] = {
        busy: data.busy || [],
        isFree: (data.busy || []).length === 0,
        errors: data.errors || undefined,
      };
    }
    return { calendars };
  }

  async listCalendars(calendar) {
    const response = await calendar.calendarList.list({ maxResults: 100 });
    const calendars = (response.data.items || []).map((c) => ({
      id: c.id,
      summary: c.summary,
      primary: !!c.primary,
      accessRole: c.accessRole,
      timeZone: c.timeZone,
    }));
    return { calendars, count: calendars.length };
  }

  async respondToEvent(calendar, auth, calendarId, params) {
    if (!params.eventId) throw new Error('eventId is required for RESPOND_TO_EVENT');
    if (!params.responseStatus) throw new Error('responseStatus is required for RESPOND_TO_EVENT');

    // Identify the connected user so we update the right attendee entry
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const me = await oauth2.userinfo.get();
    const myEmail = (me.data.email || '').toLowerCase();
    if (!myEmail) throw new Error('Could not determine the connected Google account email');

    const existing = await calendar.events.get({ calendarId, eventId: params.eventId });
    const attendees = existing.data.attendees || [];
    const self = attendees.find((a) => (a.email || '').toLowerCase() === myEmail || a.self);
    if (!self) throw new Error(`You (${myEmail}) are not an attendee of this event`);

    self.responseStatus = params.responseStatus;

    const response = await calendar.events.patch({
      calendarId,
      eventId: params.eventId,
      requestBody: { attendees },
      sendUpdates: params.sendUpdates || 'none',
    });
    return { event: this.simplifyEvent(response.data), respondedAs: myEmail, responseStatus: params.responseStatus };
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required for Google Calendar operations');
    }
  }
}

export default new GoogleCalendarAPI();
