import BaseTrigger from '../BaseTrigger.js';
import SheetsReceiver from '../../triggers/_SheetsReceiver.js';

class GoogleSheetsNewRow extends BaseTrigger {
  static schema = {
    title: 'Google Sheets New Row',
    category: 'trigger',
    type: 'google-sheets-new-row',
    icon: 'table',
    description: 'This trigger node listens for new rows added to a specified Google Sheet and triggers the workflow when a new row is detected.',
    authRequired: 'oauth',
    authProvider: 'google',
    parameters: {
      spreadsheetId: {
        type: 'string',
        inputType: 'text',
        description: 'The ID of the Google Spreadsheet to monitor',
      },
      sheetName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the sheet within the spreadsheet to monitor',
      },
    },
    outputs: {
      newRow: {
        type: 'object',
        description: 'The data of the newly added row',
      },
    },
  };

  constructor() {
    super('google-sheets-new-row');
    this.sheetsReceiver = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    if (!node.parameters || !node.parameters.spreadsheetId || !node.parameters.sheetName) {
      throw new Error('Google Sheets trigger node is missing required parameters');
    }

    // Create SheetsReceiver instance
    this.sheetsReceiver = new SheetsReceiver(
      {
        spreadsheetId: node.parameters.spreadsheetId,
        sheetName: node.parameters.sheetName,
      },
      engine
    );

    // Store in engine receivers
    engine.receivers.sheets = this.sheetsReceiver;

    // Listen for new row events
    this.sheetsReceiver.on('newRow', (data) => {
      engine.processWorkflowTrigger(data);
    });

    // Start the receiver (begins polling)
    await this.sheetsReceiver.start();

    console.log(`Google Sheets receiver started for ${node.parameters.spreadsheetId} - ${node.parameters.sheetName}`);
  }

  async validate(triggerData) {
    return 'newRow' in triggerData;
  }

  async process(inputData) {
    return {
      newRow: inputData.newRow,
    };
  }

  async teardown() {
    // Stop the sheets receiver
    if (this.sheetsReceiver) {
      this.sheetsReceiver.stop();
      this.sheetsReceiver = null;
      console.log('Google Sheets receiver stopped');
    }

    await super.teardown();
  }
}

export default new GoogleSheetsNewRow();
