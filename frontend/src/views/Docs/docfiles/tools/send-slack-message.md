# Send Slack Message 💬

## Id

`send-slack-message`

## Description

Sends messages to Slack channels using OAuth authentication. Supports real-time messaging with comprehensive channel management and user-specific workspace integration.

## Tags

slack, messaging, api, oauth, channels, communication

## Input Parameters

### Required

- **channelId** (string): Slack channel ID to send message to
- **message** (string): Message content to send

## Output Format

- **success** (boolean): Whether the message was sent successfully
- **timestamp** (string): Message timestamp
- **error** (string|null): Error message if sending failed
