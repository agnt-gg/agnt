# Discord Receiver 🎮

## Id

`discord-receiver`

## Description

Monitors Discord channels for new messages and triggers workflows when messages are received. Uses OAuth authentication to access user-specific Discord servers and supports real-time message processing with configurable channel filtering.

## Tags

discord, trigger, messaging, chat, oauth, real-time

## Input Parameters

### Required

- **channelId** (string): The Discord channel ID to monitor for new messages
- **userId** (string): User ID for OAuth authentication to access the Discord server

### Optional

- **ignoreBots** (boolean, default=true): Whether to ignore messages from bots
- **serverId** (string): Specific Discord server/guild ID to limit monitoring scope

## Output Format

- **content** (string): The text content of the Discord message
- **author** (string): Username of the message sender
- **authorId** (string): Unique Discord ID of the message sender
- **channelId** (string): The channel where the message was posted
- **guildId** (string): The Discord server/guild ID
- **timestamp** (number): Unix timestamp when the message was sent
- **attachments** (array): Array of file attachments with metadata including filename, type, and URL
