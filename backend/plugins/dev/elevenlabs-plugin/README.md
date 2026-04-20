# ElevenLabs Plugin for AGNT

Industry-leading AI voice: text-to-speech, speech-to-text, and voice library browsing using **ElevenLabs**.

## Features

- 🎙️ **Text-to-Speech** — 32+ languages, 4 models, full voice settings control
- 📝 **Speech-to-Text** — Scribe transcription with word-level timings and speaker diarization
- 🔍 **Voice Library** — Browse and inspect premade, cloned, generated, and professional voices

## Authentication

Requires an **ElevenLabs** API key. Connect in `Settings → Connections → ElevenLabs`.

Get one at: https://elevenlabs.io/app/settings/api-keys

## Actions

### `TEXT_TO_SPEECH`

Generate an MP3 from text using any voice in your library.

| Parameter         | Default                      | Notes                                          |
| ----------------- | ---------------------------- | ---------------------------------------------- |
| `text`            | required                     | The text to synthesize                         |
| `voiceId`         | `EXAVITQu4vr4xnSDxMaL`       | Default is "Bella" (warm female)               |
| `modelId`         | `eleven_multilingual_v2`     | v2 / turbo / flash / v3                        |
| `stability`       | `0.5`                        | 0=variable, 1=flat                             |
| `similarityBoost` | `0.75`                       | How closely to match original voice            |
| `style`           | `0`                          | Style exaggeration (v2 only)                   |
| `outputFormat`    | `mp3_44100_128`              | Format / sample rate / bitrate                 |

**Models:**
- `eleven_multilingual_v2` — best overall quality, 29 languages
- `eleven_turbo_v2_5` — fast, lower latency
- `eleven_flash_v2_5` — fastest, 75ms latency
- `eleven_v3` — most expressive, 70+ languages (alpha)

### `SPEECH_TO_TEXT`

Transcribe audio using ElevenLabs Scribe. Returns word-level timings — perfect for generating video captions.

| Parameter         | Default       | Notes                                   |
| ----------------- | ------------- | --------------------------------------- |
| `audioUrl`        | —             | Or use `audioFilePath`                  |
| `audioFilePath`   | —             | Local file alternative                  |
| `transcriptModel` | `scribe_v1`   | `scribe_v1_experimental` also available |
| `diarize`         | `No`          | Identify speakers                       |
| `languageCode`    | auto-detect   | ISO 639-1 (e.g. `en`, `es`, `fr`)       |

Returns:
```json
{
  "success": true,
  "transcript": "Hello world, this is a test.",
  "words": [
    { "text": "Hello", "start": 0.0, "end": 0.42, "speaker_id": "speaker_1" },
    { "text": "world", "start": 0.45, "end": 0.89, "speaker_id": "speaker_1" }
  ],
  "language": "en"
}
```

### `LIST_VOICES`

Browse available voices. Filter by category:
- `all` — every voice (default)
- `premade` — ElevenLabs stock voices
- `cloned` — voices you've cloned
- `generated` — voice-designer creations
- `professional` — ElevenLabs Voice Library

### `GET_VOICE`

Get full details for a specific voice ID including preview URL, labels (age/gender/accent), and metadata.

## Output

For TTS, returns the **absolute path** to the generated audio file — pipes directly into `remotion-compose` as a voiceover track.

```json
{
  "success": true,
  "filePath": "/path/to/plugin-data/elevenlabs/123/tts_abc123.mp3",
  "sizeBytes": 284739,
  "modelUsed": "eleven_multilingual_v2",
  "voiceId": "EXAVITQu4vr4xnSDxMaL",
  "charactersUsed": 180
}
```

## Pairs With

- 🎬 **seedance-plugin** — for cinematic AI video clips
- 🎞️ **remotion-plugin** — for final branded composition with auto-generated captions

## Pipeline Example

```
Brief → LLM → script
         ↓
      elevenlabs-api (TTS)  →  voice.mp3
         ↓
      elevenlabs-api (STT)  →  captions (word-level timings)
         ↓                      ↓
      seedance-api (clips) →  remotion-compose → final.mp4
```
