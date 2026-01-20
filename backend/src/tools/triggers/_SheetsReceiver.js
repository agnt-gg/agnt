import EventEmitter from 'events';
import { google } from 'googleapis';
import AuthManager from '../../services/auth/AuthManager.js';

class SheetsReceiver extends EventEmitter {
  constructor(config, workflowEngine) {
    super();
    this.config = config;
    this.workflowEngine = workflowEngine;
    this.spreadsheetId = config.spreadsheetId;
    this.sheetName = config.sheetName;
    this.isListening = false;
    this.lastRowCount = 0;
    this.checkNewRows = this.checkNewRows.bind(this);
  }
  async start() {
    if (this.isListening) return;
    this.isListening = true;
    await this.initializeLastRowCount();
    this.intervalId = setInterval(this.checkNewRows, 30000);
    console.log(`GoogleSheetsReceiver started for ${this.spreadsheetId} - ${this.sheetName}`);
  }
  stop() {
    this.isListening = false;
    clearInterval(this.intervalId);
    console.log(`GoogleSheetsReceiver stopped for ${this.spreadsheetId} - ${this.sheetName}`);
  }
  async getGoogleAuth() {
    try {
      const userId = this.workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token found. User needs to authenticate.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({
        access_token: accessToken,
      });

      return auth;
    } catch (error) {
      console.error('Error getting Google auth:', error);
      throw error;
    }
  }
  async initializeLastRowCount() {
    try {
      const auth = await this.getGoogleAuth();
      const sheets = google.sheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.sheetName,
      });
      this.lastRowCount = response.data.values ? response.data.values.length : 0;
    } catch (error) {
      console.error(`Error initializing row count for ${this.spreadsheetId} - ${this.sheetName}:`, error);
    }
  }
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
        const newRows = rows.slice(this.lastRowCount);
        for (const row of newRows) {
          this.emit('newRow', { newRow: row });
        }
        this.lastRowCount = rows.length;
      }
    } catch (error) {
      console.error(`Error checking for new rows in ${this.spreadsheetId} - ${this.sheetName}:`, error);
    }
  }
}

export default SheetsReceiver;
