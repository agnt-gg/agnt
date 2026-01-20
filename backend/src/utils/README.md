# YouTube Caption Extraction - 3-Tier Fallback System

This directory contains utilities for extracting captions from YouTube videos using a comprehensive 3-tier fallback system.

## Overview

The system tries multiple methods in order to ensure we can always get captions:

1. **Tier 1: YouTube API** - Official Google YouTube API (fast, clean, but often restricted)
2. **Tier 2: yt-dlp** - Direct caption extraction using yt-dlp (reliable, free)
3. **Tier 3: OpenAI Whisper** - Audio transcription using OpenAI's Whisper API (most reliable, costs money)

## Files

- `youtube-caption-extractor.js` - Handles yt-dlp caption extraction and audio downloading
- `whisper-transcriber.js` - Handles OpenAI Whisper transcription with chunking support
- `README.md` - This documentation file

## Setup

### 1. Install Dependencies

Make sure you have the following tools installed:

```bash
# Install yt-dlp
pip install yt-dlp

# Install ffmpeg (for audio processing)
# On Windows: Download from https://ffmpeg.org/download.html
# On macOS: brew install ffmpeg
# On Ubuntu: sudo apt install ffmpeg

# Install ffprobe (usually comes with ffmpeg)
```

### 2. Configure Cookies (Optional but Recommended)

To bypass YouTube's 403 restrictions, export your browser cookies:

1. Install a browser extension like "Get cookies.txt" for Chrome/Firefox
2. Visit YouTube and make sure you're logged in
3. Export cookies as `cookies.txt`
4. Place the file at `backend/src/cookies.txt`

**Important**: Keep your cookies.txt file secure and don't commit it to version control.

### 3. Environment Variables

Make sure you have the OpenAI API key set in your environment:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

## Usage

The enhanced YouTube API tool now supports these parameters for `GET_TRANSCRIPTION`:

- `videoId` - YouTube video ID (e.g., "dQw4w9WgXcQ")
- `youtubeUrl` - Full YouTube URL (alternative to videoId)
- `fallbackMethod` - Which methods to try:
  - `"all"` (default) - Try all methods in order
  - `"api"` - YouTube API only
  - `"ytdlp"` - yt-dlp only
  - `"whisper"` - OpenAI Whisper only

## How It Works

### Tier 1: YouTube API

- Uses official Google YouTube API
- Fast and clean when it works
- Often fails due to:
  - Insufficient OAuth permissions
  - Video owner restrictions
  - Third-party access disabled

### Tier 2: yt-dlp Caption Extraction

- Multiple fallback strategies:
  1. Auto-generated + manual subtitles (VTT format)
  2. Manual subtitles only (VTT format)
  3. Auto-generated only (VTT format)
  4. SRT format fallback
- Uses cookies.txt if available for better success rate
- Parses VTT/SRT files to extract clean text
- Free but may fail on restricted videos

### Tier 3: OpenAI Whisper Transcription

- Downloads audio using yt-dlp
- Automatically chunks large files (>24MB)
- Uses OpenAI's Whisper API for transcription
- Most reliable but costs ~$0.006 per minute
- Includes cost estimation and tracking

## Cost Information

- **YouTube API**: Free (but often fails)
- **yt-dlp**: Free (but may fail on restricted videos)
- **OpenAI Whisper**: ~$0.006 per minute of audio

The system provides detailed cost breakdowns and tracks savings when free methods work.

## Error Handling

The system provides comprehensive error reporting:

- Detailed logs for each tier attempt
- Specific error messages for different failure types
- Fallback chain information
- Cost tracking and savings reports

## Caching

Results are cached to avoid reprocessing the same videos. The cache includes:

- Video ID as key
- Transcription content
- Method used
- Cost information
- Timestamp for expiration

## Troubleshooting

### Common Issues

1. **403 Forbidden Errors**

   - Solution: Add cookies.txt file
   - Make sure you're logged into YouTube in your browser

2. **yt-dlp Not Found**

   - Solution: Install yt-dlp with `pip install yt-dlp`
   - Make sure it's in your system PATH

3. **ffmpeg Not Found**

   - Solution: Install ffmpeg and make sure it's in your PATH
   - Required for audio processing and chunking

4. **OpenAI API Errors**
   - Solution: Check your OPENAI_API_KEY environment variable
   - Ensure you have sufficient API credits

### Debug Logging

The system provides extensive logging with prefixes:

- `[YouTube Transcription]` - Main system logs
- `[yt-dlp]` - yt-dlp specific logs
- `[Whisper]` - OpenAI Whisper logs

## Security Notes

- Keep your `cookies.txt` file secure
- Don't commit cookies.txt to version control
- Add `cookies.txt` to your `.gitignore`
- Regularly update your cookies for best results
