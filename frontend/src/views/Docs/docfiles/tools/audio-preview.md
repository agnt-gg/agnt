# Audio Preview

## Overview

The **Audio Preview** node provides an audio player with waveform visualization. It supports multiple audio formats including MP3, WAV, OGG, WebM, AAC, and M4A up to 10MB, making it perfect for playing and analyzing audio files in workflows.

## Category

**Widget**

## Parameters

### audioSource

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: Audio source
- **Supported Formats**:
  - URL (http:// or https://)
  - Blob URL (blob://)
  - Base64 data (data:audio/...)
- **Supported Audio Types**:
  - MP3 (.mp3)
  - WAV (.wav)
  - OGG (.ogg)
  - WebM (.webm)
  - AAC (.aac)
  - M4A (.m4a)
- **Features**: Supports drag & drop of audio files
- **Size Limit**: Up to 10MB

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the audio was successfully processed

### audioUrl

- **Type**: String
- **Description**: The audio URL ready for playback

### metadata

- **Type**: Object
- **Description**: Audio metadata including:
  - Source type (url, blob, base64)
  - File size in bytes
  - Duration in seconds (when available)
  - Format/MIME type
  - Bitrate (when available)
  - Sample rate (when available)

### error

- **Type**: String
- **Description**: Error message if audio processing failed

## Use Cases

1. **Audio Playback**: Play audio files from various sources
2. **Voice Message Display**: Play recorded voice messages
3. **Music Preview**: Preview music tracks before processing
4. **Podcast Player**: Display and play podcast episodes
5. **Audio Analysis**: Visualize audio waveforms
6. **TTS Output**: Play text-to-speech generated audio

## Example Configurations

**Play Audio from URL**

```
audioSource: https://example.com/audio.mp3
```

**Play Base64 Audio**

```
audioSource: data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAASW5mbwAAAA8AAAA...
```

**Play Generated Audio**

```
audioSource: {{textToSpeech.audioUrl}}
```

## Tips

- Maximum file size is 10MB for optimal performance
- Waveform visualization provides visual feedback
- Supports all common audio formats
- Base64 audio is automatically converted for playback
- Metadata extraction includes duration and bitrate
- Drag & drop support for easy file upload
- Works with both local and remote audio sources

## Common Patterns

**Text-to-Speech Workflow**

```
1. Generate speech with Text to Speech node
2. Pass audio output to Audio Preview
3. Play and review the generated audio
4. Save or share if approved
```

**Voice Message Processing**

```
1. Receive voice message from API
2. Display with Audio Preview
3. Transcribe if needed
4. Store or forward the message
```

**Audio Quality Check**

```
1. Upload audio file
2. Display with Audio Preview
3. Check metadata.bitrate and metadata.duration
4. Process based on quality metrics
```

## Related Nodes

- **Text to Speech**: For generating audio from text
- **Custom API Request**: For fetching audio from APIs
- **File System Operation**: For reading local audio files
- **Media Preview**: For displaying images and videos
- **Send Email**: For emailing audio files

## Tags

audio, preview, player, sound, music, voice, widget, waveform, mp3, wav
