# Google Sheets Receiver 📊

## Id

`sheets-receiver`

## Description

Monitors Google Sheets for new row additions and triggers workflows when new data is detected. Uses OAuth authentication to access user-specific Google Sheets and polls for changes at regular intervals.

## Tags

google-sheets, trigger, spreadsheet, data, polling, oauth

## Input Parameters

### Required

- **spreadsheetId** (string): The Google Sheets spreadsheet ID (found in the URL)
- **sheetName** (string): The specific sheet/tab name to monitor for new rows

### Optional

- **pollInterval** (number, default=30000): Time in milliseconds between checks for new rows

## Output Format

- **newRow** (array): Array of cell values from the newly added row
- **rowNumber** (number): The row number where new data was detected
- **timestamp** (string): ISO timestamp when the new row was detected
