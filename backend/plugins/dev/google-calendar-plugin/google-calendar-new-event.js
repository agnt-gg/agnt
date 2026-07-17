import EventEmitter from 'events';
import { google } from 'googleapis';

/**
 * Google Calendar New Event Trigger Plugin
 *
 * Monitors a Google Calendar for created or updated events and triggers
 * the workflow when one is detected. Polls every 30 seconds using the
 * `updatedMin` filter so only changes since the last check are returned.
 */
class GoogleCalendarNewEvent extends EventEmitter {
  constructor() {
    super();
    this.name = 'google-calendar-new-event';
    this.intervalId = null;
    this.isListening = false;
    this.calendarId = null;
    this.lastCheckTime = null;
    this.workflowEngine = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   */
  async setup(engine, node) {
    console.log('[GoogleCalendarPlugin] Setting up New Event trigger');

    this.workflowEngine = engine;
    this.calendarId = (node.parameters && node.parameters.calendarId) || 'primary';

    // Store in engine receivers for cleanup
    engine.receivers.calendarNewEvent = this;

    await this.start();

    console.log(`[GoogleCalendarPlugin] Monitoring calendar ${this.calendarId} for new/updated events`);
  }

  async start() {
    if (this.isListening) return;

    this.isListening = true;
    this.lastCheckTime = new Date();

    this.intervalId = setInterval(() => this.checkForEvents(), 30000);

    console.log(`[GoogleCalendarPlugin] Started polling calendar ${this.calendarId}`);
  }

  stop() {
    this.isListening = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[GoogleCalendarPlugin] Stopped polling calendar ${this.calendarId}`);
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

  async checkForEvents() {
    if (!this.isListening) return;

    try {
      const auth = await this.getGoogleAuth();
      const calendar = google.calendar({ version: 'v3', auth });

      const checkStarted = new Date();
      const updatedMin = this.lastCheckTime.toISOString();

      const response = await calendar.events.list({
        calendarId: this.calendarId,
        updatedMin,
        maxResults: 50,
        singleEvents: false,
        showDeleted: false,
      });

      const events = response.data.items || [];

      if (events.length > 0) {
        console.log(`[GoogleCalendarPlugin] Detected ${events.length} new/updated event(s)`);

        for (const event of events) {
          const isNew = event.created ? new Date(event.created) >= this.lastCheckTime : false;
          this.workflowEngine.processWorkflowTrigger({
            event: this.simplifyEvent(event),
            isNew,
          });
        }
      }

      // Advance the watermark only after a successful poll so a failed
      // poll never drops events.
      this.lastCheckTime = checkStarted;
    } catch (error) {
      console.error('[GoogleCalendarPlugin] Error checking for events:', error);
    }
  }

  simplifyEvent(event) {
    return {
      id: event.id,
      summary: event.summary || '',
      description: event.description || '',
      location: event.location || '',
      status: event.status,
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      allDay: !!(event.start && event.start.date),
      attendees: (event.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
      meetLink: event.hangoutLink || null,
      htmlLink: event.htmlLink,
      created: event.created,
      updated: event.updated,
      organizer: event.organizer?.email || null,
    };
  }

  validate(triggerData) {
    return 'event' in triggerData;
  }

  async process(inputData, engine) {
    return {
      event: inputData.event,
      isNew: inputData.isNew,
    };
  }

  async teardown() {
    console.log('[GoogleCalendarPlugin] Tearing down New Event trigger');
    this.stop();
  }
}

export default new GoogleCalendarNewEvent();
