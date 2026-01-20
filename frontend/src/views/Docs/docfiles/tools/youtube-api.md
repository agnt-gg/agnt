# YouTube API 📺

## Id

`youtube-api`

## Description

Manages YouTube channels and content with comprehensive video operations. Supports video uploads, playlist management, comments, subscriptions, and transcription services. Features 3-tier fallback system for reliable transcription extraction.

## Tags

youtube, api, video, upload, playlist, comments, transcription, oauth

## Input Parameters

### Required

- **action** (string): Action to perform (`ADD_VIDEO_TO_PLAYLIST`, `COMMENT_ON_VIDEO`, `CREATE_PLAYLIST`, `DISLIKE_VIDEO`, `GET_MY_SUBSCRIPTIONS`, `GET_PLAYLIST_ITEMS`, `GET_TRANSCRIPTION`, `GET_VIDEO_DETAILS`, `LIKE_VIDEO`, `LIST_CHANNEL_VIDEOS`, `REPLY_TO_COMMENT`, `SEARCH_VIDEOS`, `SUBSCRIBE_TO_CHANNEL`, `UNSUBSCRIBE_FROM_CHANNEL`, `UPDATE_VIDEO_METADATA`, `UPLOAD_VIDEO`)

### Optional

- **videoId** (string): YouTube video ID
- **channelId** (string): YouTube channel ID
- **playlistId** (string): YouTube playlist ID
- **query** (string): Search query
- **title** (string): Video or playlist title
- **description** (string): Video or playlist description
- **maxResults** (number): Maximum results for searches
- **fallbackMethod** (string): Transcription fallback method (`api`, `ytdlp`, `whisper`, `all`)

## Output Format

- **success** (boolean): Whether the YouTube operation was successful
- **result** (object): Operation result including video data, playlists, comments, transcriptions, or upload confirmations
- **error** (string|null): Error message if the operation failed
