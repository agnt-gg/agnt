# Send Email 📧

## Id

`sendEmail`

## Description

Sends emails using SMTP configuration. Supports both plain text and HTML email formats with customizable sender names and workflow-specific email addresses.

## Tags

email, communication, smtp, notification, messaging

## Input Parameters

### Required

- **to** (string): Recipient email address (can include name format like "Name <email@domain.com>")
- **subject** (string): Email subject line
- **body** (string): Email content (text or HTML depending on isHtml flag)

### Optional

- **isHtml** (boolean, default=false): Whether the body content should be treated as HTML
- **senderName** (string, default='AGNT Workflow'): Custom sender name that appears in the "From" field

## Output Format

- **success** (boolean): Indicates whether the email was sent successfully
- **content** (object): Contains the original parameters sent (to, subject, body, etc.)
- **messageId** (string): Unique message identifier from the email service
- **error** (string|null): Error message if the email sending failed
