import BaseAction from '../BaseAction.js';
import { google } from 'googleapis';
import AuthManager from '../../../services/auth/AuthManager.js';

class GoogleSheetsOperation extends BaseAction {
  static schema = {
    title: 'Google Sheets API',
    category: 'action',
    type: 'google-sheets-api',
    icon: 'table',
    description: 'This action node interacts with Google Sheets to read, write or modify data in a spreadsheet.',
    authRequired: 'oauth',
    authProvider: 'google',
    parameters: {
      operation: {
        type: 'string',
        inputType: 'select',
        options: ['Read', 'Write', 'Append', 'Clear'],
        description: 'The operation to perform on the Google Sheet',
      },
      spreadsheetId: {
        type: 'string',
        description: 'The ID of the Google Sheet to interact with',
      },
      range: {
        type: 'string',
        description: "The range of cells to interact with (e.g., 'Sheet1!A1:B5')",
      },
      values: {
        type: 'array',
        inputType: 'textarea',
        description: 'Comma separated array of values to write or append (for write and append operations).',
        conditional: {
          field: 'operation',
          value: ['Write', 'Append'],
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the Google Sheets operation was successful',
      },
      result: {
        type: 'array',
        description: 'The data returned by the Google Sheets operation (for read operations)',
      },
      error: {
        type: 'string',
        description: 'Error message if the Google Sheets operation failed',
      },
    },
  };

  constructor() {
    super('googleSheetsOperation');
  }
  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    const resolvedParams = this.resolveParameters(params, workflowEngine);

    try {
      // Get the user's Google access token using the userId
      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'google');

      console.log('Google Sheets accessToken', accessToken);

      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate.');
      }

      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const sheets = google.sheets({ version: 'v4', auth });

      const resolvedSpreadsheetId = resolvedParams.spreadsheetId;
      const resolvedRange = resolvedParams.range;

      const processValues = (values) => {
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
      };

      switch (params.operation) {
        case 'Read':
          const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId: resolvedSpreadsheetId,
            range: resolvedRange,
          });
          return this.formatOutput({
            success: true,
            result: readResult.data.values,
            error: null,
          });
        case 'Write':
        case 'Append':
          const processedValues = processValues(params.values);
          const valueRange = {
            // values: [processedValues], // Wrap processedValues in an array to ensure it's treated as a single row
            values: processedValues, // Now processedValues is already an array of rows
          };

          let result;
          if (params.operation === 'Write') {
            result = await sheets.spreadsheets.values.update({
              spreadsheetId: resolvedSpreadsheetId,
              range: resolvedRange,
              valueInputOption: 'RAW',
              resource: valueRange,
            });
          } else {
            result = await sheets.spreadsheets.values.append({
              spreadsheetId: resolvedSpreadsheetId,
              range: resolvedRange,
              valueInputOption: 'RAW',
              insertDataOption: 'INSERT_ROWS',
              resource: valueRange,
            });
          }
          return this.formatOutput({
            success: true,
            result: result.data,
            error: null,
          });
        case 'Clear':
          const clearResult = await sheets.spreadsheets.values.clear({
            spreadsheetId: resolvedSpreadsheetId,
            range: resolvedRange,
          });
          return this.formatOutput({
            success: true,
            result: clearResult.data,
            error: null,
          });
        default:
          throw new Error(`Unknown operation: ${params.operation}`);
      }
    } catch (error) {
      console.error('Error performing Google Sheets operation:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }
  resolveParameters(params, workflowEngine) {
    const { values, ...otherParams } = params;
    return {
      ...workflowEngine.parameterResolver.resolveParameters(otherParams),
      values,
    };
  }
  validateParams(params) {
    if (!params.operation || !params.spreadsheetId || !params.range) {
      throw new Error('Operation, spreadsheetId, and range are required for Google Sheets operations');
    }
  }
}

export default new GoogleSheetsOperation();
