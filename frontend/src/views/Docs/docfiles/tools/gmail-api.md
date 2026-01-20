# Gmail API 📧

## Id

`gmail-api`

## Description

Manages Gmail accounts with comprehensive email operations including sending, replying, searching, reading emails, and handling attachments. Uses OAuth authentication for secure Gmail integration.

## Tags

gmail, email, api, google, oauth, attachments, search

## Input Parameters

### Required

- **operation** (string): Action to perform (`Send Email`, `Reply to Email`, `Search and Read Emails`, `Read Email`, `Modify Email`, `Get Attachments`)

### Optional

- **to** (string): Recipient email for sending
- **subject** (string): Email subject
- **body** (string): Email body content
- **messageId** (string): Email ID for operations
- **searchQuery** (string): Gmail search query
- **maxResults** (number): Maximum results for search
- **addLabelIds** (array): Labels to add
- **removeLabelIds** (array): Labels to remove

## Output Format

- **success** (boolean): Whether the Gmail operation was successful
- **result** (object): Operation result including email data, attachments, or search results
- **error** (string|null): Error message if the operation failed
