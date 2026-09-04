# Gmail API 📧

## Id

`gmail-api`

## Description

Manages Gmail accounts with comprehensive email operations including sending, replying, searching, reading emails, and handling attachments. Uses OAuth authentication for secure Gmail integration.

## Tags

gmail, email, api, google, oauth, attachments, search

## Input Parameters

### Required

- **operation** (string): Action to perform (`Send Email`, `Reply to Email`, `Search and Read Emails`, `List Emails Page`, `Read Email`, `Modify Email`, `Get Attachments`)

### Optional

- **to** (string): Recipient email for sending
- **subject** (string): Email subject
- **body** (string): Email body content
- **messageId** (string): Email ID for operations
- **searchQuery** (string): Gmail search query
- **maxResults** (number): Results per page, clamped to 1–500
- **pageToken** (string): Continuation token from the previous `List Emails Page` result
- **format** (string): `ids`, `metadata`, or `full`; use `ids` for cheap mailbox traversal
- **metadataHeaders** (string): Optional comma-separated metadata headers
- **includeSpamTrash** (boolean): Include Spam and Trash in page results
- **addLabelIds** (array): Labels to add
- **removeLabelIds** (array): Labels to remove

## Output Format

- **success** (boolean): Whether the Gmail operation was successful
- **result** (object): Operation result. `List Emails Page` returns `messages`, `nextPageToken`, `resultSizeEstimate`, and any `failedMessageIds`; pass `nextPageToken` into the next call until it is `null`
- **error** (string|null): Error message if the operation failed
