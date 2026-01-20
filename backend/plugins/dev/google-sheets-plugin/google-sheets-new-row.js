import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Google Sheets New Row Trigger Plugin
 *
 * This trigger monitors a Google Sheet for new rows and triggers the workflow
 * when new rows are detected. It polls the sheet every 30 seconds.
 */
class GoogleSheetsNewRow extends EventEmitter {
  constructor() {
    super();
    this.name = 'google-sheets-new-row';
    this.intervalId = null;
    this.lastRowCount = 0;
    this.isListening = false;
    this.spreadsheetId = null;
    this.sheetName = null;
    this.workflowEngine = null;
  }

  /**
   * Setup the trigger - called when workflow starts
   */
  async setup(engine, node) {
    console.log('[GoogleSheetsPlugin] Setting up Google Sheets New Row trigger');

    if (!node.parameters || !node.parameters.spreadsheetId || !node.parameters.sheetName) {
      throw new Error('Google Sheets trigger node is missing required parameters');
    }

    this.workflowEngine = engine;
    this.spreadsheetId = node.parameters.spreadsheetId;
    this.sheetName = node.parameters.sheetName;

    // Store in engine receivers for cleanup
    engine.receivers.sheets = this;

    // Start polling
    await this.start();

    console.log(`[GoogleSheetsPlugin] Monitoring ${this.spreadsheetId} - ${this.sheetName}`);
  }

  /**
   * Start polling for new rows
   */
  async start() {
    if (this.isListening) return;

    this.isListening = true;

    // Initialize the baseline row count
    await this.initializeLastRowCount();

    // Start polling every 30 seconds
    this.intervalId = setInterval(() => this.checkNewRows(), 30000);

    console.log(`[GoogleSheetsPlugin] Started polling for ${this.spreadsheetId} - ${this.sheetName}`);
  }

  /**
   * Stop polling
   */
  stop() {
    this.isListening = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[GoogleSheetsPlugin] Stopped polling for ${this.spreadsheetId} - ${this.sheetName}`);
  }

  /**
   * Get Google OAuth credentials
   */
  async getGoogleAuth() {
    try {
      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = this.workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token found. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({
        access_token: accessToken,
      });

      return auth;
    } catch (error) {
      console.error('[GoogleSheetsPlugin] Error getting Google auth:', error);
      throw error;
    }
  }

  /**
   * Initialize the baseline row count
   */
  async initializeLastRowCount() {
    try {
      const auth = await this.getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.sheetName,
      });

      this.lastRowCount = response.data.values ? response.data.values.length : 0;
      console.log(`[GoogleSheetsPlugin] Initialized with ${this.lastRowCount} rows`);
    } catch (error) {
      console.error(`[GoogleSheetsPlugin] Error initializing row count:`, error);
    }
  }

  /**
   * Check for new rows
   */
  async checkNewRows() {
    if (!this.isListening) return;

    try {
      const auth = await this.getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.sheetName,
      });

      const rows = response.data.values || [];

      if (rows.length > this.lastRowCount) {
        // Get only the new rows
        const newRows = rows.slice(this.lastRowCount);

        console.log(`[GoogleSheetsPlugin] Detected ${newRows.length} new row(s)`);

        // Trigger workflow for each new row
        for (const row of newRows) {
          this.workflowEngine.processWorkflowTrigger({ newRow: row });
        }

        // Update the row count
        this.lastRowCount = rows.length;
      }
    } catch (error) {
      console.error(`[GoogleSheetsPlugin] Error checking for new rows:`, error);
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'newRow' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    return {
      newRow: inputData.newRow,
    };
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[GoogleSheetsPlugin] Tearing down Google Sheets trigger');
    this.stop();
  }
}

export default new GoogleSheetsNewRow();
