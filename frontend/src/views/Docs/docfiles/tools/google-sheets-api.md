# Google Sheets API 📊

## Id

`google-sheets-api`

## Description

Manages Google Sheets with full spreadsheet operations including reading, writing, appending, and clearing data. Supports OAuth authentication and handles complex data structures with JSON parsing capabilities.

## Tags

google-sheets, spreadsheet, api, data, oauth, crud

## Input Parameters

### Required

- **operation** (string): Action to perform (`Read`, `Write`, `Append`, `Clear`)
- **spreadsheetId** (string): Google Sheets spreadsheet ID
- **range** (string): Cell range to operate on (e.g., "Sheet1!A1:D5")

### Optional

- **values** (string|array): Data values as JSON string or array for write/append operations

## Output Format

- **success** (boolean): Whether the Google Sheets operation was successful
- **result** (object): Operation result including cell data or update confirmations
- **error** (string|null): Error message if the operation failed
