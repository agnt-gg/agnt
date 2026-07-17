import EventEmitter from 'events';
import { google } from 'googleapis';

/**
 * Google Calendar Event Starting Trigger Plugin
 *
 * Fires the workflow N minutes before an event starts. Polls every 30
 * seconds and fires exactly once per event occurrence.
 */
class GoogleCalendarEventStarting extends EventEmitter {
  constructor() {
    super();
    this.name = 'google-calendar-event-starting';
    this.intervalId = null;
    this.isListening = false;
    this.calendarId = null;
    this.minutesBefore = 10;
    this.firedEventIds = new Set();
    this.workflowEngine = null;
  }

  async setup(engine, node) {
    console.log('[GoogleCalendarPlugin] Setting up Event Starting trigger');

    this.workflowEngine = engine;
    this.calendarId = (node.parameters && node.parameters.calendarId) || 'primary';
    this.minutesBefore = parseInt(node.parameters && node.parameters.minutesBefore, 10) || 10;

    engine.receivers.calendarEventStarting = this;

    await this.start();

    console.log(`[GoogleCalendarPlugin] Watching ${this.calendarId}; firing ${this.minutesBefore} min before events`);
  }

  async start() {
    if (this.isListening) return;

    this.isListening = true;
    this.intervalId = setInterval(() => this.checkUpcomingEvents(), 30000);

    console.log(`[GoogleCalendarPlugin] Started upcoming-event polling for ${this.calendarId}`);
  }

  stop() {
    this.isListening = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[GoogleCalendarPlugin] Stopped upcoming-event polling for ${this.calendarId}`);
  }

  async getGoogleAuth() {
    const accessToken = await this.workflowEngine.getAuth('google');
    if (!accessToken) {
      throw new Error('Not connected to Google. Connect in Settings → Connections.');
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return auth;
  }

  async checkUpcomingEvents() {
    if (!this.isListening) return;

    try {
      const auth = await this.getGoogleAuth();
      const calendar = google.calendar({ version: 'v3', auth });

      const now = new Date();
      const windowEnd = new Date(now.getTime() + this.minutesBefore * 60 * 1000);

      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: now.toISOString(),
        timeMax: windowEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 25,
      });

      const events = response.data.items || [];

      for (const event of events) {
        // All-day events have no dateTime; skip them (they don't "start" at a minute)
        const startStr = event.start?.dateTime;
        if (!startStr) continue;

        // Recurring events share an id per occurrence via start time — key on both
        const fireKey = `${event.id}:${startStr}`;
        if (this.firedEventIds.has(fireKey)) continue;

        const minutesUntilStart = Math.round((new Date(startStr) - now) / 60000);

        console.log(`[GoogleCalendarPlugin] Event "${event.summary}" starts in ${minutesUntilStart} min — firing`);

        this.firedEventIds.add(fireKey);
        this.workflowEngine.processWorkflowTrigger({
          event: this.simplifyEvent(event),
          minutesUntilStart,
        });
      }

      // Bound memory: reset the fired-set if it grows unreasonably
      if (this.firedEventIds.size > 500) {
        this.firedEventIds.clear();
      }
    } catch (error) {
      console.error('[GoogleCalendarPlugin] Error checking upcoming events:', error);
    }
  }

  simplifyEvent(event) {
    return {
      id: event.id,
      summary: event.summary || '',
      description: event.description || '',
      location: event.location || '',
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      attendees: (event.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
      meetLink: event.hangoutLink || null,
      htmlLink: event.htmlLink,
      organizer: event.organizer?.email || null,
    };
  }

  validate(triggerData) {
    return 'event' in triggerData;
  }

  async process(inputData, engine) {
    return {
      event: inputData.event,
      minutesUntilStart: inputData.minutesUntilStart,
    };
  }

  async teardown() {
    console.log('[GoogleCalendarPlugin] Tearing down Event Starting trigger');
    this.stop();
  }
}

export default new GoogleCalendarEventStarting();
