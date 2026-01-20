# Slack Receiver 💬

## Id

`slack-receiver`

## Description

Monitors Slack channels for new messages and triggers workflows when messages are posted. Uses OAuth authentication to access user-specific Slack workspaces and supports real-time message polling with configurable intervals.

## Tags

slack, trigger, messaging, chat, oauth, polling

## Input Parameters

### Required

- **channelId** (string): The Slack channel ID to monitor for new messages
- **userId** (string): User ID for OAuth authentication to access the Slack workspace

### Optional

- **pollInterval** (number, default=5000): Time in milliseconds between message checks
- **ignoreBots** (boolean, default=true): Whether to ignore messages from bots

## Output Format

- **content** (string): The text content of the Slack message
- **author** (string): Username of the message sender
- **authorId** (string): Unique ID of the message sender
- **channelId** (string): The channel where the message was posted
- **guildId** (string): The workspace/server ID (if applicable)
- **timestamp** (number): Unix timestamp when the message was sent
- **attachments** (array): Array of file attachments with metadata
