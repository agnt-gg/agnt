import { google } from 'googleapis';

/**
 * Google Meet API Plugin Tool
 *
 * Create instant meeting spaces, manage live conferences, and retrieve
 * recordings/transcripts. Recordings and transcripts require a Google
 * Workspace plan with recording enabled — consumer accounts can still
 * create and manage spaces.
 */
class GoogleMeetAPI {
  constructor() {
    this.name = 'google-meet-api';
  }

  async execute(params, inputData, workflowEngine) {
    const { __auth, ...loggableParams } = params;
    console.log('[GoogleMeetPlugin] Executing with params:', JSON.stringify(loggableParams, null, 2));
    this.validateParams(params);

    try {
      const accessToken = params.__auth?.token || (typeof workflowEngine?.getAuth === 'function' ? await workflowEngine.getAuth('google') : null);
      if (!accessToken) throw new Error('Not connected to Google. Connect in Settings → Connections.');

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const meet = google.meet({ version: 'v2', auth });

      let result;

      switch (params.action) {
        case 'CREATE_SPACE':
          result = await this.createSpace(meet, params);
          break;
        case 'GET_SPACE':
          result = await this.getSpace(meet, params.spaceName);
          break;
        case 'END_CONFERENCE':
          result = await this.endConference(meet, params.spaceName);
          break;
        case 'LIST_CONFERENCE_RECORDS':
          result = await this.listConferenceRecords(meet, params.filter);
          break;
        case 'LIST_RECORDINGS':
          result = await this.listRecordings(meet, params.conferenceRecordName);
          break;
        case 'LIST_TRANSCRIPTS':
          result = await this.listTranscripts(meet, params.conferenceRecordName);
          break;
        case 'GET_TRANSCRIPT_ENTRIES':
          result = await this.getTranscriptEntries(meet, params.transcriptName);
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
      console.error('[GoogleMeetPlugin] Error:', error);
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
      return 'Google Meet access not granted. Reconnect Google in Settings → Connections to grant Meet permission. Note: recordings/transcripts also require a Workspace plan with recording enabled. (' + error.message + ')';
    }
    if (status === 404) {
      return 'Meet resource not found. Check the resource name. (' + error.message + ')';
    }
    return error.message;
  }

  /**
   * Accept either a full resource name ("spaces/xxx") or a bare meeting
   * code / space id and normalize to the resource name the API expects.
   */
  normalizeSpaceName(spaceName) {
    if (!spaceName) throw new Error('spaceName is required');
    return spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;
  }

  async createSpace(meet, params) {
    const response = await meet.spaces.create({
      requestBody: {
        config: {
          accessType: params.accessType || 'TRUSTED',
        },
      },
    });
    return {
      spaceName: response.data.name,
      meetingUri: response.data.meetingUri,
      meetingCode: response.data.meetingCode,
      accessType: response.data.config?.accessType,
    };
  }

  async getSpace(meet, spaceName) {
    const response = await meet.spaces.get({ name: this.normalizeSpaceName(spaceName) });
    return {
      spaceName: response.data.name,
      meetingUri: response.data.meetingUri,
      meetingCode: response.data.meetingCode,
      accessType: response.data.config?.accessType,
      activeConference: response.data.activeConference || null,
    };
  }

  async endConference(meet, spaceName) {
    const name = this.normalizeSpaceName(spaceName);
    await meet.spaces.endActiveConference({ name });
    return { ended: true, spaceName: name };
  }

  async listConferenceRecords(meet, filter) {
    const response = await meet.conferenceRecords.list({
      filter: filter || undefined,
      pageSize: 25,
    });
    const records = (response.data.conferenceRecords || []).map((r) => ({
      name: r.name,
      space: r.space,
      startTime: r.startTime,
      endTime: r.endTime || null,
    }));
    return { conferenceRecords: records, count: records.length };
  }

  async listRecordings(meet, conferenceRecordName) {
    if (!conferenceRecordName) throw new Error('conferenceRecordName is required for LIST_RECORDINGS');
    const response = await meet.conferenceRecords.recordings.list({
      parent: conferenceRecordName,
    });
    const recordings = (response.data.recordings || []).map((r) => ({
      name: r.name,
      state: r.state,
      driveFileId: r.driveDestination?.file || null,
      exportUri: r.driveDestination?.exportUri || null,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
    return { recordings, count: recordings.length };
  }

  async listTranscripts(meet, conferenceRecordName) {
    if (!conferenceRecordName) throw new Error('conferenceRecordName is required for LIST_TRANSCRIPTS');
    const response = await meet.conferenceRecords.transcripts.list({
      parent: conferenceRecordName,
    });
    const transcripts = (response.data.transcripts || []).map((t) => ({
      name: t.name,
      state: t.state,
      docsDocumentId: t.docsDestination?.document || null,
      exportUri: t.docsDestination?.exportUri || null,
      startTime: t.startTime,
      endTime: t.endTime,
    }));
    return { transcripts, count: transcripts.length };
  }

  async getTranscriptEntries(meet, transcriptName) {
    if (!transcriptName) throw new Error('transcriptName is required for GET_TRANSCRIPT_ENTRIES');

    const entries = [];
    let pageToken;
    do {
      const response = await meet.conferenceRecords.transcripts.entries.list({
        parent: transcriptName,
        pageSize: 100,
        pageToken,
      });
      for (const e of response.data.transcriptEntries || []) {
        entries.push({
          participant: e.participant,
          text: e.text,
          languageCode: e.languageCode,
          startTime: e.startTime,
          endTime: e.endTime,
        });
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken && entries.length < 2000);

    return {
      entries,
      count: entries.length,
      fullText: entries.map((e) => e.text).join('\n'),
    };
  }

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required for Google Meet operations');
    }
  }
}

export default new GoogleMeetAPI();
