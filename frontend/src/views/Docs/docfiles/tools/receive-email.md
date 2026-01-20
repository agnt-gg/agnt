# Email Receiver 📬

## Id

`email-receiver`

## Description

Monitors email inboxes for new messages and triggers workflows when emails are received. Supports processing email metadata including sender, subject, body content, and attachments. Uses polling to check for new emails at regular intervals.

## Tags

email, trigger, inbox, mail, polling, attachments

## Input Parameters

### Required

- **workflowId** (string): Unique identifier for the workflow to trigger
- **emailAddress** (string): The email address to monitor for new messages

### Optional

- **pollInterval** (number, default=10000): Time in milliseconds between email checks
- **filter** (string): Optional filter criteria for incoming emails (subject contains, from address, etc.)

## Output Format

- **type** (string): Always "email" for email triggers
- **from** (string): Sender email address
- **to** (string): Recipient email address
- **subject** (string): Email subject line
- **body** (string): Plain text email content
- **html** (string): HTML email content (if available)
- **attachments** (array): Array of attachment objects with filename, type, and data
- **timestamp** (string): ISO timestamp when the email was received
