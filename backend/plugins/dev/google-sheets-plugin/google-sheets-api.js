import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Google Sheets API Plugin
 *
 * This action tool allows reading, writing, appending, and clearing data
 * in Google Sheets.
 */
class GoogleSheetsAPI {
  constructor() {
    this.name = 'google-sheets-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[GoogleSheetsPlugin] Executing Google Sheets API with params:', JSON.stringify(params, null, 2));

    try {
      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate with Google.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const sheets = google.sheets({ version: 'v4', auth });

      // Resolve parameters using the workflow engine's parameter resolver
      const resolvedSpreadsheetId = workflowEngine.parameterResolver.resolveTemplate(params.spreadsheetId);
      const resolvedRange = workflowEngine.parameterResolver.resolveTemplate(params.range);

      switch (params.operation) {
        case 'Read':
          return await this.readOperation(sheets, resolvedSpreadsheetId, resolvedRange);

        case 'Write':
        case 'Append':
          return await this.writeAppendOperation(sheets, params.operation, resolvedSpreadsheetId, resolvedRange, params.values, workflowEngine);

        case 'Clear':
          return await this.clearOperation(sheets, resolvedSpreadsheetId, resolvedRange);

        default:
          throw new Error(`Unknown operation: ${params.operation}`);
      }
    } catch (error) {
      console.error('[GoogleSheetsPlugin] Error executing Google Sheets API:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  /**
   * Read operation - get data from a range
   */
  async readOperation(sheets, spreadsheetId, range) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return {
      success: true,
      result: response.data.values || [],
      error: null,
    };
  }

  /**
   * Write or Append operation - write data to a range
   */
  async writeAppendOperation(sheets, operation, spreadsheetId, range, values, workflowEngine) {
    const processedValues = this.processValues(values, workflowEngine);

    const valueRange = {
      values: processedValues,
    };

    let response;
    if (operation === 'Write') {
      response = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: valueRange,
      });
    } else {
      // Append
      response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: valueRange,
      });
    }

    return {
      success: true,
      result: response.data,
      error: null,
    };
  }

  /**
   * Clear operation - clear data from a range
   */
  async clearOperation(sheets, spreadsheetId, range) {
    const response = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    return {
      success: true,
      result: response.data,
      error: null,
    };
  }

  /**
   * Process values parameter into proper format
   */
  processValues(values, workflowEngine) {
    let processedValues;

    // First, resolve the entire values parameter
    const resolvedValues = workflowEngine.parameterResolver.resolveTemplate(values);

    if (typeof resolvedValues === 'string') {
      try {
        // Attempt to parse the string as JSON
        processedValues = JSON.parse(resolvedValues);
      } catch (error) {
        // If parsing fails, split the string manually
        const trimmedValues = resolvedValues.trim().replace(/^\[|\]$/g, '');
        const rows = trimmedValues.split(/],\s*\[/);
        processedValues = rows.map((row) => {
          const cleanRow = row.replace(/^\[|\]$/g, '');
          return cleanRow.split(/,(?![^"]*"(?:(?:[^"]*"){2})*[^"]*$)/);
        });
      }
    } else if (Array.isArray(resolvedValues)) {
      processedValues = resolvedValues;
    } else {
      throw new Error('Invalid values format');
    }

    // Ensure processedValues is an array of arrays
    if (!Array.isArray(processedValues[0])) {
      processedValues = [processedValues];
    }

    // Trim each value and resolve any remaining templates
    return processedValues.map((row) =>
      row.map((value) => {
        const trimmed = value.toString().trim();
        return workflowEngine.parameterResolver.resolveTemplate(trimmed);
      })
    );
  }
}

export default new GoogleSheetsAPI();
