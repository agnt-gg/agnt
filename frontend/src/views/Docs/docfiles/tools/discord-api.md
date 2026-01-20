# Discord API 💬

## Id

`discord-api`

## Description

Interacts with Discord servers to send messages, manage roles, upload files, and retrieve member information. Uses OAuth authentication to access user-specific Discord workspaces with comprehensive server management capabilities.

## Tags

discord, messaging, api, roles, files, server, oauth

## Input Parameters

### Required

- **action** (string): Action to perform (`SEND_MESSAGE`, `ASSIGN_ROLE`, `GET_MEMBERS`, `UPLOAD_FILE`)
- **channelId** (string): Discord channel ID for message operations

### Optional

- **guildId** (string): Discord server/guild ID
- **message** (string): Message content for SEND_MESSAGE action
- **roleId** (string): Role ID for role management
- **memberIds** (string): Comma-separated list of member IDs for role assignment
- **fileName** (string): Name of file to upload
- **fileData** (string): Base64-encoded file data for upload
- **text** (string): Message text for file uploads

## Output Format

- **success** (boolean): Whether the Discord operation was successful
- **result** (object): Operation result including message IDs, member lists, or upload confirmations
- **error** (string|null): Error message if the operation failed
